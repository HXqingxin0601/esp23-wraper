use std::{
    collections::BTreeSet,
    env,
    ffi::OsStr,
    fs,
    io::{self, IsTerminal, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::SystemTime,
};

use anyhow::{Context, Result, anyhow, bail};
use clap::{ArgAction, CommandFactory, Parser, Subcommand};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const KNOWN_CHIPS: &[&str] = &[
    "esp32", "esp32c2", "esp32c3", "esp32c6", "esp32h2", "esp32s2", "esp32s3",
];
const BUILD_TASK_LABEL: &str = "espwrap: cargo build";
const FLASH_DEBUG_CONFIG_NAME: &str = "espwrap: Flash + Debug";
const ATTACH_CONFIG_NAME: &str = "espwrap: Attach";
const RUSTUP_INSTALL_URL: &str = "https://rustup.rs/";

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Wrap esp-generate and patch project-local VS Code config for probe-rs."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Generate a project via esp-generate, then patch local .vscode files.
    New {
        /// Path or command name for esp-generate.
        #[arg(long, default_value = "esp-generate")]
        esp_generate_bin: String,
        /// Auto-install supported missing tools via `cargo install`.
        #[arg(long, action = ArgAction::SetTrue)]
        install_missing: bool,
        /// Explicit project name to avoid interactive name inference ambiguity.
        #[arg(long)]
        name: Option<String>,
        /// Do not auto-add `--option vscode`.
        #[arg(long, action = ArgAction::SetTrue)]
        no_vscode_option: bool,
        /// Also add `--option probe-rs` before invoking esp-generate.
        #[arg(long, action = ArgAction::SetTrue)]
        add_probe_rs_option: bool,
        /// Skip the post-generation patching step.
        #[arg(long, action = ArgAction::SetTrue)]
        no_patch: bool,
        /// Preview .vscode changes without writing files.
        #[arg(long, action = ArgAction::SetTrue)]
        dry_run: bool,
        /// Backup existing .vscode files before overwriting.
        #[arg(long, action = ArgAction::SetTrue)]
        backup: bool,
        /// Override binary name for multi-bin projects.
        #[arg(long)]
        bin: Option<String>,
        /// Extra arguments forwarded directly to esp-generate.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        esp_generate_args: Vec<String>,
    },
    /// Patch local .vscode files for an existing project.
    Patch {
        /// Path to the target project root.
        #[arg(default_value = ".")]
        project: PathBuf,
        /// Override auto-detected chip.
        #[arg(long)]
        chip: Option<String>,
        /// Override auto-detected binary name.
        #[arg(long)]
        bin: Option<String>,
        /// Preview .vscode changes without writing files.
        #[arg(long, action = ArgAction::SetTrue)]
        dry_run: bool,
        /// Backup existing .vscode files before overwriting.
        #[arg(long, action = ArgAction::SetTrue)]
        backup: bool,
    },
    /// Check toolchain/debug dependencies and common environment issues.
    Doctor {
        /// Treat warnings as errors (non-zero exit).
        #[arg(long, action = ArgAction::SetTrue)]
        strict: bool,
        /// Attempt to install supported missing tools via `cargo install`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with = "json_output")]
        fix: bool,
        /// Emit machine-readable JSON instead of human-readable text.
        #[arg(long = "json", action = ArgAction::SetTrue)]
        json_output: bool,
    },
}

#[derive(Debug, Deserialize)]
struct CargoMetadata {
    packages: Vec<MetadataPackage>,
}

#[derive(Debug, Deserialize)]
struct MetadataPackage {
    name: String,
    manifest_path: String,
    default_run: Option<String>,
    dependencies: Vec<MetadataDependency>,
    targets: Vec<MetadataTarget>,
}

#[derive(Debug, Deserialize)]
struct MetadataDependency {
    name: String,
    features: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct MetadataTarget {
    kind: Vec<String>,
    name: String,
}

#[derive(Debug)]
struct ProjectInfo {
    root: PathBuf,
    package_name: String,
    chip: String,
    target_triple: String,
    bin_name: String,
    binary_format: String,
}

#[derive(Debug, Clone, Copy)]
struct PatchOptions {
    dry_run: bool,
    backup: bool,
}

#[derive(Debug)]
struct NewCommandOptions {
    esp_generate_bin: String,
    install_missing: bool,
    name_override: Option<String>,
    esp_generate_args: Vec<String>,
    add_vscode_option: bool,
    add_probe_rs_option: bool,
    patch_after_generate: bool,
    bin_override: Option<String>,
    patch_options: PatchOptions,
}

#[derive(Debug, Default)]
struct PatchReport {
    changed_files: Vec<PathBuf>,
    unchanged_files: Vec<PathBuf>,
    backup_files: Vec<PathBuf>,
}

#[derive(Debug)]
struct FilePatchResult {
    changed: bool,
    backup_path: Option<PathBuf>,
}

#[derive(Debug)]
struct DoctorCheckReport {
    name: String,
    status: DoctorStatus,
    detail: String,
    required: bool,
}

#[derive(Debug)]
struct InferredTarget {
    project_dir: PathBuf,
    chip: Option<String>,
}

#[derive(Debug)]
struct GenerateContext {
    output_dir: PathBuf,
    project_name: Option<String>,
    chip: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DoctorStatus {
    Ok,
    Warn,
    Fail,
}

impl DoctorStatus {
    fn as_str(self) -> &'static str {
        match self {
            DoctorStatus::Ok => "ok",
            DoctorStatus::Warn => "warn",
            DoctorStatus::Fail => "fail",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct DoctorTool {
    name: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    install_package: Option<&'static str>,
    install_hint: &'static str,
}

#[derive(Debug)]
enum ToolProbe {
    Available(String),
    Missing,
    Error(String),
}

#[derive(Debug, Clone, Copy)]
enum InstallDisposition {
    Never,
    Prompt,
    Auto,
}

fn rustc_tool() -> DoctorTool {
    DoctorTool {
        name: "rustc",
        command: "rustc",
        args: &["--version"],
        install_package: None,
        install_hint: RUSTUP_INSTALL_URL,
    }
}

fn cargo_tool() -> DoctorTool {
    DoctorTool {
        name: "cargo",
        command: "cargo",
        args: &["--version"],
        install_package: None,
        install_hint: RUSTUP_INSTALL_URL,
    }
}

fn esp_generate_tool() -> DoctorTool {
    DoctorTool {
        name: "esp-generate",
        command: "esp-generate",
        args: &["--version"],
        install_package: Some("esp-generate"),
        install_hint: "",
    }
}

fn probe_rs_tool() -> DoctorTool {
    DoctorTool {
        name: "probe-rs",
        command: "probe-rs",
        args: &["--version"],
        install_package: Some("probe-rs-tools"),
        install_hint: "",
    }
}

fn espflash_tool() -> DoctorTool {
    DoctorTool {
        name: "espflash",
        command: "espflash",
        args: &["--version"],
        install_package: Some("espflash"),
        install_hint: "",
    }
}

fn esp_config_tool() -> DoctorTool {
    DoctorTool {
        name: "esp-config",
        command: "esp-config",
        args: &["--version"],
        install_package: Some("esp-config"),
        install_hint: "",
    }
}

fn main() -> Result<()> {
    let args = env::args().collect::<Vec<_>>();
    if maybe_print_new_help(&args)? {
        return Ok(());
    }
    let cli = Cli::parse_from(args);
    match cli.command {
        Commands::New {
            esp_generate_bin,
            install_missing,
            name,
            no_vscode_option,
            add_probe_rs_option,
            no_patch,
            dry_run,
            backup,
            bin,
            esp_generate_args,
        } => cmd_new(NewCommandOptions {
            esp_generate_bin,
            install_missing,
            name_override: name,
            esp_generate_args,
            add_vscode_option: !no_vscode_option,
            add_probe_rs_option,
            patch_after_generate: !no_patch,
            bin_override: bin,
            patch_options: PatchOptions { dry_run, backup },
        }),
        Commands::Patch {
            project,
            chip,
            bin,
            dry_run,
            backup,
        } => {
            preflight_patch()?;
            let project = canonicalize_lossy(&project)?;
            patch_existing_project(&project, chip, bin, PatchOptions { dry_run, backup })
        }
        Commands::Doctor {
            strict,
            fix,
            json_output,
        } => cmd_doctor(strict, fix, json_output),
    }
}

fn maybe_print_new_help(args: &[String]) -> Result<bool> {
    if !is_new_help_request(args) {
        return Ok(false);
    }

    let mut command = Cli::command();
    if let Some(subcommand) = command.find_subcommand_mut("new") {
        subcommand.print_help()?;
        println!();
        println!();
        print_upstream_help(extract_esp_generate_bin_from_help_args(args).as_deref())?;
        return Ok(true);
    }

    Ok(false)
}

fn is_new_help_request(args: &[String]) -> bool {
    match args.get(1).map(String::as_str) {
        Some("new") => args
            .iter()
            .skip(2)
            .take_while(|arg| arg.as_str() != "--")
            .any(|arg| matches!(arg.as_str(), "-h" | "--help")),
        Some("help") => matches!(args.get(2).map(String::as_str), Some("new")),
        _ => false,
    }
}

fn extract_esp_generate_bin_from_help_args(args: &[String]) -> Option<String> {
    if !matches!(args.get(1).map(String::as_str), Some("new")) {
        return None;
    }

    let mut iter = args.iter().skip(2).peekable();
    while let Some(arg) = iter.next() {
        if arg == "--" || arg == "--help" || arg == "-h" {
            break;
        }
        match arg.as_str() {
            "--esp-generate-bin" => {
                if let Some(value) = iter.next() {
                    return Some(value.clone());
                }
            }
            value if value.starts_with("--esp-generate-bin=") => {
                return value.split_once('=').map(|(_, rhs)| rhs.to_owned());
            }
            _ => {}
        }
    }

    None
}

fn print_upstream_help(esp_generate_bin: Option<&str>) -> Result<()> {
    let esp_generate_bin = esp_generate_bin.unwrap_or("esp-generate");
    println!(
        "Forwarded `esp-generate` help (`{} --help`):",
        esp_generate_bin
    );
    println!();

    match Command::new(esp_generate_bin).arg("--help").output() {
        Ok(output) if output.status.success() => {
            let text = if output.stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).into_owned()
            } else {
                String::from_utf8_lossy(&output.stdout).into_owned()
            };
            print!("{text}");
            if !text.ends_with('\n') {
                println!();
            }
        }
        Ok(output) => {
            let detail =
                summarize_command_output(&output).unwrap_or_else(|| "no output".to_owned());
            println!(
                "(could not load upstream help from `{}`: command failed with {:?}: {})",
                esp_generate_bin,
                output.status.code(),
                detail
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            println!(
                "(could not load upstream help because `{}` was not found. Install it with `{}` or pass `--esp-generate-bin <path>`.)",
                esp_generate_bin,
                cargo_install_command("esp-generate")
            );
        }
        Err(error) => {
            println!(
                "(could not load upstream help from `{}`: {})",
                esp_generate_bin, error
            );
        }
    }

    Ok(())
}

fn preflight_new(
    esp_generate_bin: &str,
    patch_after_generate: bool,
    expect_probe_rs_workflow: bool,
    install_missing: bool,
) -> Result<()> {
    ensure_esp_generate_available(
        esp_generate_bin,
        default_install_disposition(install_missing),
    )?;
    if patch_after_generate {
        ensure_tool_available(cargo_tool(), InstallDisposition::Never)?;
    }
    if expect_probe_rs_workflow {
        warn_if_probe_rs_missing();
    }
    Ok(())
}

fn preflight_patch() -> Result<()> {
    ensure_tool_available(cargo_tool(), InstallDisposition::Never)?;
    warn_if_probe_rs_missing();
    Ok(())
}

fn default_install_disposition(install_missing: bool) -> InstallDisposition {
    if install_missing {
        InstallDisposition::Auto
    } else if can_prompt_install() {
        InstallDisposition::Prompt
    } else {
        InstallDisposition::Never
    }
}

fn default_fix_disposition(fix: bool) -> InstallDisposition {
    if !fix {
        InstallDisposition::Never
    } else if can_prompt_install() {
        InstallDisposition::Prompt
    } else {
        InstallDisposition::Auto
    }
}

fn ensure_esp_generate_available(
    esp_generate_bin: &str,
    install_disposition: InstallDisposition,
) -> Result<()> {
    if esp_generate_bin == "esp-generate" {
        return ensure_tool_available(esp_generate_tool(), install_disposition);
    }

    match probe_command(esp_generate_bin, &["--version"]) {
        ToolProbe::Available(_) => Ok(()),
        ToolProbe::Missing => bail!(
            "could not find `{}`; verify `--esp-generate-bin` or install `esp-generate` with `{}`",
            esp_generate_bin,
            cargo_install_command("esp-generate")
        ),
        ToolProbe::Error(detail) => {
            bail!(
                "failed to run `{}` before generation: {}",
                esp_generate_bin,
                detail
            )
        }
    }
}

fn ensure_tool_available(tool: DoctorTool, install_disposition: InstallDisposition) -> Result<()> {
    match probe_command(tool.command, tool.args) {
        ToolProbe::Available(_) => Ok(()),
        ToolProbe::Error(detail) => {
            bail!("required tool `{}` is not usable: {}", tool.command, detail)
        }
        ToolProbe::Missing => {
            if maybe_install_tool(tool, install_disposition)? {
                match probe_command(tool.command, tool.args) {
                    ToolProbe::Available(_) => Ok(()),
                    ToolProbe::Missing => bail!(
                        "`{}` was installed but is still unavailable on PATH. {}",
                        tool.command,
                        cargo_bin_path_guidance()
                    ),
                    ToolProbe::Error(detail) => bail!(
                        "`{}` was installed, but verification failed: {}",
                        tool.command,
                        detail
                    ),
                }
            } else {
                bail!("{}", tool_missing_detail(tool))
            }
        }
    }
}

fn maybe_install_tool(tool: DoctorTool, install_disposition: InstallDisposition) -> Result<bool> {
    let Some(package) = tool.install_package else {
        return Ok(false);
    };

    match install_disposition {
        InstallDisposition::Never => Ok(false),
        InstallDisposition::Prompt => {
            let prompt = format!(
                "`{}` is missing. Install it now with `{}`?",
                tool.command,
                cargo_install_command(package)
            );
            if !prompt_yes_no(&prompt)? {
                return Ok(false);
            }
            install_cargo_package(package, tool.name)?;
            Ok(true)
        }
        InstallDisposition::Auto => {
            install_cargo_package(package, tool.name)?;
            Ok(true)
        }
    }
}

fn install_cargo_package(package: &str, tool_name: &str) -> Result<()> {
    ensure_tool_available(cargo_tool(), InstallDisposition::Never)?;
    println!(
        "installing `{}` via `{}` ...",
        tool_name,
        cargo_install_command(package)
    );
    let status = Command::new("cargo")
        .args(["install", package, "--locked"])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to launch `cargo install {package} --locked`"))?;
    if !status.success() {
        bail!("`cargo install {package} --locked` exited with status {status}");
    }
    Ok(())
}

fn warn_if_probe_rs_missing() {
    match probe_command(probe_rs_tool().command, probe_rs_tool().args) {
        ToolProbe::Available(_) => {}
        ToolProbe::Missing => eprintln!(
            "warning: `probe-rs` is not installed. VS Code debug configs will be created, but flash/debug actions will not work until you install it with `{}`.",
            cargo_install_command("probe-rs-tools")
        ),
        ToolProbe::Error(detail) => eprintln!(
            "warning: `probe-rs` is installed but could not be verified: {}",
            detail
        ),
    }
}

fn probe_command(command: &str, args: &[&str]) -> ToolProbe {
    let output = Command::new(command).args(args).output();
    match output {
        Ok(output) if output.status.success() => ToolProbe::Available(
            summarize_command_output(&output).unwrap_or_else(|| "ok".to_owned()),
        ),
        Ok(output) => ToolProbe::Error(format!(
            "command failed (exit {:?}): {}",
            output.status.code(),
            summarize_command_output(&output).unwrap_or_else(|| "no output".to_owned())
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ToolProbe::Missing,
        Err(error) => ToolProbe::Error(error.to_string()),
    }
}

fn cargo_install_command(package: &str) -> String {
    format!("cargo install {package} --locked")
}

fn tool_missing_detail(tool: DoctorTool) -> String {
    match tool.install_package {
        Some(package) => format!(
            "{} is not installed or not on PATH; install it with `{}`",
            tool.command,
            cargo_install_command(package)
        ),
        None if !tool.install_hint.is_empty() => format!(
            "{} is not installed or not on PATH; see {}",
            tool.command, tool.install_hint
        ),
        None => format!("{} is not installed or not on PATH", tool.command),
    }
}

fn cargo_bin_path_guidance() -> String {
    detect_cargo_bin_dir()
        .map(|path| {
            format!(
                "Ensure Cargo bin is on PATH (expected {}). You may need to open a new terminal.",
                path.display()
            )
        })
        .unwrap_or_else(|| "Ensure Cargo bin is on PATH and open a new terminal.".to_owned())
}

fn can_prompt_install() -> bool {
    io::stdin().is_terminal() && io::stdout().is_terminal()
}

fn prompt_yes_no(prompt: &str) -> Result<bool> {
    print!("{prompt} [y/N]: ");
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .context("failed to read confirmation from stdin")?;

    Ok(matches!(
        input.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

fn cmd_new(options: NewCommandOptions) -> Result<()> {
    let NewCommandOptions {
        esp_generate_bin,
        install_missing,
        name_override,
        mut esp_generate_args,
        add_vscode_option,
        add_probe_rs_option,
        patch_after_generate,
        bin_override,
        patch_options,
    } = options;

    apply_name_override(&mut esp_generate_args, name_override.as_deref())?;

    if add_vscode_option && !has_option(&esp_generate_args, "vscode") {
        esp_generate_args.push("--option".to_owned());
        esp_generate_args.push("vscode".to_owned());
    }
    if add_probe_rs_option && !has_option(&esp_generate_args, "probe-rs") {
        esp_generate_args.push("--option".to_owned());
        esp_generate_args.push("probe-rs".to_owned());
    }

    let generate_context = infer_generate_context(&esp_generate_args)?;
    preflight_new(
        &esp_generate_bin,
        patch_after_generate,
        patch_after_generate || add_probe_rs_option,
        install_missing,
    )?;
    fs::create_dir_all(&generate_context.output_dir).with_context(|| {
        format!(
            "failed to create esp-generate output directory {}",
            generate_context.output_dir.display()
        )
    })?;

    let preexisting_entries = if patch_after_generate && generate_context.project_name.is_none() {
        snapshot_immediate_dirs(&generate_context.output_dir)?
    } else {
        BTreeSet::new()
    };

    let status = Command::new(&esp_generate_bin)
        .args(&esp_generate_args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to launch `{}`", esp_generate_bin))?;
    if !status.success() {
        bail!("esp-generate exited with status {status}");
    }
    if !patch_after_generate {
        return Ok(());
    }

    let inferred = match generate_context.project_name {
        Some(project_name) => InferredTarget {
            project_dir: generate_context.output_dir.join(project_name),
            chip: generate_context.chip,
        },
        None => infer_generated_project_from_snapshot(
            &generate_context.output_dir,
            &preexisting_entries,
            generate_context.chip,
        )?,
    };
    patch_existing_project(
        &inferred.project_dir,
        inferred.chip,
        bin_override,
        patch_options,
    )
}

fn cmd_doctor(strict: bool, fix: bool, json_output: bool) -> Result<()> {
    let required_tools = [rustc_tool(), cargo_tool(), esp_generate_tool()];
    let optional_tools = [probe_rs_tool(), espflash_tool(), esp_config_tool()];
    let install_disposition = default_fix_disposition(fix);

    if !json_output {
        println!("espwrap doctor");
    }

    let mut reports = Vec::new();
    for tool in &required_tools {
        let (status, detail) = check_tool(*tool, true, install_disposition);
        reports.push(DoctorCheckReport {
            name: tool.name.to_owned(),
            status,
            detail,
            required: true,
        });
    }
    for tool in &optional_tools {
        let (status, detail) = check_tool(*tool, false, install_disposition);
        reports.push(DoctorCheckReport {
            name: tool.name.to_owned(),
            status,
            detail,
            required: false,
        });
    }
    let (probe_status, probe_detail) = check_probe_scan();
    reports.push(DoctorCheckReport {
        name: "probe-scan".to_owned(),
        status: probe_status,
        detail: probe_detail,
        required: false,
    });
    let (path_status, path_detail) = check_cargo_bin_on_path();
    reports.push(DoctorCheckReport {
        name: "path".to_owned(),
        status: path_status,
        detail: path_detail,
        required: false,
    });

    let mut failures = 0usize;
    let mut warnings = 0usize;
    for report in &reports {
        if !json_output {
            print_doctor_line(report.status, &report.name, &report.detail);
        }
        match report.status {
            DoctorStatus::Fail => failures += 1,
            DoctorStatus::Warn => warnings += 1,
            DoctorStatus::Ok => {}
        }
    }

    if json_output {
        print_doctor_json(&reports, failures, warnings, strict)?;
    } else {
        println!("summary: failures={failures}, warnings={warnings}");
    }

    if failures > 0 {
        bail!("doctor found {failures} blocking issue(s)");
    }
    if strict && warnings > 0 {
        bail!("doctor strict mode failed due to {warnings} warning(s)");
    }
    Ok(())
}

fn print_doctor_json(
    reports: &[DoctorCheckReport],
    failures: usize,
    warnings: usize,
    strict: bool,
) -> Result<()> {
    let ok = failures == 0 && (!strict || warnings == 0);
    let checks = reports
        .iter()
        .map(|report| {
            json!({
                "name": report.name.as_str(),
                "status": report.status.as_str(),
                "detail": report.detail.as_str(),
                "required": report.required,
            })
        })
        .collect::<Vec<_>>();
    let payload = json!({
        "checks": checks,
        "summary": {
            "failures": failures,
            "warnings": warnings,
            "strict": strict,
            "ok": ok,
        }
    });
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}

fn patch_existing_project(
    project_root: &Path,
    chip_override: Option<String>,
    bin_override: Option<String>,
    patch_options: PatchOptions,
) -> Result<()> {
    let info = inspect_project(project_root, chip_override, bin_override)?;
    let report = patch_vscode_dir(&info, patch_options)?;

    println!("project: {}", info.package_name);
    println!("path: {}", info.root.display());
    println!("chip: {}", info.chip);
    println!("target: {}", info.target_triple);
    println!("bin: {}", info.bin_name);
    println!(
        "{} files changed, {} unchanged",
        report.changed_files.len(),
        report.unchanged_files.len()
    );
    if !report.backup_files.is_empty() {
        println!("{} backup file(s) created", report.backup_files.len());
    }
    if patch_options.dry_run {
        for path in report.changed_files {
            println!("dry-run: would update {}", path.display());
        }
    }
    Ok(())
}

fn inspect_project(
    project_root: &Path,
    chip_override: Option<String>,
    bin_override: Option<String>,
) -> Result<ProjectInfo> {
    let root = canonicalize_lossy(project_root)?;
    let manifest_path = root.join("Cargo.toml");
    if !manifest_path.exists() {
        bail!(
            "patch requires a Cargo project root, but {} does not contain a Cargo.toml",
            root.display()
        );
    }

    let metadata = cargo_metadata(&manifest_path)?;
    let package = metadata
        .packages
        .iter()
        .find(|package| paths_equal(Path::new(&package.manifest_path), &manifest_path))
        .ok_or_else(|| anyhow!("could not find package for {}", manifest_path.display()))?;

    let target_triple = detect_target_triple(&root)?;
    let chip = match chip_override {
        Some(chip) => chip,
        None => detect_chip(package)?.to_owned(),
    };
    let bin_name = match bin_override {
        Some(bin) => bin,
        None => detect_bin_name(package)?,
    };
    let binary_format = if has_dependency(package, "esp-bootloader-esp-idf") {
        "idf".to_owned()
    } else {
        "elf".to_owned()
    };

    Ok(ProjectInfo {
        root,
        package_name: package.name.clone(),
        chip,
        target_triple,
        bin_name,
        binary_format,
    })
}

fn cargo_metadata(manifest_path: &Path) -> Result<CargoMetadata> {
    let output = Command::new("cargo")
        .arg("metadata")
        .arg("--no-deps")
        .arg("--format-version")
        .arg("1")
        .arg("--manifest-path")
        .arg(manifest_path)
        .output()
        .context("failed to run `cargo metadata`")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "`cargo metadata` failed for {}: {}",
            manifest_path.display(),
            stderr.trim()
        );
    }
    serde_json::from_slice(&output.stdout).context("failed to parse `cargo metadata` JSON")
}

fn detect_target_triple(project_root: &Path) -> Result<String> {
    let config_path = project_root.join(".cargo").join("config.toml");
    let text = fs::read_to_string(&config_path).with_context(|| {
        format!(
            "failed to read {}. Expected an ESP project with `.cargo/config.toml`",
            config_path.display()
        )
    })?;
    let value: toml::Value = toml::from_str(&text)
        .with_context(|| format!("failed to parse {}", config_path.display()))?;
    value
        .get("build")
        .and_then(|value| value.get("target"))
        .and_then(toml::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            anyhow!(
                "could not find [build].target in {}. Expected an ESP project generated with a target triple",
                config_path.display()
            )
        })
}

fn detect_chip(package: &MetadataPackage) -> Result<&'static str> {
    for dependency in &package.dependencies {
        for feature in &dependency.features {
            if let Some(chip) = KNOWN_CHIPS.iter().find(|known| **known == feature) {
                return Ok(chip);
            }
        }
    }
    bail!(
        "could not detect chip from Cargo.toml features for package `{}`; pass `--chip` explicitly",
        package.name
    )
}

fn detect_bin_name(package: &MetadataPackage) -> Result<String> {
    let mut bins: Vec<&str> = package
        .targets
        .iter()
        .filter(|target| target.kind.iter().any(|kind| kind == "bin"))
        .map(|target| target.name.as_str())
        .collect();
    bins.sort_unstable();
    bins.dedup();
    match bins.as_slice() {
        [only] => Ok((*only).to_owned()),
        _ => {
            if let Some(default_run) = &package.default_run {
                if bins.iter().any(|bin| *bin == default_run) {
                    return Ok(default_run.clone());
                }
            }
            if bins.iter().any(|bin| *bin == package.name) {
                return Ok(package.name.clone());
            }
            bail!(
                "package `{}` has multiple bins ({:?}); pass `--bin <name>` explicitly",
                package.name,
                bins
            )
        }
    }
}

fn has_dependency(package: &MetadataPackage, dependency_name: &str) -> bool {
    package
        .dependencies
        .iter()
        .any(|dependency| dependency.name == dependency_name)
}

fn patch_vscode_dir(info: &ProjectInfo, options: PatchOptions) -> Result<PatchReport> {
    let vscode_dir = info.root.join(".vscode");
    fs::create_dir_all(&vscode_dir)
        .with_context(|| format!("failed to create {}", vscode_dir.display()))?;
    let mut report = PatchReport::default();

    let settings_path = vscode_dir.join("settings.json");
    record_patch_result(
        &mut report,
        settings_path.clone(),
        patch_settings_json(&settings_path, info, options)?,
    );

    let tasks_path = vscode_dir.join("tasks.json");
    record_patch_result(
        &mut report,
        tasks_path.clone(),
        patch_tasks_json(&tasks_path, options)?,
    );

    let launch_path = vscode_dir.join("launch.json");
    record_patch_result(
        &mut report,
        launch_path.clone(),
        patch_launch_json(&launch_path, info, options)?,
    );

    let extensions_path = vscode_dir.join("extensions.json");
    record_patch_result(
        &mut report,
        extensions_path.clone(),
        patch_extensions_json(&extensions_path, options)?,
    );

    Ok(report)
}

fn record_patch_result(report: &mut PatchReport, path: PathBuf, result: FilePatchResult) {
    if result.changed {
        report.changed_files.push(path);
    } else {
        report.unchanged_files.push(path);
    }
    if let Some(backup_path) = result.backup_path {
        report.backup_files.push(backup_path);
    }
}

fn patch_settings_json(
    path: &Path,
    info: &ProjectInfo,
    options: PatchOptions,
) -> Result<FilePatchResult> {
    let mut root = load_jsonc_object(path)?;
    let before = Value::Object(root.clone());
    root.insert(
        "rust-analyzer.cargo.allTargets".to_owned(),
        Value::Bool(false),
    );
    root.insert(
        "rust-analyzer.cargo.target".to_owned(),
        Value::String(info.target_triple.clone()),
    );
    write_json_update(path, &before, &Value::Object(root), options)
}

fn patch_tasks_json(path: &Path, options: PatchOptions) -> Result<FilePatchResult> {
    let mut root = load_jsonc_object(path)?;
    let before = Value::Object(root.clone());
    root.insert("version".to_owned(), Value::String("2.0.0".to_owned()));
    let tasks_value = root
        .entry("tasks".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    let tasks = tasks_value
        .as_array_mut()
        .ok_or_else(|| anyhow!("`tasks` in {} is not an array", path.display()))?;
    let build_task = json!({
        "label": BUILD_TASK_LABEL,
        "type": "shell",
        "command": "cargo",
        "args": ["build"],
        "options": { "cwd": "${workspaceFolder}" },
        "problemMatcher": ["$rustc"]
    });
    upsert_named(tasks, "label", BUILD_TASK_LABEL, build_task);
    write_json_update(path, &before, &Value::Object(root), options)
}

fn patch_launch_json(
    path: &Path,
    info: &ProjectInfo,
    options: PatchOptions,
) -> Result<FilePatchResult> {
    let mut root = load_jsonc_object(path)?;
    let before = Value::Object(root.clone());
    root.insert("version".to_owned(), Value::String("0.2.0".to_owned()));
    let configs_value = root
        .entry("configurations".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    let configs = configs_value
        .as_array_mut()
        .ok_or_else(|| anyhow!("`configurations` in {} is not an array", path.display()))?;

    let program_binary = format!("target/{}/debug/{}", info.target_triple, info.bin_name);
    let launch_config = json!({
        "type": "probe-rs-debug",
        "request": "launch",
        "name": FLASH_DEBUG_CONFIG_NAME,
        "cwd": "${workspaceFolder}",
        "preLaunchTask": BUILD_TASK_LABEL,
        "chip": info.chip,
        "flashingConfig": {
            "flashingEnabled": true,
            "haltAfterReset": true,
            "formatOptions": { "binaryFormat": info.binary_format }
        },
        "coreConfigs": [{ "coreIndex": 0, "programBinary": program_binary, "rttEnabled": true }]
    });
    let attach_config = json!({
        "type": "probe-rs-debug",
        "request": "attach",
        "name": ATTACH_CONFIG_NAME,
        "cwd": "${workspaceFolder}",
        "preLaunchTask": BUILD_TASK_LABEL,
        "chip": info.chip,
        "coreConfigs": [{
            "coreIndex": 0,
            "programBinary": format!("target/{}/debug/{}", info.target_triple, info.bin_name),
            "rttEnabled": true
        }]
    });
    upsert_launch_like(configs, "launch", launch_config);
    upsert_launch_like(configs, "attach", attach_config);
    write_json_update(path, &before, &Value::Object(root), options)
}

fn patch_extensions_json(path: &Path, options: PatchOptions) -> Result<FilePatchResult> {
    let mut root = load_jsonc_object(path)?;
    let before = Value::Object(root.clone());
    let recommendations_value = root
        .entry("recommendations".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    let recommendations = recommendations_value
        .as_array_mut()
        .ok_or_else(|| anyhow!("`recommendations` in {} is not an array", path.display()))?;
    let mut current: BTreeSet<String> = recommendations
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    for extension in [
        "rust-lang.rust-analyzer",
        "tamasfe.even-better-toml",
        "probe-rs.probe-rs-debugger",
    ] {
        current.insert(extension.to_owned());
    }
    *recommendations = current.into_iter().map(Value::String).collect();
    write_json_update(path, &before, &Value::Object(root), options)
}

fn write_json_update(
    path: &Path,
    before: &Value,
    after: &Value,
    options: PatchOptions,
) -> Result<FilePatchResult> {
    if before == after {
        return Ok(FilePatchResult {
            changed: false,
            backup_path: None,
        });
    }

    if options.dry_run {
        return Ok(FilePatchResult {
            changed: true,
            backup_path: None,
        });
    }

    let backup_path = if options.backup {
        create_backup(path)?
    } else {
        None
    };
    write_pretty_json(path, after)?;

    Ok(FilePatchResult {
        changed: true,
        backup_path,
    })
}

fn create_backup(path: &Path) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }

    let file_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| anyhow!("failed to read file name for {}", path.display()))?;

    for index in 0..=1024u16 {
        let candidate_name = if index == 0 {
            format!("{file_name}.bak")
        } else {
            format!("{file_name}.bak.{index}")
        };
        let candidate = path.with_file_name(candidate_name);
        if !candidate.exists() {
            fs::copy(path, &candidate).with_context(|| {
                format!(
                    "failed to create backup from {} to {}",
                    path.display(),
                    candidate.display()
                )
            })?;
            return Ok(Some(candidate));
        }
    }

    bail!("failed to allocate backup file name for {}", path.display())
}

fn load_jsonc_object(path: &Path) -> Result<Map<String, Value>> {
    if !path.exists() {
        return Ok(Map::new());
    }

    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }

    let value: Value =
        json5::from_str(&text).with_context(|| format!("failed to parse {}", path.display()))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow!("{} does not contain a JSON object", path.display()))
}

fn write_pretty_json(path: &Path, value: &Value) -> Result<()> {
    let text = serde_json::to_string_pretty(value)?;
    fs::write(path, format!("{text}\n"))
        .with_context(|| format!("failed to write {}", path.display()))
}

fn upsert_named(array: &mut Vec<Value>, key: &str, name: &str, new_value: Value) {
    if let Some(slot) = array.iter_mut().find(|item| {
        item.as_object()
            .and_then(|object| object.get(key))
            .and_then(Value::as_str)
            == Some(name)
    }) {
        *slot = new_value;
    } else {
        array.push(new_value);
    }
}

fn upsert_launch_like(array: &mut Vec<Value>, request: &str, new_value: Value) {
    let matching_name = new_value
        .as_object()
        .and_then(|object| object.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    if let Some(slot) = array.iter_mut().find(|item| {
        let Some(object) = item.as_object() else {
            return false;
        };
        let item_type = object.get("type").and_then(Value::as_str);
        let item_request = object.get("request").and_then(Value::as_str);
        let item_name = object.get("name").and_then(Value::as_str);

        (item_type == Some("probe-rs-debug")
            && item_request == Some(request)
            && item_name == Some(matching_name))
            || (item_type == Some("probe-rs-debug")
                && item_request == Some(request)
                && matches!(item_name, Some("Launch" | "Attach")))
    }) {
        *slot = new_value;
    } else {
        array.push(new_value);
    }
}

fn has_option(args: &[String], wanted: &str) -> bool {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--option" || arg == "-o" {
            if let Some(value) = iter.next() {
                for option in value.split(',') {
                    if option == wanted {
                        return true;
                    }
                }
            }
            continue;
        }

        if let Some(value) = arg.strip_prefix("--option=") {
            for option in value.split(',') {
                if option == wanted {
                    return true;
                }
            }
        }
    }
    false
}

fn apply_name_override(args: &mut Vec<String>, name_override: Option<&str>) -> Result<()> {
    let Some(name) = name_override else {
        return Ok(());
    };

    let inferred = infer_generate_context(args)?;
    if let Some(existing) = inferred.project_name {
        if existing == name {
            return Ok(());
        }
        bail!(
            "conflicting project names: `--name {}` and positional `{}`; keep only one",
            name,
            existing
        );
    }

    args.push(name.to_owned());
    Ok(())
}

fn infer_generate_context(args: &[String]) -> Result<GenerateContext> {
    let mut output_path: Option<PathBuf> = None;
    let mut chip: Option<String> = None;
    let mut positionals: Vec<String> = Vec::new();
    let mut iter = args.iter().peekable();

    while let Some(arg) = iter.next() {
        if arg == "--" {
            for remaining in iter {
                positionals.push(remaining.to_owned());
            }
            break;
        }

        match arg.as_str() {
            "-O" | "--output-path" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("{arg} requires a value"))?;
                output_path = Some(PathBuf::from(value));
            }
            "-c" | "--chip" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("{arg} requires a value"))?;
                chip = Some(value.clone());
            }
            "-o" | "--option" | "--toolchain" => {
                iter.next();
            }
            value if value.starts_with("--output-path=") => {
                output_path = Some(PathBuf::from(
                    value
                        .split_once('=')
                        .map(|(_, rhs)| rhs)
                        .unwrap_or_default(),
                ));
            }
            value if value.starts_with("--chip=") => {
                chip = value.split_once('=').map(|(_, rhs)| rhs.to_owned());
            }
            value if value.starts_with("--option=") || value.starts_with("--toolchain=") => {}
            value if value.starts_with('-') => {}
            value => positionals.push(value.to_owned()),
        }
    }

    let output_dir = match output_path {
        Some(path) if path.is_absolute() => path,
        Some(path) => std::env::current_dir()?.join(path),
        None => std::env::current_dir()?,
    };
    Ok(GenerateContext {
        output_dir,
        project_name: positionals.last().cloned(),
        chip,
    })
}

fn snapshot_immediate_dirs(root: &Path) -> Result<BTreeSet<String>> {
    let mut entries = BTreeSet::new();
    for entry in fs::read_dir(root).with_context(|| format!("failed to read {}", root.display()))? {
        let entry = entry.with_context(|| format!("failed to read entry in {}", root.display()))?;
        if entry
            .file_type()
            .with_context(|| format!("failed to inspect {}", entry.path().display()))?
            .is_dir()
        {
            entries.insert(entry.file_name().to_string_lossy().to_string());
        }
    }
    Ok(entries)
}

fn infer_generated_project_from_snapshot(
    output_dir: &Path,
    preexisting_entries: &BTreeSet<String>,
    chip: Option<String>,
) -> Result<InferredTarget> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(output_dir)
        .with_context(|| format!("failed to read {}", output_dir.display()))?
    {
        let entry =
            entry.with_context(|| format!("failed to read entry in {}", output_dir.display()))?;
        let file_type = entry
            .file_type()
            .with_context(|| format!("failed to inspect {}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if preexisting_entries.contains(&name) {
            continue;
        }

        let project_dir = entry.path();
        if !project_dir.join("Cargo.toml").exists() {
            continue;
        }
        let modified_at = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        candidates.push((project_dir, modified_at));
    }

    candidates.sort_by_key(|(_, modified_at)| *modified_at);
    match candidates.as_slice() {
        [(project_dir, _)] => Ok(InferredTarget {
            project_dir: project_dir.clone(),
            chip,
        }),
        [] => bail!(
            "unable to infer generated project path from interactive esp-generate run in {}; pass --name or run `espwrap patch <path>`",
            output_dir.display()
        ),
        _ => {
            let paths = candidates
                .iter()
                .map(|(path, _)| path.display().to_string())
                .collect::<Vec<_>>();
            bail!(
                "multiple new Cargo projects were created in {}: {:?}; run `espwrap patch <path>` for the one you want",
                output_dir.display(),
                paths
            )
        }
    }
}

fn check_tool(
    tool: DoctorTool,
    required: bool,
    install_disposition: InstallDisposition,
) -> (DoctorStatus, String) {
    let missing_status = if required {
        DoctorStatus::Fail
    } else {
        DoctorStatus::Warn
    };

    match probe_command(tool.command, tool.args) {
        ToolProbe::Available(detail) => (DoctorStatus::Ok, detail),
        ToolProbe::Error(detail) => (missing_status, detail),
        ToolProbe::Missing => {
            if tool.install_package.is_some()
                && !matches!(install_disposition, InstallDisposition::Never)
            {
                match maybe_install_tool(tool, install_disposition) {
                    Ok(true) => match probe_command(tool.command, tool.args) {
                        ToolProbe::Available(detail) => (
                            DoctorStatus::Ok,
                            format!("installed successfully; {detail}"),
                        ),
                        ToolProbe::Missing => (
                            missing_status,
                            format!(
                                "`{}` was installed but is still unavailable on PATH. {}",
                                tool.command,
                                cargo_bin_path_guidance()
                            ),
                        ),
                        ToolProbe::Error(detail) => (
                            missing_status,
                            format!(
                                "`{}` was installed, but verification failed: {detail}",
                                tool.command
                            ),
                        ),
                    },
                    Ok(false) => (missing_status, tool_missing_detail(tool)),
                    Err(error) => (
                        missing_status,
                        format!("failed to install `{}`: {error}", tool.command),
                    ),
                }
            } else {
                (missing_status, tool_missing_detail(tool))
            }
        }
    }
}

fn check_probe_scan() -> (DoctorStatus, String) {
    let output = Command::new("probe-rs").arg("list").output();
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let probes: Vec<&str> = stdout
                .lines()
                .filter(|line| !line.trim().is_empty())
                .collect();
            if probes.is_empty() {
                (
                    DoctorStatus::Warn,
                    "probe-rs is installed but no probe was detected".to_owned(),
                )
            } else {
                (
                    DoctorStatus::Ok,
                    format!("{} probe(s) detected", probes.len()),
                )
            }
        }
        Ok(output) => (
            DoctorStatus::Warn,
            format!(
                "`probe-rs list` failed: {}",
                summarize_command_output(&output).unwrap_or_else(|| "no output".to_owned())
            ),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            DoctorStatus::Warn,
            "probe-rs is not installed; probe scan skipped".to_owned(),
        ),
        Err(error) => (
            DoctorStatus::Warn,
            format!("failed to run `probe-rs list`: {error}"),
        ),
    }
}

fn check_cargo_bin_on_path() -> (DoctorStatus, String) {
    let Some(cargo_bin) = detect_cargo_bin_dir() else {
        return (
            DoctorStatus::Warn,
            "could not determine Cargo bin directory".to_owned(),
        );
    };

    if path_has_entry(&cargo_bin) {
        (
            DoctorStatus::Ok,
            format!("Cargo bin is on PATH: {}", cargo_bin.display()),
        )
    } else {
        (
            DoctorStatus::Warn,
            format!("Cargo bin is not on PATH: {}", cargo_bin.display()),
        )
    }
}

fn detect_cargo_bin_dir() -> Option<PathBuf> {
    if let Some(cargo_home) = env::var_os("CARGO_HOME") {
        return Some(PathBuf::from(cargo_home).join("bin"));
    }
    let home = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".cargo").join("bin"))
}

fn path_has_entry(target: &Path) -> bool {
    let Some(path_value) = env::var_os("PATH") else {
        return false;
    };
    for entry in env::split_paths(&path_value) {
        if paths_equal(&entry, target) {
            return true;
        }
    }
    false
}

fn summarize_command_output(output: &std::process::Output) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) {
        return Some(line.trim().to_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_owned())
}

fn print_doctor_line(status: DoctorStatus, name: &str, detail: &str) {
    let label = match status {
        DoctorStatus::Ok => "[ok]",
        DoctorStatus::Warn => "[warn]",
        DoctorStatus::Fail => "[fail]",
    };
    println!("{label:<7} {name:<12} {detail}");
}

fn canonicalize_lossy(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        fs::canonicalize(path).with_context(|| format!("failed to canonicalize {}", path.display()))
    } else {
        let base = std::env::current_dir()?;
        Ok(base.join(path))
    }
}

fn paths_equal(lhs: &Path, rhs: &Path) -> bool {
    normalize_path(lhs) == normalize_path(rhs)
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::{
        Cli, Commands, PatchOptions, apply_name_override, cargo_install_command, create_backup,
        has_option, infer_generate_context, infer_generated_project_from_snapshot, rustc_tool,
        tool_missing_detail, write_json_update,
    };
    use clap::Parser;
    use serde_json::{Map, Value};
    use std::{
        collections::BTreeSet,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn parses_new_install_missing_flag() {
        let cli = Cli::try_parse_from(["espwrap", "new", "--install-missing", "--name", "demo"])
            .expect("cli parse should succeed");
        match cli.command {
            Commands::New {
                install_missing,
                name,
                ..
            } => {
                assert!(install_missing);
                assert_eq!(name.as_deref(), Some("demo"));
            }
            other => panic!("unexpected command parsed: {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_fix_flag() {
        let cli =
            Cli::try_parse_from(["espwrap", "doctor", "--fix"]).expect("cli parse should succeed");
        match cli.command {
            Commands::Doctor {
                fix,
                strict,
                json_output,
            } => {
                assert!(fix);
                assert!(!strict);
                assert!(!json_output);
            }
            other => panic!("unexpected command parsed: {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_json_flag() {
        let cli =
            Cli::try_parse_from(["espwrap", "doctor", "--json"]).expect("cli parse should succeed");
        match cli.command {
            Commands::Doctor {
                fix,
                strict,
                json_output,
            } => {
                assert!(!fix);
                assert!(!strict);
                assert!(json_output);
            }
            other => panic!("unexpected command parsed: {other:?}"),
        }
    }

    #[test]
    fn formats_cargo_install_commands() {
        assert_eq!(
            cargo_install_command("esp-generate"),
            "cargo install esp-generate --locked"
        );
    }

    #[test]
    fn missing_tool_detail_uses_url_for_rust_tools() {
        let detail = tool_missing_detail(rustc_tool());
        assert!(detail.contains("rustc is not installed"));
        assert!(detail.contains("https://rustup.rs/"));
    }

    #[test]
    fn detects_auto_added_options() {
        let args = vec![
            "--chip".to_owned(),
            "esp32c3".to_owned(),
            "--option".to_owned(),
            "vscode".to_owned(),
            "--option=probe-rs".to_owned(),
            "demo".to_owned(),
        ];
        assert!(has_option(&args, "vscode"));
        assert!(has_option(&args, "probe-rs"));
        assert!(!has_option(&args, "wifi"));
    }

    #[test]
    fn infers_project_dir_and_chip() {
        let args = vec![
            "--headless".to_owned(),
            "--chip".to_owned(),
            "esp32c3".to_owned(),
            "--output-path".to_owned(),
            "generated".to_owned(),
            "demo".to_owned(),
        ];
        let context = infer_generate_context(&args).expect("context inference should succeed");
        assert_eq!(context.chip.as_deref(), Some("esp32c3"));
        assert_eq!(context.project_name.as_deref(), Some("demo"));
        assert_eq!(
            context.output_dir.join("demo"),
            std::env::current_dir()
                .unwrap()
                .join(PathBuf::from("generated").join("demo"))
        );
    }

    #[test]
    fn infers_interactive_generate_context_without_name() {
        let args = vec![
            "--chip".to_owned(),
            "esp32c3".to_owned(),
            "--output-path".to_owned(),
            "generated".to_owned(),
            "-o".to_owned(),
            "vscode".to_owned(),
        ];
        let context = infer_generate_context(&args).expect("context inference should succeed");
        assert_eq!(context.chip.as_deref(), Some("esp32c3"));
        assert_eq!(context.project_name, None);
        assert_eq!(
            context.output_dir,
            std::env::current_dir().unwrap().join("generated")
        );
    }

    #[test]
    fn applies_name_override_when_missing() {
        let mut args = vec![
            "--chip".to_owned(),
            "esp32c3".to_owned(),
            "--headless".to_owned(),
        ];
        apply_name_override(&mut args, Some("myproj")).expect("override should succeed");
        assert_eq!(args.last().map(String::as_str), Some("myproj"));
    }

    #[test]
    fn rejects_conflicting_name_override() {
        let mut args = vec!["--chip".to_owned(), "esp32c3".to_owned(), "demo".to_owned()];
        let error = apply_name_override(&mut args, Some("other"))
            .expect_err("override should fail on conflict");
        assert!(error.to_string().contains("conflicting project names"));
    }

    #[test]
    fn infers_generated_project_from_directory_snapshot() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("espwrap-test-{unique}"));
        let existing = root.join("existing");
        let created = root.join("fresh-proj");

        fs::create_dir_all(&existing).expect("should create existing dir");
        fs::create_dir_all(&created).expect("should create generated dir");
        fs::write(
            created.join("Cargo.toml"),
            "[package]\nname='fresh-proj'\nversion='0.1.0'\n",
        )
        .expect("should create Cargo.toml");

        let mut snapshot = BTreeSet::new();
        snapshot.insert("existing".to_owned());

        let inferred =
            infer_generated_project_from_snapshot(&root, &snapshot, Some("esp32c3".to_owned()))
                .expect("should infer created project");
        assert_eq!(inferred.project_dir, created);
        assert_eq!(inferred.chip.as_deref(), Some("esp32c3"));

        fs::remove_dir_all(&root).expect("should clean temp directory");
    }

    #[test]
    fn create_backup_uses_numeric_suffix_when_needed() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("espwrap-backup-{unique}"));
        fs::create_dir_all(&root).expect("should create temp directory");

        let target = root.join("launch.json");
        fs::write(&target, "{ \"a\": 1 }").expect("should create launch.json");
        fs::write(root.join("launch.json.bak"), "old").expect("should create existing backup");

        let backup = create_backup(&target)
            .expect("backup should succeed")
            .expect("backup path should exist");
        assert_eq!(
            backup.file_name().and_then(|name| name.to_str()),
            Some("launch.json.bak.1")
        );

        fs::remove_dir_all(&root).expect("should clean temp directory");
    }

    #[test]
    fn write_json_update_respects_dry_run() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("espwrap-dryrun-{unique}"));
        fs::create_dir_all(&root).expect("should create temp directory");

        let target = root.join("settings.json");
        fs::write(&target, "{ \"a\": 1 }\n").expect("should create settings file");

        let mut before = Map::new();
        before.insert("a".to_owned(), Value::Number(1.into()));
        let before = Value::Object(before);

        let mut after = Map::new();
        after.insert("a".to_owned(), Value::Number(1.into()));
        after.insert("b".to_owned(), Value::Bool(true));
        let after = Value::Object(after);

        let result = write_json_update(
            &target,
            &before,
            &after,
            PatchOptions {
                dry_run: true,
                backup: true,
            },
        )
        .expect("dry-run write should succeed");

        assert!(result.changed);
        assert!(!root.join("settings.json.bak").exists());
        let text = fs::read_to_string(&target).expect("should still read original file");
        assert!(!text.contains("\"b\""));

        fs::remove_dir_all(&root).expect("should clean temp directory");
    }
}

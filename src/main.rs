use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
    process::{Command, Stdio},
};

use anyhow::{Context, Result, anyhow, bail};
use clap::{ArgAction, Parser, Subcommand};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const KNOWN_CHIPS: &[&str] = &[
    "esp32", "esp32c2", "esp32c3", "esp32c6", "esp32h2", "esp32s2", "esp32s3",
];

const BUILD_TASK_LABEL: &str = "espwrap: cargo build";
const FLASH_DEBUG_CONFIG_NAME: &str = "espwrap: Flash + Debug";
const ATTACH_CONFIG_NAME: &str = "espwrap: Attach";

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
    /// Generate a new project via esp-generate, then patch the generated project's .vscode files.
    New {
        /// Path or command name for esp-generate.
        #[arg(long, default_value = "esp-generate")]
        esp_generate_bin: String,

        /// Do not auto-add `--option vscode`.
        #[arg(long, action = ArgAction::SetTrue)]
        no_vscode_option: bool,

        /// Also add `--option probe-rs` before invoking esp-generate.
        ///
        /// This is opt-in because esp-generate marks some options, such as
        /// `log`, as incompatible with `probe-rs`.
        #[arg(long, action = ArgAction::SetTrue)]
        add_probe_rs_option: bool,

        /// Skip the post-generation patching step.
        #[arg(long, action = ArgAction::SetTrue)]
        no_patch: bool,

        /// Override the debug binary name if the generated project has multiple bins.
        #[arg(long)]
        bin: Option<String>,

        /// Extra arguments forwarded to esp-generate.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        esp_generate_args: Vec<String>,
    },

    /// Patch an existing generated project's local .vscode files.
    Patch {
        /// Path to the project root.
        #[arg(default_value = ".")]
        project: PathBuf,

        /// Override detected chip name.
        #[arg(long)]
        chip: Option<String>,

        /// Override detected debug binary name.
        #[arg(long)]
        bin: Option<String>,
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

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::New {
            esp_generate_bin,
            no_vscode_option,
            add_probe_rs_option,
            no_patch,
            bin,
            esp_generate_args,
        } => cmd_new(
            &esp_generate_bin,
            esp_generate_args,
            !no_vscode_option,
            add_probe_rs_option,
            !no_patch,
            bin,
        ),
        Commands::Patch { project, chip, bin } => {
            let project = canonicalize_lossy(&project)?;
            patch_existing_project(&project, chip, bin)
        }
    }
}

fn cmd_new(
    esp_generate_bin: &str,
    mut esp_generate_args: Vec<String>,
    add_vscode_option: bool,
    add_probe_rs_option: bool,
    patch_after_generate: bool,
    bin_override: Option<String>,
) -> Result<()> {
    if add_vscode_option && !has_option(&esp_generate_args, "vscode") {
        esp_generate_args.push("--option".to_owned());
        esp_generate_args.push("vscode".to_owned());
    }

    if add_probe_rs_option && !has_option(&esp_generate_args, "probe-rs") {
        esp_generate_args.push("--option".to_owned());
        esp_generate_args.push("probe-rs".to_owned());
    }

    let generate_context = infer_generate_context(&esp_generate_args)?;

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

    let status = Command::new(esp_generate_bin)
        .args(&esp_generate_args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to launch `{esp_generate_bin}`"))?;

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

    patch_existing_project(&inferred.project_dir, inferred.chip, bin_override)
}

fn patch_existing_project(
    project_root: &Path,
    chip_override: Option<String>,
    bin_override: Option<String>,
) -> Result<()> {
    let info = inspect_project(project_root, chip_override, bin_override)?;
    patch_vscode_dir(&info)?;

    println!(
        "patched .vscode for `{}` at {}",
        info.package_name,
        info.root.display()
    );
    println!("chip: {}", info.chip);
    println!("target: {}", info.target_triple);
    println!("bin: {}", info.bin_name);

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
        bail!("{} does not contain a Cargo.toml", root.display());
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
        bail!("`cargo metadata` failed: {stderr}");
    }

    serde_json::from_slice(&output.stdout).context("failed to parse `cargo metadata` JSON")
}

fn detect_target_triple(project_root: &Path) -> Result<String> {
    let config_path = project_root.join(".cargo").join("config.toml");
    let text = fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let value: toml::Value = toml::from_str(&text)
        .with_context(|| format!("failed to parse {}", config_path.display()))?;

    value
        .get("build")
        .and_then(|value| value.get("target"))
        .and_then(toml::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("could not find [build].target in {}", config_path.display()))
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

fn patch_vscode_dir(info: &ProjectInfo) -> Result<()> {
    let vscode_dir = info.root.join(".vscode");
    fs::create_dir_all(&vscode_dir)
        .with_context(|| format!("failed to create {}", vscode_dir.display()))?;

    patch_settings_json(&vscode_dir.join("settings.json"), info)?;
    patch_tasks_json(&vscode_dir.join("tasks.json"))?;
    patch_launch_json(&vscode_dir.join("launch.json"), info)?;
    patch_extensions_json(&vscode_dir.join("extensions.json"))?;

    Ok(())
}

fn patch_settings_json(path: &Path, info: &ProjectInfo) -> Result<()> {
    let mut root = load_jsonc_object(path)?;
    root.insert(
        "rust-analyzer.cargo.allTargets".to_owned(),
        Value::Bool(false),
    );
    root.insert(
        "rust-analyzer.cargo.target".to_owned(),
        Value::String(info.target_triple.clone()),
    );
    write_pretty_json(path, &Value::Object(root))
}

fn patch_tasks_json(path: &Path) -> Result<()> {
    let mut root = load_jsonc_object(path)?;
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
        "options": {
            "cwd": "${workspaceFolder}"
        },
        "problemMatcher": ["$rustc"]
    });

    upsert_named(tasks, "label", BUILD_TASK_LABEL, build_task);
    write_pretty_json(path, &Value::Object(root))
}

fn patch_launch_json(path: &Path, info: &ProjectInfo) -> Result<()> {
    let mut root = load_jsonc_object(path)?;
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
            "formatOptions": {
                "binaryFormat": info.binary_format
            }
        },
        "coreConfigs": [
            {
                "coreIndex": 0,
                "programBinary": program_binary,
                "rttEnabled": true
            }
        ]
    });

    let attach_config = json!({
        "type": "probe-rs-debug",
        "request": "attach",
        "name": ATTACH_CONFIG_NAME,
        "cwd": "${workspaceFolder}",
        "preLaunchTask": BUILD_TASK_LABEL,
        "chip": info.chip,
        "coreConfigs": [
            {
                "coreIndex": 0,
                "programBinary": format!(
                    "target/{}/debug/{}",
                    info.target_triple, info.bin_name
                ),
                "rttEnabled": true
            }
        ]
    });

    upsert_launch_like(configs, "launch", launch_config);
    upsert_launch_like(configs, "attach", attach_config);

    write_pretty_json(path, &Value::Object(root))
}

fn patch_extensions_json(path: &Path) -> Result<()> {
    let mut root = load_jsonc_object(path)?;
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
    write_pretty_json(path, &Value::Object(root))
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

fn infer_generate_context(args: &[String]) -> Result<GenerateContext> {
    let mut output_path: Option<PathBuf> = None;
    let mut chip: Option<String> = None;
    let mut positionals: Vec<String> = Vec::new();
    let mut iter = args.iter().peekable();

    while let Some(arg) = iter.next() {
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

    let output_path = match output_path {
        Some(path) if path.is_absolute() => path,
        Some(path) => std::env::current_dir()?.join(path),
        None => std::env::current_dir()?,
    };

    Ok(GenerateContext {
        output_dir: output_path,
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

    for entry in
        fs::read_dir(output_dir).with_context(|| format!("failed to read {}", output_dir.display()))?
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
            "unable to infer generated project path from interactive esp-generate run in {}; pass NAME on the command line or run `espwrap patch <path>`",
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
        has_option, infer_generate_context, infer_generated_project_from_snapshot,
    };
    use std::{
        collections::BTreeSet,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

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
        assert_eq!(context.output_dir, std::env::current_dir().unwrap().join("generated"));
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
        fs::write(created.join("Cargo.toml"), "[package]\nname='fresh-proj'\nversion='0.1.0'\n")
            .expect("should create Cargo.toml");

        let mut snapshot = BTreeSet::new();
        snapshot.insert("existing".to_owned());

        let inferred = infer_generated_project_from_snapshot(
            &root,
            &snapshot,
            Some("esp32c3".to_owned()),
        )
        .expect("should infer created project");

        assert_eq!(inferred.project_dir, created);
        assert_eq!(inferred.chip.as_deref(), Some("esp32c3"));

        fs::remove_dir_all(&root).expect("should clean temp directory");
    }
}

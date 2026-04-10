use assert_cmd::prelude::*;
use predicates::prelude::*;
use std::{fs, path::Path, process::Command};
use tempfile::tempdir;

#[test]
fn doctor_json_outputs_parseable_report() {
    let output = Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args(["doctor", "--json"])
        .output()
        .expect("doctor --json should run");

    assert!(
        output.status.success() || output.status.code() == Some(1),
        "doctor --json should exit with 0 or 1, got {:?}",
        output.status.code()
    );
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("doctor found"),
            "expected doctor failure detail in stderr, got: {stderr}"
        );
    }

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("doctor --json should emit valid JSON");
    let checks = value["checks"]
        .as_array()
        .expect("checks should be an array");
    assert!(!checks.is_empty(), "checks should not be empty");
    assert!(
        checks.iter().any(|item| item["name"] == "rustc"),
        "report should include rustc"
    );
    assert!(value["summary"]["failures"].is_number());
    assert!(value["summary"]["warnings"].is_number());
    assert!(value["summary"]["ok"].is_boolean());
}

#[test]
fn new_fails_early_with_actionable_generator_error() {
    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "new",
            "--esp-generate-bin",
            "definitely-missing-esp-generate",
            "--name",
            "demo",
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("verify `--esp-generate-bin`"))
        .stderr(predicate::str::contains(
            "cargo install esp-generate --locked",
        ));
}

#[test]
fn new_help_includes_wrapped_and_upstream_flags() {
    let temp = tempdir().expect("temp dir should exist");
    let fake_generator = write_fake_generator_help(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "new",
            "--esp-generate-bin",
            fake_generator.to_str().expect("path should be utf-8"),
            "--help",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("--install-missing"))
        .stdout(predicate::str::contains("--debug-backend"))
        .stdout(predicate::str::contains("Forwarded `esp-generate` help"))
        .stdout(predicate::str::contains("MOCK ESP-GENERATE HELP"))
        .stdout(predicate::str::contains("--headless"));
}

#[test]
fn patch_empty_directory_reports_cargo_project_requirement() {
    let temp = tempdir().expect("temp dir should exist");

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args(["patch", temp.path().to_str().expect("path should be utf-8")])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "patch requires a Cargo project root",
        ));
}

#[test]
fn patch_writes_expected_vscode_files_for_valid_project() {
    let temp = tempdir().expect("temp dir should exist");
    write_patchable_project(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("4 files changed, 0 unchanged"))
        .stdout(predicate::str::contains("chip: esp32c3"))
        .stdout(predicate::str::contains("debug backend: probe-rs"));

    let settings = fs::read_to_string(temp.path().join(".vscode").join("settings.json"))
        .expect("settings should exist");
    assert!(settings.contains("\"rust-analyzer.cargo.target\": \"riscv32imc-unknown-none-elf\""));

    let tasks = fs::read_to_string(temp.path().join(".vscode").join("tasks.json"))
        .expect("tasks should exist");
    assert!(tasks.contains("\"label\": \"espwrap: cargo build\""));

    let launch = fs::read_to_string(temp.path().join(".vscode").join("launch.json"))
        .expect("launch should exist");
    assert!(launch.contains("\"name\": \"espwrap: Flash + Debug\""));
    assert!(launch.contains("\"chip\": \"esp32c3\""));
    assert!(
        launch.contains("\"programBinary\": \"target/riscv32imc-unknown-none-elf/debug/demo\"")
    );

    let extensions = fs::read_to_string(temp.path().join(".vscode").join("extensions.json"))
        .expect("extensions should exist");
    assert!(extensions.contains("\"probe-rs.probe-rs-debugger\""));
    assert!(!extensions.contains("\"marus25.cortex-debug\""));
}

#[test]
fn patch_writes_openocd_vscode_files_when_requested() {
    let temp = tempdir().expect("temp dir should exist");
    write_patchable_project(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
            "--debug-backend",
            "openocd",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("debug backend: openocd"));

    let launch = fs::read_to_string(temp.path().join(".vscode").join("launch.json"))
        .expect("launch should exist");
    assert!(launch.contains("\"type\": \"cortex-debug\""));
    assert!(launch.contains("\"servertype\": \"openocd\""));
    assert!(launch.contains("\"gdbPath\": \"riscv32-esp-elf-gdb\""));
    assert!(launch.contains("\"board/esp32c3-builtin.cfg\""));
    assert!(launch.contains("\"executable\": \"target/riscv32imc-unknown-none-elf/debug/demo\""));

    let extensions = fs::read_to_string(temp.path().join(".vscode").join("extensions.json"))
        .expect("extensions should exist");
    assert!(extensions.contains("\"marus25.cortex-debug\""));
    assert!(!extensions.contains("\"probe-rs.probe-rs-debugger\""));
}

#[test]
fn patch_honors_custom_openocd_config_files() {
    let temp = tempdir().expect("temp dir should exist");
    write_patchable_project(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
            "--debug-backend",
            "openocd",
            "--openocd-config",
            "interface/ftdi/esp32_devkitj_v1.cfg",
            "--openocd-config",
            "board/esp32c3-builtin.cfg",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "openocd configs: interface/ftdi/esp32_devkitj_v1.cfg, board/esp32c3-builtin.cfg",
        ));

    let launch = fs::read_to_string(temp.path().join(".vscode").join("launch.json"))
        .expect("launch should exist");
    assert!(launch.contains("\"interface/ftdi/esp32_devkitj_v1.cfg\""));
    assert!(launch.contains("\"board/esp32c3-builtin.cfg\""));
}

#[test]
fn patch_rejects_openocd_configs_without_openocd_backend() {
    let temp = tempdir().expect("temp dir should exist");
    write_patchable_project(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
            "--openocd-config",
            "board/custom.cfg",
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "`--openocd-config` requires `--debug-backend openocd`",
        ));
}

#[test]
fn patch_none_backend_removes_managed_debug_entries() {
    let temp = tempdir().expect("temp dir should exist");
    write_patchable_project(temp.path());

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
        ])
        .assert()
        .success();

    Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args([
            "patch",
            temp.path().to_str().expect("path should be utf-8"),
            "--chip",
            "esp32c3",
            "--debug-backend",
            "none",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("debug backend: none"));

    let launch = fs::read_to_string(temp.path().join(".vscode").join("launch.json"))
        .expect("launch should exist");
    assert!(!launch.contains("\"probe-rs-debug\""));
    assert!(!launch.contains("\"cortex-debug\""));
    assert!(!launch.contains("\"name\": \"espwrap: Flash + Debug\""));

    let extensions = fs::read_to_string(temp.path().join(".vscode").join("extensions.json"))
        .expect("extensions should exist");
    assert!(!extensions.contains("\"probe-rs.probe-rs-debugger\""));
    assert!(!extensions.contains("\"marus25.cortex-debug\""));
}

fn write_fake_generator_help(root: &Path) -> std::path::PathBuf {
    if cfg!(windows) {
        let path = root.join("fake-esp-generate.cmd");
        fs::write(
            &path,
            "@echo off\r\necho MOCK ESP-GENERATE HELP\r\necho   --headless    Run in headless mode\r\n",
        )
        .expect("should write mock generator");
        path
    } else {
        let path = root.join("fake-esp-generate");
        fs::write(
            &path,
            "#!/bin/sh\necho 'MOCK ESP-GENERATE HELP'\necho '  --headless    Run in headless mode'\n",
        )
        .expect("should write mock generator");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&path)
                .expect("metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).expect("should set executable bit");
        }
        path
    }
}

fn write_patchable_project(root: &Path) {
    fs::create_dir_all(root.join("src")).expect("should create src directory");
    fs::create_dir_all(root.join(".cargo")).expect("should create cargo config directory");
    fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2024\"\n\n[[bin]]\nname = \"demo\"\npath = \"src/main.rs\"\n",
    )
    .expect("should write Cargo.toml");
    fs::write(root.join("src").join("main.rs"), "fn main() {}\n").expect("should write main.rs");
    fs::write(
        root.join(".cargo").join("config.toml"),
        "[build]\ntarget = \"riscv32imc-unknown-none-elf\"\n",
    )
    .expect("should write cargo config");
}

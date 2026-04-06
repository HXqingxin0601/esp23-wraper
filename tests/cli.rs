use assert_cmd::prelude::*;
use predicates::prelude::*;
use std::{fs, path::Path, process::Command};
use tempfile::tempdir;

#[test]
fn doctor_json_outputs_parseable_report() {
    let output = Command::cargo_bin("espwrap")
        .expect("binary should build")
        .args(["doctor", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let value: serde_json::Value =
        serde_json::from_slice(&output).expect("doctor --json should emit valid JSON");
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

# espwrap

`espwrap` is a host-side CLI that wraps `esp-generate` and patches project-local
VS Code debug configuration for `probe-rs`.

It only edits files in the target project, never VS Code user/global settings.

## What it solves

- Generate an ESP Rust project with `esp-generate`.
- Auto-patch local `.vscode/*.json` with project-specific values:
  - chip
  - target triple
  - binary path
  - `probe-rs` launch/attach entries
- Keep existing JSON files and merge updates instead of replacing blindly.
- Provide diagnostics via `espwrap doctor`.

## Commands

```text
espwrap new     # generate + patch
espwrap patch   # patch an existing project
espwrap doctor  # verify local toolchain and debug dependencies
```

## Installation

### Prerequisites

- Rust toolchain (`cargo`, `rustc`)
- `esp-generate`

Install `esp-generate` if needed:

```powershell
cargo install esp-generate --locked
```

### Global install (Windows)

```powershell
cd tools\espwrap
.\install.cmd
```

Or:

```powershell
cd tools\espwrap
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Global install (macOS/Linux)

```bash
cd tools/espwrap
./install.sh
```

### Verify

```powershell
espwrap --version
espwrap --help
```

## Usage

### 1) Create project (recommended: explicit name)

```powershell
espwrap new --headless --chip esp32c3 --name myproj
```

### 2) Create project and enable additional template options

```powershell
espwrap new --headless --chip esp32c3 --name myproj -- -o unstable-hal -o embassy
```

Notes:

- `espwrap` forwards extra args after `--` directly to `esp-generate`.
- `--option vscode` is auto-added unless `--no-vscode-option` is used.
- `--option probe-rs` is opt-in via `--add-probe-rs-option`.

### 3) Patch existing project

```powershell
espwrap patch d:\path\to\project
```

Useful flags:

- `--dry-run`: preview changes without writing files.
- `--backup`: create `*.bak` backups before overwriting.
- `--chip <chip>`: force chip if auto-detect is ambiguous.
- `--bin <name>`: force binary name in multi-bin projects.

### 4) Diagnose environment

```powershell
espwrap doctor
espwrap doctor --strict
```

`doctor` checks required and optional tools, probe visibility, and Cargo bin PATH.

## Files espwrap patches

- `.vscode/settings.json`
- `.vscode/tasks.json`
- `.vscode/launch.json`
- `.vscode/extensions.json`

Only these project-local files are touched.

## Development

```powershell
cd tools\espwrap
cargo fmt
cargo build
cargo test --no-run
```

If your environment blocks running freshly built binaries, `cargo test --no-run`
still validates compilation of all test targets.

## Roadmap

- Add richer `doctor` checks for USB/JTAG drivers per platform.
- Add optional JSON output mode for CI integrations.
- Add end-to-end integration tests for generated template projects.

## License

MIT. See [LICENSE](LICENSE).

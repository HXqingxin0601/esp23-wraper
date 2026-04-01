# espwrap

`espwrap` is a small host-side CLI that wraps `esp-generate` and patches the
generated project's local `.vscode/*.json` files for `probe-rs`.

It does **not** edit VS Code user defaults. It only edits the generated
project's own:

- `.vscode/launch.json`
- `.vscode/tasks.json`
- `.vscode/settings.json`
- `.vscode/extensions.json`

## Why this exists

`esp-generate` can already create VS Code files, but those files are generic.
`espwrap` fills in project-specific values such as:

- `chip`
- `programBinary`
- Rust target triple
- `probe-rs` launch / attach config

It also merges into existing VS Code files instead of blindly overwriting them.

## Install globally

If you want to use it as a global command:

```powershell
cd tools\espwrap
.\install.ps1
```

That script:

- detects your Rust host target triple automatically
- installs `espwrap` with `cargo install`
- forces a host-side install instead of inheriting the parent embedded target
- uses `--locked` for reproducibility
- uses `--force` by default so updating is easy during development

If PowerShell script execution is restricted, use:

```powershell
cd tools\espwrap
.\install.cmd
```

To uninstall:

```powershell
cd tools\espwrap
.\uninstall.ps1
```

After installation, verify with:

```powershell
espwrap --help
Get-Command espwrap
where.exe espwrap
```

If `where.exe espwrap` finds nothing, check whether this directory is on your PATH:

```text
C:\Users\<you>\.cargo\bin
```

## Usage

Run it from this directory so it builds as a host-side Windows CLI instead of
inheriting the parent embedded target:

```powershell
cd tools\espwrap
cargo run -- new --headless --chip esp32c3 your-project
```

If you want `esp-generate` itself to also enable the `probe-rs` template
option, add:

```powershell
cargo run -- new --add-probe-rs-option --headless --chip esp32c3 your-project
```

That flag is opt-in because `esp-generate` marks some options, such as `log`,
as incompatible with `probe-rs`.

To patch an existing project:

```powershell
cargo run -- patch d:\path\to\your-project
```

If a project has multiple binaries, specify which one should be used for
debugging:

```powershell
cargo run -- patch d:\path\to\your-project --bin my_app
```

## What is auto-detected

- chip, from Cargo dependency features when possible
- target triple, from `.cargo/config.toml`
- binary name, when the project has a single bin or an obvious default

## What still is not magic

- Multi-bin projects may need `--bin`
- Mixed-chip repos may need `--chip`
- Hardware availability still matters: `probe-rs list` must see a probe before
  VS Code debug will work
- It edits project-local `.vscode/*.json`, not VS Code user defaults

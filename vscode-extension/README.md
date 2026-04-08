# ESP Wrap for VS Code

`ESP Wrap` is a VS Code companion extension for the `espwrap` CLI. It is built
for developers who want to use Rust in VS Code for ESP32-class chips without
hand-editing `.vscode` files or memorizing every `esp-generate` flag.

This extension is currently intended for local testing and open-source
development inside this repository. It is not being published yet.

## What It Does

- Add an `ESP Wrap` sidebar in the activity bar with one-click entry points
- Create official `no_std` ESP Rust projects from a guided form
- Patch the current workspace from a guided form instead of a stack of input boxes
- Run `espwrap doctor` and show structured diagnostics
- Preview the exact CLI command before execution
- Auto-detect a bundled CLI, local repo build, or PATH entry before asking you to configure `espwrap.binaryPath`

## Requirements

- A usable `espwrap` binary
  For local repo testing, `cargo build` is enough. You do not need to
  globally install `espwrap` first.
- `esp-generate` installed for `no_std` project generation
- `probe-rs` tools installed if you plan to flash/debug from VS Code

If you want the official `std` / ESP-IDF template, generate that separately
with `cargo generate esp-rs/esp-idf-template cargo`. The current `ESP Wrap`
new-project flow only wraps the `esp-generate` `no_std` path.

## Commands

- `ESP Wrap: New Rust Project`
- `ESP Wrap: Patch Current Workspace`
- `ESP Wrap: Run Doctor`

## Development

```powershell
cd ..
cargo build
cd vscode-extension
npm install
npm run compile
npm run test
```

`cargo build` produces the local `espwrap` executable that the extension will
auto-detect from `../target/debug/espwrap(.exe)` or
`../target/release/espwrap(.exe)`.

Then:

1. Open `d:\esp32Project\tools\espwrap\vscode-extension` in VS Code.
2. Press `F5` to start the bundled `Run ESP Wrap Extension` debug configuration.
3. In the Extension Development Host window, click the `ESP Wrap` activity bar icon to open the sidebar home.

In development mode, the extension will try to auto-detect:

1. `bin/espwrap(.exe)` bundled into an installed VSIX
2. `../target/debug/espwrap(.exe)` or `../target/release/espwrap(.exe)` near the workspace
3. `espwrap` from `PATH`

You only need to set `espwrap.binaryPath` if you want to force a specific
custom binary.

## Local Install Without F5

```powershell
cd d:\esp32Project\tools\espwrap
cargo build
cd d:\esp32Project\tools\espwrap\vscode-extension
npm run package:vsix
npm run install:vsix
```

This produces a local VSIX in `.artifacts\` and bundles the current local
`espwrap` binary into the extension package. After that, you can use the
extension like a normal installed plugin instead of launching it with `F5`.

Important notes:

- `npm run package:vsix` does not compile `espwrap` for you. Run `cargo build`
  first so there is a local binary to bundle.
- You do not need a separate global `espwrap` install if the packaged VSIX
  already contains the bundled CLI.
- The bundled CLI is platform-specific. A VSIX built on Windows contains
  `espwrap.exe`; it is not meant to be reused as the bundled CLI on Linux or
  macOS. Build the VSIX on each target OS if you want native bundled binaries
  there too.

Useful commands:

- `npm run package:vsix`
- `npm run install:vsix`
- `npm run test:e2e`

`npm test` now includes:

- form model tests
- homepage UI badge rendering tests
- patch form UI rendering tests

`npm run test:e2e` additionally smoke-tests the generated VSIX archive.

The checked-in [`.vscode/launch.json`](./.vscode/launch.json) is only for local
extension development. It does not affect generated user projects.

## License

MIT. See the repository root [LICENSE](../LICENSE).

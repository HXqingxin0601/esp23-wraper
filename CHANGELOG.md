# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.1] - 2026-04-10

### Added

- `new` and `patch` now accept `--debug-backend <probe-rs|openocd|none>`.
- `new` and `patch` now accept repeatable `--openocd-config <FILE>` overrides for custom OpenOCD board/interface setups.
- `doctor --json` now reports `openocd` and Espressif GDB availability.
- Test coverage for `openocd` and `none` backend patch generation.
- Extension forms now expose the managed debug backend directly.

### Changed

- `probe-rs` remains the default backend, but `new` now auto-adds the upstream
  `probe-rs` template option when that backend is selected.
- `.vscode/launch.json` and `.vscode/extensions.json` now replace previously
  managed debug entries when the backend changes, so switching backends does
  not leave stale configs behind.
- Polished the extension new-project layout so `Chip` and `Preset` stay aligned
  and `BLE Stack` sits with more breathing room below the common feature toggles.
- Removed the older `--add-probe-rs-option` flag in favor of the shared
  `--debug-backend` switch.
- Fixed the extension webview payload wiring so Browse and Preview work again
  in the new-project and patch forms.

## [0.2.0] - 2026-04-09

### Added

- `doctor` command to validate toolchain/debug dependencies.
- `patch --dry-run` to preview JSON updates without writing.
- `patch --backup` to save `*.bak` files before writing.
- `new --name` to avoid project-name ambiguity in interactive generation.
- Additional unit tests for name override, snapshot inference, backup suffixing,
  and dry-run behavior.
- Additional integration tests covering successful patch generation and
  homepage layout behavior.
- Open-source project files: `LICENSE`, `CONTRIBUTING.md`, and CI workflow.
- Cross-platform install helpers: `install.sh` and `uninstall.sh`.
- Local VS Code extension workspace with sidebar home, guided project/patch
  forms, doctor integration, VSIX packaging, and smoke tests.

### Changed

- `new` and `patch` now share patch options (`dry-run`, `backup`).
- Improved error messages for interactive generation path inference.
- Improved project inference for `new` so post-generation patching does not
  depend on forwarded positional args being interpreted as the project name.
- README rewritten with full command-level usage and development instructions.
- README and extension docs now explicitly say that `espwrap new` currently
  wraps the official `no_std` `esp-generate` workflow, while the official
  `std` template still uses `esp-idf-template`.
- Extension home page now keeps the main new-project action visible while
  secondary actions and diagnostics live in collapsible sections.
- Windows `npm run install:vsix` now resolves the actual VS Code CLI more
  reliably.
- Crate metadata updated for publication readiness.

## [0.1.0] - 2026-04-01

### Added

- Initial `espwrap` CLI with:
  - `new` wrapper around `esp-generate`
  - `patch` for local `.vscode` files
  - chip/target/bin auto-detection
  - Windows install/uninstall scripts

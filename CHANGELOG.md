# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-04-02

### Added

- `doctor` command to validate toolchain/debug dependencies.
- `patch --dry-run` to preview JSON updates without writing.
- `patch --backup` to save `*.bak` files before writing.
- `new --name` to avoid project-name ambiguity in interactive generation.
- Additional unit tests for name override, snapshot inference, backup suffixing,
  and dry-run behavior.
- Open-source project files: `LICENSE`, `CONTRIBUTING.md`, and CI workflow.
- Cross-platform install helpers: `install.sh` and `uninstall.sh`.

### Changed

- `new` and `patch` now share patch options (`dry-run`, `backup`).
- Improved error messages for interactive generation path inference.
- README rewritten with full command-level usage and development instructions.
- Crate metadata updated for publication readiness.

## [0.1.0] - 2026-04-01

### Added

- Initial `espwrap` CLI with:
  - `new` wrapper around `esp-generate`
  - `patch` for local `.vscode` files
  - chip/target/bin auto-detection
  - Windows install/uninstall scripts

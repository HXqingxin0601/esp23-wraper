# Changelog

All notable changes to this project are documented in this file.

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

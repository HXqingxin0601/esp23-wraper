# Third-Party Notices

This project (`espwrap`) is distributed under the MIT License. See `LICENSE`.

This file summarizes major third-party components and related notice context.
It is provided for transparency and compliance convenience.

## Scope

- `espwrap` is a wrapper CLI.
- It invokes external tools (for example `esp-generate`) at runtime.
- It does not vendor or copy upstream `esp-generate` source code into this
  repository.

## Third-party components

1. Rust crates from crates.io

- `espwrap` depends on Rust crates resolved in `Cargo.lock`.
- Each crate keeps its own license metadata.
- Current dependency licenses are permissive (for example MIT / Apache-2.0 /
  ISC / Unlicense combinations).

2. External tools used by workflow

- `esp-generate`: upstream project/tool used to generate ESP Rust templates.
- `probe-rs` and VS Code extensions: used by generated debug workflows.

Use of these tools is subject to their own licenses and terms.

## Trademarks

`ESP32`, `Espressif`, and related names are trademarks of their respective
owners. Reference in this repository is for compatibility and descriptive use.

## Maintainer intent

This project is maintained for learning and development convenience and is not
offered as a paid/commercial service by the maintainer.

## For redistributors

If you redistribute source or binaries:

- Keep this repository `LICENSE`.
- Keep required third-party notices/licenses for included dependencies.
- Verify upstream license obligations for any bundled external artifacts.

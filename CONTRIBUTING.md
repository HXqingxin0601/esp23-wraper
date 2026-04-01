# Contributing

Thanks for contributing to `espwrap`.

## Development setup

```bash
cargo fmt
cargo build
cargo test --no-run
```

If your environment allows running local test binaries, also run:

```bash
cargo test
```

## Pull request checklist

- Keep behavior changes covered by tests when possible.
- Run formatting and build checks before opening PR.
- Update `README.md` when CLI behavior or flags change.
- Update `CHANGELOG.md` for user-visible changes.

## Commit style

Use concise, imperative commit messages (for example: `add doctor strict mode`).

## Reporting issues

When opening an issue, include:

- OS and shell
- `espwrap --version`
- exact command line
- full error output

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

## Contribution license

By submitting code, docs, or other content to this repository, you confirm you
have the right to do so and agree your contribution is licensed under the same
MIT license as this project.

## Reporting issues

When opening an issue, include:

- OS and shell
- `espwrap --version`
- exact command line
- full error output

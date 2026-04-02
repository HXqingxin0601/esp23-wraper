# Security Policy

## Supported Versions

Security fixes are provided on a best-effort basis for the latest `master`
branch state.

This is a small learning/developer utility project with no commercial support
or formal SLA.

## Reporting a Vulnerability

Please do not publish exploit details in a public issue before a fix is ready.

Preferred contact:

- Open a private GitHub security advisory/report if available for this repo.

Fallback:

- Open a normal issue and mark it clearly as security-related, but avoid sharing
  sensitive details until maintainers confirm next steps.

Please include:

- Affected version/commit
- Reproduction steps
- Impact assessment
- Suggested fix (if any)

## Scope Notes

`espwrap` is a wrapper around external tools and project-local file patching.
Vulnerabilities in upstream tools (for example `esp-generate`, `probe-rs`, Rust
toolchain, VS Code extensions) should also be reported to their upstream
maintainers.

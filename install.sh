#!/usr/bin/env bash
set -euo pipefail

NO_FORCE=0
if [[ "${1:-}" == "--no-force" ]]; then
  NO_FORCE=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST_TRIPLE="$(rustc -vV | awk '/^host: /{ print $2 }')"
if [[ -z "$HOST_TRIPLE" ]]; then
  echo "Failed to detect host target triple from rustc -vV" >&2
  exit 1
fi

ARGS=(install --path . --target "$HOST_TRIPLE" --locked)
if [[ "$NO_FORCE" -eq 0 ]]; then
  ARGS+=(--force)
fi

echo "Installing espwrap for host target $HOST_TRIPLE ..."
cargo "${ARGS[@]}"

echo
echo "Verification:"
echo "  espwrap --help"
echo "  command -v espwrap"

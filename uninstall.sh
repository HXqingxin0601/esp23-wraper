#!/usr/bin/env bash
set -euo pipefail

echo "Uninstalling espwrap ..."
cargo uninstall espwrap
echo "espwrap has been removed."

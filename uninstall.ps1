$ErrorActionPreference = "Stop"

Write-Host "Uninstalling espwrap ..."
& cargo uninstall espwrap

if ($LASTEXITCODE -ne 0) {
    throw "cargo uninstall failed with exit code $LASTEXITCODE"
}

Write-Host "espwrap has been removed."

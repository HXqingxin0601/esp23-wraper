param(
    [switch]$NoForce
)

$ErrorActionPreference = "Stop"

function Get-HostTriple {
    $hostLine = & rustc -vV | Select-String '^host:\s+(.+)$'
    if (-not $hostLine) {
        throw "Failed to detect the Rust host target triple from `rustc -vV`."
    }

    return $hostLine.Matches[0].Groups[1].Value.Trim()
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoBinDir = Join-Path $HOME ".cargo\bin"

Push-Location $scriptDir
try {
    $hostTriple = Get-HostTriple

    $cargoArgs = @(
        "install",
        "--path", ".",
        "--target", $hostTriple,
        "--locked"
    )

    if (-not $NoForce) {
        $cargoArgs += "--force"
    }

    Write-Host "Installing espwrap for host target $hostTriple ..."
    & cargo @cargoArgs

    if ($LASTEXITCODE -ne 0) {
        throw "cargo install failed with exit code $LASTEXITCODE"
    }

    $command = Get-Command espwrap -ErrorAction SilentlyContinue

    if ($command) {
        Write-Host ""
        Write-Host "espwrap is installed and available on PATH:"
        Write-Host "  $($command.Source)"
    } else {
        Write-Warning ""
        Write-Warning "espwrap was installed, but it is not currently visible on PATH."
        Write-Warning "Cargo bin directory:"
        Write-Warning "  $cargoBinDir"
        Write-Warning "You can still run it directly from there, or add that folder to PATH."
    }

    Write-Host ""
    Write-Host "Verification:"
    Write-Host "  espwrap --help"
    Write-Host "  Get-Command espwrap"
    Write-Host "  where.exe espwrap"
} finally {
    Pop-Location
}

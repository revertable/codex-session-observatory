[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = $PSScriptRoot
$frontendDirectory = Join-Path $repositoryRoot 'frontend'
$frontendPackage = Join-Path $frontendDirectory 'package.json'
$backendManifest = Join-Path $repositoryRoot 'backend\Cargo.toml'
$tauriManifest = Join-Path $frontendDirectory 'src-tauri\Cargo.toml'
$tauriConfig = Join-Path $frontendDirectory 'src-tauri\tauri.conf.json'

function Read-JsonVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$DisplayPath
    )

    try {
        $document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
            ConvertFrom-Json
    }
    catch {
        throw "Could not read the version from ${DisplayPath}: $($_.Exception.Message)"
    }

    $version = [string]$document.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "The version is missing from $DisplayPath."
    }

    return $version.Trim()
}

function Read-CargoPackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$DisplayPath
    )

    $inPackageSection = $false

    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match '^\s*\[([^]]+)\]\s*$') {
            $inPackageSection = $Matches[1] -eq 'package'
            continue
        }

        if ($inPackageSection -and $line -match '^\s*version\s*=\s*"([^"]+)"') {
            return $Matches[1]
        }
    }

    throw "The [package] version is missing from $DisplayPath."
}

function Resolve-ApplicationPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $commandInfo = Get-Command $Name `
        -CommandType Application `
        -ErrorAction Stop |
        Select-Object -First 1

    if ($null -eq $commandInfo) {
        throw "Required application was not found: $Name"
    }

    return [string]$commandInfo.Source
}

function Invoke-VerificationStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    Write-Host "[VERIFY] $Name" -ForegroundColor Cyan

    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode."
    }
}

if (-not (Test-Path -LiteralPath $frontendPackage -PathType Leaf)) {
    throw 'The frontend package.json was not found.'
}

foreach ($manifestPath in @($backendManifest, $tauriManifest)) {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Cargo manifest was not found: $manifestPath"
    }
}

if (-not (Test-Path -LiteralPath $tauriConfig -PathType Leaf)) {
    throw 'The Tauri configuration was not found.'
}

Write-Host '[VERIFY] Release version consistency' -ForegroundColor Cyan

$releaseVersions = [ordered]@{
    'frontend/package.json' = Read-JsonVersion `
        -Path $frontendPackage `
        -DisplayPath 'frontend/package.json'
    'backend/Cargo.toml' = Read-CargoPackageVersion `
        -Path $backendManifest `
        -DisplayPath 'backend/Cargo.toml'
    'frontend/src-tauri/Cargo.toml' = Read-CargoPackageVersion `
        -Path $tauriManifest `
        -DisplayPath 'frontend/src-tauri/Cargo.toml'
    'frontend/src-tauri/tauri.conf.json' = Read-JsonVersion `
        -Path $tauriConfig `
        -DisplayPath 'frontend/src-tauri/tauri.conf.json'
}

$versionSummary = ($releaseVersions.GetEnumerator() | ForEach-Object {
        "$($_.Key)=$($_.Value)"
    }) -join '; '
$uniqueVersions = @($releaseVersions.Values | Sort-Object -Unique)

if ($uniqueVersions.Count -ne 1) {
    throw "Release version mismatch: $versionSummary"
}

Write-Host "[PASS] Release versions match: $($uniqueVersions[0])" -ForegroundColor Green

$npmCommand = Resolve-ApplicationPath -Name 'npm.cmd'
$cargoCommand = Resolve-ApplicationPath -Name 'cargo.exe'

Write-Host "[TOOL] npm: $npmCommand" -ForegroundColor DarkGray
Write-Host "[TOOL] cargo: $cargoCommand" -ForegroundColor DarkGray

Invoke-VerificationStep `
    -Name 'Frontend tests' `
    -Command $npmCommand `
    -Arguments @('test') `
    -WorkingDirectory $frontendDirectory

Invoke-VerificationStep `
    -Name 'Frontend browser integration tests' `
    -Command $npmCommand `
    -Arguments @('run', 'test:browser') `
    -WorkingDirectory $frontendDirectory

Invoke-VerificationStep `
    -Name 'Svelte and TypeScript checks' `
    -Command $npmCommand `
    -Arguments @('run', 'check') `
    -WorkingDirectory $frontendDirectory

Invoke-VerificationStep `
    -Name 'Frontend production build' `
    -Command $npmCommand `
    -Arguments @('run', 'build') `
    -WorkingDirectory $frontendDirectory

Invoke-VerificationStep `
    -Name 'Backend Rust tests' `
    -Command $cargoCommand `
    -Arguments @('test', '--manifest-path', $backendManifest) `
    -WorkingDirectory $repositoryRoot

Invoke-VerificationStep `
    -Name 'Tauri bridge Rust tests' `
    -Command $cargoCommand `
    -Arguments @('test', '--manifest-path', $tauriManifest) `
    -WorkingDirectory $repositoryRoot

Invoke-VerificationStep `
    -Name 'Tauri release build without bundling' `
    -Command $npmCommand `
    -Arguments @('run', 'tauri:build', '--', '--no-bundle') `
    -WorkingDirectory $frontendDirectory

Write-Host '[PASS] Full automated verification completed.' -ForegroundColor Green

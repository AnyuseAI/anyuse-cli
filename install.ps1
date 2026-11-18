# 下载已发布的独立 CLI；不安装 Node/Bun，不修改持久 PATH。
param(
    [string]$Version = 'latest',
    [string]$InstallDir = (Join-Path $HOME '.local\bin'),
    [string]$Repository = 'AnyuseAI/anyuse-cli'
)
$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository' }
if ($Version -ne 'latest' -and $Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw 'Invalid version (omit the v prefix)' }
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Use install.sh on macOS/Linux' }
# 第一版只提供原生 Windows x64；ARM64 用户可继续使用 Node/npm 安装。
$Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($Architecture -ne 'AMD64') { throw 'Standalone Windows builds currently require x64; use npm on ARM64' }
$Asset = 'anyuse-windows-x64.exe'
$Base = "https://github.com/$Repository/releases"
$Base += if ($Version -eq 'latest') { '/latest/download' } else { "/download/v$Version" }
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$Staging = $null
New-Item -ItemType Directory -Path $TempDir | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $Binary = Join-Path $TempDir $Asset
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile $Binary -TimeoutSec 300
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset.sha256" -OutFile (Join-Path $TempDir 'checksum') -TimeoutSec 60
    $Checksum = (Get-Content -Raw (Join-Path $TempDir 'checksum')).Trim()
    if ($Checksum -notmatch ('^([a-f0-9]{64})  ' + [Regex]::Escape($Asset) + '$')) { throw 'Invalid checksum file' }
    $ExpectedHash = $Matches[1]
    if ((Get-FileHash -Algorithm SHA256 $Binary).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Checksum mismatch; existing installation unchanged' }
    $Installed = & $Binary --version
    if ($LASTEXITCODE -ne 0) { throw 'Executable failed to start' }
    if ($Version -ne 'latest' -and $Installed -ne $Version) { throw 'Executable version mismatch' }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $Staging = Join-Path $InstallDir ('.anyuse-' + [Guid]::NewGuid().ToString() + '.exe')
    Copy-Item -LiteralPath $Binary -Destination $Staging
    $Destination = Join-Path $InstallDir 'anyuse.exe'
    if (Test-Path -LiteralPath $Destination) {
        [IO.File]::Replace($Staging, $Destination, $null)
    } else {
        [IO.File]::Move($Staging, $Destination)
    }
    Write-Host "Installed Anyuse $Installed to $Destination"
    Write-Host "Add this directory to PATH if needed: $InstallDir"
} finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
    if ($Staging -and (Test-Path -LiteralPath $Staging)) { Remove-Item -LiteralPath $Staging -Force }
}

# Windows CI 用真实可执行文件和模拟下载验证安装流程，不访问 GitHub Releases。
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Fixture = Join-Path $Root 'artifacts/anyuse-windows-x64.exe'
$FixtureHash = (Get-FileHash -Algorithm SHA256 $Fixture).Hash.ToLowerInvariant()
$Temp = Join-Path ([IO.Path]::GetTempPath()) ('anyuse-installer-test-' + [Guid]::NewGuid())
$Out = Join-Path $Temp 'directory with spaces'
$global:AnyuseInstallTest = @{
    BadHash = $false
    DownloadFailure = $false
    Urls = [System.Collections.Generic.List[string]]::new()
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, [int]$TimeoutSec)
    $global:AnyuseInstallTest.Urls.Add($Uri)
    if ($global:AnyuseInstallTest.DownloadFailure) { throw 'Simulated download failure' }
    if ($Uri.EndsWith('.sha256')) {
        $Hash = if ($global:AnyuseInstallTest.BadHash) { '0' * 64 } else { $FixtureHash }
        [IO.File]::WriteAllText($OutFile, "$Hash  anyuse-windows-x64.exe`n")
    } else { Copy-Item -LiteralPath $Fixture -Destination $OutFile }
}
try {
    $Version = (Get-Content -Raw (Join-Path $Root 'package.json') | ConvertFrom-Json).version
    & (Join-Path $Root 'install.ps1') -Version $Version -InstallDir $Out -Repository 'example/cli'
    $Installed = Join-Path $Out 'anyuse.exe'
    if ((& $Installed --version) -ne $Version) { throw 'Installed version mismatch' }
    if (-not $global:AnyuseInstallTest.Urls.Contains("https://github.com/example/cli/releases/download/v$Version/anyuse-windows-x64.exe")) { throw 'Wrong download URL' }
    foreach ($Failure in @('checksum', 'download')) {
        [IO.File]::WriteAllText($Installed, 'old installation')
        $global:AnyuseInstallTest.BadHash = $Failure -eq 'checksum'
        $global:AnyuseInstallTest.DownloadFailure = $Failure -eq 'download'
        $Failed = $false
        try { & (Join-Path $Root 'install.ps1') -Version $Version -InstallDir $Out } catch { $Failed = $true }
        if (-not $Failed) { throw 'Installer should fail' }
        if ([IO.File]::ReadAllText($Installed) -ne 'old installation') { throw 'Old installation was modified' }
    }
    $global:AnyuseInstallTest.BadHash = $false
    $global:AnyuseInstallTest.DownloadFailure = $false
    & (Join-Path $Root 'install.ps1') -InstallDir $Out
    if ((& $Installed --version) -ne $Version) { throw 'Upgrade failed' }
    if (-not $global:AnyuseInstallTest.Urls.Contains('https://github.com/AnyuseAI/anyuse-cli/releases/latest/download/anyuse-windows-x64.exe')) { throw 'Wrong latest URL' }
    Write-Host 'Windows install, upgrade, checksum and download failure checks passed.'
} finally {
    Remove-Item -LiteralPath $Temp -Recurse -Force
    Remove-Variable -Name AnyuseInstallTest -Scope Global -ErrorAction SilentlyContinue
}

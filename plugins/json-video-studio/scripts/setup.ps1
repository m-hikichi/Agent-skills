# Builds the image, starts VOICEVOX, runs the doctor, and installs the personal plugin.
# Pass -SkipPersonalInstall to use the repository directly with `claude --plugin-dir`.
[CmdletBinding()]
param([switch]$SkipPersonalInstall)

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$image = 'json-video-studio'
$doctor = @('run', '--rm', '--init', '--network', 'json-video-studio', $image, 'doctor')

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed." }
}

Invoke-Docker compose version | Out-Null

Write-Host "Building $image ..."
Invoke-Docker build --tag $image --file (Join-Path $pluginRoot 'mcp-server/Dockerfile') $pluginRoot

Write-Host 'Starting the VOICEVOX Engine ...'
Invoke-Docker compose --file (Join-Path $pluginRoot 'mcp-server/compose.yml') up --detach

Write-Host 'Waiting for the runtime doctor to pass ...'
foreach ($attempt in 1..60) {
    & docker @doctor 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
}
Invoke-Docker @doctor

Write-Host 'Validating the bundled minimal project ...'
Invoke-Docker run --rm --init -e JSON_VIDEO_WORKSPACE_ROOT=/app/examples $image validate minimal.video-project.json

$personalPath = Join-Path $HOME '.claude\skills\json-video-studio'
if ($SkipPersonalInstall -or ($pluginRoot -eq $personalPath)) {
} elseif (Test-Path -LiteralPath $personalPath) {
    Write-Warning "Personal plugin already exists at $personalPath; it was not overwritten."
} else {
    & robocopy $pluginRoot $personalPath /E /XD .git node_modules dist .json-video-work /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Failed to copy the personal plugin.' }
    Write-Host "Installed the personal plugin at $personalPath"
}

Write-Host ''
Write-Host 'Setup completed.'
if (-not $SkipPersonalInstall -and (Test-Path -LiteralPath $personalPath)) {
    Write-Host 'Start a new Claude Code session with: claude'
} else {
    Write-Host "Start a new Claude Code session with: claude --plugin-dir `"$pluginRoot`""
}
Write-Host 'Check the Remotion license (https://www.remotion.dev/docs/license) and the VOICEVOX character terms before publishing.'
exit 0

[CmdletBinding()]
param([Parameter(Mandatory)][string]$RunDirectory)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$destination = [IO.Path]::GetFullPath($RunDirectory, $workspace)
if (-not $destination.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'RunDirectory must be a new child directory of the workspace.'
}
if (Test-Path -LiteralPath $destination) { throw 'RunDirectory already exists; choose a new directory.' }
$package = 'git+https://github.com/github/spec-kit.git@bca679051abb80d6cf0cd909f2539a28a10eb7eb'
$previousCache = $env:UV_CACHE_DIR
$previousTools = $env:UV_TOOL_DIR
try {
    $env:UV_CACHE_DIR = Join-Path $workspace '.uv-cache'
    $env:UV_TOOL_DIR = Join-Path $workspace '.uv-tools'
    & uv tool run --from $package specify init $destination --integration codex --integration-options=--skills --ignore-agent-tools --non-interactive --script ps
    if ($LASTEXITCODE -ne 0) { throw 'Official CLI initialization failed.' }
    Push-Location $destination
    try {
        & pwsh -NoProfile -File ./.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName notification-preferences -Number 1 'Register and disable notification destinations'
        if ($LASTEXITCODE -ne 0) { throw 'Official feature creation failed.' }
    } finally { Pop-Location }
    $feature = Join-Path $destination 'specs/001-notification-preferences'
    # This copies a controlled human-authored fixture into the official scaffold.
    # It does NOT execute an agent's speckit-specify command.
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'project/specs/001-notification-preferences/spec.md') -Destination (Join-Path $feature 'spec.md')
    $output = Join-Path $destination 'documents'
    $scripts = Join-Path $workspace 'skills/speckit-requirements-functions-tests/scripts'
    & uv run --offline python (Join-Path $scripts 'generate_documents.py') $feature --output-dir $output --profile draft
    if ($LASTEXITCODE -ne 0) { throw 'Draft generation failed.' }
    $canonical = Join-Path $output '001-notification-preferences_requirements-functions-tests.json'
    & uv run --offline python (Join-Path $scripts 'check_documents.py') $feature $canonical --output-dir $output --profile draft
    if ($LASTEXITCODE -ne 0) { throw 'Draft validation failed.' }
    & uv run --offline python (Join-Path $scripts 'check_documents.py') $feature $canonical --output-dir $output --profile publish
    if ($LASTEXITCODE -ne 1) { throw 'Unreviewed draft must be rejected for publication.' }
    Write-Host 'PASS: official CLI scaffold -> controlled fixture -> draft generation/check; unreviewed publish rejected.'
} finally {
    $env:UV_CACHE_DIR = $previousCache
    $env:UV_TOOL_DIR = $previousTools
}

# Compatibility launcher only. Lifecycle business rules live in marp-slide.mjs.
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CliArguments
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'marp-slide.mjs'
$pluginRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$workspace = (Get-Location).Path
$forwardedArguments = [System.Collections.Generic.List[string]]::new()
for ($index = 0; $index -lt $CliArguments.Count; $index += 1) {
  if ($CliArguments[$index] -eq '--root') {
    if ($index + 1 -ge $CliArguments.Count) {
      Write-Error 'Option --root requires a value.'
      exit 1
    }
    $workspace = (Resolve-Path -LiteralPath $CliArguments[$index + 1]).Path
    $index += 1
  } else {
    $forwardedArguments.Add($CliArguments[$index])
  }
}

# Stop hooks are global. A workspace without the run marker must stop cleanly
# without requiring either runtime.
if ($CliArguments.Count -gt 0 -and $CliArguments[0] -eq 'gate') {
  $statePath = Join-Path $workspace '.slide-work/run-state.json'
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    exit 0
  }
}

if ($nodeCommand) {
  & $nodeCommand.Source $scriptPath @CliArguments
  exit $LASTEXITCODE
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
  Write-Error 'marp-slide requires either Node.js or Docker with the marp-mcp-server image.'
  exit 1
}

$workspaceMode = if ($CliArguments.Count -gt 0 -and $CliArguments[0] -eq 'gate') { 'ro' } else { 'rw' }
$dockerArguments = @(
  'run', '--rm',
  '--read-only',
  '--network', 'none',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m',
  '--entrypoint', 'node',
  '-v', "$($pluginRoot):/plugin:ro",
  '-v', "$($workspace):/workspace:$workspaceMode",
  '-w', '/workspace',
  'marp-mcp-server',
  '/plugin/scripts/marp-slide.mjs'
) + $forwardedArguments.ToArray() + @('--root', '/workspace')

& $dockerCommand.Source @dockerArguments
exit $LASTEXITCODE

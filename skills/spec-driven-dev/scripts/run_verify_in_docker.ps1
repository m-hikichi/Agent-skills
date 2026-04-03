param(
    [string]$ProjectRoot = ".",
    [string]$Image = "python:3.12"
)

$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
$pluginRoot = Split-Path -Parent $PSScriptRoot

docker run --rm `
  -v "${resolvedProjectRoot}:/workspace" `
  -v "${pluginRoot}:/plugin" `
  -w /workspace `
  $Image `
  python /plugin/scripts/verify_spec_consistency.py --project-root /workspace

param(
    [string]$ProjectRoot = ".",
    [string]$Image = "python:3.12"
)

$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
$skillDir = Split-Path -Parent $PSScriptRoot

docker run --rm `
  -v "${resolvedProjectRoot}:/workspace" `
  -v "${skillDir}:/skill" `
  -w /workspace `
  $Image `
  python /skill/scripts/verify_spec_consistency.py --project-root /workspace

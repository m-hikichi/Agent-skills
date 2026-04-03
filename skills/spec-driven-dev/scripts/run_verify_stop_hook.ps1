# Stop/SubagentStop hook: run review_stop_gate.py inside Docker.
# No local Python required.
param(
    [string]$ProjectRoot = ""
)

if ($ProjectRoot) {
    $resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
} elseif ($env:CLAUDE_PROJECT_DIR) {
    $resolvedProjectRoot = $env:CLAUDE_PROJECT_DIR
} else {
    $resolvedProjectRoot = (Get-Location).Path
}

$pluginRoot = Split-Path -Parent $PSScriptRoot
$image = if ($env:VERIFY_SPEC_IMAGE) { $env:VERIFY_SPEC_IMAGE } else { "python:3.12" }
$hookInput = [Console]::In.ReadToEnd()

$output = $hookInput | docker run --rm -i `
  -v "${resolvedProjectRoot}:/workspace" `
  -v "${pluginRoot}:/plugin" `
  -w /workspace `
  $image `
  python /plugin/scripts/review_stop_gate.py --project-root /workspace 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    if ($output) {
        $output | Write-Output
    }
    exit 0
}

if ($output) {
    [Console]::Error.WriteLine(($output -join [Environment]::NewLine))
} else {
    [Console]::Error.WriteLine("spec-driven-dev stop reviewer failed.")
}

exit 2

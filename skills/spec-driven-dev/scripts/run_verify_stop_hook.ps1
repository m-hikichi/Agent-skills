param(
    [string]$ProjectRoot = ""
)

if ($ProjectRoot) {
    $resolvedProjectRoot = $ProjectRoot
} elseif ($env:CLAUDE_PROJECT_DIR) {
    $resolvedProjectRoot = $env:CLAUDE_PROJECT_DIR
} else {
    $resolvedProjectRoot = "."
}

$reviewerPath = Join-Path $PSScriptRoot "review_stop_gate.py"
$hookInput = [Console]::In.ReadToEnd()
$pythonPrefix = $null

if (Get-Command py -ErrorAction SilentlyContinue) {
    try {
        & py -3 -V *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonPrefix = @("py", "-3")
        }
    } catch {
    }
}

if (-not $pythonPrefix -and (Get-Command python -ErrorAction SilentlyContinue)) {
    try {
        & python -V *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonPrefix = @("python")
        }
    } catch {
    }
}

if (-not $pythonPrefix) {
    [Console]::Error.WriteLine("spec-driven-dev stop hook requires Python 3 on the host machine.")
    exit 2
}

$pythonCommand = $pythonPrefix + @($reviewerPath, "--project-root", $resolvedProjectRoot)
$output = $hookInput | & $pythonCommand[0] $pythonCommand[1..($pythonCommand.Length - 1)] 2>&1
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

[CmdletBinding()]
param(
    [switch]$SkipVoicevox,
    [switch]$SkipBuild,
    [switch]$SkipPersonalInstall
)

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$imageName = 'json-video-studio:0.1.0'
$composeFile = Join-Path $pluginRoot 'compose.voicevox.yml'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found. Install Docker Desktop or Docker Engine first.'
}

& docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot connect to the Docker daemon. Start Docker and run this script again.'
}

& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 is not available.'
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
    & claude plugin validate $pluginRoot --strict
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code plugin validation failed.' }
}

if (-not $SkipBuild) {
    Write-Host "Building $imageName ..."
    & docker build --tag $imageName $pluginRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to build the JSON Video Studio image.'
    }
}

if (-not $SkipVoicevox) {
    Write-Host 'Starting the pinned VOICEVOX Engine ...'
    & docker compose --file $composeFile up --detach
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to start the VOICEVOX Engine.'
    }

    Write-Host 'Waiting for the VOICEVOX Engine API and speaker models ...'
    $voicevoxProbe = @(
        'run', '--rm', '--network', 'json-video-studio', '--entrypoint', 'node',
        $imageName, '-e',
        "Promise.all([fetch('http://voicevox:50021/version',{signal:AbortSignal.timeout(3000)}),fetch('http://voicevox:50021/speakers',{signal:AbortSignal.timeout(5000)})]).then(async ([version,speakers])=>{const list=await speakers.json();if(!version.ok||!speakers.ok||!Array.isArray(list)||list.length===0)process.exit(1)}).catch(()=>process.exit(1))"
    )
    $voicevoxReady = $false
    foreach ($attempt in 1..60) {
        & docker @voicevoxProbe 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $voicevoxReady = $true
            break
        }
        if ($attempt -lt 60) { Start-Sleep -Seconds 2 }
    }
    if (-not $voicevoxReady) {
        throw 'VOICEVOX Engine did not become ready after 60 probes. Check: docker compose --file compose.voicevox.yml logs voicevox'
    }
}

$setupData = Join-Path $pluginRoot '.json-video-work\setup-doctor'
New-Item -ItemType Directory -Path $setupData -Force | Out-Null

Write-Host 'Running the deterministic runtime doctor ...'
$doctorArgs = @(
    'run', '--rm', '--init',
    '--network', 'json-video-studio',
    '-e', 'JSON_VIDEO_WORKSPACE_ROOT=/workspace',
    '-e', 'JSON_VIDEO_DATA_ROOT=/data',
    '-e', 'JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json',
    '-e', 'JSON_VIDEO_UI_HOST=0.0.0.0',
    '-e', 'JSON_VIDEO_ALLOW_CONTAINER_BIND=1',
    '-e', 'JSON_VIDEO_UI_PORT=43120',
    '-e', 'VOICEVOX_URL=http://voicevox:50021',
    '-v', "${pluginRoot}:/workspace",
    '-v', "${setupData}:/data",
    $imageName, 'doctor'
)
& docker @doctorArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Runtime doctor failed. Follow the troubleshooting steps in README.md.'
}

Write-Host 'Validating the bundled minimal project ...'
$validateArgs = @(
    'run', '--rm', '--init',
    '-e', 'JSON_VIDEO_WORKSPACE_ROOT=/app/examples',
    '-e', 'JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json',
    $imageName, 'validate', 'minimal.video-project.json'
)
& docker @validateArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Schema validation failed for the bundled minimal project.'
}

$personalInstallReady = $false
if (-not $SkipPersonalInstall) {
    $personalRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.claude\skills'
    $personalPath = Join-Path $personalRoot 'json-video-studio'
    if ([System.IO.Path]::GetFullPath($pluginRoot) -eq [System.IO.Path]::GetFullPath($personalPath)) {
        Write-Host "Personal plugin is already running from $personalPath"
        $personalInstallReady = $true
    } elseif (Test-Path -LiteralPath $personalPath) {
        Write-Warning "Personal plugin already exists at $personalPath; it was not overwritten. Remove or back it up explicitly before updating."
    } else {
        New-Item -ItemType Directory -Force -Path $personalRoot | Out-Null
        $staging = Join-Path $personalRoot ('.json-video-studio.install-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $staging | Out-Null
        try {
            foreach ($file in @('.mcp.json', '.dockerignore', '.gitignore', 'compose.voicevox.yml', 'Dockerfile', 'README.md', 'THIRD_PARTY_NOTICES.md')) {
                Copy-Item -LiteralPath (Join-Path $pluginRoot $file) -Destination $staging
            }
            foreach ($directory in @('.claude-plugin', 'agents', 'docs', 'examples', 'schemas', 'skills', 'scripts')) {
                Copy-Item -LiteralPath (Join-Path $pluginRoot $directory) -Destination $staging -Recurse
            }
            # Copy runtime source and E2E inputs explicitly. Generated build, coverage,
            # smoke, and Playwright result directories are intentionally not copied.
            $runtimeTarget = Join-Path $staging 'runtime'
            New-Item -ItemType Directory -Path $runtimeTarget | Out-Null
            foreach ($file in @('package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', '.npmrc')) {
                Copy-Item -LiteralPath (Join-Path $pluginRoot "runtime\$file") -Destination $runtimeTarget
            }
            foreach ($directory in @('src', 'scripts', 'tests', 'e2e')) {
                Copy-Item -LiteralPath (Join-Path $pluginRoot "runtime\$directory") -Destination $runtimeTarget -Recurse
            }
            Move-Item -LiteralPath $staging -Destination $personalPath
            Write-Host "Installed the personal Claude Code plugin at $personalPath"
            $personalInstallReady = $true
        } finally {
            if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        }
    }
}

Write-Host ''
Write-Host 'Setup completed.'
Write-Host 'Runtime doctor and minimal project validation passed without AI assistance.'
if ($personalInstallReady) {
    Write-Host 'Start a new Claude Code session with: claude'
    Write-Host "The personal plugin at $personalPath will auto-load as json-video-studio@skills-dir."
} else {
    Write-Host "Start the current source with: claude --plugin-dir `"$pluginRoot`""
}
Write-Host 'The local editor will be available at http://127.0.0.1:43120 after the MCP server starts.'
Write-Host 'Before organizational use or offering a service, re-check the current Remotion terms: https://www.remotion.dev/docs/license/pricing'
Write-Host 'Review THIRD_PARTY_NOTICES.md and the selected VOICEVOX character terms before publishing a video.'

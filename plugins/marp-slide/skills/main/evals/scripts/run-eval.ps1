param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$HarnessArgs
)

$ErrorActionPreference = 'Stop'
$Script = Join-Path $PSScriptRoot 'eval-harness.mjs'

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node $Script @HarnessArgs
  exit $LASTEXITCODE
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Node.js or Docker is required to run the evaluation harness.'
}

$PluginRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$HostRoot = (Get-Location).Path.TrimEnd('\')
$PathFlags = @('--workspace', '--baseline-plugin', '--candidate-plugin', '--render-root', '--output', '--baseline', '--report')
$ContainerArgs = @()

for ($Index = 0; $Index -lt $HarnessArgs.Count; $Index++) {
  $Token = $HarnessArgs[$Index]
  $ContainerArgs += $Token
  if ($PathFlags -contains $Token) {
    $Index++
    if ($Index -ge $HarnessArgs.Count) { throw "$Token requires a path" }
    $RawPath = $HarnessArgs[$Index]
    $Absolute = if ([System.IO.Path]::IsPathRooted($RawPath)) {
      [System.IO.Path]::GetFullPath($RawPath)
    } else {
      [System.IO.Path]::GetFullPath((Join-Path $HostRoot $RawPath))
    }
    if ($Absolute -ne $HostRoot -and -not $Absolute.StartsWith("$HostRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Docker fallback requires $Token to stay under the current directory: $HostRoot"
    }
    $Relative = [System.IO.Path]::GetRelativePath($HostRoot, $Absolute).Replace('\', '/')
    $ContainerArgs += $(if ($Relative -eq '.') { '/workspace' } else { "/workspace/$Relative" })
  }
}

$Image = if ($env:MARP_SLIDE_IMAGE) { $env:MARP_SLIDE_IMAGE } else { 'marp-mcp-server' }
& docker run --rm --network none --entrypoint node `
  -v "${HostRoot}:/workspace" `
  -v "${PluginRoot}:/plugin:ro" `
  -w /workspace `
  $Image `
  /plugin/skills/main/evals/scripts/eval-harness.mjs `
  @ContainerArgs
exit $LASTEXITCODE

Param(
  [string]$TargetDir = "$HOME\.mini-agent\config"
)

$ErrorActionPreference = "Stop"

Write-Host "Mini Agent TypeScript - setup config"
Write-Host "Target: $TargetDir"

New-Item -ItemType Directory -Force $TargetDir | Out-Null

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root "config"

$files = @(
  @{ Src = "config-example.yaml"; Dst = "config.yaml" },
  @{ Src = "mcp.json";           Dst = "mcp.json" },
  @{ Src = "system_prompt.md";   Dst = "system_prompt.md" }
)

foreach ($f in $files) {
  $src = Join-Path $srcDir $f.Src
  $dst = Join-Path $TargetDir $f.Dst

  if (-not (Test-Path $src)) {
    Write-Host "Missing source file: $src"
    continue
  }

  if (Test-Path $dst) {
    Write-Host "Skip (already exists): $dst"
  } else {
    Copy-Item -Force $src $dst
    Write-Host "Created: $dst"
  }
}

Write-Host "Done."
Write-Host "Next: edit $TargetDir\config.yaml and fill api_key/api_base."


# Optional helper to build the site from a local mirror.
# The repository is now at C:\network-portfolio; normal npm commands inside site/
# are the default. This helper copies site/ to a local folder, installs, builds,
# and copies dist/ back.
# Usage (from the repository root): pwsh -File site\build-local.ps1 [-Dev]
#   -Dev   starts the Vite dev server from the mirror instead of building.
#          Edit files in site/; re-run to sync (no live sync across the mirror).
param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$mirror = Join-Path $env:LOCALAPPDATA 'network-portfolio-site-build'

New-Item -ItemType Directory -Force $mirror | Out-Null
Get-ChildItem $site -Exclude node_modules, dist | Copy-Item -Destination $mirror -Recurse -Force

Push-Location $mirror
try {
  if (-not (Test-Path (Join-Path $mirror 'node_modules'))) { npm install --no-audit --no-fund }
  if ($Dev) {
    npm run dev
  } else {
    npm run build
    if (Test-Path (Join-Path $site 'dist')) { Remove-Item -Recurse -Force (Join-Path $site 'dist') }
    Copy-Item (Join-Path $mirror 'dist') (Join-Path $site 'dist') -Recurse
    Write-Host "Built to $site\dist"
  }
} finally { Pop-Location }

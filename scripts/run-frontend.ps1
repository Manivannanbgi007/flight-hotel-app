<#
.SYNOPSIS
    Runs the React app with hot reload on http://localhost:5173. API calls are forwarded to the gateway (:8080).
#>
$ErrorActionPreference = 'Continue'
$frontend = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend'
Set-Location $frontend
if (-not (Test-Path 'node_modules')) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
npm run dev

<#
.SYNOPSIS
    Runs one backend service on your machine (outside Docker) against the Docker infrastructure.

.DESCRIPTION
    1. Builds and installs the shared modules (event-schemas, common-lib) the first time or with -Rebuild.
    2. Stops the same service in Docker (if running) so the port is free.
    3. Starts the service with "mvn spring-boot:run". The service reads secrets from the project's .env file.

.EXAMPLE
    .\scripts\run-service.ps1 reporting-service
    .\scripts\run-service.ps1 hotel-service -Rebuild
    .\scripts\run-service.ps1 mcp-client-service      # needs Ollama: .\scripts\start-infra.ps1 -Assistant
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('api-gateway', 'identity-service', 'hotel-service', 'flight-service', 'booking-service',
            'payment-service', 'notification-service', 'reporting-service',
            'mcp-server-service', 'mcp-client-service', 'search-service')]
    [string] $Name,

    [switch] $Rebuild
)
# Native tools (docker, mvn) print progress on stderr. Windows PowerShell 5.1 would treat that as an error with
# 'Stop', so we keep 'Continue' and check exit codes ourselves.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path '.env')) {
    Write-Host "No .env file found. Run: Copy-Item .env.example .env   (then set the passwords)" -ForegroundColor Yellow
    exit 1
}

$mvnw = Join-Path $root 'mvnw.cmd'
$commonLib = Join-Path $env:USERPROFILE '.m2\repository\com\flighthotel\common-lib\0.1.0-SNAPSHOT'

if ($Rebuild -or -not (Test-Path $commonLib)) {
    Write-Host "Installing shared modules (event-schemas, common-lib)..." -ForegroundColor Cyan
    & $mvnw -B -q -N install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $mvnw -B -q -DskipTests -pl platform/event-schemas,platform/common-lib install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# If the same service is also running in Docker, its port is taken.
cmd /c "docker compose stop $Name >nul 2>&1"

Write-Host "Starting $Name (Ctrl+C to stop)..." -ForegroundColor Green
& $mvnw -B -f "services/$Name/pom.xml" spring-boot:run
exit $LASTEXITCODE

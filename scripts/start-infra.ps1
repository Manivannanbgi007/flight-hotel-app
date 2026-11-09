<#
.SYNOPSIS
    Starts only the infrastructure (MySQL, Redis, Kafka, Schema Registry, Debezium, Elasticsearch, Mailpit) in Docker,
    so you can run one or more services from your IDE or with scripts\run-service.ps1.

.EXAMPLE
    .\scripts\start-infra.ps1
    .\scripts\start-infra.ps1 -Assistant     # also Ollama + the model pull, for mcp-client-service (about 4.5 GB RAM)
#>
param(
    [switch] $Assistant
)
# See run-service.ps1: native tools write progress to stderr, so check exit codes instead of using 'Stop'.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path '.env')) {
    Write-Host "No .env file found. Copy .env.example to .env and set the passwords first:" -ForegroundColor Yellow
    Write-Host "    Copy-Item .env.example .env"
    exit 1
}

$infra = 'mysql', 'redis', 'kafka', 'kafka-init', 'schema-registry', 'kafka-connect', 'connect-init', 'elasticsearch', 'mailpit'
if ($Assistant) { $infra += 'ollama', 'ollama-init' }
docker compose up -d @infra
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting the infrastructure failed. See DOCKER_SETUP.md > Troubleshooting." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Infrastructure is up. Check with: docker compose ps" -ForegroundColor Green
Write-Host "  MySQL            localhost:3307 (MYSQL_HOST_PORT in .env)"
Write-Host "  Kafka            localhost:9092"
Write-Host "  Schema Registry  http://localhost:8081"
Write-Host "  Kafka Connect    http://localhost:8083/connectors"
Write-Host "  Elasticsearch    http://localhost:9200"
Write-Host "  Redis            localhost:6379"
Write-Host "  Mailpit (email)  http://localhost:8025"
if ($Assistant) {
    Write-Host "  Ollama           http://localhost:11434 (the first start pulls the model; see AI_ASSISTANT.md)"
}

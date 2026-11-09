<#
.SYNOPSIS
    Pushes the application images and the data services' images to the local registry (localhost:5001).

.DESCRIPTION
    Application images: the ones Docker Compose builds (flighthotel/<service>:local), pushed as
    localhost:5001/flighthotel/<service>:<Tag>. Build them first with `docker compose build`.
    Use a NEW tag for every new version (nodes cache images by tag), then deploy that tag
    (global.image.tag in deploy/environments/kind/values.yaml).
    Data services: MySQL, Redis, Kafka, ... mirrored once under the same names (pulled from the internet if missing).

.EXAMPLE
    .\deploy\scripts\push-images.ps1                 # tag 1.0.0
    .\deploy\scripts\push-images.ps1 -Tag 1.0.1 -AppOnly
#>
param(
    [string] $Tag = '1.0.0',
    [switch] $AppOnly,
    [switch] $IncludeOllama
)
$ErrorActionPreference = 'Continue'
$registry = 'localhost:5001'

$services = 'api-gateway', 'identity-service', 'hotel-service', 'flight-service', 'booking-service', 'payment-service',
    'notification-service', 'reporting-service', 'mcp-server-service', 'mcp-client-service', 'search-service', 'frontend'

foreach ($service in $services) {
    $target = "$registry/flighthotel/${service}:$Tag"
    Write-Host "-> $target" -ForegroundColor Cyan
    docker tag "flighthotel/${service}:local" $target
    if ($LASTEXITCODE -ne 0) { Write-Host "Missing flighthotel/${service}:local: run 'docker compose build' first." -ForegroundColor Red; exit 1 }
    docker push --quiet $target | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Push failed: is the registry running (kind-up.ps1)?" -ForegroundColor Red; exit 1 }
}

if ($AppOnly) { Write-Host "Application images pushed with tag $Tag." -ForegroundColor Green; exit 0 }

# Source image -> path in the local registry (same tag). Keep in step with deploy/charts/data-platform/values.yaml.
$mirror = [ordered]@{
    'mysql:8.4.13'                                         = 'mysql:8.4.13'
    'redis:8.4.8'                                          = 'redis:8.4.8'
    'confluentinc/cp-kafka:8.4.0'                          = 'confluentinc/cp-kafka:8.4.0'
    'confluentinc/cp-schema-registry:8.4.0'                = 'confluentinc/cp-schema-registry:8.4.0'
    'quay.io/debezium/connect:3.7.0.Final'                 = 'debezium/connect:3.7.0.Final'
    'docker.elastic.co/elasticsearch/elasticsearch:9.4.8'  = 'elasticsearch/elasticsearch:9.4.8'
    'axllent/mailpit:v1.33.0'                              = 'axllent/mailpit:v1.33.0'
    'curlimages/curl:8.17.0'                               = 'curlimages/curl:8.17.0'
}
if ($IncludeOllama) { $mirror['ollama/ollama:0.40.14'] = 'ollama/ollama:0.40.14' }

foreach ($source in $mirror.Keys) {
    $target = "$registry/$($mirror[$source])"
    Write-Host "-> $target" -ForegroundColor Cyan
    docker image inspect $source *> $null
    if ($LASTEXITCODE -ne 0) { docker pull --quiet $source | Out-Null }
    docker tag $source $target
    docker push --quiet $target | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Push of $target failed." -ForegroundColor Red; exit 1 }
}
Write-Host "All images are in $registry (application tag $Tag)." -ForegroundColor Green

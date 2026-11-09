<#
.SYNOPSIS
    Deploys everything with Helm directly (the manual path; with GitOps, Argo CD does the same from Git).

.DESCRIPTION
    1. data-platform (MySQL, Kafka, ...) in flight-hotel-data, waiting until it is ready (topics and connectors included)
    2. shared (common settings, network policies, quota) in flight-hotel
    3. every service in flight-hotel: one release of deploy/charts/microservice per file in
       deploy/environments/<env>/services/
    Safe to run again; a changed image tag or setting starts that service's canary / blue-green rollout.

.EXAMPLE
    .\deploy\scripts\deploy-apps.ps1
    .\deploy\scripts\deploy-apps.ps1 -Only booking-service -Tag 1.0.1
#>
param(
    [string] $Environment = 'kind',
    [string] $Only = '',
    [string] $Tag = ''
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$envDir = "deploy/environments/$Environment"
$tagArgs = if ($Tag) { @('--set', "global.image.tag=$Tag") } else { @() }
# --server-side=false (Helm's three-way merge, as Argo CD applies too): Argo Rollouts adds a pod-template hash to the
# selectors of the stable/canary and active/preview Services. Helm 4's default server-side apply would conflict with
# that field (or, forced, remove the hash and send traffic to both versions); the merge patches only what changed.
$applyArgs = @('--server-side=false')

if (-not $Only) {
    Write-Host "data-platform (first start: 5-10 minutes)" -ForegroundColor Cyan
    helm upgrade --install data-platform deploy/charts/data-platform -n flight-hotel-data @applyArgs `
        -f "$envDir/values.yaml" -f "$envDir/data-platform.yaml" --wait --wait-for-jobs --timeout 20m
    if ($LASTEXITCODE -ne 0) { Write-Host "data-platform failed: kubectl get pods -n flight-hotel-data" -ForegroundColor Red; exit 1 }

    Write-Host "shared" -ForegroundColor Cyan
    helm upgrade --install shared deploy/charts/shared -n flight-hotel @applyArgs `
        -f "$envDir/values.yaml" -f "$envDir/shared.yaml"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

foreach ($file in Get-ChildItem "$envDir/services" -Filter *.yaml) {
    $service = $file.BaseName
    if ($Only -and $service -ne $Only) { continue }
    Write-Host "$service" -ForegroundColor Cyan
    helm upgrade --install $service deploy/charts/microservice -n flight-hotel @applyArgs `
        -f "$envDir/values.yaml" -f $file.FullName @tagArgs
    if ($LASTEXITCODE -ne 0) { Write-Host "$service failed." -ForegroundColor Red; exit 1 }
}
Write-Host "`nDeployed. Watch: kubectl get pods -n flight-hotel -w   |   kubectl argo rollouts list rollouts -n flight-hotel" -ForegroundColor Green

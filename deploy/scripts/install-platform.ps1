<#
.SYNOPSIS
    Installs the cluster add-ons (pinned versions): Gateway API, metrics-server, Traefik, Argo Rollouts, Argo CD.

.DESCRIPTION
    Safe to run again (helm upgrade --install). Values are in deploy/platform/values/.

.EXAMPLE
    .\deploy\scripts\install-platform.ps1
    .\deploy\scripts\install-platform.ps1 -SkipArgoCd     # manual Helm deployments only
#>
param([switch] $SkipArgoCd)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

function Step([string] $text) { Write-Host $text -ForegroundColor Cyan }
function Check([string] $what) { if ($LASTEXITCODE -ne 0) { Write-Host "$what failed." -ForegroundColor Red; exit 1 } }

Step "Helm repositories"
helm repo add argo https://argoproj.github.io/argo-helm --force-update | Out-Null
helm repo add traefik https://traefik.github.io/charts --force-update | Out-Null
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update | Out-Null
helm repo update | Out-Null

Step "Gateway API CRDs v1.6.3 (standard channel)"
kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.3/standard-install.yaml | Out-Null
Check "Gateway API CRDs"

Step "Namespaces (with Pod Security levels)"
kubectl apply -f deploy/platform/namespaces.yaml
Check "Namespaces"

Step "metrics-server 0.9 (autoscaling metrics)"
helm upgrade --install metrics-server metrics-server/metrics-server --version 3.14.0 -n kube-system `
    -f deploy/platform/values/metrics-server.yaml --wait --timeout 5m
Check "metrics-server"

Step "Traefik 3.7 (Gateway API, http://localhost)"
helm upgrade --install traefik traefik/traefik --version 42.3.1 -n traefik --create-namespace `
    -f deploy/platform/values/traefik.yaml --wait --timeout 5m
Check "Traefik"

Step "Argo Rollouts 1.10 (+ Gateway API traffic plugin)"
helm upgrade --install argo-rollouts argo/argo-rollouts --version 2.43.9 -n argo-rollouts --create-namespace `
    -f deploy/platform/values/argo-rollouts.yaml --wait --timeout 5m
Check "Argo Rollouts"
kubectl apply -f deploy/platform/analysis-templates.yaml
kubectl apply -f deploy/platform/routes.yaml

if (-not $SkipArgoCd) {
    Step "Argo CD 3.6 (http://argocd.localhost)"
    helm upgrade --install argocd argo/argo-cd --version 10.15.0 -n argocd --create-namespace `
        -f deploy/platform/values/argo-cd.yaml --wait --timeout 10m
    Check "Argo CD"
    $secret = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>$null
    if ($secret) {
        Write-Host "Argo CD user: admin. Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' (base64)" -ForegroundColor Yellow
    }
}
Write-Host "`nPlatform ready. Next: .\deploy\scripts\create-secrets.ps1" -ForegroundColor Green

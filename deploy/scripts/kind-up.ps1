<#
.SYNOPSIS
    Creates the local HA Kubernetes cluster (3 control planes, 3 workers) and a local image registry next to it.

.DESCRIPTION
    1. Registry container "kind-registry" (registry:3), published on localhost:5001.
    2. kind cluster "flight-hotel" from deploy/kind/cluster.yaml (skipped when it exists).
    3. Every node pulls localhost:5001/... from the registry container (containerd hosts.toml).
    4. The registry joins the cluster's Docker network, and the cluster documents it (KEP-1755 ConfigMap).
    Safe to run again.

.EXAMPLE
    .\deploy\scripts\kind-up.ps1
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$cluster = 'flight-hotel'
$registry = 'kind-registry'
$port = 5001

Write-Host "1/4 Local registry ($registry, localhost:$port)" -ForegroundColor Cyan
if ((docker inspect -f '{{.State.Running}}' $registry 2>$null) -ne 'true') {
    docker run -d --restart=always -p "127.0.0.1:${port}:5000" --network bridge --name $registry registry:3.1.0 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not start the registry." -ForegroundColor Red; exit 1 }
}

Write-Host "2/4 Cluster $cluster (3 control planes + 3 workers; a few minutes the first time)" -ForegroundColor Cyan
if (-not ((kind get clusters 2>$null) -contains $cluster)) {
    kind create cluster --config deploy/kind/cluster.yaml --wait 5m
    if ($LASTEXITCODE -ne 0) { Write-Host "kind create cluster failed." -ForegroundColor Red; exit $LASTEXITCODE }
}

Write-Host "3/4 Nodes pull localhost:$port/... from the registry" -ForegroundColor Cyan
$dir = "/etc/containerd/certs.d/localhost:$port"
$hostsToml = Join-Path ([IO.Path]::GetTempPath()) 'kind-registry-hosts.toml'
# UTF-8 without BOM: containerd rejects a TOML file that starts with a byte-order mark.
[IO.File]::WriteAllText($hostsToml, "[host.`"http://${registry}:5000`"]`n", (New-Object Text.UTF8Encoding $false))
foreach ($node in (kind get nodes --name $cluster)) {
    if ($node -like '*external-load-balancer') { continue }
    docker exec $node mkdir -p $dir
    docker cp $hostsToml "${node}:$dir/hosts.toml" | Out-Null
}
Remove-Item $hostsToml

Write-Host "4/4 Registry on the cluster network" -ForegroundColor Cyan
if ((docker inspect -f '{{json .NetworkSettings.Networks.kind}}' $registry) -eq 'null') {
    docker network connect kind $registry
}
@"
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:$port"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
"@ | kubectl apply -f - | Out-Null

kubectl get nodes -o wide
Write-Host "`nCluster ready. Next: .\deploy\scripts\push-images.ps1" -ForegroundColor Green

<#
.SYNOPSIS
    Deletes the local cluster (all its data). With -RemoveRegistry also the local registry and its images.

.EXAMPLE
    .\deploy\scripts\kind-down.ps1
#>
param([switch] $RemoveRegistry)
kind delete cluster --name flight-hotel
if ($RemoveRegistry) { docker rm -f kind-registry | Out-Null; Write-Host "Registry removed." }

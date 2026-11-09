<#
.SYNOPSIS
    Creates the Kubernetes Secret "flight-hotel-secrets" (in flight-hotel and flight-hotel-data) from the project's .env.

.DESCRIPTION
    Passwords and keys never go into Git. This reads only the keys the cluster needs from .env, builds the Secret in
    memory and pipes it to kubectl (no temporary file, nothing printed). Run it again after changing .env, then
    restart the affected pods (kubectl argo rollouts restart <service> -n flight-hotel).
    Production (EKS): External Secrets Operator + AWS Secrets Manager instead (deploy/environments/eks/README.md).

.EXAMPLE
    .\deploy\scripts\create-secrets.ps1
#>
param([string] $EnvFile = '.env')
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

if (-not (Test-Path $EnvFile)) { Write-Host "No $EnvFile. Copy .env.example to .env and set the passwords." -ForegroundColor Red; exit 1 }

$values = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$' -and -not $line.TrimStart().StartsWith('#')) {
        $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
}

$required = 'MYSQL_ROOT_PASSWORD', 'IDENTITY_DB_PASSWORD', 'HOTEL_DB_PASSWORD', 'FLIGHT_DB_PASSWORD', 'BOOKING_DB_PASSWORD',
    'PAYMENT_DB_PASSWORD', 'NOTIFICATION_DB_PASSWORD', 'REPORTING_DB_PASSWORD', 'DEBEZIUM_DB_PASSWORD',
    'DATA_ENCRYPTION_KEY', 'MCP_SERVER_API_KEY'
$optional = @{
    'DEMO_USER_PASSWORD'      = ''
    'NEWSLETTER_SECRET'       = ''
    'PAYMENT_DEMO_SECRET'     = 'demo-only-secret-never-used-in-production'
    'RAZORPAY_KEY_ID'         = ''
    'RAZORPAY_KEY_SECRET'     = ''
    'RAZORPAY_WEBHOOK_SECRET' = ''
}

$missing = $required | Where-Object { -not $values[$_] }
if ($missing) { Write-Host "Set these in ${EnvFile}: $($missing -join ', ')" -ForegroundColor Red; exit 1 }

$data = [ordered]@{}
foreach ($key in $required) { $data[$key] = $values[$key] }
foreach ($key in $optional.Keys) { $data[$key] = if ($values[$key]) { $values[$key] } else { $optional[$key] } }

function ToBase64([string] $text) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) }

foreach ($namespace in 'flight-hotel', 'flight-hotel-data') {
    $lines = @('apiVersion: v1', 'kind: Secret', 'type: Opaque', 'metadata:', '  name: flight-hotel-secrets',
        "  namespace: $namespace", '  labels:', '    app.kubernetes.io/part-of: flight-hotel', 'data:')
    # Quoted: an optional key left empty stays an empty value ("") instead of becoming null and disappearing.
    foreach ($key in $data.Keys) { $lines += "  ${key}: `"$(ToBase64 $data[$key])`"" }
    ($lines -join "`n") | kubectl apply -f - | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not create the secret in $namespace (run install-platform.ps1 first)." -ForegroundColor Red; exit 1 }
    Write-Host "Secret flight-hotel-secrets in $namespace ($($data.Count) keys)" -ForegroundColor Green
}

<#
.SYNOPSIS
    Hands the cluster to Argo CD (GitOps): from then on Argo CD deploys whatever is on the main branch of your repository.

.DESCRIPTION
    1. Points every file in deploy/argocd/ at your repository (-RepoUrl). If that changed a file, the script stops:
       commit and push the change, then run it again (Argo CD reads these files from Git, not from this folder).
    2. -PrivateRepo: asks for a user name and a read-only token and stores them as an Argo CD repository secret
       (nothing is printed or written to disk).
    3. Applies the two Argo CD projects and the root Application of the environment. Argo CD then creates the other
       Applications and syncs them wave by wave: platform-config, data-platform, shared, then the 12 services.
    Resources that deploy-apps.ps1 created with Helm are adopted in place (same manifests, no restart).

.EXAMPLE
    .\deploy\scripts\argocd-bootstrap.ps1 -RepoUrl https://github.com/<owner>/flight-hotel-app.git
    .\deploy\scripts\argocd-bootstrap.ps1 -RepoUrl https://github.com/<owner>/flight-hotel-app.git -PrivateRepo
#>
param(
    [Parameter(Mandatory = $true)] [string] $RepoUrl,
    [string] $Environment = 'kind',
    [switch] $PrivateRepo
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

if ($RepoUrl -notmatch '^https?://\S+$') { Write-Host "-RepoUrl must be an http(s) URL, for example https://github.com/<owner>/flight-hotel-app.git" -ForegroundColor Red; exit 1 }
if (-not (Test-Path "deploy/argocd/$Environment/root.yaml")) { Write-Host "No deploy/argocd/$Environment/root.yaml" -ForegroundColor Red; exit 1 }

# 1. Repository URL in the Argo CD files (the repoURL: lines and the projects' sourceRepos entries).
$pattern = '(?m)^(\s*(?:repoURL:|-)\s+)(https?://\S+?)(\r?)$'
$changed = @()
foreach ($file in Get-ChildItem deploy/argocd -Recurse -Filter *.yaml) {
    $text = [IO.File]::ReadAllText($file.FullName)
    $updated = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $RepoUrl + $m.Groups[3].Value })
    if ($updated -ne $text) {
        [IO.File]::WriteAllText($file.FullName, $updated, (New-Object Text.UTF8Encoding $false))
        $changed += $file.FullName.Substring($root.Length + 1)
    }
}
if ($changed) {
    Write-Host "Set the repository to $RepoUrl in:" -ForegroundColor Yellow
    $changed | ForEach-Object { Write-Host "  $_" }
    Write-Host "Commit and push these files to main, then run this script again." -ForegroundColor Yellow
    exit 0
}

if (-not (kubectl get namespace argocd --ignore-not-found -o name)) { Write-Host "Argo CD is not installed: run install-platform.ps1 first." -ForegroundColor Red; exit 1 }

# 2. Credentials for a private repository (a GitHub fine-grained token with read access to "Contents" is enough).
if ($PrivateRepo) {
    $user = Read-Host 'Git user name'
    $secure = Read-Host 'Read-only token' -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    function ToBase64([string] $text) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) }
    @(
        'apiVersion: v1', 'kind: Secret', 'type: Opaque', 'metadata:', '  name: flight-hotel-repo', '  namespace: argocd',
        '  labels:', '    argocd.argoproj.io/secret-type: repository', 'data:',
        "  type: `"$(ToBase64 'git')`"", "  url: `"$(ToBase64 $RepoUrl)`"",
        "  username: `"$(ToBase64 $user)`"", "  password: `"$(ToBase64 $token)`""
    ) -join "`n" | kubectl apply -f - | Out-Null
    $token = $null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not store the repository credentials." -ForegroundColor Red; exit 1 }
    Write-Host "Repository credentials stored (secret argocd/flight-hotel-repo)." -ForegroundColor Green
}

# 3. Projects and the root Application.
kubectl apply -f deploy/argocd/projects.yaml
if ($LASTEXITCODE -ne 0) { exit 1 }
kubectl apply -f "deploy/argocd/$Environment/root.yaml"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`nArgo CD now deploys $RepoUrl (main). Watch: http://argocd.localhost   or   kubectl get applications -n argocd -w" -ForegroundColor Green
Write-Host "Password of 'admin': kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' (base64)"

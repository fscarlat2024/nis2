# Pune pe serverul Scut NIS2 cheia Firebase pentru notificarile Android. Se ruleaza o singura data, din PowerShell normal (nu ca Administrator).
# Cheia ramane doar pe calculatorul tau si pe Cloudflare; scriptul nu o afiseaza.
$ErrorActionPreference = 'Stop'
$fisier = Join-Path $env:USERPROFILE 'Downloads\ncs-apps-e64e0-firebase-adminsdk-fbsvc-757c3150b5.json'
if (-not (Test-Path $fisier)) { throw "Nu gasesc cheia: $fisier" }
$json = [IO.File]::ReadAllText($fisier)
$sa = $json | ConvertFrom-Json
if ($sa.type -ne 'service_account' -or -not $sa.private_key) { throw 'Fisierul nu este o cheie de service account Firebase.' }
Set-Location (Join-Path $PSScriptRoot '..')
Write-Host ("Proiect: " + $sa.project_id)
$json | node node_modules/wrangler/bin/wrangler.js secret put FCM_SA
if ($LASTEXITCODE -eq 0) { Write-Host 'Gata: cheia FCM_SA este pe server.' -ForegroundColor Green }

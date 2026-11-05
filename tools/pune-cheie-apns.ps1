# Pune pe serverul Scut NIS2 cheile pentru notificarile iPhone. Se ruleaza o singura data, din PowerShell normal (nu ca Administrator).
# Cheia ramane doar pe calculatorul tau si pe Cloudflare; scriptul nu o afiseaza.
$ErrorActionPreference = 'Stop'
$cheie = Join-Path $env:USERPROFILE 'Downloads\key apple\AuthKey_73UUH9L343.p8'
if (-not (Test-Path $cheie)) { throw "Nu gasesc cheia: $cheie" }
Set-Location (Join-Path $PSScriptRoot '..')
$tmp = Join-Path $env:TEMP ('apns-' + [guid]::NewGuid() + '.json')
try {
  @{
    APNS_KEY     = [IO.File]::ReadAllText($cheie)
    APNS_KEY_ID  = '73UUH9L343'
    APNS_TEAM_ID = 'L22K2CY58S'
    APNS_TOPIC   = 'ro.netcomm.nis2'
  } | ConvertTo-Json | Out-File -FilePath $tmp -Encoding ascii
  node node_modules\wrangler\bin\wrangler.js secret bulk $tmp
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host 'Gata. Notificarile iPhone sunt configurate.' -ForegroundColor Green

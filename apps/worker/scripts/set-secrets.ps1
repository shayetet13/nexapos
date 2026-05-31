Param(
  [string]$WorkerName = "pos-cloud-worker"
)

$ErrorActionPreference = "Stop"

$secrets = @(
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
  "INTERNAL_TOKEN",
  "ORIGIN_URL",
  "FRONTEND_URL",
  "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "DEV_ADMIN_EMAILS",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM"
)

Write-Host "Setting Cloudflare Worker secrets for '$WorkerName'" -ForegroundColor Cyan
Write-Host "Values are entered securely and never written to git files." -ForegroundColor Yellow

foreach ($name in $secrets) {
  Write-Host ""
  Write-Host "Secret: $name" -ForegroundColor Green
  wrangler secret put $name --name $WorkerName
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set secret: $name"
  }
}

Write-Host ""
Write-Host "All secrets have been uploaded to Cloudflare Worker." -ForegroundColor Cyan

@echo off
cd /d "%~dp0"
echo Starting POS Cloud (Frontend + Backend + Tunnel)...
start "cloudflared" cloudflared tunnel run pos-backend
pnpm dev

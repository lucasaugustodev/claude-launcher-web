$ErrorActionPreference = "Continue"
Set-Location "C:\Users\PC\claude-launcher-web"

Write-Host "=== Git Status ===" -ForegroundColor Cyan
git status

Write-Host "`n=== Git Diff (unstaged) ===" -ForegroundColor Cyan
git diff --stat

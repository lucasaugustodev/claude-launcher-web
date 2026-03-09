@echo off
cd /d C:\Users\PC\claude-launcher-web
echo === Git Status ===
git status
echo.
echo === Git Diff --stat ===
git diff --stat
echo.
echo === Git Diff --name-only ===
git diff --name-only

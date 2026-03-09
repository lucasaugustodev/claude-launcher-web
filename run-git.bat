@echo off
cd /d C:\Users\PC\claude-launcher-web
git status > git-status-output.txt 2>&1
git diff --stat >> git-status-output.txt 2>&1
git diff --name-only >> git-status-output.txt 2>&1
git remote -v >> git-status-output.txt 2>&1
type git-status-output.txt

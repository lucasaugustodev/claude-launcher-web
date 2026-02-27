# Claude Launcher Web - Auto-update script (Windows)
# Checks GitHub for updates and restarts if needed

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$logDir = Join-Path $scriptDir 'data'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'update.log'

function Log($msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logFile -Value "[$ts] $msg" -ErrorAction SilentlyContinue
}

# Truncate log if too large
if ((Test-Path $logFile) -and ((Get-Content $logFile -ErrorAction SilentlyContinue | Measure-Object).Count -gt 200)) {
  Get-Content $logFile -Tail 100 | Set-Content "$logFile.tmp"
  Move-Item "$logFile.tmp" $logFile -Force
}

# Ensure git is in PATH
$env:Path = 'C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\nodejs;' + $env:Path

# Fetch latest
$fetchOut = & git fetch origin main 2>&1
if ($LASTEXITCODE -ne 0) {
  $fetchOut = & git fetch origin master 2>&1
  if ($LASTEXITCODE -ne 0) { Log "ERROR: git fetch failed: $fetchOut"; exit 1 }
}

$local = & git rev-parse HEAD 2>&1
$branch = & git rev-parse --abbrev-ref HEAD 2>&1
$remote = & git rev-parse "origin/$branch" 2>&1

if ($local -eq $remote) { exit 0 }

Log "Update available: $local -> $remote"

$pullOut = & git pull origin $branch 2>&1
if ($LASTEXITCODE -ne 0) {
  Log "ERROR: git pull failed, resetting..."
  & git reset --hard "origin/$branch" 2>&1 | Out-Null
}
Log ($pullOut | Select-Object -Last 3 | Out-String)

# Check if package.json changed
$changed = & git diff "$local" "$remote" --name-only 2>&1
if ($changed -match 'package.json') {
  Log "package.json changed, running npm install..."
  $npmOut = & 'C:\Program Files\nodejs\npm.cmd' install --production 2>&1
  Log ($npmOut | Select-Object -Last 3 | Out-String)
}

Log "Restarting service..."
$taskName = 'ClaudeLauncherWeb'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Log "Restarted via Scheduled Task"
Log "Update complete: $(& git rev-parse --short HEAD 2>&1)"

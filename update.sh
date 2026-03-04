#!/bin/bash
# Claude Launcher Web - Auto-update script
# Checks GitHub for updates and restarts if needed

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Ensure git trusts this directory (fixes ownership mismatch)
git config --global --add safe.directory "$SCRIPT_DIR" 2>/dev/null

LOG_FILE="$SCRIPT_DIR/data/update.log"
mkdir -p "$SCRIPT_DIR/data"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE" 2>/dev/null
}

# Only keep last 200 lines of log
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 200 ]; then
  tail -100 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Fetch latest changes
git fetch origin main 2>/dev/null || git fetch origin master 2>/dev/null || { log "ERROR: git fetch failed"; exit 1; }

# Get current and remote HEAD
LOCAL=$(git rev-parse HEAD 2>/dev/null)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Update available: $LOCAL -> $REMOTE"

# Pull changes
git pull origin "$BRANCH" 2>&1 | tail -5 >> "$LOG_FILE"
if [ $? -ne 0 ]; then
  log "ERROR: git pull failed, attempting reset"
  git reset --hard "origin/$BRANCH" 2>&1 >> "$LOG_FILE"
fi

# Check if package.json changed (need npm install)
if git diff "$LOCAL" "$REMOTE" --name-only | grep -q "package.json"; then
  log "package.json changed, running npm install..."
  npm install --production 2>&1 | tail -3 >> "$LOG_FILE"
fi

log "Restarting service..."

# Try systemd first, then pm2
if systemctl is-active claude-launcher-web &>/dev/null; then
  sudo systemctl restart claude-launcher-web
  log "Restarted via systemd"
elif command -v pm2 &>/dev/null; then
  pm2 restart claude-launcher-web 2>/dev/null || pm2 restart all
  log "Restarted via pm2"
else
  log "WARNING: No service manager found to restart"
fi

log "Update complete: $(git rev-parse --short HEAD)"

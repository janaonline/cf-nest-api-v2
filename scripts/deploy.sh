#!/usr/bin/env bash
# Production deploy for cf-nest-api-v2 (Ubuntu + PM2).
#
# Usage:  ./scripts/deploy.sh
#
# production branch -> npm ci -> build -> PM2 start or restart.

set -euo pipefail

APP_DIR="/var/www/html/production/cf-nest-api-v2"
BRANCH="production"
PM2_APP="cf-nest-api-v2"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

command -v pm2 >/dev/null || { echo "pm2 is not installed (npm i -g pm2)." >&2; exit 1; }
[ -d "$APP_DIR/.git" ] || { echo "$APP_DIR is not a git checkout." >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "Missing $APP_DIR/.env." >&2; exit 1; }

cd "$APP_DIR"

log "Pulling '$BRANCH'"
git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log "Installing dependencies"
npm ci

log "Building"
npm run build

log "Starting/restarting $PM2_APP"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart ecosystem.config.js --only "$PM2_APP" --update-env
else
  pm2 start ecosystem.config.js --only "$PM2_APP"
fi
pm2 save >/dev/null

pm2 status "$PM2_APP"
log "Deployment complete ($(git rev-parse --short HEAD))."

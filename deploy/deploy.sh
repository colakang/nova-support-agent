#!/usr/bin/env bash
# Deploy to a single small host (tested: 2 GB ARM EC2 shared with other services).
#   DEPLOY_HOST=ec2 SITE_DOMAIN=support-demo.example.com ./deploy/deploy.sh
# Prereqs on the host: docker + compose, nginx with the site from deploy/nginx.conf.example,
# and ~/support-agent/.env (chmod 600) created once from .env.example. Secrets never leave the host.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:?set DEPLOY_HOST (ssh alias)}"
DOMAIN="${SITE_DOMAIN:?set SITE_DOMAIN}"
REMOTE_DIR="${REMOTE_DIR:-support-agent}"
WEB_ROOT="${WEB_ROOT:-/var/www/support-demo}"

echo "▶ building static web (same-origin API)"
NEXT_PUBLIC_API_URL="" pnpm --filter @sa/web build
test -f apps/web/out/index.html || { echo "apps/web/out missing — is next.config output: 'export'?"; exit 1; }

echo "▶ syncing source to $HOST:$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude out --exclude .git \
  --exclude '.env' --exclude '.env.*' --exclude 'evals/.cache' --exclude 'evals/results/run-*.json' \
  ./ "$HOST:$REMOTE_DIR/"

echo "▶ syncing web build to $WEB_ROOT"
rsync -az --delete apps/web/out/ "$HOST:$REMOTE_DIR/.web-out/"
ssh "$HOST" "sudo mkdir -p $WEB_ROOT && sudo rsync -a --delete $REMOTE_DIR/.web-out/ $WEB_ROOT/"

echo "▶ containers"
ssh "$HOST" "cd $REMOTE_DIR && test -f .env && docker compose --profile prod up -d --build && \
  docker compose exec -T api node --import tsx src/cli/migrate.ts && \
  docker compose exec -T api node --import tsx ../../packages/rag/src/cli/ingest.ts && \
  docker image prune -f >/dev/null"

echo "▶ health"
sleep 2
curl -fsS "https://$DOMAIN/api/health" && echo

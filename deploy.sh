#!/usr/bin/env bash
#
# Redeploy QBO Summary on the EC2 box.
#
#   ./deploy.sh
#
# Why this exists rather than just `docker-compose up -d --build`:
# this host runs docker-compose v1.29.2 (the old standalone Python build),
# which crashes with `KeyError: 'ContainerConfig'` whenever it tries to
# RECREATE an existing container against a newer-format image. The build
# itself always succeeds — only the recreate step dies. Removing the old
# container first sidesteps the broken code path entirely.
#
# The app_data volume is never touched, so QuickBooks connections, cached
# summaries and live sessions all survive a redeploy.

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE=docker-compose.prod.yml

echo "==> Pulling latest code"
git pull

echo "==> Building image"
docker-compose -f "$COMPOSE_FILE" build

echo "==> Removing old container (volume is left alone)"
docker-compose -f "$COMPOSE_FILE" rm -f -s app

echo "==> Starting"
docker-compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for health check"
sleep 5
docker-compose -f "$COMPOSE_FILE" ps

echo
if curl -fsS -o /dev/null http://127.0.0.1:4500/api/health; then
  echo "OK — app is answering on 127.0.0.1:4500"
else
  echo "WARNING — no answer on 127.0.0.1:4500 yet. Check: docker-compose -f $COMPOSE_FILE logs --tail=50 app"
  exit 1
fi

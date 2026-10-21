#!/usr/bin/env bash
#
# Redeploy gogo.org.in from the latest main branch.
#
# Run manually on the server:
#   ssh root@200.234.38.116
#   cd /var/www/gogo && ./deploy.sh
#
# Does NOT run automatically on push. The repo has had a recurring injected-code
# incident (see SECURITY_INCIDENT.md) whose source was never found, so this script
# deliberately stops on any sign of it rather than building and shipping it.
#
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Checking for injected-code signatures before installing or building anything"
node Frontend/scripts/check-source-integrity.mjs

echo "==> Backend: installing dependencies"
cd Backend
npm install --omit=dev
cd ..

echo "==> Frontend: installing dependencies and building"
cd Frontend
npm install
npm run build
cd ..

echo "==> Reloading pm2 processes (zero-downtime)"
pm2 reload gogo-api
pm2 reload gogo-workers
pm2 save

echo "==> Reloading nginx"
nginx -t
systemctl reload nginx

echo "==> Deploy finished: $(git rev-parse --short HEAD)"
sleep 2
curl -s http://localhost:5000/health && echo || echo "(health check didn't respond yet -- give pm2 a few more seconds and check 'pm2 status')"

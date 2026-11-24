#!/bin/bash
# Local dev: random secrets in .dev.vars, migrations, demo client and a test owner (owner@demo.test / demo-pass-2026).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .dev.vars ]; then
  printf 'SECRETS_KEY=%s\nAGENT_TOKEN=%s\nSETUP_CODE=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$(openssl rand -hex 8)" > .dev.vars
fi
rm -rf .wrangler/state
${WRANGLER:-npx --yes wrangler@4} d1 migrations apply DB --local
python3 scripts/seed.py --owner > .wrangler/seed.sql
${WRANGLER:-npx --yes wrangler@4} d1 execute DB --local --file .wrangler/seed.sql
echo "Ready: npx wrangler dev  →  http://localhost:8787  (owner@demo.test / demo-pass-2026)"

#!/bin/bash
# Install the site in the agency's own Cloudflare account: one Worker + one D1, named after the agency.
#   site/scripts/install.sh <name>        e.g. install.sh dana-studio
# Needs: wrangler logged in (`npx wrangler login` opens the browser once). Prints no keys.
# Writes .secrets/site.json (site address + agent token, for scripts/agent.py) and opens the setup page.
set -euo pipefail
NAME="${1:?usage: install.sh <name, lowercase-with-dashes>}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || { echo "name: lowercase letters, digits and dashes only"; exit 1; }
W="${WRANGLER:-npx --yes wrangler@4}"
SITE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(dirname "$SITE")"
cd "$SITE"
T0=$(date +%s); step(){ echo "[$(( $(date +%s) - T0 ))s] $*"; }

step "1/6 Cloudflare login"
$W whoami 2>&1 | grep -qi "associated with the email\|You are logged in" || { echo "Not logged in: run  npx wrangler login  and run this again"; exit 2; }

step "2/6 database $NAME"
ID=$($W d1 list --json 2>/dev/null | python3 -c "import json,sys;print(next((d['uuid'] for d in json.load(sys.stdin) if d['name']=='$NAME'),''))")
if [ -z "$ID" ]; then
  $W d1 create "$NAME" > /tmp/d1-$$.txt 2>&1 || { cat /tmp/d1-$$.txt; exit 3; }
  ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /tmp/d1-$$.txt | head -1); rm -f /tmp/d1-$$.txt
fi
[ -n "$ID" ] || { echo "could not read the database id"; exit 3; }
python3 - "$NAME" "$ID" <<'EOF'
import re, sys
name, dbid = sys.argv[1], sys.argv[2]
s = open("wrangler.jsonc").read()
s = re.sub(r'"name": "[^"]*",\n  "main"', f'"name": "{name}",\n  "main"', s, count=1)
s = re.sub(r'"database_name": "[^"]*"', f'"database_name": "{name}"', s)
s = re.sub(r'"database_id": "[^"]*"', f'"database_id": "{dbid}"', s)
open("wrangler.jsonc", "w").write(s)
EOF

step "3/6 tables"
$W d1 migrations apply DB --remote > /dev/null
if [ "$($W d1 execute DB --remote --json --command 'SELECT COUNT(*) AS n FROM clients' 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["results"][0]["n"])')" = "0" ]; then
  python3 scripts/seed.py > /tmp/seed-$$.sql && $W d1 execute DB --remote --file /tmp/seed-$$.sql > /dev/null; rm -f /tmp/seed-$$.sql
  step "   demo client added"
fi

step "4/6 deploy"
OUT=$($W deploy 2>&1) || { echo "$OUT" | tail -20; exit 4; }
URL=$(echo "$OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "$OUT" | tail -20; echo "deployed, but no workers.dev address (open Workers & Pages once in the dashboard to pick a subdomain)"; exit 4; }

step "5/6 secrets"
mkdir -p "$ROOT/.secrets"; chmod 700 "$ROOT/.secrets"
CONF="$ROOT/.secrets/site.json"
if [ -f "$CONF" ] && python3 -c "import json;exit(0 if json.load(open('$CONF')).get('name')=='$NAME' else 1)"; then
  step "   keeping existing secrets"
  SETUP_CODE=$(python3 -c "import json;print(json.load(open('$CONF'))['setup_code'])")
else
  SK=$(openssl rand -hex 32); AT=$(openssl rand -hex 24); SETUP_CODE=$(openssl rand -hex 8)
  printf '{"SECRETS_KEY":"%s","AGENT_TOKEN":"%s","SETUP_CODE":"%s"}' "$SK" "$AT" "$SETUP_CODE" > /tmp/sec-$$.json
  $W secret bulk /tmp/sec-$$.json > /dev/null; rm -f /tmp/sec-$$.json
  printf '{"name":"%s","url":"%s","agent_token":"%s","setup_code":"%s"}\n' "$NAME" "$URL" "$AT" "$SETUP_CODE" > "$CONF"; chmod 600 "$CONF"
  unset SK AT
fi

step "6/6 check"
for i in 1 2 3 4 5 6; do
  S=$(curl -s "$URL/api/session" || true); echo "$S" | grep -q setup_needed && break; sleep 3
done
echo "$S" | grep -q '"setup_needed":true' && step "   site is up, waiting for the owner" || step "   site answered: ${S:0:120}"
python3 "$SITE/scripts/agent.py" beat "installed" > /dev/null && step "   agent connection ok"
echo "DONE in $(( $(date +%s) - T0 ))s → $URL"
[ "${NO_OPEN:-}" = "1" ] || open "$URL/#setup=$SETUP_CODE"

#!/usr/bin/env bash
# Browser tests against a local fork of Robinhood Chain mainnet: contracts deployed exactly as on launch day,
# Shield and the web app pointed at the fork, a stand-in wallet signing real transactions. Nothing touches mainnet.
#   apps/web/e2e/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB="$ROOT/apps/web"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; for port in 3320 8899 8545; do fuser -k -TERM "$port/tcp" >/dev/null 2>&1 || true; done; sleep 1; }
cleanup  # nothing left over from an earlier run
trap cleanup EXIT

echo "── fork + contracts"
(cd "$ROOT/contracts" && KEEP_NODE=1 SETUP_ONLY=1 scripts/rehearsal.sh | grep -E "FAIL|E2E setup")
ENVJSON="$(cat "$ROOT/contracts/deployments/localhost.e2e.json")"
# Scan only blocks made on the fork: older logs would be fetched from mainnet through the fork, which is slow and flaky.
FORK_BLOCK=$(curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"hardhat_metadata","params":[]}' http://127.0.0.1:8545 \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).result;console.log(m?.forkedNetwork?.forkBlockNumber??0)})")
j() { node -e "console.log(JSON.parse(process.argv[1]).$1)" "$ENVJSON"; }
ADMIN_KEY="e2e-admin-$(date +%s)"
ADMIN_SHA=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$ADMIN_KEY")

echo "── Shield on the fork"
echo "   scanning from fork block $FORK_BLOCK"
(cd "$ROOT/apps/shield" && SCAN_MAX_REQUESTS=6 SCAN_FIRST_TX=0 SCAN_FROM_BLOCK=$((FORK_BLOCK + 1)) WEBHOOK_ALLOW_HTTP=1 RPC_NO_PUBLIC_FALLBACK=1 RPC_TIMEOUT_MS=90000 EXPLORER_API_URL=http://127.0.0.1:9 PORT=8899 NODE_ENV=development RPC_URL_MAINNET=http://127.0.0.1:8545 SHIELD_ADMIN_KEY_SHA256=$ADMIN_SHA \
  HEIM_HOLDER_ADDRESS=$(j HOLDER) HEIM_ADDRESS=$(j HEIM) HEIMDALL_PAY_ADDRESS=$(j PAY) HEIMDALL_FACTORY_ADDRESS=$(j FACTORY) HEIMDALL_SIGNALS_ADDRESS=$(j SIGNALS) HEIMDALL_STAKING_ADDRESS=$(j STAKING) \
  npx tsx src/server.ts > /tmp/e2e-shield.log 2>&1) & PIDS+=($!)

echo "── web build for the fork"
cd "$WEB"
export NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_PUBLIC_API_URL=http://127.0.0.1:8899 SHIELD_API_URL=http://127.0.0.1:8899 \
  NEXT_PUBLIC_HEIM_ADDRESS=$(j HEIM) NEXT_PUBLIC_HEIM_HOLDER_ADDRESS=$(j HOLDER) NEXT_PUBLIC_STAKING_ADDRESS=$(j STAKING) NEXT_PUBLIC_SPLITTER_ADDRESS=$(j SPLITTER) \
  NEXT_PUBLIC_FACTORY_ADDRESS=$(j FACTORY) NEXT_PUBLIC_PAY_ADDRESS=$(j PAY) NEXT_PUBLIC_AUTOINVEST_ADDRESS=$(j AUTOINVEST) NEXT_PUBLIC_SIGNALS_ADDRESS=$(j SIGNALS)
NEXT_DIST_DIR=.next-e2e npx next build > /tmp/e2e-build.log 2>&1 || { tail -30 /tmp/e2e-build.log; exit 1; }
(NEXT_DIST_DIR=.next-e2e npx next start -p 3320 > /tmp/e2e-web.log 2>&1) & PIDS+=($!)
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3320 && curl -sf -o /dev/null http://127.0.0.1:8899/health && break; sleep 1; done

echo "── browser tests"
E2E_ENV="$ENVJSON" E2E_ADMIN_KEY="$ADMIN_KEY" CHROME_PATH="${CHROME_PATH:-$(command -v google-chrome || true)}" npx playwright test "$@"

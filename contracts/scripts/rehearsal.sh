#!/usr/bin/env bash
# Launch-day rehearsal on a local fork of Robinhood Chain mainnet. Nothing touches mainnet.
#   scripts/rehearsal.sh            (RPC_URL_MAINNET to use your own RPC)
set -euo pipefail
cd "$(dirname "$0")/.."
RPC="${RPC_URL_MAINNET:-https://rpc.mainnet.chain.robinhood.com}"
rm -f deployments/localhost*.json deployments/localhost.rehearsal.md
# chain id 4663 like mainnet, so wallets and the web app see the chain they expect
RPC_URL_MAINNET="$RPC" npx hardhat node --network robinhoodFork > /tmp/heimdall-fork.log 2>&1 &
NODE=$!; trap 'kill $NODE 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 && break; sleep 1; done
echo "── 1. core contracts (deploy.ts)";      DRY_RUN=1 npx hardhat run scripts/deploy.ts --network localhost
echo "── 2. stand-in \$HEIM";                  npx hardhat run scripts/rehearsal-token.ts --network localhost
HEIM=$(node -e 'console.log(require("./deployments/localhost.heim.json").HEIM)')
echo "── 3. staking + splitter";              HEIM=$HEIM STAKER_BPS=5000 npx hardhat run scripts/deploy-staking.ts --network localhost
echo "── 4. Safe batches + money through every fee path"; npx hardhat run scripts/rehearsal.ts --network localhost
if [ "${KEEP_NODE:-0}" = "1" ]; then trap - EXIT; echo "fork node left running (pid $NODE)"; fi

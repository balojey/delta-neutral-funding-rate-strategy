#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Devnet integration test — full 8-step delta-neutral strategy lifecycle
# ---------------------------------------------------------------------------
# Usage:
#   bash scripts/test-devnet.sh
#
# Pre-requisites:
#   1. HELIUS_RPC_URL in .env points to a devnet endpoint
#   2. assetMintAddress in config/base.ts = Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
#   3. vaultAddress and lookupTableAddress in config/base.ts filled after Step 1
# ---------------------------------------------------------------------------

export CLUSTER=devnet

# Load .env
set -a; source .env; set +a

# Derive pubkeys from keypair files
ADMIN_PUBKEY=$(node -e "const b=require('fs').readFileSync(process.env.ADMIN_FILE_PATH,'utf8'); const {Keypair}=require('@solana/web3.js'); console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(b))).publicKey.toBase58())")
MANAGER_PUBKEY=$(node -e "const b=require('fs').readFileSync(process.env.MANAGER_FILE_PATH,'utf8'); const {Keypair}=require('@solana/web3.js'); console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(b))).publicKey.toBase58())")
USER_PUBKEY=$(node -e "const b=require('fs').readFileSync(process.env.USER_FILE_PATH,'utf8'); const {Keypair}=require('@solana/web3.js'); console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(b))).publicKey.toBase58())")

log() { echo -e "\n\033[1;34m>>> $*\033[0m"; }
ok()  { echo -e "\033[1;32m✔  $*\033[0m"; }

# ---------------------------------------------------------------------------
echo -e "\033[1;33m"
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║           Devnet Integration Test — Account Summary          ║"
echo "  ╠══════════════════════════════════════════════════════════════╣"
echo "  ║  Admin:   $ADMIN_PUBKEY  ║"
echo "  ║  Manager: $MANAGER_PUBKEY  ║"
echo "  ║  User:    $USER_PUBKEY  ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo -e "\033[0m"
# ---------------------------------------------------------------------------
log "Pre-flight: check balances and airdrop if needed"
# ---------------------------------------------------------------------------
MIN_SOL=1  # airdrop if balance is below this (in SOL)

airdrop_if_needed() {
  local pubkey=$1
  local label=$2
  local balance
  balance=$(solana balance "$pubkey" --url "$HELIUS_RPC_URL" | awk '{print int($1)}')
  echo "  $label ($pubkey): ${balance} SOL"
  if [ "$balance" -lt "$MIN_SOL" ]; then
    echo "  → Balance low, requesting airdrop..."
    solana airdrop 2 "$pubkey" --url "$HELIUS_RPC_URL"
    sleep 5
  else
    echo "  → Balance sufficient, skipping airdrop."
  fi
}

airdrop_if_needed "$ADMIN_PUBKEY"   "admin"
airdrop_if_needed "$MANAGER_PUBKEY" "manager"
airdrop_if_needed "$USER_PUBKEY"    "user"
ok "Balance check done"

# ---------------------------------------------------------------------------
log "Step 1 — Init vault, adaptor, and Drift user"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/admin-init-vault.ts
echo ""
echo "⚠️  NOTE: Copy the vault address and LUT address printed above into config/base.ts before proceeding."

pnpm ts-node src/scripts/admin-add-adaptor.ts
pnpm ts-node src/scripts/manager-init-user.ts
ok "Step 1 complete"

# ---------------------------------------------------------------------------
log "Step 2 — Fund: user deposit → manager deposit into Drift"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/user-deposit-vault.ts
pnpm ts-node src/scripts/manager-deposit-user.ts
ok "Step 2 complete"

# ---------------------------------------------------------------------------
log "Step 3 — Open short SOL-PERP"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/manager-open-short-perp.ts
ok "Step 3 complete"

# ---------------------------------------------------------------------------
log "Step 4 — Query strategy positions"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/query-strategy-positions.ts
ok "Step 4 complete"

# ---------------------------------------------------------------------------
log "Step 5 — Rebalance delta"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/manager-rebalance-delta.ts
ok "Step 5 complete"

# ---------------------------------------------------------------------------
log "Step 6 — Compound yield"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/manager-compound-yield.ts
ok "Step 6 complete"

# ---------------------------------------------------------------------------
log "Step 7 — Close short (run twice to verify idempotence)"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/manager-close-short-perp.ts
pnpm ts-node src/scripts/manager-close-short-perp.ts
ok "Step 7 complete — second run should have printed 'No open short position to close.'"

# ---------------------------------------------------------------------------
log "Step 8 — Withdraw: Drift → vault → user"
# ---------------------------------------------------------------------------
pnpm ts-node src/scripts/manager-withdraw-user.ts
pnpm ts-node src/scripts/user-instant-withdraw-vault.ts
ok "Step 8 complete"

echo ""
echo -e "\033[1;32m✔  Full lifecycle complete.\033[0m"

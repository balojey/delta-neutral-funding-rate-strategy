# Tech Stack

## Language & Runtime
- TypeScript 5.7, targeting ES2020, CommonJS modules
- Node.js v18+
- `ts-node` for direct script execution (no build step required)

## Key Libraries
- `@voltr/vault-sdk` — Voltr Vault program client (PDAs, instructions, types)
- `@coral-xyz/anchor` ^0.30 — Anchor framework for Solana program interaction
- `@solana/web3.js` ^1.98 — Core Solana SDK (connections, transactions, keypairs)
- `@solana/spl-token` ^0.4 — SPL Token / Token-2022 utilities
- `@drift-labs/sdk` 2.120.0-beta.1 — Drift Protocol SDK (remaining accounts builder)
- `dotenv` — environment variable loading
- `bs58` — Base58 encoding for transaction serialization

## Package Manager
- `pnpm` (lockfile: `pnpm-lock.yaml`)

## Common Commands

```bash
# Install dependencies
pnpm install

# Run any script
pnpm ts-node src/scripts/<script-name>.ts

# Examples
pnpm ts-node src/scripts/admin-init-vault.ts
pnpm ts-node src/scripts/user-deposit-vault.ts
pnpm ts-node src/scripts/query-strategy-positions.ts
```

No build, test, or lint scripts are configured. Scripts are run directly via `ts-node`.

## Environment Setup
Copy `.env.example` to `.env` and populate:
```
ADMIN_FILE_PATH="/path/to/admin.json"
MANAGER_FILE_PATH="/path/to/manager.json"
USER_FILE_PATH="/path/to/user.json"
HELIUS_RPC_URL="https://your-rpc-provider-url"
```
Keypair files are JSON arrays of secret key bytes (Solana CLI format). Never commit them.

## Transaction Pattern
All scripts use `sendAndConfirmOptimisedTx` from `src/utils/helper.ts`, which:
1. Simulates the transaction to estimate compute units
2. Adds a 10% CU buffer
3. Fetches a priority fee estimate via Helius `getPriorityFeeEstimate`
4. Sends a versioned transaction (`TransactionMessage` → `VersionedTransaction`) with optional LUT accounts

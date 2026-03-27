# Project Structure

```
.
├── config/                  # User-editable configuration (edit before running scripts)
│   ├── base.ts              # Vault address, asset mint, amounts, fees, LUT address
│   └── drift.ts             # Drift market index, strategy deposit/withdraw amounts
├── src/
│   ├── constants/
│   │   ├── base.ts          # PROTOCOL_ADMIN address
│   │   └── drift.ts         # ADAPTOR_PROGRAM_ID, DRIFT program/market constants, DISCRIMINATOR map
│   ├── utils/
│   │   └── helper.ts        # Shared utilities: sendAndConfirmOptimisedTx, setupTokenAccount, LUT helpers
│   └── scripts/             # Executable scripts, one action per file
│       ├── admin-*.ts       # Vault init, config updates, fee harvesting, adaptor management
│       ├── manager-*.ts     # Strategy init, deposit/withdraw into Drift
│       └── user-*.ts        # Vault deposit/withdraw, position queries
├── .env                     # Local secrets (gitignored)
├── .env.example             # Template for required env vars
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

## Conventions

- Scripts are standalone and self-contained — each file handles one operation end-to-end
- Scripts follow a `{role}-{action}.ts` naming pattern (e.g. `admin-init-vault.ts`, `user-deposit-vault.ts`)
- All scripts read config from `config/base.ts` and `config/drift.ts` — never hardcode addresses or amounts in scripts
- All scripts load keypairs from env vars (`ADMIN_FILE_PATH`, `MANAGER_FILE_PATH`, `USER_FILE_PATH`) and the RPC from `HELIUS_RPC_URL`
- Shared logic lives in `src/utils/helper.ts` — transaction sending, ATA setup, and LUT management are never duplicated inline
- Constants (program IDs, market indices, discriminators) live in `src/constants/` — never hardcoded in scripts
- All transactions use versioned transactions (`VersionedTransaction`) with `TransactionMessage.compileToV0Message`
- LUT accounts are passed to `compileToV0Message` when `useLookupTable` is true
- Token amounts always account for decimals (asset tokens vary; LP tokens are always 9 decimals)

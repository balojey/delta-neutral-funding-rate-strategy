# Voltr Vault Client Scripts

A TypeScript scripting toolkit for interacting with the Voltr Vault protocol on Solana. It provides operational scripts for three roles — admin, manager, and user — to manage yield vaults and deploy capital into DeFi strategies, with a focus on the delta-neutral funding rate strategy on Drift Protocol.

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [The Delta-Neutral Funding Rate Strategy](#the-delta-neutral-funding-rate-strategy)
- [Running on Live Mainnet](#running-on-live-mainnet)
- [Backtesting the Strategy](#backtesting-the-strategy)
- [Running on Devnet](#running-on-devnet)
- [Available Scripts Reference](#available-scripts-reference)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)

---

## Introduction

This repository contains TypeScript scripts for interacting with Voltr Vaults on Solana. It covers core vault operations (init, deposit, withdraw, fee harvesting) as well as Drift protocol spot market strategy management via the Voltr Drift Adaptor.

---

## Prerequisites

1. **Node.js v18+**
2. **pnpm** — `npm install -g pnpm`
3. **Solana keypair files (JSON format)** for three roles: Admin, Manager, User
4. **Solana RPC URL** — a reliable endpoint (e.g. Helius)

---

## Installation

```bash
git clone <your-repo-url>
cd <repo>
pnpm install
```

---

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
ADMIN_FILE_PATH="/path/to/your/admin.json"
MANAGER_FILE_PATH="/path/to/your/manager.json"
USER_FILE_PATH="/path/to/your/user.json"
HELIUS_RPC_URL="https://your-rpc-provider-url"
```

> Never commit keypair files to version control.

### Base Config (`config/base.ts`)

Edit before running any scripts. Key fields:

- `vaultAddress` — fill in after running `admin-init-vault.ts`
- `assetMintAddress` — the token deposited into the vault (e.g. USDC mint)
- `assetTokenProgram` — SPL Token or Token-2022 program ID
- `depositAmountVault` / `withdrawAmountVault` — amounts in smallest token units
- `useLookupTable` / `lookupTableAddress` — LUT for cheaper transactions
- `vaultConfig` — fees, caps, waiting periods (all in basis points or seconds)

### Drift Config (`config/drift.ts`)

Key fields for the delta-neutral strategy:

- `perpMarketIndex` — target perp market (default: SOL-PERP index 1)
- `shortPerpSizeRatio` — fraction of NAV to deploy as short notional (default `0.40`)
- `bufferRatio` — fraction of NAV held as liquid USDC buffer (default `0.10`)
- `rebalanceThresholdPct` — delta deviation % that triggers a rebalance (default `2`)
- `minMarginHealthRatio` — margin health floor (default `1.5`)
- `perpOrderSize` — order size in base asset units (default: `1_000_000_000` = 1 SOL)

---

## The Delta-Neutral Funding Rate Strategy

### What it is

This strategy earns yield from two sources simultaneously while maintaining near-zero directional exposure to SOL price:

1. **Funding rate income** — by holding a short SOL-PERP position on Drift, the strategy receives funding payments from long traders whenever the funding rate is positive. On Drift, funding rates are paid hourly and have historically averaged 10–30% APY during bull markets.

2. **USDC lending yield** — the USDC collateral sitting in Drift's spot market earns lending interest from borrowers, typically 3–8% APY.

### Capital allocation (50/40/10 split)

| Allocation | Purpose |
|---|---|
| 90% as spot USDC collateral | Earns lending yield; backs the short perp margin |
| 40% synthetic short notional | The size of the short perp position (backed by the collateral above) |
| 10% liquid buffer | Absorbs negative funding payments; emergency cushion |

> The 40% short notional is synthetic — it does not require separate capital. It is the notional size of the short position, backed by the 90% USDC collateral already on Drift.

### How delta neutrality works

**Delta** = spot balance − short notional. When delta is near zero, the strategy has no net directional exposure — gains from the short offset losses from holding USDC as SOL rises, and vice versa.

When SOL price moves, the short notional changes (mark-to-market) while the spot balance stays constant, causing delta to drift. When `|delta| / NAV` exceeds `rebalanceThresholdPct`, the short is resized to restore neutrality.

### Risk management

- **Rebalance** — fires automatically when delta deviation exceeds threshold; adjusts short size toward spot balance
- **Margin health** = `(spotBalance + buffer) / shortNotional`. Below `minMarginHealthRatio` (1.5), no short increases are allowed. Below 1.2, the short is halved (emergency deleveraging)
- **Buffer drain** — negative funding payments drain the buffer first before touching the spot balance

### Key metrics

| Metric | Go/No-Go Threshold | Meaning |
|---|---|---|
| Blended APY | > 15% | Annualised combined return from funding + lending |
| Max Drawdown | < 10% | Largest peak-to-trough NAV decline during the period |
| Margin breaches < 1.2 | 0 | Number of emergency deleveraging events |
| Worst 30-day APY | > 0% | The worst rolling month must still be profitable |

### When the strategy works best

- **Sideways or mildly bullish markets** — funding rates are positive, price moves are small, delta stays manageable
- **High funding rate environments** — bull markets with elevated perpetual premiums
- **Avoid** — strong sustained bull runs (SOL +50%+ in a quarter) where short losses outpace funding income

---

## Running on Live Mainnet

### Step 1 — Set up the vault (Admin, once)

```bash
# 1. Edit config/base.ts with your vault parameters
# 2. Initialize the vault
pnpm ts-node src/scripts/admin-init-vault.ts
# Copy the output vault address and LUT address into config/base.ts

# 3. Add the Drift adaptor
pnpm ts-node src/scripts/admin-add-adaptor.ts

# 4. (Optional) Set LP token metadata
pnpm ts-node src/scripts/admin-set-token-metadata.ts
```

### Step 2 — Initialize the Drift strategy (Manager, once)

```bash
# Enable margin trading — required for the short perp position
# Set enableMarginTrading: true in config/drift.ts first
pnpm ts-node src/scripts/manager-init-user.ts
```

### Step 3 — Fund the strategy (Manager)

```bash
# Set depositStrategyAmount in config/drift.ts
pnpm ts-node src/scripts/manager-deposit-user.ts
```

### Step 4 — Open the short perp position (Manager)

```bash
# Set perpMarketIndex and perpOrderSize in config/drift.ts
pnpm ts-node src/scripts/manager-open-short-perp.ts
```

### Step 5 — Ongoing operations (Manager, run periodically)

```bash
# Rebalance delta when price moves (run every few hours or via cron)
pnpm ts-node src/scripts/manager-rebalance-delta.ts

# Compound yield — withdraws free collateral and re-deposits to grow position
pnpm ts-node src/scripts/manager-compound-yield.ts

# Query current positions
pnpm ts-node src/scripts/query-strategy-positions.ts
```

### Step 6 — User deposits and withdrawals

```bash
# Deposit into the vault
pnpm ts-node src/scripts/user-deposit-vault.ts

# Query your position value
pnpm ts-node src/scripts/user-query-position.ts

# Instant withdrawal
pnpm ts-node src/scripts/user-instant-withdraw-vault.ts

# Or: request withdrawal (waits for withdrawalWaitingPeriod)
pnpm ts-node src/scripts/user-request-withdraw-vault.ts
pnpm ts-node src/scripts/user-withdraw-vault.ts
```

### Step 7 — Closing the position (Manager)

```bash
# Close the short perp before withdrawing all funds
pnpm ts-node src/scripts/manager-close-short-perp.ts

# Withdraw funds back to the vault
pnpm ts-node src/scripts/manager-withdraw-user.ts
```

### Harvest fees (Admin)

```bash
pnpm ts-node src/scripts/admin-harvest-fee.ts
```

---

## Backtesting the Strategy

The `backtest/` directory contains a standalone simulation toolkit that replays the strategy against real historical Drift mainnet data — no on-chain interaction required.

### What it simulates

- Tick-by-tick hourly NAV evolution over the requested date range
- Spot yield accrual, funding payments (positive and negative), mark-to-market, delta rebalancing, margin health checks
- All strategy parameters from `config/drift.ts` (or overridden via grid search)

### Quick start

```bash
# Single run with default params — sideways period recommended for first test
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-07-01

# With custom initial capital
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-07-01 --capital 50000

or

pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2023-01-01 --to 2023-11-03 --capital 500000

# Grid search — sweeps 192 parameter combinations to find the optimal config
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-07-01 --grid
```

The report opens automatically in your browser when the run completes.

### CLI options

| Flag | Default | Description |
|---|---|---|
| `--market` | `SOL-PERP` | Market to backtest (`SOL-PERP` or `BTC-PERP`) |
| `--from` | — | Start date `YYYY-MM-DD` |
| `--to` | `2025-01-09` | End date `YYYY-MM-DD` (Drift S3 data ceiling) |
| `--months` | `12` | Lookback in months from `--to` (used when `--from` is not set) |
| `--capital` | `100000` | Initial capital in USD |
| `--grid` | `false` | Run full 192-combination parameter grid search |

### Choosing a good date range

The Drift S3 historical data is available from 2022 through early January 2025.

| Period | SOL behaviour | Expected result |
|---|---|---|
| `2024-04-01` → `2024-07-01` | Sideways $130–$180 | Strategy likely passes — low drawdown |
| `2023-01-01` → `2023-06-01` | Recovery from bear | Moderate funding, low drawdown |
| `2024-10-01` → `2025-01-09` | Strong bull run +80% | High APY but drawdown likely > 10% |

### Cache management

Data is cached in `backtest/data/` keyed by market and date range. Delete to force a refresh:

```bash
rm backtest/data/*.json
```

### Outputs

All results are written to `backtest/results/`:

- `report.html` — interactive charts: NAV vs SOL price, drawdown, daily funding income, grid scatter plot
- `grid-search-results.csv` — one row per parameter combination (grid mode)
- `grid-search-summary.json` — top-5 configs filtered by drawdown < 10% and zero 1.2 breaches (grid mode)

### Understanding the report

- **NAV** (Net Asset Value) — total dollar value of the strategy position at each point in time. Starts at your `--capital` value.
- **Blended APY** — annualised combined return from funding income + lending yield. Target: > 15%.
- **Max Drawdown** — the largest peak-to-trough NAV decline. Target: < 10%. High during strong bull runs because the short loses money faster than funding compensates.
- **Sharpe Ratio** — risk-adjusted return. Higher is better; > 1.0 is considered good.
- **Rebalance events** — how many times the short was resized to restore delta neutrality.
- **Negative funding hours** — hours where the strategy paid funding instead of receiving it.

### Data sources

| Data | Source |
|---|---|
| Funding rates | Drift S3 bucket (`fundingRateRecords/{YYYY}/{YYYYMMDD}`) |
| SOL/USD prices | Binance public API (`SOLUSDT` 1h klines, no auth required) |
| USDC lending rates | Constant 5% APY fallback (Drift S3 lending data unavailable) |

---

## Running on Devnet

Devnet allows you to test the full strategy flow without real funds. The Drift program ID is the same on devnet (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`), but you use devnet USDC and a devnet RPC.

> **Note:** A Voltr devnet program ID is required to run vault operations on devnet. If one is not yet available, you can still test Drift interactions directly using the devnet constants in `config/devnet.ts`.

### Step 1 — Configure for devnet

In `.env`, point your RPC to a devnet endpoint:
```bash
HELIUS_RPC_URL="https://devnet.helius-rpc.com/?api-key=<your-key>"
```

In `config/base.ts`, set the devnet USDC mint:
```typescript
export const assetMintAddress = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
```

In scripts that use Drift, import `driftEnv` from `config/devnet.ts` instead of the default:
```typescript
import { driftEnv } from "../../config/devnet";
```

### Step 2 — Airdrop SOL to your keypairs

```bash
solana airdrop 2 <ADMIN_PUBKEY>   --url devnet
solana airdrop 2 <MANAGER_PUBKEY> --url devnet
solana airdrop 2 <USER_PUBKEY>    --url devnet
```

For devnet USDC, use the Drift devnet faucet or mint via `spl-token`.

### Step 3 — Run the same flow as mainnet

The script sequence is identical to the live mainnet flow. All scripts work on devnet as long as the RPC and mint addresses are set correctly.

```bash
pnpm ts-node src/scripts/admin-init-vault.ts
pnpm ts-node src/scripts/admin-add-adaptor.ts
pnpm ts-node src/scripts/manager-init-user.ts
pnpm ts-node src/scripts/manager-deposit-user.ts
pnpm ts-node src/scripts/manager-open-short-perp.ts
pnpm ts-node src/scripts/manager-rebalance-delta.ts
```

### Devnet constants (`config/devnet.ts`)

```typescript
DRIFT_DEVNET.PROGRAM_ID  // dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH
DRIFT_DEVNET.PERP.SOL.MARKET_INDEX  // 1
DRIFT_DEVNET.SPOT.USDC.MARKET_INDEX // 0
```

---

## Available Scripts Reference

Run any script with:
```bash
pnpm ts-node src/scripts/<script-name>.ts
```

### Admin Scripts

| Script | Description |
|---|---|
| `admin-init-vault.ts` | Initialize a new vault; outputs vault + LUT addresses |
| `admin-init-vault-and-set-token-metadata.ts` | Init vault and set LP token metadata in one flow |
| `admin-set-token-metadata.ts` | Set or update LP token metadata on an existing vault |
| `admin-update-vault-config.ts` | Update a single vault config field (fees, caps, etc.) |
| `admin-accept-vault-admin.ts` | Accept a pending admin transfer |
| `admin-harvest-fee.ts` | Collect accumulated performance fees |
| `admin-add-adaptor.ts` | Add the Drift adaptor to the vault (once per vault) |
| `admin-init-direct-withdraw.ts` | Enable direct user withdrawals from a Drift position |

### Manager Scripts

| Script | Description |
|---|---|
| `manager-init-user.ts` | Initialize Drift user strategy (with margin trading support) |
| `manager-init-earn.ts` | Initialize Drift earn strategy (no margin) |
| `manager-deposit-user.ts` | Deposit vault funds into Drift user strategy |
| `manager-withdraw-user.ts` | Withdraw from Drift user strategy back to vault |
| `manager-deposit-earn.ts` | Deposit vault funds into Drift earn strategy |
| `manager-withdraw-earn.ts` | Withdraw from Drift earn strategy back to vault |
| `manager-open-short-perp.ts` | Open the short perp position |
| `manager-close-short-perp.ts` | Close the short perp position |
| `manager-rebalance-delta.ts` | Rebalance delta if deviation exceeds threshold |
| `manager-compound-yield.ts` | Withdraw free collateral and re-deposit to compound |

### User Scripts

| Script | Description |
|---|---|
| `user-deposit-vault.ts` | Deposit into the vault, receive LP tokens |
| `user-request-withdraw-vault.ts` | Initiate a withdrawal request |
| `user-withdraw-vault.ts` | Complete a withdrawal after the waiting period |
| `user-instant-withdraw-vault.ts` | Immediate single-transaction withdrawal |
| `user-cancel-request-withdraw-vault.ts` | Cancel a pending withdrawal request |
| `user-query-position.ts` | Query LP balance and underlying asset value |
| `query-strategy-positions.ts` | Query vault total value and all strategy allocations |

---

## Project Structure

```
.
├── config/
│   ├── base.ts              # Vault configuration
│   ├── drift.ts             # Drift strategy parameters
│   └── devnet.ts            # Devnet constants and environment
├── src/
│   ├── constants/
│   │   ├── base.ts          # Protocol admin address
│   │   └── drift.ts         # Drift program IDs, market indices, discriminators
│   ├── utils/
│   │   └── helper.ts        # Tx sending, ATA setup, LUT utilities
│   └── scripts/             # One script per operation
├── backtest/
│   ├── types.ts             # Shared interfaces
│   ├── align.ts             # Data alignment + lending interpolation
│   ├── fetch-funding-rates.ts  # Drift S3 daily CSV fetcher
│   ├── fetch-lending-rates.ts  # Lending rate fetcher (with fallback)
│   ├── fetch-prices.ts      # Binance klines fetcher
│   ├── simulator.ts         # Tick-by-tick NAV simulation engine
│   ├── metrics.ts           # APY, Sharpe, drawdown, pass/fail evaluation
│   ├── grid-search.ts       # 192-combination parameter sweep
│   ├── report.ts            # HTML report generator
│   ├── run-backtest.ts      # CLI entry point
│   ├── data/                # Cached JSON data (gitignored)
│   └── results/             # Output files (gitignored)
├── docs/                    # Strategy documentation and analysis
├── .env.example
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

---

## Dependencies

**Runtime:**
- `@coral-xyz/anchor` — Anchor framework for Solana programs
- `@solana/web3.js` — core Solana SDK
- `@solana/spl-token` — SPL Token utilities
- `@voltr/vault-sdk` — Voltr Vault SDK
- `@drift-labs/sdk` — Drift Protocol SDK
- `bs58` — Base58 encoding
- `dotenv` — environment variable loading

**Dev:**
- `typescript`, `ts-node`, `@types/node`, `@types/bn.js`, `vitest`, `fast-check`

---

For questions about the Voltr protocol, refer to the official Voltr documentation.

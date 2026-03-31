# Voltr Vault Client Scripts

A set of TypeScript scripts for interacting with the Voltr Vault protocol on Solana, including base vault operations and Drift spot market strategy integrations via the `@voltr/vault-sdk`.

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Base Config (`config/base.ts`)](#base-config-configbasets)
  - [Drift Config (`config/drift.ts`)](#drift-config-configdriftts)
- [Available Scripts](#available-scripts)
  - [Admin Scripts](#admin-scripts)
  - [Manager Scripts](#manager-scripts)
  - [User Scripts](#user-scripts)
  - [Query Scripts](#query-scripts)
- [Usage Flows](#usage-flows)
  - [Basic Vault Flow](#basic-vault-flow)
  - [Drift Strategy Flow](#drift-strategy-flow)
  - [Delta-Neutral Funding Rate Strategy Flow](#delta-neutral-funding-rate-strategy-flow)
- [Project Structure](#project-structure)
- [Delta-Neutral Backtest Toolkit](#delta-neutral-backtest-toolkit)
- [Dependencies](#dependencies)

---

## Introduction

This repository contains TypeScript scripts for interacting with Voltr Vaults on Solana. It covers core vault operations (init, deposit, withdraw, fee harvesting) as well as Drift protocol spot market strategy management via the Voltr Drift Adaptor.

---

## Prerequisites

1. **Node.js v18+**

2. **pnpm**
   ```bash
   npm install -g pnpm
   ```

3. **Solana Keypair files (JSON format)** for three roles:
   - **Admin** — vault configuration and admin operations
   - **Manager** — strategy management (deposit/withdraw into Drift)
   - **User** — vault deposits and withdrawals

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

Edit this file before running any scripts.

- **`vaultConfig`** — vault parameters used during initialization:
  - `maxCap`: maximum total deposits (in base asset smallest units)
  - `managerPerformanceFee` / `adminPerformanceFee`: fees in basis points (500 = 5%)
  - `managerManagementFee` / `adminManagementFee`: annual management fees in basis points
  - `lockedProfitDegradationDuration`: seconds over which locked profit is linearly released
  - `redemptionFee`: one-time fee on withdrawal (basis points)
  - `issuanceFee`: one-time fee on deposit (basis points)
  - `withdrawalWaitingPeriod`: seconds a user must wait between requesting and completing a withdrawal

- **`vaultParams`** — wraps `vaultConfig` with `name` and `description` strings

- **`lpTokenMetadata`** — optional LP token metadata: `symbol`, `name`, `uri` (used by `admin-init-vault-and-set-token-metadata.ts` and `admin-set-token-metadata.ts`)

- **`assetMintAddress`** — public key of the token deposited into the vault (e.g. USDC mint)

- **`assetTokenProgram`** — token program governing the asset mint (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` for SPL Token, or Token-2022 program ID)

- **`vaultAddress`** — leave empty initially; fill in after running `admin-init-vault.ts`

- **`useLookupTable`** — set `true` to create and use an Address Lookup Table (LUT) for cheaper transactions

- **`lookupTableAddress`** — leave empty initially; fill in after vault init if `useLookupTable` is `true`

- **`depositAmountVault`** / **`withdrawAmountVault`** — amounts in smallest token units (e.g. `1_000_000` = 1 USDC)

- **`isWithdrawAll`** — if `true`, withdraws the user's entire position

- **`isWithdrawInLp`** — if `true`, `withdrawAmountVault` is interpreted as LP token amount; if `false`, as underlying asset amount

- **`vaultConfigUpdateField`** / **`vaultConfigUpdateValue`** — field and value used by `admin-update-vault-config.ts`

### Drift Config (`config/drift.ts`)

- **`depositStrategyAmount`** — amount of the vault's base asset to deposit into the Drift strategy (smallest units)

- **`withdrawStrategyAmount`** — amount to withdraw from the Drift strategy (smallest units)

- **`driftMarketIndex`** — Drift spot market index to interact with. Must correspond to the vault's `assetMintAddress`. Available indices are defined in `src/constants/drift.ts`:
  - USDC: `0`
  - SOL: `1`
  - USDT: `5`
  - PYUSD: `22`
  - USDS: `28`
  - USDC_JLP: `34`

- **`enableMarginTrading`** — boolean passed during `manager-init-user.ts` to enable margin trading on the Drift user account

- **`directWithdrawDiscriminator`** — instruction discriminator bytes used by `admin-init-direct-withdraw.ts`

- **`perpMarketIndex`** — target perpetual market for the delta-neutral strategy. Defaults to `DRIFT.PERP.SOL.MARKET_INDEX` (SOL-PERP, index 1). Change to `DRIFT.PERP.BTC.MARKET_INDEX` (index 2) for BTC-PERP.

- **`shortPerpSizeRatio`** — fraction of vault NAV to deploy as short perp notional (default `0.40`)

- **`bufferRatio`** — fraction of vault NAV to hold as liquid USDC buffer (default `0.10`)

- **`rebalanceThresholdPct`** — delta deviation percentage that triggers a rebalance (default `2`)

- **`minMarginHealthRatio`** — margin health floor below which short increases are blocked and reductions are triggered (default `1.5`)

- **`perpOrderSize`** — base order size in the perp market's base asset units. Default is `1_000_000_000` (1 SOL at 9 decimals). Adjust before running open/rebalance scripts.

> No swaps are performed. The vault's `assetMintAddress` must directly match the asset of the chosen `driftMarketIndex`.

---

## Available Scripts

Run scripts with:
```bash
pnpm ts-node src/scripts/<script-name>.ts
```

### Admin Scripts

- **`admin-init-vault.ts`**
  Initializes a new vault. Generates a vault keypair, sets up the vault with `vaultParams` and `assetMintAddress`, and optionally creates and populates a LUT.
  Outputs the vault address and LUT address — update `config/base.ts` with these values.
  Uses: `ADMIN_FILE_PATH`, `MANAGER_FILE_PATH`

- **`admin-init-vault-and-set-token-metadata.ts`**
  Same as above but also sets LP token metadata (`lpTokenMetadata`) in the same flow.
  Uses: `ADMIN_FILE_PATH`, `MANAGER_FILE_PATH`

- **`admin-set-token-metadata.ts`**
  Sets or updates LP token metadata on an existing vault.
  Requires: `vaultAddress`, `lpTokenMetadata`
  Uses: `ADMIN_FILE_PATH`

- **`admin-update-vault-config.ts`**
  Updates a single vault config field. Supports all `VaultConfigField` variants including fees, caps, waiting periods, and admin/manager public keys. The value is serialized according to the field type.
  Requires: `vaultAddress`, `vaultConfigUpdateField`, `vaultConfigUpdateValue`
  Uses: `ADMIN_FILE_PATH`

- **`admin-accept-vault-admin.ts`**
  Accepts a pending admin transfer for the vault. Run this with the new admin's keypair after a `PendingAdmin` update has been set via `admin-update-vault-config.ts`.
  Requires: `vaultAddress`
  Uses: `ADMIN_FILE_PATH` (as the pending admin)

- **`admin-harvest-fee.ts`**
  Collects accumulated performance fees from the vault and distributes LP tokens to the admin, manager, and protocol admin. Creates recipient LP token accounts if they don't exist.
  Requires: `vaultAddress`
  Uses: `ADMIN_FILE_PATH`, `MANAGER_FILE_PATH`

- **`admin-add-adaptor.ts`**
  Adds the Voltr Drift Adaptor program (`ADAPTOR_PROGRAM_ID`) to the vault's approved adaptors list. Only needs to be run once per vault. Optionally updates the LUT.
  Requires: `vaultAddress`
  Uses: `ADMIN_FILE_PATH`

- **`admin-init-direct-withdraw.ts`**
  Initializes a direct withdraw strategy for the vault, registering a specific Drift spot market vault as a counterparty with a given instruction discriminator. Used for enabling direct user withdrawals from a Drift position.
  Requires: `vaultAddress`, `driftMarketIndex`, `directWithdrawDiscriminator` (from `config/drift.ts`), `lookupTableAddress` (if `useLookupTable`)
  Uses: `ADMIN_FILE_PATH`

### Manager Scripts

- **`manager-init-user.ts`**
  Initializes the Drift "user" strategy for the vault. Creates the strategy PDA (seeded with `"drift_user"`), the Drift user stats and user accounts, and the vault strategy asset ATA. Sets the manager as the delegatee. Only needs to be run once per vault.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `enableMarginTrading`
  Uses: `ADMIN_FILE_PATH` (as payer), `MANAGER_FILE_PATH` (as delegatee)

- **`manager-init-earn.ts`**
  Initializes the Drift "earn" strategy for the vault. Uses the spot market vault PDA as the strategy address (seeded with `"spot_market_vault"`). Creates Drift user stats, user, and spot market accounts. Only needs to be run once per vault.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `driftMarketIndex`
  Uses: `ADMIN_FILE_PATH`

- **`manager-deposit-user.ts`**
  Deposits funds from the vault into the Drift "user" strategy (spot market defined by `driftMarketIndex`). Uses `@drift-labs/sdk` to build remaining accounts.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `depositStrategyAmount`, `driftMarketIndex`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-withdraw-user.ts`**
  Withdraws funds from the Drift "user" strategy back into the vault. Uses `@drift-labs/sdk` to build remaining accounts.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `withdrawStrategyAmount`, `driftMarketIndex`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-deposit-earn.ts`**
  Deposits funds from the vault into the Drift "earn" strategy (spot market vault PDA). Uses `@drift-labs/sdk` to build remaining accounts.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `depositStrategyAmount`, `driftMarketIndex`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-withdraw-earn.ts`**
  Withdraws funds from the Drift "earn" strategy back into the vault. Uses `@drift-labs/sdk` to build remaining accounts.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `withdrawStrategyAmount`, `driftMarketIndex`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-open-short-perp.ts`**
  Opens a short perpetual position on Drift via `placeAndTakePerpOrder`. Uses `perpMarketIndex` and `perpOrderSize` from `config/drift.ts`. Part of the delta-neutral funding rate strategy.
  Requires: `vaultAddress`, `perpMarketIndex`, `perpOrderSize`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-close-short-perp.ts`**
  Closes the current short perp position by submitting a reduce-only LONG order of equal size. Exits cleanly if no position exists.
  Requires: `vaultAddress`, `perpMarketIndex`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-rebalance-delta.ts`**
  Reads current spot and perp positions, computes delta, and adjusts the short if deviation exceeds `rebalanceThresholdPct`. Checks margin health before acting — blocks short increases below `minMarginHealthRatio`, and submits a reduce-only 50% order if health drops below 1.2.
  Requires: `vaultAddress`, `perpMarketIndex`, `rebalanceThresholdPct`, `minMarginHealthRatio`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

- **`manager-compound-yield.ts`**
  Computes withdrawable yield (free collateral above the margin safety floor), withdraws it from Drift, and re-deposits it into the spot market to compound returns. No-ops if no yield is available.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `driftMarketIndex`, `perpMarketIndex`, `minMarginHealthRatio`, `lookupTableAddress` (if `useLookupTable`)
  Uses: `MANAGER_FILE_PATH`

### User Scripts

- **`user-deposit-vault.ts`**
  Deposits `depositAmountVault` of the vault's asset into the vault, receiving LP tokens. Handles wSOL wrapping if `assetMintAddress` is the native SOL mint.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`, `depositAmountVault`
  Uses: `USER_FILE_PATH`

- **`user-request-withdraw-vault.ts`**
  Initiates a withdrawal request. Only one pending request is allowed at a time. Uses `withdrawAmountVault`, `isWithdrawInLp`, `isWithdrawAll`.
  Requires: `vaultAddress`
  Uses: `USER_FILE_PATH`

- **`user-withdraw-vault.ts`**
  Completes a previously requested withdrawal after the `withdrawalWaitingPeriod` has elapsed. Handles wSOL unwrapping if needed.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`
  Uses: `USER_FILE_PATH`

- **`user-instant-withdraw-vault.ts`**
  Performs an immediate single-transaction withdrawal. Uses `withdrawAmountVault`, `isWithdrawInLp`, `isWithdrawAll`. Handles wSOL unwrapping if needed.
  Requires: `vaultAddress`, `assetMintAddress`, `assetTokenProgram`
  Uses: `USER_FILE_PATH`

- **`user-cancel-request-withdraw-vault.ts`**
  Cancels an outstanding withdrawal request. Fails if no pending request exists.
  Requires: `vaultAddress`
  Uses: `USER_FILE_PATH`

### Query Scripts

- **`user-query-position.ts`**
  Fetches the user's LP token balance and calculates the equivalent underlying asset value — both before and after redemption fees and locked profit degradation.
  Requires: `vaultAddress`
  Uses: `USER_FILE_PATH`

- **`query-strategy-positions.ts`**
  Fetches the vault's total asset value and lists all initialized strategy allocations with their strategy address and position value.
  Requires: `vaultAddress`

---

## Usage Flows

### Basic Vault Flow

1. Set environment variables and edit `config/base.ts` with `vaultConfig`, `vaultParams`, `assetMintAddress`, `assetTokenProgram`.

2. Initialize the vault:
   ```bash
   pnpm ts-node src/scripts/admin-init-vault.ts
   ```
   Copy the output `Vault:` and `LUT:` addresses into `config/base.ts`.

3. (Optional) Set LP token metadata:
   ```bash
   pnpm ts-node src/scripts/admin-set-token-metadata.ts
   ```

4. Deposit (User):
   ```bash
   pnpm ts-node src/scripts/user-deposit-vault.ts
   ```

5. Query position:
   ```bash
   pnpm ts-node src/scripts/user-query-position.ts
   ```

6. Withdraw:
   - Instant:
     ```bash
     pnpm ts-node src/scripts/user-instant-withdraw-vault.ts
     ```
   - With waiting period:
     ```bash
     pnpm ts-node src/scripts/user-request-withdraw-vault.ts
     # wait for withdrawalWaitingPeriod to elapse
     pnpm ts-node src/scripts/user-withdraw-vault.ts
     ```

7. Harvest fees (Admin):
   ```bash
   pnpm ts-node src/scripts/admin-harvest-fee.ts
   ```

### Drift Strategy Flow

Assumes the vault is already initialized and `config/base.ts` is fully configured.

1. Configure `config/drift.ts`: set `driftMarketIndex` to match your vault's `assetMintAddress`, and set `depositStrategyAmount` / `withdrawStrategyAmount`.

2. Add the Drift adaptor (Admin, once per vault):
   ```bash
   pnpm ts-node src/scripts/admin-add-adaptor.ts
   ```

3. Initialize the Drift strategy (once per vault). Choose the appropriate strategy type:
   - **User strategy** (supports margin trading):
     ```bash
     pnpm ts-node src/scripts/manager-init-user.ts
     ```
   - **Earn strategy** (spot market vault, no margin):
     ```bash
     pnpm ts-node src/scripts/manager-init-earn.ts
     ```

4. (Optional) Initialize direct withdraw for the strategy:
   ```bash
   pnpm ts-node src/scripts/admin-init-direct-withdraw.ts
   ```

5. Deposit vault funds into the Drift strategy (Manager):
   - User strategy: `pnpm ts-node src/scripts/manager-deposit-user.ts`
   - Earn strategy: `pnpm ts-node src/scripts/manager-deposit-earn.ts`

6. Query strategy positions:
   ```bash
   pnpm ts-node src/scripts/query-strategy-positions.ts
   ```

7. Withdraw from the Drift strategy back to the vault (Manager):
   - User strategy: `pnpm ts-node src/scripts/manager-withdraw-user.ts`
   - Earn strategy: `pnpm ts-node src/scripts/manager-withdraw-earn.ts`

---

### Delta-Neutral Funding Rate Strategy Flow

This strategy deploys USDC in a 50/40/10 split: 50% to Drift spot USDC lending, 40% as margin for a short SOL-PERP (or BTC-PERP) position, and 10% held as a liquid buffer. Yield comes from perpetual funding rate payments and USDC lending interest simultaneously. Target blended APY: 18–40%.

**Prerequisites:** vault initialized, Drift user strategy initialized with `enableMarginTrading: true`, funds deposited into the Drift spot market via `manager-deposit-user.ts`.

**Configure `config/drift.ts`:**
- Set `perpMarketIndex` (default: SOL-PERP index 1)
- Set `perpOrderSize` to the desired order size in base asset units (default: 1 SOL = `1_000_000_000`)
- Tune `shortPerpSizeRatio`, `bufferRatio`, `rebalanceThresholdPct`, `minMarginHealthRatio` as needed

**Open the position:**
```bash
pnpm ts-node src/scripts/manager-open-short-perp.ts
```

**Rebalance delta (run periodically):**
```bash
pnpm ts-node src/scripts/manager-rebalance-delta.ts
```
Adjusts the short size if delta deviation exceeds `rebalanceThresholdPct`. Automatically de-risks if margin health is low.

**Compound yield (run periodically):**
```bash
pnpm ts-node src/scripts/manager-compound-yield.ts
```
Withdraws free collateral above the margin safety floor and re-deposits it to grow the position over time.

**Close the position (before full vault withdrawal):**
```bash
pnpm ts-node src/scripts/manager-close-short-perp.ts
```
Fully closes the short perp position. Then run `manager-withdraw-user.ts` to return funds to the vault.

---

## Project Structure

```
.
├── config/
│   ├── base.ts                              # Base vault configuration
│   └── drift.ts                             # Drift strategy configuration
├── src/
│   ├── constants/
│   │   ├── base.ts                          # Protocol admin address
│   │   └── drift.ts                         # Drift program IDs, market indices, discriminators
│   ├── utils/
│   │   └── helper.ts                        # Tx sending, ATA setup, LUT utilities
│   └── scripts/
│       ├── admin-init-vault.ts
│       ├── admin-init-vault-and-set-token-metadata.ts
│       ├── admin-set-token-metadata.ts
│       ├── admin-update-vault-config.ts
│       ├── admin-accept-vault-admin.ts
│       ├── admin-harvest-fee.ts
│       ├── admin-add-adaptor.ts
│       ├── admin-init-direct-withdraw.ts
│       ├── manager-init-user.ts
│       ├── manager-init-earn.ts
│       ├── manager-deposit-user.ts
│       ├── manager-withdraw-user.ts
│       ├── manager-deposit-earn.ts
│       ├── manager-withdraw-earn.ts
│       ├── manager-open-short-perp.ts
│       ├── manager-close-short-perp.ts
│       ├── manager-rebalance-delta.ts
│       ├── manager-compound-yield.ts
│       ├── user-deposit-vault.ts
│       ├── user-request-withdraw-vault.ts
│       ├── user-withdraw-vault.ts
│       ├── user-instant-withdraw-vault.ts
│       ├── user-cancel-request-withdraw-vault.ts
│       ├── user-query-position.ts
│       └── query-strategy-positions.ts
├── .env.example
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

---

## Delta-Neutral Backtest Toolkit

A standalone TypeScript simulation toolkit in `backtest/` that measures the historical performance of the 50/40/10 delta-neutral funding rate strategy using real Drift Protocol mainnet data. No on-chain interaction occurs — it runs entirely offline.

### What it does

- Fetches and caches historical funding rates from the Drift S3 bucket (daily CSV files)
- Fetches and caches hourly SOL/USD prices from the Binance public API
- Falls back to a constant 5% APY for USDC lending rates (Drift S3 lending data unavailable)
- Runs a tick-by-tick hourly NAV simulation: spot yield accrual, funding payments, mark-to-market, delta rebalancing, margin health checks
- Computes blended APY, Sharpe ratio, max drawdown, rebalance count, margin health breaches
- Evaluates go/no-go pass criteria: APY > 15%, drawdown < 10%, zero margin breaches below 1.2
- Optionally sweeps a 192-combination parameter grid (6 × 4 × 4 × 2) and writes CSV + JSON results
- Generates a self-contained HTML report with interactive charts (NAV vs price, drawdown, funding income, grid scatter)

### Usage

```bash
# Single run — default params from config/drift.ts
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --months 3

# Explicit date range (YYYY-MM-DD)
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-12-01

# Explicit date range (YYYY-MM-DD) and capital
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-12-01 --capital 500000

or

pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2023-01-01 --to 2023-11-03 --capital 500000

# Grid search over all 192 parameter combinations
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2024-04-01 --to 2024-12-01 --grid
```

**CLI options:**

| Flag | Default | Description |
|---|---|---|
| `--market` | `SOL-PERP` | Market to backtest (`SOL-PERP` or `BTC-PERP`) |
| `--months` | `12` | Lookback window in months (used when `--from` is not set) |
| `--from` | — | Start date `YYYY-MM-DD` (overrides `--months`) |
| `--to` | `2025-01-09` | End date `YYYY-MM-DD` (S3 data ceiling) |
| `--grid` | `false` | Run full 192-combination grid search |
| `--capital` | `100000` | Initial capital in USD to simulate with |

**Cache:** All fetched data is cached in `backtest/data/` as JSON files keyed by market and date range. Delete a file to force a refresh:
```bash
rm backtest/data/*.json
```

**Outputs** (written to `backtest/results/`):
- `report.html` — interactive HTML report with charts (open in any browser)
- `grid-search-results.csv` — one row per parameter combination (grid mode only)
- `grid-search-summary.json` — top-5 configurations by APY, filtered by drawdown < 10% and zero 1.2 breaches (grid mode only)

### Data sources

| Data | Source | Notes |
|---|---|---|
| Funding rates | Drift S3 (`fundingRateRecords/{YYYY}/{YYYYMMDD}`) | Available 2022–Jan 2025 |
| SOL/USD prices | Binance public API (`SOLUSDT` 1h klines) | No auth required |
| USDC lending rates | Constant 5% APY fallback | Drift S3 lending data not available |

### Interpreting results

- **Blended APY** is annualised from the simulation window — a 3-month bull run will produce inflated numbers
- **Max drawdown** captures intra-period dips from the short losing money during price pumps
- **The strategy is designed for sideways/mildly bullish markets** — strong bull runs (e.g. Oct–Jan 2025 when SOL +80%) will exceed the 10% drawdown threshold
- For representative results, test a range-bound period (e.g. `--from 2024-04-01 --to 2024-07-01`)

### Backtest structure

```
backtest/
├── types.ts                  # Shared interfaces
├── align.ts                  # Data alignment + lending interpolation
├── fetch-funding-rates.ts    # Drift S3 daily CSV fetcher
├── fetch-lending-rates.ts    # Lending rate fetcher (with fallback)
├── fetch-prices.ts           # Binance klines fetcher
├── simulator.ts              # Tick-by-tick NAV simulation engine
├── metrics.ts                # APY, Sharpe, drawdown, pass/fail evaluation
├── grid-search.ts            # 192-combination parameter sweep
├── report.ts                 # HTML report generator
├── run-backtest.ts           # CLI entry point
├── data/                     # Cached JSON data files (gitignored)
└── results/                  # Output files (gitignored)
```

---

## Dependencies

**Runtime:**
- `@coral-xyz/anchor` — Anchor framework for Solana programs
- `@solana/web3.js` — core Solana SDK
- `@solana/spl-token` — SPL Token utilities
- `@voltr/vault-sdk` — Voltr Vault SDK
- `@drift-labs/sdk` — Drift Protocol SDK (used for remaining accounts in strategy scripts)
- `bs58` — Base58 encoding
- `dotenv` — environment variable loading

**Dev:**
- `typescript`, `ts-node`, `@types/node`, `@types/bn.js`

---

For questions about the Voltr protocol, refer to the official Voltr documentation.

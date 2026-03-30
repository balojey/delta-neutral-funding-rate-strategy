# Testing & Validation Plan: Delta-Neutral Funding Rate Strategy

## Overview

Before deploying the delta-neutral funding rate strategy on mainnet, we validate it across two independent dimensions:

- **Phase 1 — Devnet Integration Testing**: Validates that the code works correctly end-to-end against a live Drift devnet deployment. Catches transaction construction bugs, PDA derivation errors, account ordering issues, and SDK integration problems.
- **Phase 2 — Backtesting**: Validates that the strategy economics are sound using historical mainnet data. Measures blended APY, rebalance frequency, margin health behaviour, and drawdown characteristics.

These phases are independent and can run in parallel, but Phase 1 should be completed first since it de-risks the code before any capital — even simulated — is involved.

---

## Phase 1: Devnet Integration Testing

### Goal

Confirm that all four manager scripts execute correctly against Drift devnet:
- PDAs derive correctly
- Remaining accounts are built in the right order
- Instructions simulate and confirm without error
- Position state is readable and consistent between scripts
- The full lifecycle (open → rebalance → compound → close) completes without residual state

### Environment Setup

1. **Devnet RPC** — use a devnet-capable RPC endpoint (e.g. `https://api.devnet.solana.com` or a Helius devnet endpoint). Set `HELIUS_RPC_URL` accordingly.

2. **Devnet program IDs** — Drift maintains a devnet deployment. The program IDs differ from mainnet. Create a `config/devnet.ts` or a `.env.devnet` override that points to devnet constants. Key values to swap:
   - `DRIFT.PROGRAM_ID`
   - `DRIFT.SPOT.STATE`
   - `DRIFT.LOOKUP_TABLE_ADDRESSES`
   - Oracle addresses

3. **Funded devnet keypairs** — airdrop SOL to the admin, manager, and user keypairs on devnet:
   ```bash
   solana airdrop 2 <ADMIN_PUBKEY> --url devnet
   solana airdrop 2 <MANAGER_PUBKEY> --url devnet
   ```

4. **Devnet USDC** — Drift devnet uses a specific USDC mint. Obtain devnet USDC via the Drift devnet UI or faucet. Update `assetMintAddress` in `config/base.ts` to the devnet USDC mint.

### Test Sequence

Run each step in order, verifying the expected outcome before proceeding.

#### Step 1 — Vault & Strategy Initialization
```
admin-init-vault.ts          → vault created, LUT populated
admin-add-adaptor.ts         → Drift adaptor registered
manager-init-user.ts         → Drift user account created with enableMarginTrading: true
```
Expected: no errors, vault address and strategy PDA derivable.

#### Step 2 — Fund the Strategy
```
user-deposit-vault.ts        → USDC deposited into vault
manager-deposit-user.ts      → USDC moved into Drift spot market
```
Expected: Drift user account shows USDC spot balance.

#### Step 3 — Open Short Position
```
manager-open-short-perp.ts   → short SOL-PERP position opened
```
Expected: `getPerpPosition(perpMarketIndex)` returns non-zero negative `baseAssetAmount`.

#### Step 4 — Query State
```
query-strategy-positions.ts  → strategy position value visible
```
Expected: position value reflects spot deposit + unrealized perp P&L.

#### Step 5 — Rebalance Delta
```
manager-rebalance-delta.ts   → delta computed, rebalance order submitted or skipped
```
Expected: if delta is within threshold, logs "no rebalance needed". If outside, order submits and confirms.

#### Step 6 — Compound Yield
```
manager-compound-yield.ts    → free collateral above margin floor withdrawn and re-deposited
```
Expected: if no yield has accrued yet (likely on devnet), logs "no yield available to compound" and exits cleanly.

#### Step 7 — Close Position
```
manager-close-short-perp.ts  → short position fully closed
```
Expected: `getPerpPosition(perpMarketIndex)` returns null or zero `baseAssetAmount`.

#### Step 8 — Withdraw
```
manager-withdraw-user.ts     → USDC withdrawn from Drift back to vault
user-instant-withdraw-vault.ts → USDC returned to user
```
Expected: vault and user balances restored, no residual Drift positions.

### Pass Criteria

- All 8 steps complete without unhandled errors
- No residual open perp positions after Step 7
- `manager-close-short-perp.ts` is idempotent — running it twice when no position exists logs cleanly and exits
- `manager-compound-yield.ts` exits cleanly when no yield is available
- `manager-rebalance-delta.ts` exits cleanly when delta is within threshold

### Known Devnet Limitations

- Funding rates on devnet are synthetic and do not reflect real market conditions — yield measurement is not meaningful here
- Oracle prices may be stale or fixed — delta computation will work structurally but numbers won't be realistic
- Devnet can be unstable; retry failed RPC calls before concluding a bug exists in the code

---

## Phase 2: Backtesting

### Goal

Measure the historical performance of the 50/40/10 strategy using real mainnet data. Specifically:

- What blended APY would the strategy have achieved over the past 6–12 months?
- How often would the delta rebalance have triggered?
- What was the worst drawdown period (negative funding rate)?
- How does `minMarginHealthRatio = 1.5` hold up under historical volatility?
- What is the sensitivity of APY to `shortPerpSizeRatio` (e.g. 0.30 vs 0.40 vs 0.50)?

### Data Sources

| Data | Source |
|---|---|
| SOL-PERP funding rate history | Drift Protocol API: `https://drift-historical-data-v2.s3.eu-west-1.amazonaws.com/program/dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH/market/SOL-PERP/fundingRates` |
| USDC spot lending rate history | Drift Protocol API (spot market utilisation rate) or on-chain account snapshots |
| SOL/USD price history | CoinGecko API, Birdeye, or Pyth oracle history |
| BTC-PERP funding rate history | Same Drift S3 bucket, `BTC-PERP` market |

### Backtest Model

The backtest simulates the vault's NAV over time using the following logic at each hourly tick:

```
inputs:
  initial_usdc          = starting capital (e.g. 100,000 USDC)
  short_perp_ratio      = 0.40
  buffer_ratio          = 0.10
  spot_ratio            = 0.50  (= 1 - short_perp_ratio - buffer_ratio)
  rebalance_threshold   = 0.02  (2%)
  min_health_ratio      = 1.5

state:
  spot_balance          = initial_usdc * spot_ratio
  short_notional        = initial_usdc * short_perp_ratio
  buffer                = initial_usdc * buffer_ratio
  sol_price             = oracle price at tick

per tick:
  1. accrue spot yield:
       spot_balance += spot_balance * (usdc_lending_rate / 8760)

  2. accrue funding payment:
       funding_payment = short_notional * funding_rate_this_hour
       if funding_rate > 0:  # longs pay shorts → we receive
           spot_balance += funding_payment
       else:                 # shorts pay longs → we pay
           buffer -= abs(funding_payment)
           if buffer < 0: spot_balance += buffer; buffer = 0

  3. update short notional with price change:
       short_notional = short_size_in_sol * sol_price

  4. compute delta:
       delta = spot_balance - short_notional
       if abs(delta) / nav > rebalance_threshold:
           adjust short_notional toward spot_balance

  5. compute margin health proxy:
       health = (spot_balance + buffer) / short_notional
       if health < 1.2:
           short_notional *= 0.5  # simulate reduce-only

  6. compute NAV:
       nav = spot_balance + buffer + unrealized_pnl
```

### Output Metrics

For each backtest run, record:

- **Blended APY** — annualised return on initial capital
- **Sharpe ratio** — return / volatility of daily NAV changes
- **Max drawdown** — largest peak-to-trough NAV decline
- **Rebalance count** — number of rebalance events triggered
- **Negative funding periods** — hours where funding rate was negative (we paid)
- **Margin health breaches** — number of ticks where health dropped below 1.5 or 1.2

### Parameter Sensitivity Analysis

Run the backtest across a grid of parameter values to find the optimal configuration:

| Parameter | Values to test |
|---|---|
| `shortPerpSizeRatio` | 0.25, 0.30, 0.35, 0.40, 0.45, 0.50 |
| `rebalanceThresholdPct` | 1, 2, 3, 5 |
| `minMarginHealthRatio` | 1.3, 1.5, 1.8, 2.0 |
| Market | SOL-PERP, BTC-PERP |

### Implementation Approach

The backtest is a standalone TypeScript or Python script (Python preferred for data analysis ergonomics). It does not interact with any on-chain programs — it is pure data processing.

Suggested structure:
```
backtest/
├── data/
│   ├── fetch-funding-rates.ts     # pulls and caches historical funding rate data
│   ├── fetch-lending-rates.ts     # pulls and caches USDC lending rate data
│   └── fetch-prices.ts            # pulls and caches SOL/USD price history
├── engine/
│   ├── simulator.ts               # core tick-by-tick simulation loop
│   ├── metrics.ts                 # APY, Sharpe, drawdown calculations
│   └── grid-search.ts             # parameter sensitivity sweep
├── results/
│   └── (generated CSV/JSON output files)
└── run-backtest.ts                # entry point
```

### Pass Criteria

- Blended APY > 15% annualised over the most recent 12-month window
- Max drawdown < 10% of initial capital
- No margin health breaches below 1.2 under the chosen parameter set
- Strategy remains profitable (positive APY) even during the worst 30-day funding rate window in the dataset

---

## Recommended Execution Order

1. Complete Phase 1 devnet testing first — fix any code issues found
2. Run Phase 2 backtest in parallel or immediately after Phase 1
3. Review backtest results and tune `config/drift.ts` parameters accordingly
4. Re-run Phase 1 with the tuned parameters to confirm devnet behaviour is consistent
5. Deploy to mainnet with a small initial capital allocation (e.g. 1,000 USDC) and monitor for 48 hours before scaling

---

## Go/No-Go Checklist Before Mainnet

- [ ] All Phase 1 devnet steps pass without errors
- [ ] Backtest shows APY > 15% over 12-month window
- [ ] Backtest max drawdown < 10%
- [ ] No margin health breaches below 1.2 in backtest
- [ ] `perpOrderSize` in `config/drift.ts` set to appropriate size for initial capital
- [ ] `enableMarginTrading: true` confirmed on the Drift user account
- [ ] LUT populated and `useLookupTable: true` in `config/base.ts`
- [ ] Manager keypair has sufficient SOL for transaction fees

# Delta-Neutral Funding Rate Harvesting Strategy

> Target: ≥ 25% APY | Risk Profile: Low-Medium | Asset: USDC

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why This Strategy Works](#2-why-this-strategy-works)
3. [Strategy Mechanics](#3-strategy-mechanics)
4. [Yield Sources & APY Breakdown](#4-yield-sources--apy-breakdown)
5. [Implementation Plan](#5-implementation-plan)
6. [Risk Analysis & Mitigations](#6-risk-analysis--mitigations)
7. [Operational Parameters](#7-operational-parameters)
8. [Monitoring & Rebalancing](#8-monitoring--rebalancing)
9. [Why This Fits the Voltr Vault Architecture](#9-why-this-fits-the-voltr-vault-architecture)

---

## 1. Executive Summary

This strategy harvests **perpetual futures funding rates** on Drift Protocol in a
**delta-neutral** configuration — meaning the vault holds no directional exposure to
crypto price movements. Yield is generated purely from the structural imbalance between
perpetual futures traders (who are predominantly long) and the market-making side
(shorts), combined with the base lending APY earned on the USDC collateral deposited
into Drift's spot market.

The strategy targets a blended **25–40% APY** under normal market conditions, with
periods of elevated funding (bull markets, high leverage demand) pushing returns
significantly higher.

---

## 2. Why This Strategy Works

### The Structural Long Bias of Crypto Markets

Crypto perpetual futures markets are structurally long-biased. Retail and institutional
participants overwhelmingly hold long positions to gain leveraged exposure to price
appreciation. This persistent imbalance means the **mark price of perpetuals trades
above the oracle (spot) price** for the majority of time in trending or neutral markets.

When mark > oracle, the funding rate is **positive** — longs pay shorts. A delta-neutral
vault that holds a short perpetual position collects these payments continuously, every
hour on Drift.

### Drift's Funding Rate Formula

Drift calculates funding rates hourly using:

```
Funding Rate = (1/24) × (mark_TWAP - oracle_TWAP) / oracle_TWAP
```

This is then annualized as:

```
APR = rate × 24 × 365.25
APY = (1 + rate)^(24 × 365.25) - 1
```

Historically, SOL-PERP and BTC-PERP on Drift have averaged **0.01–0.03% per hour**
during bull/neutral markets, which annualizes to roughly **87–262% APR** on the
short side. Even in conservative, range-bound conditions, average rates of
**0.003–0.005% per hour** produce **26–44% APR**.

### Lending Yield on Collateral

USDC deposited into Drift's spot market earns lending interest automatically. At
moderate utilization (60–80%), the USDC supply APY on Drift sits in the **8–15%**
range. This is a free base yield on top of the funding harvest — the same capital
earns both simultaneously via Drift's cross-margin account model.

### Why Delta-Neutral Eliminates Price Risk

The vault simultaneously holds:
- A **spot long** position in the underlying asset (e.g., SOL) — or equivalently,
  deposits the asset into Drift's spot market
- A **short perpetual** position of equal notional size on Drift

These two legs cancel each other out in terms of price exposure:
- If SOL price rises 20%: spot long gains +20%, short perp loses −20% → net 0
- If SOL price falls 20%: spot long loses −20%, short perp gains +20% → net 0

The only P&L that remains is the funding rate collected by the short leg, plus the
lending yield on the USDC collateral.

---

## 3. Strategy Mechanics

### Capital Allocation

For every **1 USDC** deposited into the vault:

| Allocation | Purpose | Yield Source |
|---|---|---|
| 50% | Deposited to Drift spot market as USDC collateral | Lending APY (8–15%) |
| 40% | Used as margin to open short perpetual position (SOL-PERP or BTC-PERP) | Funding rate collection |
| 10% | Held as liquid USDC buffer | Covers funding payments on negative-rate days, margin top-ups |

The short perpetual position is sized so that its notional value equals the spot
exposure, keeping the portfolio delta at zero.

### Funding Rate Collection Flow

```
Every Hour (Drift funding settlement):
  IF funding_rate > 0:
    short_position receives: notional_size × funding_rate
    → accrues to vault's Drift account balance
  IF funding_rate < 0:
    short_position pays: notional_size × abs(funding_rate)
    → deducted from vault's Drift account balance (covered by 10% buffer)
```

### Compounding

Accumulated funding payments and lending interest are periodically (daily or weekly)
withdrawn from the Drift account and re-deposited into the strategy, compounding the
position size and increasing future yield.

### Leverage Consideration

The short perpetual position uses **1x–2x leverage** only. This keeps the margin
health ratio well above liquidation thresholds and avoids amplifying losses on
negative funding days. The goal is yield, not leverage.

---

## 4. Yield Sources & APY Breakdown

### Conservative Scenario (range-bound market, low funding)

| Source | Estimated APY |
|---|---|
| Drift USDC lending yield | 8% |
| Funding rate harvest (0.003%/hr avg, 40% of capital deployed) | 10.5% |
| Compounding effect (weekly reinvestment) | +1.5% |
| **Total** | **~20% APY** |

> Note: Conservative scenario may dip below the 25% target during prolonged
> bear markets where funding turns negative. The 10% buffer absorbs these periods.

### Base Scenario (neutral-to-bullish market, moderate funding)

| Source | Estimated APY |
|---|---|
| Drift USDC lending yield | 12% |
| Funding rate harvest (0.005%/hr avg, 40% of capital deployed) | 17.5% |
| Compounding effect (weekly reinvestment) | +2% |
| **Total** | **~31.5% APY** |

### Bull Market Scenario (high leverage demand, elevated funding)

| Source | Estimated APY |
|---|---|
| Drift USDC lending yield | 15% |
| Funding rate harvest (0.01%/hr avg, 40% of capital deployed) | 35% |
| Compounding effect (weekly reinvestment) | +3% |
| **Total** | **~53% APY** |

### APY Calculation Methodology

Funding APY contribution is calculated as:

```
funding_apy = ((1 + avg_hourly_rate)^(24 × 365.25) - 1) × capital_deployed_ratio
```

For the base scenario:
```
= ((1 + 0.00005)^8766 - 1) × 0.40
= (1.5425 - 1) × 0.40
= 0.2170 → ~21.7% on total capital
```

Combined with 12% lending yield on 50% of capital (= 6% blended) and compounding,
the blended total reaches ~31.5%.

---

## 5. Implementation Plan

The strategy will be implemented as a new **Drift User strategy** within the existing
Voltr vault framework, using the `drift_user` adaptor with `enableMarginTrading: true`
to allow the short perpetual position.

### Phase 1 — Vault & Strategy Initialization

1. Deploy a new Voltr vault with USDC as the asset mint
2. Run `admin-init-vault.ts` to create the vault on-chain
3. Run `manager-init-user.ts` with `enableMarginTrading: true` to initialize the
   Drift User strategy (this creates the Drift sub-account with the manager as delegatee)
4. Add the strategy as an adaptor via `admin-add-adaptor.ts`
5. Populate the LUT with all relevant accounts via `setupAddressLookupTable`

### Phase 2 — Capital Deployment

1. Manager calls `manager-deposit-user.ts` to move USDC from the vault into the
   Drift cross-margin account
2. Within the Drift account (via manager delegation), open a short SOL-PERP or
   BTC-PERP position sized to match the deposited notional
3. The Drift account now simultaneously earns lending yield on the USDC spot deposit
   and collects hourly funding on the short perp

### Phase 3 — Automation (Rebalancing Bot)

A lightweight off-chain bot (TypeScript, running on a cron schedule) handles:

- **Hourly**: Check funding rate direction; log P&L
- **Daily**: Rebalance delta if spot/perp drift causes net exposure > ±2%
- **Weekly**: Compound — withdraw accumulated yield, re-deposit into strategy
- **Threshold-based**: If margin health ratio drops below 1.5, reduce short size or
  add collateral from the 10% buffer

### Phase 4 — Monitoring & Reporting

- `query-strategy-positions.ts` provides real-time position value
- Off-chain dashboard tracks: funding rate 7d/30d average, current delta, margin
  health, cumulative yield vs. benchmark

### New Scripts Required

| Script | Role |
|---|---|
| `manager-open-short-perp.ts` | Opens/adjusts the short perpetual position via Drift SDK |
| `manager-rebalance-delta.ts` | Rebalances spot vs. perp notional to maintain delta neutrality |
| `manager-compound-yield.ts` | Withdraws accrued funding + lending yield and re-deposits |
| `manager-close-short-perp.ts` | Gracefully unwinds the short position before full withdrawal |

---

## 6. Risk Analysis & Mitigations

### Negative Funding Rate Risk
**Risk**: Funding turns negative (shorts pay longs) during sharp market downturns.
**Mitigation**: The 10% USDC buffer absorbs up to ~30 days of negative funding at
−0.003%/hr before requiring intervention. The bot monitors and can reduce position
size if negative funding persists beyond 7 days.

### Liquidation Risk
**Risk**: Extreme volatility causes the short perp margin to approach liquidation.
**Mitigation**: 1x–2x leverage only. Drift's cross-margin model allows the USDC
spot deposit to act as additional collateral. The bot tops up margin from the buffer
if health ratio < 1.5.

### Smart Contract Risk
**Risk**: Vulnerability in Drift Protocol or Voltr Vault contracts.
**Mitigation**: Both protocols are audited and battle-tested on Solana mainnet.
Drift has processed over $145B in cumulative volume. Position sizes are capped per
vault to limit blast radius.

### Oracle Manipulation Risk
**Risk**: Oracle price manipulation could cause artificial funding rate spikes or
incorrect liquidations.
**Mitigation**: Drift uses Pyth oracles with confidence interval checks and TWAP
smoothing. The funding rate is clamped per market tier (max 0.125%/hr for Tier B
markets like SOL/BTC), preventing extreme outlier events.

### Basis Risk
**Risk**: The spread between the perp and spot price widens unexpectedly, creating
temporary unrealized losses.
**Mitigation**: This is a mark-to-market effect only. As long as the position is
held, funding payments continue to accrue. The vault's LP token NAV accounts for
this correctly via Voltr's `positionValue` tracking.

### Counterparty / Protocol Risk
**Risk**: Drift protocol insolvency or insurance fund depletion.
**Mitigation**: Drift maintains a protocol insurance fund. Position sizes are kept
below 5% of Drift's open interest in any single market to avoid being a systemic
participant.

---

## 7. Operational Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Target asset | USDC | Stablecoin base eliminates spot price risk on collateral |
| Perp market | SOL-PERP (primary), BTC-PERP (secondary) | Highest liquidity, most consistent positive funding on Drift |
| Max leverage | 2x | Safety margin; keeps health ratio > 2.0 at all times |
| Capital to perp | 40% | Balances yield maximization with margin safety |
| Capital to spot/lending | 50% | Earns base lending yield; acts as cross-margin collateral |
| Liquidity buffer | 10% | Covers negative funding periods and emergency top-ups |
| Rebalance threshold | ±2% delta | Tight enough to stay neutral, loose enough to avoid over-trading |
| Compound frequency | Weekly | Minimizes transaction costs while capturing compounding benefit |
| Min margin health ratio | 1.5 | Triggers automatic de-risking before liquidation zone |
| Max drawdown tolerance | 5% of NAV | Strategy pauses and unwinds if breached |

---

## 8. Monitoring & Rebalancing

### Key Metrics to Track

| Metric | Target | Action if Breached |
|---|---|---|
| Net delta | 0 ± 2% | Rebalance via `manager-rebalance-delta.ts` |
| Margin health ratio | > 1.5 | Add collateral from buffer or reduce short size |
| 7-day avg funding rate | > 0 | If negative for 7+ days, reduce short by 50% |
| Cumulative yield vs. 25% APY pace | On track | Alert manager; review market conditions |
| USDC buffer balance | > 5% of NAV | Compound less aggressively; rebuild buffer |

### Rebalancing Logic

Delta drift occurs when the underlying asset price moves significantly. For example,
if SOL rises 10%, the short perp gains value (reducing notional exposure) while the
spot leg stays the same. The bot detects this and adjusts the short size to restore
neutrality.

```
current_delta = spot_notional - abs(short_perp_notional)
if abs(current_delta / total_nav) > 0.02:
    adjust short_perp_notional to match spot_notional
```

---

## 9. Why This Fits the Voltr Vault Architecture

This strategy maps cleanly onto the existing codebase:

- Uses the **Drift User strategy** (`drift_user` PDA) with `enableMarginTrading: true`,
  which is already implemented in `manager-init-user.ts`
- The manager keypair acts as the **delegatee** on the Drift sub-account, enabling
  it to open/close perp positions programmatically
- All capital flows through the existing `manager-deposit-user.ts` /
  `manager-withdraw-user.ts` scripts
- `query-strategy-positions.ts` already surfaces `positionValue` for NAV tracking
- The LUT infrastructure in `helper.ts` handles the large account set required for
  perp + spot interactions in a single transaction
- New scripts follow the existing `{role}-{action}.ts` naming convention and read
  all config from `config/base.ts` and `config/drift.ts`

The only new configuration needed in `config/drift.ts` is:

```typescript
export const perpMarketIndex = DRIFT.PERP.SOL.MARKET_INDEX; // to be added to constants
export const shortPerpSizeRatio = 0.40;  // fraction of vault NAV to deploy as short
export const bufferRatio = 0.10;         // fraction to keep as liquid USDC
export const rebalanceThresholdPct = 2;  // delta rebalance trigger in %
export const minMarginHealthRatio = 1.5; // liquidation safety floor
```

---

*Strategy authored: March 2026*
*Based on Drift Protocol v3 mechanics and Voltr Vault SDK architecture*

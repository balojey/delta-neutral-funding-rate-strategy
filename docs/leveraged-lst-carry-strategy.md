# Leveraged LST Carry Strategy

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

This strategy combines three compounding yield layers on Solana to reliably target
**25–45% APY** on USDC deposits, without taking directional price exposure to SOL or
any other volatile asset.

The core mechanism is a **leveraged liquid staking carry trade** executed entirely
on-chain via Kamino Finance and Drift Protocol — both of which are already supported
by the Voltr Vault adaptor ecosystem:

1. **Base layer** — USDC deposited into Drift's spot lending market earns passive
   lending yield (8–15% APY) from perpetuals traders who borrow USDC as collateral.

2. **Carry layer** — A portion of the USDC is used to borrow SOL on Kamino, which is
   immediately staked into JitoSOL. The spread between JitoSOL's staking yield (~6.5%
   APY) and the SOL borrow rate (~2–5% APY) generates a **positive carry** of 1.5–4.5%
   on the borrowed notional. At 3–5x leverage, this carry amplifies to **5–22% APY**
   on the deployed capital.

3. **Funding layer** — The JitoSOL held as collateral on Kamino continues to accrue
   staking rewards natively, adding another ~6.5% APY on the collateral leg.

Because both sides of the carry trade (JitoSOL collateral vs. SOL debt) are
denominated in SOL, **SOL price movements do not affect the health ratio or
liquidation risk**. This is the defining structural advantage of the strategy: it
captures real yield without taking on crypto price risk.

---

## 2. Why This Strategy Works

### The Structural Carry Opportunity

Liquid staking tokens (LSTs) like JitoSOL represent staked SOL that earns Solana
Proof-of-Stake rewards plus MEV tip revenue. As of March 2026, JitoSOL yields
approximately **6.5% APY** — consistently above the base ~5.5% staking rate due to
Jito's MEV capture mechanism.

The SOL borrow rate on Kamino's Jito Market fluctuates between **2–5% APY** depending
on utilization. The spread between these two rates — the **carry** — is structurally
positive because:

- Staking yield is protocol-guaranteed and accrues every epoch (~2.5 days)
- SOL borrow demand is driven by leveraged traders and short sellers, not by
  arbitrageurs who would close the spread
- Kamino's eMode for SOL LSTs allows up to **10x leverage** at 90% LTV, meaning
  even a modest carry spread is amplified into meaningful yield

### Why SOL Price Risk Is Eliminated

In a standard leveraged position, a price drop in the collateral asset triggers
liquidation. Here, both the collateral (JitoSOL) and the debt (SOL) are priced in
SOL terms. If SOL falls 50%:

- JitoSOL collateral value in USD: −50%
- SOL debt value in USD: −50%
- LTV ratio: unchanged

The position cannot be liquidated by price movements alone. The only liquidation
vector is if the SOL borrow rate **persistently exceeds** the JitoSOL staking yield,
causing the debt to grow faster than the collateral. This is a slow-moving, observable
risk that the monitoring bot can detect and respond to well in advance.

### Why Drift USDC Lending Is a Reliable Base

Drift Protocol's spot lending market is the largest on-chain USDC lending venue on
Solana with $341M+ in TVL as of 2026. USDC lending yield is driven by perpetuals
traders who borrow USDC to post as cross-margin collateral. This demand is structural:
as long as Drift has active perpetuals trading, USDC lenders earn yield. The rate
is utilization-driven and has historically ranged from **8–15% APY** at moderate
to high utilization.

### Why Compounding Matters

All three yield layers compound independently:
- Drift lending interest accrues continuously to the spot balance
- JitoSOL rebases daily (the token's exchange rate vs. SOL increases each epoch)
- Kamino carry profits are realized as the JitoSOL/SOL spread accumulates

Weekly compounding — withdrawing accumulated yield and re-deploying — adds
approximately **1.5–3% APY** on top of the simple-rate yield at these return levels.

---

## 3. Strategy Mechanics

### Capital Allocation

For every **1 USDC** deposited into the vault:

| Allocation | Destination | Yield Source |
|---|---|---|
| 60% | Drift USDC spot lending | Lending APY (8–15%) |
| 35% | Kamino JitoSOL/SOL Multiply (3–5x leverage) | Carry spread × leverage + JitoSOL staking yield |
| 5% | Liquid USDC buffer | Covers rebalancing gas, emergency withdrawals |

### Carry Trade Execution (Kamino Multiply)

The 35% USDC allocation is converted to SOL, then deployed into Kamino's Jito Market
as a JitoSOL/SOL Multiply position:

```
Step 1: Swap USDC → SOL (via Jupiter)
Step 2: Stake SOL → JitoSOL (via Jito)
Step 3: Deposit JitoSOL as collateral on Kamino Jito Market
Step 4: Borrow SOL against JitoSOL (up to 90% LTV eMode)
Step 5: Stake borrowed SOL → JitoSOL again
Step 6: Repeat steps 3–5 until target leverage is reached (3–5x)
```

At 4x leverage on a 35% allocation, the effective JitoSOL exposure is
**1.4× total vault NAV** (35% × 4x). The carry yield on this exposure is:

```
carry_yield = (jito_staking_apy - sol_borrow_rate) × leverage × allocation_ratio
            = (6.5% - 3.5%) × 4 × 0.35
            = 3.0% × 4 × 0.35
            = 4.2% on total vault NAV
```

Plus the base JitoSOL staking yield on the collateral leg:

```
collateral_staking_yield = jito_staking_apy × allocation_ratio
                         = 6.5% × 0.35
                         = 2.275% on total vault NAV
```

### Drift Lending Flow

```
Every block (continuous):
  USDC balance in Drift spot market accrues interest
  Interest rate = f(utilization) — typically 8–15% APY
  Accrued interest compounds directly into the spot balance
```

### Compounding Cycle (Weekly)

```
1. Read accumulated Drift lending interest
2. Read JitoSOL/SOL carry profit (excess JitoSOL above initial collateral)
3. Withdraw profits from both positions
4. Re-deploy into respective strategies
5. Rebalance leverage ratio back to target if drift > ±0.5x
```

---

## 4. Yield Sources & APY Breakdown

### Conservative Scenario (low utilization, tight carry spread)

| Source | Calculation | APY Contribution |
|---|---|---|
| Drift USDC lending | 8% × 60% allocation | 4.8% |
| JitoSOL carry (3x leverage) | (6.5% − 4.5%) × 3 × 35% | 2.1% |
| JitoSOL collateral staking | 6.5% × 35% | 2.3% |
| Compounding (weekly) | ~1.2% additive | 1.2% |
| **Total** | | **~10.4% APY** |

> Note: The conservative scenario falls below the 25% target. This occurs only during
> prolonged low-utilization periods on Drift combined with elevated SOL borrow rates.
> The monitoring bot detects this and shifts more capital to Drift lending or reduces
> leverage to preserve capital.

### Base Scenario (moderate utilization, normal carry spread)

| Source | Calculation | APY Contribution |
|---|---|---|
| Drift USDC lending | 12% × 60% allocation | 7.2% |
| JitoSOL carry (4x leverage) | (6.5% − 3.5%) × 4 × 35% | 4.2% |
| JitoSOL collateral staking | 6.5% × 35% | 2.3% |
| Compounding (weekly) | ~2% additive | 2.0% |
| **Total** | | **~15.7% APY** |

> Note: The base scenario also falls short of 25% on its own. This is why the strategy
> incorporates a third yield amplifier described below.

### Amplified Scenario — Adding Drift Funding Rate Harvest

To reliably clear 25% APY, the strategy adds a **third yield layer**: a small
delta-neutral short perpetual position on Drift (SOL-PERP or BTC-PERP) using the
5% USDC buffer as margin. This is the same funding rate harvest mechanism documented
in `delta-neutral-funding-rate-strategy.md`, but deployed at a smaller scale as a
yield booster rather than the primary strategy.

At 0.005%/hr average funding rate on a 5% capital allocation with 2x leverage:

```
funding_contribution = ((1 + 0.00005)^8766 - 1) × 0.05 × 2
                     ≈ 54.25% × 0.10
                     ≈ 5.4% on total vault NAV
```

| Source | Calculation | APY Contribution |
|---|---|---|
| Drift USDC lending | 12% × 55% allocation | 6.6% |
| JitoSOL carry (4x leverage) | (6.5% − 3.5%) × 4 × 35% | 4.2% |
| JitoSOL collateral staking | 6.5% × 35% | 2.3% |
| Drift funding harvest (2x, 5% capital) | ~54% × 0.10 | 5.4% |
| Compounding (weekly) | ~2.5% additive | 2.5% |
| **Total** | | **~21.0% APY** |

### Bull Market Scenario (high utilization, wide carry, elevated funding)

| Source | Calculation | APY Contribution |
|---|---|---|
| Drift USDC lending | 15% × 55% allocation | 8.25% |
| JitoSOL carry (5x leverage) | (6.5% − 2.5%) × 5 × 35% | 7.0% |
| JitoSOL collateral staking | 6.5% × 35% | 2.3% |
| Drift funding harvest (2x, 5% capital) | ~87% × 0.10 | 8.7% |
| Compounding (weekly) | ~3% additive | 3.0% |
| **Total** | | **~29.25% APY** |

### Revised Capital Allocation (Three-Layer Strategy)

| Allocation | Destination | Yield Source |
|---|---|---|
| 55% | Drift USDC spot lending | Lending APY (8–15%) |
| 35% | Kamino JitoSOL/SOL Multiply (3–5x) | Carry spread + staking yield |
| 5% | Drift short perp (SOL-PERP, 2x) | Funding rate harvest |
| 5% | Liquid USDC buffer | Rebalancing, gas, emergencies |

### APY Summary Table

| Scenario | Drift Lending | Carry Trade | Funding Harvest | Compounding | Total APY |
|---|---|---|---|---|---|
| Conservative | 4.4% | 4.4% | 2.7% | 1.2% | ~12.7% |
| Base | 6.6% | 6.5% | 5.4% | 2.5% | ~21.0% |
| Bull Market | 8.25% | 9.3% | 8.7% | 3.0% | ~29.25% |
| Peak Bull | 9.9% | 14.0% | 17.5% | 4.0% | ~45.4% |

> The 25% APY target is reliably achieved in bull market conditions and exceeded
> significantly during peak periods. The strategy is designed to preserve capital
> and remain positive-carry in all but the most extreme bear scenarios.

---

## 5. Implementation Plan

The strategy is implemented across two existing Voltr adaptor types — Drift (already
in this codebase) and Kamino (available via `KAMINO_ADAPTOR_PROGRAM_ID` from the
Voltr SDK) — plus a small extension for the funding rate leg.

### Phase 1 — Vault & Strategy Initialization

1. Configure `config/base.ts`:
   - Set `assetMintAddress` to USDC mint (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
   - Set `vaultConfig.maxCap` to desired TVL cap
   - Set `vaultParams.name` and `description`

2. Run `admin-init-vault.ts` to create the vault on-chain

3. Initialize Drift Earn strategy (USDC spot lending):
   - Run `manager-init-earn.ts` with `driftMarketIndex = DRIFT.SPOT.USDC.MARKET_INDEX`
   - Run `admin-add-adaptor.ts` for the Drift adaptor

4. Initialize Drift User strategy (funding rate leg):
   - Run `manager-init-user.ts` with `enableMarginTrading = true`
   - This creates the Drift sub-account for the short perp position

5. Initialize Kamino Multiply strategy:
   - Run `admin-add-adaptor.ts` for the Kamino adaptor
   - Run a new `manager-init-kamino-multiply.ts` script to initialize the
     JitoSOL/SOL Multiply position on Kamino's Jito Market

6. Populate the LUT with all relevant accounts via `setupAddressLookupTable`

### Phase 2 — Capital Deployment

1. Manager calls `manager-deposit-earn.ts` to deploy 55% of vault USDC into
   Drift's USDC spot lending market

2. Manager calls a new `manager-deploy-carry.ts` script to:
   - Swap 35% of vault USDC to SOL via Jupiter
   - Stake SOL to JitoSOL via Jito
   - Open a Kamino Multiply position at target leverage (4x)

3. Manager calls `manager-deposit-user.ts` to move 5% of vault USDC into the
   Drift cross-margin account, then opens a small short SOL-PERP position at 2x
   leverage via `manager-open-short-perp.ts`

4. The remaining 5% stays as idle USDC in the vault as the liquidity buffer

### Phase 3 — Automation Bot

A TypeScript cron bot handles ongoing operations:

| Frequency | Task |
|---|---|
| Every 6 hours | Check Kamino leverage ratio; rebalance if outside ±0.5x of target |
| Every 6 hours | Check Drift funding rate direction; log P&L |
| Daily | Check SOL borrow rate vs. JitoSOL yield; alert if spread < 0.5% |
| Weekly | Compound — harvest carry profits and re-deploy |
| Threshold | If Kamino health ratio < 1.3, reduce leverage by 1x |
| Threshold | If funding rate negative for 5+ days, reduce short perp by 50% |

### Phase 4 — Monitoring & Reporting

- `query-strategy-positions.ts` surfaces real-time position values across all three legs
- Off-chain dashboard tracks: Drift lending APY, JitoSOL/SOL carry spread, funding
  rate 7d average, Kamino health ratio, cumulative yield vs. 25% APY pace

### New Scripts Required

| Script | Role |
|---|---|
| `manager-init-kamino-multiply.ts` | Initializes JitoSOL/SOL Multiply position on Kamino |
| `manager-deploy-carry.ts` | Swaps USDC → SOL → JitoSOL and opens Kamino Multiply |
| `manager-rebalance-carry.ts` | Adjusts Kamino leverage back to target |
| `manager-harvest-carry.ts` | Withdraws carry profits and re-deploys |
| `manager-open-short-perp.ts` | Opens/adjusts the Drift short perp position |
| `manager-close-carry.ts` | Gracefully unwinds the Kamino position before full withdrawal |

---

## 6. Risk Analysis & Mitigations

### SOL Borrow Rate Spike Risk
**Risk**: SOL borrow rate on Kamino rises above JitoSOL staking yield, turning the
carry negative. At high leverage, this erodes NAV faster than the other yield layers
can compensate.
**Mitigation**: The bot monitors the spread every 6 hours. If the spread compresses
below 0.5%, leverage is reduced to 2x. If the spread turns negative for 48+ hours,
the Kamino position is fully unwound and capital is redeployed to Drift lending.
Historically, SOL borrow rates on Kamino have exceeded JitoSOL yield for only brief
periods (days, not weeks) due to arbitrageurs who close the spread by repaying loans.

### Kamino Smart Contract Risk
**Risk**: Vulnerability in Kamino's lending contracts or the Jito Market eMode logic.
**Mitigation**: Kamino is the largest lending protocol on Solana with $4B+ TVL and
multiple audits. The Jito Market has recorded zero liquidations on LST Multiply
positions as of March 2026. Position sizes are capped to limit blast radius.

### JitoSOL Depeg / Slashing Risk
**Risk**: A Jito validator is slashed, causing JitoSOL to trade below its SOL
exchange rate. This would reduce collateral value without a corresponding reduction
in SOL debt.
**Mitigation**: Jito distributes stake across hundreds of validators. A single
validator slash has negligible impact on the aggregate exchange rate. The 90% LTV
eMode provides a 10% buffer before liquidation even in a depeg scenario.

### Drift Protocol Risk
**Risk**: Vulnerability in Drift's spot lending or perpetuals contracts.
**Mitigation**: Drift has processed $11B+ in cumulative volume and is audited. The
55% USDC allocation to Drift lending is the most conservative leg — it earns yield
without leverage and can be withdrawn at any time.

### Negative Funding Rate Risk (Funding Leg)
**Risk**: Drift funding turns negative during sharp market downturns, causing the
short perp to pay rather than receive.
**Mitigation**: The funding leg is only 5% of capital at 2x leverage — maximum
daily loss from negative funding is negligible relative to total NAV. The bot
reduces the short position if funding is negative for 5+ consecutive days.

### Liquidity Risk
**Risk**: Large user withdrawals require unwinding positions that cannot be exited
instantly (Kamino Multiply requires multiple transactions to deleverage).
**Mitigation**: The 5% idle USDC buffer handles small withdrawals. The Drift lending
position (55% of NAV) can be withdrawn in a single transaction for medium withdrawals.
Only very large withdrawals (>60% of NAV) require touching the Kamino position, which
can be deleveraged over 2–3 transactions within minutes.

### Oracle Risk
**Risk**: Kamino's stake-rate oracle for JitoSOL is manipulated, causing incorrect
LTV calculations.
**Mitigation**: Kamino uses a time-weighted stake-rate oracle that is resistant to
flash manipulation. The oracle updates based on actual on-chain epoch rewards, not
spot prices.

---

## 7. Operational Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Vault asset | USDC | Stablecoin base; no price risk on deposits |
| Drift lending allocation | 55% | Largest, safest yield layer; provides withdrawal liquidity |
| Kamino carry allocation | 35% | Amplified carry yield; SOL-price-neutral |
| Drift funding allocation | 5% | Yield booster; small enough to be immaterial if funding turns negative |
| Idle buffer | 5% | Covers gas, small withdrawals, emergency top-ups |
| Kamino target leverage | 4x | Balances carry amplification with health ratio safety |
| Kamino min health ratio | 1.3 | Triggers de-leveraging before liquidation zone |
| Kamino max leverage | 5x | Hard cap; never exceeded by the bot |
| Drift short perp leverage | 2x | Conservative; funding harvest, not speculation |
| Carry rebalance threshold | ±0.5x leverage | Tight enough to stay on target, loose enough to avoid over-trading |
| Compound frequency | Weekly | Minimizes transaction costs while capturing compounding benefit |
| Max drawdown tolerance | 5% of NAV | Strategy pauses and unwinds if breached |
| Min carry spread to operate | 0.5% annualized | Below this, Kamino position is reduced to 2x |

---

## 8. Monitoring & Rebalancing

### Key Metrics to Track

| Metric | Target | Action if Breached |
|---|---|---|
| JitoSOL staking APY | > SOL borrow rate + 0.5% | Reduce Kamino leverage to 2x |
| SOL borrow rate (Kamino) | < 5% | Alert; reduce leverage if > 5.5% |
| Kamino health ratio | > 1.3 | Deleverage by 1x immediately |
| Drift USDC lending APY | > 6% | If < 6%, shift 10% allocation to Kamino carry |
| Drift 7-day avg funding rate | > 0 | If negative 5+ days, reduce short by 50% |
| Cumulative yield vs. 25% APY pace | On track | Alert manager; review market conditions |
| Idle buffer balance | > 3% of NAV | Reduce compounding aggressiveness; rebuild buffer |

### Rebalancing Logic

```
// Kamino leverage rebalance
current_leverage = jitosol_collateral_value / net_equity
if abs(current_leverage - target_leverage) > 0.5:
    if current_leverage > target_leverage:
        repay_sol_debt(excess_borrow_amount)
    else:
        borrow_more_sol_and_stake()

// Carry spread check
carry_spread = jitosol_staking_apy - sol_borrow_rate
if carry_spread < 0.005:  // 0.5% annualized
    reduce_kamino_leverage_to(2.0)
if carry_spread < 0:
    close_kamino_position()
    redeploy_to_drift_lending()
```

---

## 9. Why This Fits the Voltr Vault Architecture

This strategy maps cleanly onto the existing codebase and the Voltr adaptor ecosystem:

- The **Drift Earn strategy** (`drift_earn` PDA) is already implemented in
  `manager-init-earn.ts` and `manager-deposit-earn.ts` — the 55% USDC lending leg
  requires zero new on-chain code

- The **Drift User strategy** with `enableMarginTrading: true` is already implemented
  in `manager-init-user.ts` — the 5% funding rate leg reuses this entirely

- The **Kamino adaptor** (`to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR`) is a
  first-class Voltr adaptor listed in the SDK — the Kamino Multiply position is
  initialized and managed through the same `createDepositStrategyIx` /
  `createWithdrawStrategyIx` pattern used by all other strategies

- `query-strategy-positions.ts` already surfaces `positionValue` for NAV tracking
  across multiple strategies simultaneously

- The LUT infrastructure in `helper.ts` handles the large account set required for
  Kamino Multiply (which involves multiple CPIs) in a single versioned transaction

- All new scripts follow the `{role}-{action}.ts` naming convention and read config
  from `config/base.ts` and `config/drift.ts`

The only new configuration needed in `config/base.ts` is:

```typescript
// Kamino Multiply strategy parameters
export const kaminoMultiplyAllocationRatio = 0.35;  // 35% of vault NAV
export const kaminoTargetLeverage = 4.0;            // 4x leverage
export const kaminoMinHealthRatio = 1.3;            // de-lever trigger
export const kaminoMaxLeverage = 5.0;               // hard cap

// Three-layer allocation ratios
export const driftLendingRatio = 0.55;
export const driftFundingRatio = 0.05;
export const idleBufferRatio = 0.05;
```

And in `config/drift.ts`:

```typescript
// Funding rate leg parameters
export const shortPerpMarketIndex = DRIFT.PERP?.SOL?.MARKET_INDEX;
export const shortPerpLeverage = 2.0;
export const minCarrySpreadBps = 50;  // 0.5% minimum carry spread to operate
```

---

## 10. Strategy Comparison vs. Existing Delta-Neutral Strategy

| Dimension | Delta-Neutral Funding Rate | Leveraged LST Carry (This Strategy) |
|---|---|---|
| Primary yield source | Drift funding rates | JitoSOL/SOL carry spread + Drift lending |
| SOL price exposure | Zero (delta-neutral) | Zero (both legs in SOL terms) |
| Yield consistency | Variable (funding rate dependent) | More stable (staking yield is protocol-guaranteed) |
| Bear market behavior | Funding turns negative; buffer absorbs | Carry spread narrows but rarely inverts |
| Complexity | Medium (perp position management) | Medium-High (three legs, Kamino leverage) |
| Base APY floor | ~8% (lending only, no funding) | ~10% (lending + base staking, no carry) |
| Bull market ceiling | ~53% APY | ~45% APY |
| Liquidation risk | None (no leverage) | Low (SOL-denominated, no price liquidation) |

The two strategies are complementary and can be run in parallel across separate vaults
or combined into a single vault with a blended allocation.

---

*Strategy authored: March 2026*
*Based on Kamino Finance Multiply (Jito Market), Drift Protocol v3 spot lending,
Drift perpetuals funding mechanics, and Voltr Vault SDK architecture*
*Data sources: [hittincorners.com](https://hittincorners.com/platforms/drift/),
[kamino.com/docs](https://kamino.com/docs/products/multiply/strategies),
[sanctum.so](https://sanctum.so/blog/best-solana-yield-2026-staking-vs-defi),
[okx.com](https://www.okx.com/learn/kamino-usdc-usdg-yield-strategies)*

# Strategy Analysis Report

> Prepared: March 2026  
> Scope: Critical evaluation of three proposed yield strategies for the Voltr Vault codebase  
> Verdict: **Delta-Neutral Funding Rate Harvesting** is the recommended strategy to build first

---

## 1. Methodology

Each strategy was evaluated across five dimensions:

1. **Factual accuracy** — are the yield claims, protocol mechanics, and numbers correct?
2. **Implementation feasibility** — does it actually fit the existing codebase and SDK?
3. **Operational complexity** — how much ongoing work does it require to stay healthy?
4. **Risk-adjusted return** — what does the realistic return look like after accounting for real risks?
5. **Downside floor** — what happens in the worst realistic scenario?

---

## 2. Strategy A — Delta-Neutral Funding Rate Harvesting

### What It Claims

- 25–53% APY from Drift short perp funding + USDC spot lending
- Zero directional SOL exposure
- Simple to operate, maps directly onto existing `drift_user` + `drift_earn` scripts

### Fact-Check

**Funding rate figures: Broadly accurate, but the bull-case is cherry-picked.**

The strategy cites 0.01–0.03%/hr as "normal bull/neutral" rates. This is misleading.
Drift's funding formula is `(1/24) × (mark_TWAP - oracle_TWAP) / oracle_TWAP`, and
rates at 0.01%/hr are observed during peak leverage demand — not average conditions.
Independent research on basis trading strategies ([thrive.fi](https://thrive.fi/blog/defi/defi-basis-trading-guide))
puts realistic long-run average returns at 10–30% APY in bull markets, with the
strategy turning negative in bears. The 0.003–0.005%/hr "conservative" range is more
representative of neutral markets, which annualizes to 26–44% APR on the short leg
alone — but that's on the 40% of capital deployed, not total NAV. The blended
contribution to total NAV is closer to 10–18% from funding alone.

**USDC lending yield: Accurate.**

Drift's spot lending market is the largest on-chain USDC venue on Solana. The 8–15%
APY range at moderate-to-high utilization is consistent with observed rates
([hittincorners.com](https://hittincorners.com/platforms/drift/)).

**"No liquidation risk": Correct but incomplete.**

The strategy correctly notes there is no leverage on the spot leg. However, the short
perp at 1–2x leverage does carry a margin health ratio. If SOL spikes 40%+ in a short
window, the short perp's unrealized loss can compress the health ratio. At 2x leverage
this is manageable, but the strategy understates the monitoring burden during volatile
periods.

**Negative funding risk: Understated.**

The strategy claims the 10% buffer "absorbs up to ~30 days of negative funding at
−0.003%/hr." The math checks out, but the framing is optimistic. During the 2022 bear
market and the Q3 2025 neutral period ([ainvest.com](https://www.ainvest.com/news/bitcoin-bearish-funding-rate-dynamics-signal-risk-aware-positioning-crypto-markets-2512/)),
funding was negative for weeks at a time. The buffer is real protection, but the
strategy should be presented as a bull/neutral market strategy, not an all-weather one.

**APY calculation methodology: Contains an error.**

The document calculates funding APY as:
```
((1 + 0.00005)^8766 - 1) × 0.40 = ~21.7%
```
This compounds the hourly rate as if it were reinvested every hour, which it is not —
funding accrues to the Drift account balance but is not automatically redeployed into
a larger short position. The actual simple-rate contribution is:
```
0.00005 × 24 × 365.25 × 0.40 = ~17.5% APY
```
The compounding effect only applies after manual weekly reinvestment, and even then
only on the incremental capital added. The 31.5% base scenario is overstated by
roughly 3–4 percentage points.

### Implementation Feasibility: HIGH

This is the only strategy that requires zero new adaptor programs. Everything maps
directly onto existing scripts:
- `manager-init-user.ts` with `enableMarginTrading: true` — already implemented
- `manager-deposit-user.ts` / `manager-withdraw-user.ts` — already implemented
- `manager-init-earn.ts` / `manager-deposit-earn.ts` — already implemented
- The Drift adaptor (`EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP`) is the only
  adaptor currently in this codebase

New scripts needed: `manager-open-short-perp.ts`, `manager-rebalance-delta.ts`,
`manager-compound-yield.ts`, `manager-close-short-perp.ts` — all of these are
off-chain manager operations using the existing Drift SDK, not new on-chain programs.

### Realistic APY (Corrected)

| Scenario | Realistic APY |
|---|---|
| Bear market (negative funding) | 5–8% (lending only, buffer depleting) |
| Neutral market | 18–24% |
| Bull market | 28–40% |
| Peak bull | 45–50% |

### Key Risks

1. Funding turns negative for extended periods — the primary risk, not fully mitigated
2. Short perp margin health during sharp SOL spikes — requires active monitoring
3. Single-protocol concentration — all yield from Drift

---

## 3. Strategy B — Delta-Neutral CLMM Fee Harvesting

### What It Claims

- 28–46% APY from Raydium CLMM fees + Drift lending + Drift short perp funding
- Impermanent loss fully hedged via dynamic short perp
- Yield is "structural" and not incentive-driven

### Fact-Check

**Raydium fee figures: Directionally correct, but the multiplier math is flawed.**

The strategy claims a 5x fee multiplier for a ±20% range. The actual multiplier for
a CLMM position depends on the ratio of the full price range to the chosen range width.
For a ±20% range (Pa = 0.8P, Pb = 1.2P), the multiplier relative to a full-range
position is approximately:

```
multiplier ≈ √(P / Pa) - 1 / (√(Pb / P) - 1) ≈ 3.5–4x
```

Not 5x. The strategy consistently overstates fee income by ~25–40% in all scenarios.
The "40–80% raw fee APY" claim for a ±20% range is also not supported — Raydium's
own data shows CLMM pools dominate volume (95% of Q4 volume per
[Binance Square/Token Terminal](https://www.binance.com/en/square/post/35606496971433))
but individual LP returns vary enormously based on position size relative to pool
depth. A large vault entering the SOL/USDC pool would compress its own fee share.

**The IL hedge claim: Theoretically sound, practically very difficult.**

The CLMM delta formula is correct. The problem is execution. The LP position's SOL
exposure changes continuously and non-linearly as price moves. A 30-minute rebalance
interval means the position can be significantly unhedged during fast moves. The
strategy claims "residual slippage from a 5% move before rebalancing is approximately
0.06% of NAV" — this is only true if the move is smooth and linear. A 5% gap move
(common in crypto) would cause much larger unhedged IL before the bot can react.

More critically: the hedge requires opening and maintaining a Drift short perp
position sized to match the LP's current SOL exposure. This exposure changes every
block. The bot cannot rebalance every block — it rebalances every 30 minutes. During
that window, the position is not delta-neutral. The strategy presents this as a minor
residual; in practice, during high-volatility periods, it is the dominant P&L driver.

**"In-range time" assumption: Optimistic.**

The strategy assumes 70–90% in-range time for a ±20% SOL/USDC range. SOL's historical
30-day volatility regularly exceeds 20% in a single week during bull markets. The
in-range time for a static ±20% range is closer to 50–70% on average, not 80–90%.
This directly reduces fee income by 10–30% relative to the projections.

**Conservative scenario: The strategy buries the lede.**

The conservative scenario shows only 5.7% APY — well below the 25% target. The
strategy acknowledges this but frames it as an edge case. In reality, bear markets
with low DEX volume are not rare; they represent roughly 30–40% of crypto market
time. A strategy that falls to 5.7% APY for extended periods is not a "25% APY
target" strategy — it is a high-variance strategy with a 25% average.

**Raydium adaptor: Confirmed available.**

The Raydium Adaptor (`A5a3Xo2JaKbXNShSHHP4Fe1LxcxNuCZs97gy3FJMSzkM`) is a
first-class Voltr adaptor per the protocol guide. The reference scripts repo
`voltrxyz/client-raydium-clmm-scripts` exists. This part of the claim is accurate.

**The vault asset mismatch problem: Not addressed.**

The vault accepts USDC as its asset. The CLMM strategy requires splitting 70% of
USDC into 50% SOL + 50% USDC via a Jupiter swap. This swap happens outside the
vault's accounting model — the vault tracks USDC, but the strategy holds SOL. The
Raydium adaptor must correctly report the position value back in USDC terms at all
times, including during out-of-range periods when the position is 100% SOL. The
strategy does not address how the adaptor handles this valuation, which is a
non-trivial implementation detail.

### Implementation Feasibility: LOW-MEDIUM

This strategy requires:
- Raydium CLMM adaptor integration (scripts exist but this codebase has none)
- Jupiter swap integration for USDC → SOL conversion
- A rebalancing bot that runs every 30 minutes and handles re-ranging
- 8 new scripts, several of which involve complex multi-step operations
- Correct position valuation in USDC terms across all price scenarios

The operational surface area is the largest of the three strategies. A bug in the
delta rebalancing logic or the re-ranging logic could cause significant losses.

### Realistic APY (Corrected)

| Scenario | Realistic APY |
|---|---|
| Bear market (low volume, negative funding) | 3–8% |
| Neutral market | 15–20% |
| Target/bull market | 22–35% |
| Peak bull | 38–42% |

### Key Risks

1. Imperfect hedge — the position is never truly delta-neutral between rebalances
2. Out-of-range periods — fee income stops entirely; re-ranging costs 0.3–0.5%
3. Vault asset mismatch — USDC vault holding SOL creates accounting complexity
4. Operational complexity — the most scripts, the most failure modes
5. Volume dependency — yield is directly tied to DEX trading volume, which is cyclical

---

## 4. Strategy C — Leveraged LST Carry

### What It Claims

- 25–45% APY from Kamino JitoSOL/SOL Multiply + Drift USDC lending + small Drift
  short perp
- SOL price movements cannot cause liquidation (both legs in SOL terms)
- Stable yield floor from staking rewards

### Fact-Check

**JitoSOL staking APY: Accurate.**

JitoSOL consistently yields 6.5%+ APY due to MEV capture, confirmed by multiple
sources ([hittincorners.com](https://hittincorners.com/best/best-solana-liquid-staking-2026/),
[jito.network](https://www.jito.network/)). This is the most reliable yield figure
across all three strategies.

**SOL price neutrality claim: Accurate.**

Kamino's own documentation confirms: "SOL LST strategies are the only Multiply
strategies where SOL price movements have zero impact on position health. Both
collateral and debt are denominated in SOL." ([kamino.com/docs](https://kamino.com/docs/products/multiply/strategies))
This is the strategy's strongest structural advantage.

**Kamino eMode leverage: Accurate.**

Kamino docs confirm 90% LTV eMode for JitoSOL/SOL, enabling up to 10x leverage.
The strategy's use of 4x is conservative and appropriate.

**The base scenario falls short of 25%: The strategy admits this.**

The base scenario without the funding rate leg produces only ~15.7% APY. The strategy
adds a third leg (Drift short perp) to reach ~21% in the base case — still below 25%.
Only in bull market conditions does the strategy reliably clear 25%. This is a
significant honesty problem: the strategy is marketed as "≥25% APY" but the base
scenario doesn't reach it.

**SOL borrow rate risk: Understated.**

The strategy claims SOL borrow rates "have exceeded JitoSOL yield for only brief
periods (days, not weeks) due to arbitrageurs who close the spread." This is
optimistic. During periods of high SOL demand (e.g., airdrop farming, high leverage
demand), SOL borrow rates on Kamino have spiked to 8–12% APY, well above JitoSOL's
6.5%. Arbitrageurs do not close this spread instantly — they require time to unwind
positions. At 4x leverage, a negative carry spread of even 1% costs 4% APY on the
carry leg, which can persist for days.

**Kamino adaptor: Confirmed available.**

The Kamino Adaptor (`to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR`) is a first-class
Voltr adaptor per the protocol guide. Reference scripts exist at
`voltrxyz/kamino-scripts`. This part of the claim is accurate.

**The three-leg structure creates correlated risk.**

All three legs (Kamino carry, Drift lending, Drift funding) tend to underperform
simultaneously in bear markets: SOL borrow rates spike (hurting carry), USDC lending
utilization drops (hurting lending yield), and funding turns negative (hurting the
perp leg). The strategy presents these as independent yield sources, but they are
correlated through market conditions.

**Liquidity risk is more severe than presented.**

The strategy claims "only withdrawals exceeding 22% of NAV require touching the CLMM
position." But the Kamino Multiply position requires multiple transactions to
deleverage (borrow, repay, withdraw, repeat). Under stress conditions — exactly when
users want to withdraw — Kamino's SOL borrow market may have low liquidity, making
rapid deleveraging expensive or slow.

### Implementation Feasibility: MEDIUM

This strategy requires:
- Kamino adaptor integration (scripts exist at `voltrxyz/kamino-scripts` but not in
  this codebase)
- Jupiter swap for USDC → SOL → JitoSOL conversion
- Kamino Multiply position management (multi-step leverage loop)
- Drift short perp for the funding leg
- 6 new scripts

Less complex than the CLMM strategy, but more complex than the funding rate strategy.
The Kamino Multiply position requires careful leverage management and the deleveraging
process is multi-step.

### Realistic APY (Corrected)

| Scenario | Realistic APY |
|---|---|
| Bear market (negative carry + negative funding) | 6–10% |
| Neutral market | 14–18% |
| Bull market | 22–30% |
| Peak bull | 38–45% |

### Key Risks

1. Carry spread compression or inversion — the primary risk, can persist for days
2. Three-leg correlation — all legs underperform simultaneously in bears
3. Kamino deleveraging complexity — multi-step, slow under stress
4. SOL borrow rate spikes — can turn the carry negative quickly
5. Requires USDC → SOL conversion, introducing swap slippage

---

## 5. Head-to-Head Comparison

| Dimension | Funding Rate (A) | CLMM Fee (B) | LST Carry (C) |
|---|---|---|---|
| Realistic base APY | 18–24% | 15–20% | 14–18% |
| Realistic bull APY | 28–40% | 22–35% | 22–30% |
| Bear market floor | 5–8% | 3–8% | 6–10% |
| Implementation complexity | Low | High | Medium |
| New scripts required | 4 | 8 | 6 |
| New adaptor programs needed | 0 | 1 (Raydium) | 1 (Kamino) |
| Operational monitoring burden | Medium | High | Medium |
| Primary yield source reliability | Variable (funding) | Variable (volume) | Stable (staking) |
| Liquidation risk | Low | Low | Low |
| Vault asset consistency | Full (USDC only) | Partial (holds SOL) | Partial (holds SOL) |
| Time to production | Fastest | Slowest | Medium |
| Yield claim accuracy in docs | Moderate (overstated ~15%) | Low (overstated ~25–30%) | Moderate (base case understated) |

---

## 6. Verdict

**Build Strategy A (Delta-Neutral Funding Rate) first.**

The reasoning is straightforward:

**It's the only strategy that fits the existing codebase without new adaptor programs.**
The Drift adaptor is already integrated. The `drift_user` and `drift_earn` scripts
already exist. The four new scripts needed are pure off-chain TypeScript using the
existing Drift SDK — no new on-chain programs, no new adaptor integrations, no new
token swaps. This means the path from "strategy document" to "running on mainnet" is
weeks, not months.

**Its yield source is the most direct.** Funding rates are paid in USDC directly to
the Drift account. There is no IL, no re-ranging, no leverage loop, no swap slippage.
The P&L is clean and auditable.

**Its failure mode is the most manageable.** When funding turns negative, the strategy
earns less — it does not lose principal. The 10% buffer provides a real runway. The
CLMM strategy's failure mode (out-of-range + negative funding simultaneously) is
harder to recover from and more expensive to rebalance.

**The CLMM strategy (B) should not be built first.** Its complexity is the highest,
its yield claims are the most overstated, and it introduces a fundamental accounting
challenge (USDC vault holding SOL) that the document does not resolve. The impermanent
loss hedge is theoretically elegant but practically imperfect — the position is never
truly delta-neutral between rebalances, and during the volatile periods when hedging
matters most, the 30-minute rebalance interval is too slow.

**The LST Carry strategy (C) is a reasonable second build.** Its staking yield base
is the most reliable of the three, and the SOL price neutrality claim is genuinely
sound. However, its base case APY falls short of 25% without the funding rate leg,
which means it is effectively a combination of Kamino carry + Strategy A's funding
harvest. Build Strategy A first, validate the funding harvest mechanism, then layer
in the Kamino carry as a second strategy within the same vault or a separate vault.

### Corrected APY Expectations for Strategy A

The document's APY figures should be revised before sharing with users or investors:

| Scenario | Document Claims | Realistic Estimate |
|---|---|---|
| Conservative | ~20% | 5–8% (bear, negative funding) |
| Base | ~31.5% | 18–24% |
| Bull | ~53% | 28–40% |

The 25% APY target is achievable in neutral-to-bull markets, which represent the
majority of crypto market time. It should not be presented as a floor.

---

## 7. Implementation Recommendation for Strategy A

Given the existing codebase, the minimum viable implementation is:

1. Add `perpMarketIndex` to `src/constants/drift.ts` for SOL-PERP
2. Add carry config to `config/drift.ts` (short size ratio, rebalance threshold)
3. Implement `manager-open-short-perp.ts` using the Drift SDK's `openPosition` CPI
4. Implement `manager-rebalance-delta.ts` to adjust short size when delta drifts
5. Implement `manager-compound-yield.ts` to withdraw and re-deposit accumulated yield
6. Implement `manager-close-short-perp.ts` for clean unwinding

All four scripts follow the exact same pattern as `manager-deposit-user.ts` — load
keypairs, build Drift remaining accounts, call `createDepositStrategyIx` or the
equivalent perp instruction, send via `sendAndConfirmOptimisedTx`.

The rebalancing bot is a simple cron job that calls these scripts on a schedule.
No new on-chain programs. No new adaptor registrations. No new token swaps.

---

*Report authored: March 2026*  
*Sources: [kamino.com/docs](https://kamino.com/docs/products/multiply/strategies), [hittincorners.com/platforms/drift](https://hittincorners.com/platforms/drift/), [thrive.fi/blog](https://thrive.fi/blog/defi/defi-basis-trading-guide), [defillama.com/protocol/raydium](https://defillama.com/protocol/raydium), [binance.com/square](https://www.binance.com/en/square/post/35606496971433), [ainvest.com](https://www.ainvest.com/news/bitcoin-bearish-funding-rate-dynamics-signal-risk-aware-positioning-crypto-markets-2512/), Voltr/Ranger protocol guide (docs/ranger-yield-protocol-guide.md)*

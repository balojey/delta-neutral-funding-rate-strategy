# Strategy A v2 — Analysis

> Reviewing the updated Delta-Neutral Funding Rate Harvesting Strategy document  
> Date: March 2026

---

## What Changed

The author incorporated the core criticisms from the prior report. The key revisions:

1. The headline APY target changed from "≥ 25% APY" to "≥ 25% APY in neutral-to-bull markets" — an honest qualification
2. The executive summary now explicitly states this is a bull/neutral market strategy with a 5–8% bear market floor, not an all-weather product
3. The APY calculation methodology was corrected from hourly compounding to simple-rate arithmetic, fixing the ~3–4 percentage point overstatement
4. The bear market scenario is now a first-class section, not buried in the risk section
5. The liquidation risk section was upgraded — margin health monitoring is now hourly (not daily), and a hard 1.2 health ratio floor triggers immediate position reduction
6. The negative funding risk section now explicitly names the 2022 bear market and Q3 2025 as historical precedents

These are substantive improvements. The document is now materially more honest than v1.

---

## Remaining Issues

### Minor: The "spot long" framing is imprecise

Section 2 describes the delta-neutral structure as holding "a spot long position in the underlying asset (e.g., SOL)." But the vault's asset is USDC — there is no SOL spot long. What actually happens is that USDC is deposited into Drift's cross-margin account, and the short perp's delta is offset by the fact that the USDC collateral is not exposed to SOL price movements. The delta neutrality comes from the short perp having zero net directional exposure on its own (short perp + no spot = net short, which is wrong) — or more precisely, the strategy is not truly delta-neutral in the classic sense. It is a **short perp funded by USDC collateral**, which collects funding without taking directional risk because the USDC collateral value doesn't move with SOL.

This is a documentation clarity issue, not a strategy flaw. But it matters for user communication: depositors should understand they are not holding SOL at any point.

### Minor: The peak bull scenario is still unrealistic as presented

The peak bull table shows "0.01–0.03%/hr avg, 40% of capital" producing "35–105% blended" funding contribution. The 105% figure (from 0.03%/hr) is technically correct arithmetic but represents a rate that has only been observed for brief windows during extreme leverage events. Presenting it in a scenario table implies it is a sustained condition. A note similar to the one added to the neutral scenario would help here.

### Minor: `DRIFT.PERP` is not in the constants file

The config snippet in Section 9 references `DRIFT.PERP.SOL.MARKET_INDEX`, but `src/constants/drift.ts` only defines `DRIFT.SPOT`. The perp market index for SOL-PERP on Drift is `0`. This constant needs to be added to `src/constants/drift.ts` before the config snippet works. It's a small gap but will cause a runtime error if copied verbatim.

---

## Overall Assessment

The updated document is ready to build from. The yield claims are now grounded, the risk section is honest about the primary failure mode, and the implementation plan maps cleanly onto the existing codebase with no new adaptor programs required.

The corrected APY expectations hold:

| Scenario | v1 Claim | v2 Claim | Assessment |
|---|---|---|---|
| Bear market | ~20% | 5–8% | v2 is accurate |
| Neutral market | ~31.5% | ~18–24% | v2 is accurate |
| Bull market | ~53% | ~28–40% | v2 is accurate |
| Peak bull | ~53% | ~45–50% | v2 is reasonable with the caveat noted above |

The strategy is sound. The four new scripts (`manager-open-short-perp.ts`, `manager-rebalance-delta.ts`, `manager-compound-yield.ts`, `manager-close-short-perp.ts`) are the right scope — all follow the existing pattern in `manager-deposit-user.ts` and require no new on-chain programs.

One thing to do before writing any code: add `DRIFT.PERP` constants to `src/constants/drift.ts`. SOL-PERP is market index `0`, BTC-PERP is `1`. Everything in the config and scripts depends on this.

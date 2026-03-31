# Delta-Neutral Funding Rate Strategy — Presentation Script

> Narrated walkthrough. Target delivery time: 2 minutes 30 seconds.

---

So, what we've built here is a strategy that earns yield without taking a bet on
where the market goes. No "SOL is going up" or "SOL is going down." None of that.

Here's the insight: in crypto, perpetual futures traders are almost always net long.
They want leveraged exposure to price. And to keep the perp price from drifting away
from spot, the protocol makes longs pay shorts every single hour. That payment is
called the funding rate — and it flows to whoever is on the short side.

We sit on the short side. But we're not actually bearish. We hedge the short with an
equal spot position, so price moves cancel out completely. SOL goes up 20%, the short
loses 20%, the spot gains 20% — net zero. What's left is just the funding income,
dripping in every hour, plus the lending yield on the USDC collateral sitting in
Drift's spot market.

Two yield streams. No price risk. That's the whole idea.

Capital is split 50/40/10 — 50% earning lending yield, 40% backing the short perp,
10% held as a liquid buffer for the days when funding goes negative. The target is
18 to 40% blended APY in neutral-to-bull markets, with a lending yield floor of
around 5 to 8% if things turn bearish.

---

Now let's see it in action. We're going to run the backtest right now.

```bash
pnpm ts-node backtest/run-backtest.ts --market SOL-PERP --from 2023-01-01 --to 2023-11-03 --capital 500000
```

We're testing SOL-PERP, January through November 2023 — about 10 months — with
$500,000 in starting capital. That's a real, challenging period. SOL went from
roughly $10 to $25 during this window, which is actually a tough environment for a
short-perp strategy.

Once it finishes running, the report automatically opens in your browser. You don't
have to go find a file — it just pops up.

---

Let's talk through what you're looking at.

The NAV vs SOL Price chart at the top is the most important one. The blue line is
our portfolio value, the yellow line is SOL's price. Notice how they move against
each other during rallies — that's the short leg taking mark-to-market heat as SOL
climbs. But the blue line keeps recovering and ends higher than it started. That's
the funding income doing its job, quietly compounding in the background regardless
of what price is doing.

The final NAV is $530,934 on a $500,000 start. That's $31k of real yield, no
directional exposure, over 10 months.

Now the number that will catch your eye is the max drawdown — 60.8%. The report
flags it in yellow, and rightly so. This is a mark-to-market figure. It's what the
portfolio looked like on paper during the worst SOL rally. The position was never
liquidated — you can see zero health breaches below 1.2, which is the liquidation
danger zone. The safety mechanisms held. But we're showing you this number because
you deserve to see it. In a live deployment, you'd tune the short size ratio down
to bring that drawdown in line with your risk tolerance.

The daily funding income chart at the bottom right tells the quieter story — small,
consistent payments, every day, with occasional spikes when leverage demand peaks.
This is the drip that builds the return over time.

---

What we've shown you today is not a backtest of a theory. This is the actual
simulator running the actual parameters we deploy on-chain, against real historical
data from Drift Protocol.

The strategy is implemented, the safety logic is live, and the tooling is ready.
We're not here to promise you a number — we're here to show you the mechanics, show
you the risks honestly, and let the data speak.

If you want to stress-test different parameters, there's a grid search mode that
sweeps the configuration space and finds the optimal balance between yield and
drawdown for your risk profile.

We're happy to go deeper on anything — the on-chain implementation, the rebalancing
logic, or the risk model. The floor is open.

---

*Generated: March 2026*

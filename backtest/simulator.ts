import { SimulatorParams, AlignedTick, TickSnapshot } from "./types";

function simulate(params: SimulatorParams, ticks: AlignedTick[]): TickSnapshot[] {
  const { initialCapital, shortPerpSizeRatio, bufferRatio, rebalanceThresholdPct } = params;

  if (shortPerpSizeRatio + bufferRatio >= 1) {
    throw new Error("Invalid params: ratios sum to >= 1");
  }
  if (ticks.length === 0) {
    throw new Error("No aligned ticks for simulation");
  }

  // Initialisation from first tick.
  // The 50/40/10 split means:
  //   - buffer: 10% held as liquid USDC
  //   - spotBalance: 90% deployed as USDC collateral on Drift spot (backs both lending yield and the short margin)
  //   - shortNotional: synthetic short exposure = 40% of initialCapital (not a separate cash bucket)
  // At entry, NAV = spotBalance + buffer + unrealizedPnl(=0) = initialCapital
  let spotBalance = initialCapital * (1 - bufferRatio);
  let shortNotional = initialCapital * shortPerpSizeRatio;
  let buffer = initialCapital * bufferRatio;
  let shortSizeInSol = shortNotional / ticks[0].solPrice;
  // entryPrice tracks the weighted average entry of the short position.
  // It resets to current price whenever shortSizeInSol changes (rebalance / margin breach).
  let entryPrice = ticks[0].solPrice;

  const snapshots: TickSnapshot[] = [];

  for (const tick of ticks) {
    // Step 1 — Mark-to-market
    shortNotional = shortSizeInSol * tick.solPrice;

    // Step 2 — Spot yield accrual
    const lendingYield = spotBalance * (tick.lendingRate / 8760);
    spotBalance += lendingYield;

    // Step 3 — Funding payment
    const fundingPayment = shortNotional * tick.fundingRate;
    if (tick.fundingRate >= 0) {
      spotBalance += fundingPayment;
    } else {
      const payment = Math.abs(fundingPayment);
      if (buffer >= payment) {
        buffer -= payment;
      } else {
        spotBalance -= payment - buffer;
        buffer = 0;
      }
    }

    // Step 4 — Unrealized P&L and NAV
    // The short is a synthetic position backed by spot USDC collateral.
    // unrealizedPnl = mark-to-market gain/loss on the short since last entry price reset.
    const unrealizedPnl = (entryPrice - tick.solPrice) * shortSizeInSol;
    const nav = spotBalance + buffer + unrealizedPnl;

    // Step 5 — Delta and margin health
    let delta = spotBalance - shortNotional;
    let marginHealth = shortNotional > 0 ? (spotBalance + buffer) / shortNotional : Infinity;

    // Step 6 — Margin health breach check (BEFORE rebalance)
    let marginBreached = false;
    if (marginHealth < 1.2) {
      shortNotional = shortNotional / 2;
      shortSizeInSol = shortSizeInSol / 2;
      entryPrice = tick.solPrice; // reset entry price after position change
      marginBreached = true;
      delta = spotBalance - shortNotional;
      marginHealth = shortNotional > 0 ? (spotBalance + buffer) / shortNotional : Infinity;
    }

    // Step 7 — Rebalance check
    let rebalanced = false;
    if (nav > 0 && Math.abs(delta) / nav > rebalanceThresholdPct / 100) {
      shortNotional = spotBalance;
      shortSizeInSol = spotBalance / tick.solPrice;
      entryPrice = tick.solPrice; // reset entry price after position change
      rebalanced = true;
      delta = spotBalance - shortNotional; // = 0
    }

    // Step 8 — Record snapshot
    snapshots.push({
      timestamp: tick.timestamp,
      nav,
      spotBalance,
      buffer,
      shortNotional,
      shortSizeInSol,
      delta,
      marginHealth,
      fundingPayment,
      lendingYield,
      rebalanced,
      marginBreached,
      solPrice: tick.solPrice,
    });
  }

  return snapshots;
}

module.exports = { simulate };
export { simulate };

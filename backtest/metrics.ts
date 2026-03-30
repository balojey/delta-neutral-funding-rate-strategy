import { TickSnapshot, SimulationMetrics } from "./types";

function computeMetrics(snapshots: TickSnapshot[]): SimulationMetrics {
  if (snapshots.length < 168) {
    throw new Error("Insufficient data: need >= 168 ticks");
  }

  const totalHours = snapshots.length;
  const initialNAV = snapshots[0].nav;
  const finalNAV = snapshots[totalHours - 1].nav;

  // 1. Blended APY (Requirement 5.1)
  const blendedAPY = ((finalNAV / initialNAV) ** (8760 / totalHours) - 1) * 100;

  // 2. Sharpe Ratio (Requirement 5.2)
  const dailyNAVs: number[] = [];
  for (let i = 0; i < totalHours; i += 24) {
    dailyNAVs.push(snapshots[i].nav);
  }
  const dailyReturns: number[] = [];
  for (let i = 0; i < dailyNAVs.length - 1; i++) {
    dailyReturns.push((dailyNAVs[i + 1] - dailyNAVs[i]) / dailyNAVs[i]);
  }
  let sharpeRatio = 0;
  if (dailyReturns.length > 0) {
    const meanDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((sum, r) => sum + (r - meanDailyReturn) ** 2, 0) / dailyReturns.length;
    const stdDevDailyReturn = Math.sqrt(variance);
    sharpeRatio =
      stdDevDailyReturn === 0 ? 0 : (meanDailyReturn / stdDevDailyReturn) * Math.sqrt(365);
  }

  // 3. Max Drawdown (Requirement 5.3)
  let maxDrawdownPct = 0;
  let peakNAV = snapshots[0].nav;
  for (const snap of snapshots) {
    if (snap.nav > peakNAV) peakNAV = snap.nav;
    const drawdown = ((peakNAV - snap.nav) / peakNAV) * 100;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  // 4. Counts (Requirements 5.4, 5.5, 5.6)
  const rebalanceCount = snapshots.filter((s) => s.rebalanced).length;
  const negativeFundingHours = snapshots.filter((s) => s.fundingPayment < 0).length;
  const healthBreachesBelow1_5 = snapshots.filter((s) => s.marginHealth < 1.5).length;
  const healthBreachesBelow1_2 = snapshots.filter((s) => s.marginHealth < 1.2).length;

  // 5. Worst 30-day rolling window APY (Requirement 8.4)
  const windowSize = 720;
  let worstWindow30dAPY: number;
  if (snapshots.length < windowSize) {
    // Use entire series as one window
    const windowHours = snapshots.length;
    worstWindow30dAPY =
      ((snapshots[windowHours - 1].nav / snapshots[0].nav) ** (8760 / windowHours) - 1) * 100;
  } else {
    worstWindow30dAPY = Infinity;
    for (let i = 0; i <= snapshots.length - windowSize; i++) {
      const windowAPY =
        ((snapshots[i + windowSize - 1].nav / snapshots[i].nav) ** (8760 / windowSize) - 1) * 100;
      if (windowAPY < worstWindow30dAPY) worstWindow30dAPY = windowAPY;
    }
  }

  return {
    blendedAPY,
    sharpeRatio,
    maxDrawdownPct,
    rebalanceCount,
    negativeFundingHours,
    healthBreachesBelow1_5,
    healthBreachesBelow1_2,
    worstWindow30dAPY,
    totalHours,
    initialNAV,
    finalNAV,
  };
}

function evaluatePassCriteria(metrics: SimulationMetrics): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (!(metrics.blendedAPY > 15)) {
    failures.push(
      `Blended APY ${metrics.blendedAPY.toFixed(2)}% does not exceed 15%`
    );
  }
  if (!(metrics.maxDrawdownPct < 10)) {
    failures.push(
      `Max drawdown ${metrics.maxDrawdownPct.toFixed(2)}% exceeds 10%`
    );
  }
  if (!(metrics.healthBreachesBelow1_2 === 0)) {
    failures.push(
      `${metrics.healthBreachesBelow1_2} margin health breach(es) below 1.2`
    );
  }
  if (!(metrics.worstWindow30dAPY > 0)) {
    failures.push(
      `worst 30-day window APY is negative (${metrics.worstWindow30dAPY.toFixed(2)}%)`
    );
  }

  return { passed: failures.length === 0, failures };
}

module.exports = { computeMetrics, evaluatePassCriteria };
export { computeMetrics, evaluatePassCriteria };

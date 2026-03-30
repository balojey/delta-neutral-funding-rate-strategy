import {
  FundingRateRecord,
  LendingRateRecord,
  PriceRecord,
  AlignedTick,
} from "./types";

/**
 * Interpolate a lending rate for a given timestamp using linear interpolation
 * between the two nearest surrounding known values. Falls back to nearest
 * available value if no surrounding pair exists (extrapolation).
 */
function interpolateLendingRate(
  ts: number,
  sorted: LendingRateRecord[]
): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0].annualisedRate;

  // Find insertion point
  let lo = 0;
  let hi = sorted.length - 1;

  if (ts <= sorted[lo].timestamp) return sorted[lo].annualisedRate;
  if (ts >= sorted[hi].timestamp) return sorted[hi].annualisedRate;

  // Binary search for surrounding pair
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].timestamp <= ts) lo = mid;
    else hi = mid;
  }

  const t1 = sorted[lo].timestamp;
  const t2 = sorted[hi].timestamp;
  const r1 = sorted[lo].annualisedRate;
  const r2 = sorted[hi].annualisedRate;

  if (t2 === t1) return r1;
  return r1 + (r2 - r1) * (ts - t1) / (t2 - t1);
}

/**
 * Align three data series to a common set of hourly timestamps driven by the
 * price array. Funding rates must have an exact match; lending rates are
 * linearly interpolated for missing hours. Price gaps > 2 consecutive hours
 * emit a [WARN] to stdout.
 */
export function alignDataSeries(
  funding: FundingRateRecord[],
  lending: LendingRateRecord[],
  prices: PriceRecord[],
  startTs: number,
  endTs: number
): AlignedTick[] {
  // Handle edge cases
  if (!funding.length || !lending.length || !prices.length) return [];

  // Build a fast lookup for funding rates by timestamp
  const fundingMap = new Map<number, number>();
  for (const f of funding) {
    fundingMap.set(f.timestamp, f.fundingRate);
  }

  // Sort lending records by timestamp for interpolation
  const sortedLending = [...lending].sort((a, b) => a.timestamp - b.timestamp);

  // Filter prices to the requested window and sort
  const windowPrices = prices
    .filter((p) => p.timestamp >= startTs && p.timestamp <= endTs)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (windowPrices.length === 0) return [];

  // Detect and warn about price gaps > 2 consecutive hours
  const TWO_HOURS = 2 * 3600;
  for (let i = 1; i < windowPrices.length; i++) {
    const diff = windowPrices[i].timestamp - windowPrices[i - 1].timestamp;
    if (diff > TWO_HOURS) {
      const gapHours = diff / 3600;
      const startGapTs = windowPrices[i - 1].timestamp;
      console.log(
        `[WARN] Price gap detected: ${gapHours} hours starting at ${new Date(startGapTs * 1000).toISOString()}`
      );
    }
  }

  // Build aligned ticks: price drives the timeline, funding must match exactly
  const ticks: AlignedTick[] = [];
  for (const price of windowPrices) {
    const ts = price.timestamp;
    const fundingRate = fundingMap.get(ts);
    if (fundingRate === undefined) continue; // skip if no exact funding match

    const lendingRate = interpolateLendingRate(ts, sortedLending);

    ticks.push({
      timestamp: ts,
      fundingRate,
      lendingRate,
      solPrice: price.closePrice,
    });
  }

  return ticks;
}

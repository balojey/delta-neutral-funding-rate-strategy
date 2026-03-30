import * as fs from "fs";
import * as path from "path";
import {
  SimulatorParams,
  FundingRateRecord,
  LendingRateRecord,
  PriceRecord,
  GridResult,
} from "./types";
import { alignDataSeries } from "./align";
import { simulate } from "./simulator";
import { computeMetrics } from "./metrics";

// Parameter grid axes (Requirement 6.1)
const SHORT_PERP_SIZE_RATIOS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
const REBALANCE_THRESHOLD_PCTS = [1, 2, 3, 5];
const MIN_MARGIN_HEALTH_RATIOS = [1.3, 1.5, 1.8, 2.0];
const MARKETS = ["SOL-PERP", "BTC-PERP"] as const;

const CSV_HEADER =
  "shortPerpSizeRatio,rebalanceThresholdPct,minMarginHealthRatio,market," +
  "blendedAPY,sharpeRatio,maxDrawdownPct,rebalanceCount,negativeFundingHours," +
  "healthBreachesBelow1_5,healthBreachesBelow1_2,worstWindow30dAPY";

async function runGridSearch(
  baseParams: Omit<
    SimulatorParams,
    "shortPerpSizeRatio" | "rebalanceThresholdPct" | "minMarginHealthRatio"
  >,
  dataByMarket: Record<
    string,
    {
      funding: FundingRateRecord[];
      lending: LendingRateRecord[];
      prices: PriceRecord[];
    }
  >,
  outputDir: string
): Promise<GridResult[]> {
  // Pre-flight: ensure outputDir exists and is writable (Requirement 6.5)
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch {
    throw new Error(`Output directory not writable: ${outputDir}`);
  }

  const results: GridResult[] = [];

  // Build and execute Cartesian product (Requirement 6.1, 6.2)
  for (const market of MARKETS) {
    const marketData = dataByMarket[market];
    if (!marketData) {
      console.log(`[WARN] No data for market ${market}, skipping`);
      continue;
    }

    const { funding, lending, prices } = marketData;

    // Derive time window from price array
    const sortedPrices = [...prices].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedPrices.length === 0) {
      console.log(`[WARN] Empty price array for market ${market}, skipping`);
      continue;
    }
    const startTs = sortedPrices[0].timestamp;
    const endTs = sortedPrices[sortedPrices.length - 1].timestamp;

    // Align once per market (shared across all param combos for this market)
    const alignedTicks = alignDataSeries(funding, lending, prices, startTs, endTs);

    for (const shortPerpSizeRatio of SHORT_PERP_SIZE_RATIOS) {
      for (const rebalanceThresholdPct of REBALANCE_THRESHOLD_PCTS) {
        for (const minMarginHealthRatio of MIN_MARGIN_HEALTH_RATIOS) {
          try {
            const params: SimulatorParams = {
              ...baseParams,
              shortPerpSizeRatio,
              rebalanceThresholdPct,
              minMarginHealthRatio,
            };

            const snapshots = simulate(params, alignedTicks);
            const metrics = computeMetrics(snapshots);

            const gridResult: GridResult = {
              shortPerpSizeRatio,
              rebalanceThresholdPct,
              minMarginHealthRatio,
              market,
              ...metrics,
            };

            results.push(gridResult);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(
              `[ERROR] Combination {shortPerpSizeRatio: ${shortPerpSizeRatio}, ` +
                `rebalanceThresholdPct: ${rebalanceThresholdPct}, ` +
                `minMarginHealthRatio: ${minMarginHealthRatio}, ` +
                `market: ${market}}: ${msg}`
            );
          }
        }
      }
    }
  }

  // Write CSV (Requirement 6.3)
  const csvRows = results.map(
    (r) =>
      `${r.shortPerpSizeRatio},${r.rebalanceThresholdPct},${r.minMarginHealthRatio},` +
      `${r.market},${r.blendedAPY},${r.sharpeRatio},${r.maxDrawdownPct},` +
      `${r.rebalanceCount},${r.negativeFundingHours},${r.healthBreachesBelow1_5},` +
      `${r.healthBreachesBelow1_2},${r.worstWindow30dAPY}`
  );
  const csvContent = [CSV_HEADER, ...csvRows].join("\n");
  await fs.promises.writeFile(
    path.join(outputDir, "grid-search-results.csv"),
    csvContent,
    "utf-8"
  );

  // Write summary JSON (Requirement 6.4)
  const filtered = results
    .filter((r) => r.maxDrawdownPct < 10 && r.healthBreachesBelow1_2 === 0)
    .sort((a, b) => b.blendedAPY - a.blendedAPY)
    .slice(0, 5);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalCombinations: 192,
    successfulRuns: results.length,
    top5: filtered,
  };

  await fs.promises.writeFile(
    path.join(outputDir, "grid-search-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );

  return results;
}

module.exports = { runGridSearch };
export { runGridSearch };

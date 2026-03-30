import { fetchFundingRates } from "./fetch-funding-rates";
import { fetchLendingRates } from "./fetch-lending-rates";
import { fetchPrices } from "./fetch-prices";
import { alignDataSeries } from "./align";
import { simulate } from "./simulator";
import { computeMetrics, evaluatePassCriteria } from "./metrics";
import { runGridSearch } from "./grid-search";
import { generateReport } from "./report";
import {
  shortPerpSizeRatio,
  bufferRatio,
  rebalanceThresholdPct,
  minMarginHealthRatio,
} from "../config/drift";

// --- CLI argument parsing (Requirement 7.1) ---
function parseArgs(argv: string[]): {
  market: "SOL-PERP" | "BTC-PERP";
  months: number;
  grid: boolean;
  from?: string;
  to?: string;
} {
  let market: "SOL-PERP" | "BTC-PERP" = "SOL-PERP";
  let months = 12;
  let grid = false;
  let from: string | undefined;
  let to: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--market") {
      const val = argv[i + 1];
      if (val === "SOL-PERP" || val === "BTC-PERP") { market = val; i++; }
      else { console.error(`Invalid --market value: ${val}. Must be SOL-PERP or BTC-PERP.`); process.exit(1); }
    } else if (arg === "--months") {
      const val = Number(argv[i + 1]);
      if (!isFinite(val) || val <= 0) { console.error(`Invalid --months value: ${argv[i + 1]}.`); process.exit(1); }
      months = val; i++;
    } else if (arg === "--from") {
      from = argv[i + 1]; i++;
    } else if (arg === "--to") {
      to = argv[i + 1]; i++;
    } else if (arg === "--grid") {
      grid = true;
    }
  }

  return { market, months, grid, from, to };
}

async function main() {
  const { market, months, grid, from, to } = parseArgs(process.argv.slice(2));

  // Resolve date range:
  // --from / --to take priority; otherwise use --months lookback from S3_DATA_END
  const S3_DATA_END = Math.floor(new Date("2025-01-09T00:00:00Z").getTime() / 1000);

  let endTs: number;
  let startTs: number;

  if (to) {
    endTs = Math.floor(new Date(to + "T00:00:00Z").getTime() / 1000);
    if (isNaN(endTs)) { console.error(`Invalid --to date: ${to}. Use YYYY-MM-DD.`); process.exit(1); }
  } else {
    endTs = Math.min(Math.floor(Date.now() / 1000), S3_DATA_END);
  }

  if (from) {
    startTs = Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000);
    if (isNaN(startTs)) { console.error(`Invalid --from date: ${from}. Use YYYY-MM-DD.`); process.exit(1); }
  } else {
    startTs = endTs - months * 30 * 24 * 3600;
  }

  const cacheDir = "backtest/data";
  const outputDir = "backtest/results";

  // Include date range in cache keys so different --months values don't collide
  const startDate = new Date(startTs * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const endDate = new Date(endTs * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const dateTag = `${startDate}-${endDate}`;

  // Step 1 — Fetch data
  console.log(`Fetching data for ${market} over the last ${months} month(s)...`);
  console.log(`Date range: ${startDate} → ${endDate}`);

  const funding = await fetchFundingRates(market, startTs, endTs, {
    cacheDir,
    cacheKey: `funding-${market}-${dateTag}`,
  });
  const lending = await fetchLendingRates(startTs, endTs, {
    cacheDir,
    cacheKey: `lending-USDC-${dateTag}`,
  });
  const prices = await fetchPrices("SOL", startTs, endTs, {
    cacheDir,
    cacheKey: `prices-SOL-${dateTag}`,
  });

  // Step 2 — Print data summary (Requirement 7.4)
  console.log(`Funding rates: ${funding.length} records`);
  console.log(`Lending rates: ${lending.length} records`);
  console.log(`Prices: ${prices.length} records`);

  if (funding.length > 0) {
    const first = new Date(funding[0].timestamp * 1000).toISOString().slice(0, 10);
    const last = new Date(funding[funding.length - 1].timestamp * 1000).toISOString().slice(0, 10);
    console.log(`Funding date range: ${first} → ${last}`);
  }
  if (lending.length > 0) {
    const first = new Date(lending[0].timestamp * 1000).toISOString().slice(0, 10);
    const last = new Date(lending[lending.length - 1].timestamp * 1000).toISOString().slice(0, 10);
    console.log(`Lending date range: ${first} → ${last}`);
  }
  if (prices.length > 0) {
    const first = new Date(prices[0].timestamp * 1000).toISOString().slice(0, 10);
    const last = new Date(prices[prices.length - 1].timestamp * 1000).toISOString().slice(0, 10);
    console.log(`Prices date range: ${first} → ${last}`);
  }

  // Step 3 — Exit if any source is empty (Requirement 7.5)
  if (funding.length === 0 || lending.length === 0 || prices.length === 0) {
    console.error(
      "Error: one or more data sources returned no records for the requested date range"
    );
    process.exit(1);
  }

  if (grid) {
    // Step 4b — Grid search (Requirement 7.3)
    const dataByMarket: Record<
      string,
      {
        funding: typeof funding;
        lending: typeof lending;
        prices: typeof prices;
      }
    > = {
      [market]: { funding, lending, prices },
    };

    const results = await runGridSearch(
      { initialCapital: 100_000, bufferRatio },
      dataByMarket,
      outputDir
    );

    // Print summary table
    console.log(`\n=== Grid Search Complete ===`);
    console.log(`Total combinations run: ${results.length}`);

    const top5 = results
      .filter((r) => r.maxDrawdownPct < 10 && r.healthBreachesBelow1_2 === 0)
      .sort((a, b) => b.blendedAPY - a.blendedAPY)
      .slice(0, 5);

    console.log(`\nTop 5 configurations (drawdown < 10%, zero 1.2 breaches):`);
    console.log(
      `${"shortPerp".padEnd(10)} ${"rebalPct".padEnd(10)} ${"minHealth".padEnd(10)} ${"market".padEnd(10)} ${"APY%".padEnd(8)} ${"Sharpe".padEnd(8)} ${"DD%".padEnd(8)}`
    );
    for (const r of top5) {
      console.log(
        `${String(r.shortPerpSizeRatio).padEnd(10)} ${String(r.rebalanceThresholdPct).padEnd(10)} ${String(r.minMarginHealthRatio).padEnd(10)} ${r.market.padEnd(10)} ${r.blendedAPY.toFixed(2).padEnd(8)} ${r.sharpeRatio.toFixed(3).padEnd(8)} ${r.maxDrawdownPct.toFixed(2).padEnd(8)}`
      );
    }
    console.log(`\nResults written to ${outputDir}/`);

    // Generate report using the best-performing combination's simulation
    const best = results.sort((a, b) => b.blendedAPY - a.blendedAPY)[0];
    if (best) {
      const bestTicks = alignDataSeries(funding, lending, prices, startTs, endTs);
      const bestSnapshots = simulate({
        initialCapital: 100_000,
        bufferRatio,
        shortPerpSizeRatio: best.shortPerpSizeRatio,
        rebalanceThresholdPct: best.rebalanceThresholdPct,
        minMarginHealthRatio: best.minMarginHealthRatio,
      }, bestTicks);
      const bestMetrics = computeMetrics(bestSnapshots);
      const { passed, failures } = evaluatePassCriteria(bestMetrics);
      const reportPath = generateReport({
        snapshots: bestSnapshots, metrics: bestMetrics, passed, failures,
        market, months, gridResults: results, outputDir,
      });
      console.log(`Report: ${reportPath}`);
    }
  } else {
    // Step 4a — Single run (Requirement 7.2)
    const ticks = alignDataSeries(funding, lending, prices, startTs, endTs);
    const snapshots = simulate(
      {
        initialCapital: 100_000,
        shortPerpSizeRatio,
        bufferRatio,
        rebalanceThresholdPct,
        minMarginHealthRatio,
      },
      ticks
    );
    const metrics = computeMetrics(snapshots);
    const { passed, failures } = evaluatePassCriteria(metrics);

    // Print metrics summary
    console.log(`\n=== Backtest Results ===`);
    console.log(
      `Period: ${new Date(startTs * 1000).toISOString().slice(0, 10)} → ${new Date(endTs * 1000).toISOString().slice(0, 10)}`
    );
    console.log(`Ticks simulated: ${snapshots.length}`);
    console.log(`Blended APY: ${metrics.blendedAPY.toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}`);
    console.log(`Max Drawdown: ${metrics.maxDrawdownPct.toFixed(2)}%`);
    console.log(`Rebalance events: ${metrics.rebalanceCount}`);
    console.log(`Negative funding hours: ${metrics.negativeFundingHours}`);
    console.log(`Health breaches < 1.5: ${metrics.healthBreachesBelow1_5}`);
    console.log(`Health breaches < 1.2: ${metrics.healthBreachesBelow1_2}`);
    console.log(`Worst 30d window APY: ${metrics.worstWindow30dAPY.toFixed(2)}%`);
    console.log(`Initial NAV: $${metrics.initialNAV.toFixed(2)}`);
    console.log(`Final NAV: $${metrics.finalNAV.toFixed(2)}`);

    // Pass/fail output (Requirements 8.2, 8.3)
    if (passed) {
      console.log("\nPASS: Strategy meets all go/no-go criteria");
    } else {
      console.log(`\nFAIL: ${failures.join("; ")}`);
    }

    const reportPath = generateReport({
      snapshots, metrics, passed, failures, market, months, outputDir,
    });
    console.log(`\nReport: ${reportPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

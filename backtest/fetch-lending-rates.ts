import * as fs from "fs";
import * as path from "path";
import { CacheOptions, LendingRateRecord } from "./types";

const DRIFT_SPOT_MARKETS_URL =
  "https://drift-historical-data-v2.s3.eu-west-1.amazonaws.com/program/" +
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH/spotMarkets";

async function fetchLendingRates(
  startTs: number,
  endTs: number,
  opts: CacheOptions,
  fallbackRate: number = 0.05
): Promise<LendingRateRecord[]> {
  const cacheFile = path.join(opts.cacheDir, `${opts.cacheKey}.json`);

  // Cache hit — return immediately without network call
  if (fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    return JSON.parse(raw) as LendingRateRecord[];
  }

  let records: LendingRateRecord[] = [];
  let usedFallback = false;

  try {
    const response = await fetch(DRIFT_SPOT_MARKETS_URL);
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} fetching ${DRIFT_SPOT_MARKETS_URL}`);
    }

    const rawData: unknown = await response.json();
    const rawRecords = Array.isArray(rawData) ? rawData : [];

    // Filter for USDC spot market (market index 0)
    const parsed: LendingRateRecord[] = [];
    for (const raw of rawRecords) {
      const rec = raw as Record<string, unknown>;

      // Only process USDC (market index 0)
      const marketIndex = rec["marketIndex"] ?? rec["market_index"];
      if (Number(marketIndex) !== 0) continue;

      // Extract timestamp
      const tsRaw = rec["ts"] ?? rec["timestamp"] ?? rec["recordTs"];
      const timestamp = tsRaw !== undefined ? Number(tsRaw) : NaN;
      if (!isFinite(timestamp)) continue;

      // Try to use a direct rate field first
      const directRate = rec["depositRate"] ?? rec["lendingRate"] ?? rec["deposit_rate"];
      if (directRate !== undefined && directRate !== null) {
        let rate = Number(directRate);
        if (isFinite(rate)) {
          // Drift stores rates as scaled integers (divide by 1e6 if large)
          if (rate > 10) rate = rate / 1e6;
          parsed.push({ timestamp, annualisedRate: rate });
          continue;
        }
      }

      // Fall back to computing from utilisation
      const depositBalanceRaw = rec["depositBalance"] ?? rec["totalDeposits"];
      const borrowBalanceRaw = rec["borrowBalance"] ?? rec["totalBorrows"];
      if (depositBalanceRaw === undefined || borrowBalanceRaw === undefined) continue;

      const totalDeposits = Number(depositBalanceRaw);
      const totalBorrows = Number(borrowBalanceRaw);
      if (!isFinite(totalDeposits) || !isFinite(totalBorrows) || totalDeposits <= 0) continue;

      const utilizationRate = totalBorrows / totalDeposits;
      // Simple approximation: lendingRate = utilizationRate * 0.10 (10% max borrow rate)
      const annualisedRate = utilizationRate * 0.10;
      parsed.push({ timestamp, annualisedRate });
    }

    if (parsed.length === 0) {
      throw new Error("No USDC lending rate records parsed from S3 response");
    }

    // Filter by date range
    records = parsed.filter((r) => r.timestamp >= startTs && r.timestamp <= endTs);

    if (records.length === 0) {
      throw new Error("No USDC lending rate records within requested date range");
    }
  } catch (err) {
    usedFallback = true;
    const rate = fallbackRate ?? 0.05;
    console.log(
      `[WARN] USDC lending rate data unavailable — using constant fallback rate of ${(rate * 100).toFixed(2)}% APY`
    );

    // Generate one record per hour from startTs to endTs
    records = [];
    for (let t = startTs; t <= endTs; t += 3600) {
      records.push({ timestamp: t, annualisedRate: rate });
    }
  }

  // Write cache (create directory if needed)
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  await fs.promises.writeFile(cacheFile, JSON.stringify(records, null, 2), "utf-8");

  return records;
}

module.exports = { fetchLendingRates };
export { fetchLendingRates };

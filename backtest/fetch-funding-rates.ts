import * as fs from "fs";
import * as path from "path";
import { CacheOptions, FundingRateRecord } from "./types";

const BASE_URL =
  "https://drift-historical-data-v2.s3.eu-west-1.amazonaws.com/program/" +
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH/market";

/** Format a Date as YYYYMMDD */
function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Parse a CSV text into FundingRateRecord[]. Returns [records, skippedCount]. */
function parseCsv(csv: string, market: string): [FundingRateRecord[], number] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [[], 0];

  const header = lines[0].split(",");
  const tsIdx = header.indexOf("ts");
  const rateIdx = header.indexOf("fundingRate");

  if (tsIdx === -1 || rateIdx === -1) return [[], 0];

  const records: FundingRateRecord[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const timestamp = Number(cols[tsIdx]);
    // Drift S3 CSV stores fundingRate with FUNDING_RATE_PRECISION = 1e9
    // Divide by 1e9 to get the actual hourly rate as a decimal (e.g. 0.0001 = 0.01%/hr)
    const fundingRate = Number(cols[rateIdx]) / 1e9;

    if (!isFinite(timestamp) || !isFinite(fundingRate) || isNaN(fundingRate)) {
      skipped++;
      continue;
    }

    records.push({ timestamp, market, fundingRate });
  }

  return [records, skipped];
}

async function fetchFundingRates(
  market: "SOL-PERP" | "BTC-PERP",
  startTs: number,
  endTs: number,
  opts: CacheOptions
): Promise<FundingRateRecord[]> {
  const cacheFile = path.join(opts.cacheDir, `${opts.cacheKey}.json`);

  // Cache hit — return immediately without network call
  if (fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    return JSON.parse(raw) as FundingRateRecord[];
  }

  // Build list of YYYYMMDD dates to fetch
  const dates: string[] = [];
  const cursor = new Date(startTs * 1000);
  cursor.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(endTs * 1000);

  while (cursor <= endDate) {
    const year = cursor.getUTCFullYear();
    dates.push(`${year}/${toDateStr(cursor)}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Fetch each daily CSV file
  const allRecords: FundingRateRecord[] = [];
  let totalSkipped = 0;

  for (const datePath of dates) {
    const url = `${BASE_URL}/${market}/fundingRateRecords/${datePath}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      // Network error for this day — skip silently
      continue;
    }

    if (response.status === 404) continue; // no data for this day
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const csv = await response.text();
    const [records, skipped] = parseCsv(csv, market);
    allRecords.push(...records);
    totalSkipped += skipped;
  }

  if (totalSkipped > 0) {
    console.log(`[INFO] Skipped ${totalSkipped} invalid funding rate records`);
  }

  // Filter by date range and sort ascending
  const filtered = allRecords
    .filter((r) => r.timestamp >= startTs && r.timestamp <= endTs)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Write cache
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  await fs.promises.writeFile(cacheFile, JSON.stringify(filtered, null, 2), "utf-8");

  return filtered;
}

module.exports = { fetchFundingRates };
export { fetchFundingRates };

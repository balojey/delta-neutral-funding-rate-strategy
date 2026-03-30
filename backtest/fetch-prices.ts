import * as fs from "fs";
import * as path from "path";
import { CacheOptions, PriceRecord } from "./types";

// Binance klines: free, no auth, 1000 candles per request
// Response: [[openTimeMs, open, high, low, close, volume, closeTimeMs, ...], ...]
const BINANCE_URL = "https://api.binance.com/api/v3/klines";
const MAX_CANDLES = 1000;
const ONE_HOUR_MS = 3600 * 1000;

async function fetchWithRetry(url: string, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url);
    if (response.status === 200) return response;
    if (response.status === 429) {
      if (attempt < maxAttempts) {
        console.log(`[INFO] Rate limited (429), waiting 60s before retry ${attempt + 1}/${maxAttempts}...`);
        await new Promise((resolve) => setTimeout(resolve, 60_000));
      } else {
        throw new Error("HTTP 429 fetching Binance after 3 attempts");
      }
    } else {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

async function fetchPrices(
  asset: "SOL",
  startTs: number,
  endTs: number,
  opts: CacheOptions
): Promise<PriceRecord[]> {
  const cacheFile = path.join(opts.cacheDir, `${opts.cacheKey}.json`);

  // Cache hit — return immediately without network call
  if (fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    return JSON.parse(raw) as PriceRecord[];
  }

  const symbol = asset === "SOL" ? "SOLUSDT" : `${asset}USDT`;
  const allRecords: PriceRecord[] = [];

  // Paginate: Binance returns max 1000 candles per request
  let cursorMs = startTs * 1000;
  const endMs = endTs * 1000;

  while (cursorMs < endMs) {
    const batchEndMs = Math.min(cursorMs + MAX_CANDLES * ONE_HOUR_MS, endMs);
    const url =
      `${BINANCE_URL}?symbol=${symbol}&interval=1h` +
      `&startTime=${cursorMs}&endTime=${batchEndMs}&limit=${MAX_CANDLES}`;

    const response = await fetchWithRetry(url);
    const candles = (await response.json()) as [number, string, string, string, string, ...unknown[]][];

    if (candles.length === 0) break;

    for (const candle of candles) {
      const openTimeMs = candle[0];
      const closePrice = parseFloat(candle[4]); // index 4 = close price
      if (!isFinite(closePrice)) continue;
      allRecords.push({
        timestamp: Math.floor(openTimeMs / 1000),
        closePrice,
      });
    }

    // Advance cursor past the last candle returned
    const lastOpenTimeMs = candles[candles.length - 1][0];
    cursorMs = lastOpenTimeMs + ONE_HOUR_MS;
  }

  // Sort ascending
  allRecords.sort((a, b) => a.timestamp - b.timestamp);

  // Gap warning: check for gaps > 2 consecutive hours
  const TWO_HOURS = 2 * 3600;
  for (let i = 1; i < allRecords.length; i++) {
    const gapSeconds = allRecords[i].timestamp - allRecords[i - 1].timestamp;
    if (gapSeconds > TWO_HOURS) {
      const gapHours = Math.round(gapSeconds / 3600);
      const startGapTs = allRecords[i - 1].timestamp;
      console.log(
        `[WARN] Price gap detected: ${gapHours} hours starting at ${new Date(startGapTs * 1000).toISOString()}`
      );
    }
  }

  // Filter by date range
  const filtered = allRecords.filter(
    (r) => r.timestamp >= startTs && r.timestamp <= endTs
  );

  // Write cache
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  await fs.promises.writeFile(cacheFile, JSON.stringify(filtered, null, 2), "utf-8");

  return filtered;
}

module.exports = { fetchPrices };
export { fetchPrices };

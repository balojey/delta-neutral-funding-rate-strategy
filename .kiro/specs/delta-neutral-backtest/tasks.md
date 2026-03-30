# Implementation Plan: Delta-Neutral Backtest

## Overview

Implement the delta-neutral backtest toolkit as a standalone TypeScript pipeline in `backtest/`. The implementation follows the data-fetch → simulate → metrics → output flow, built incrementally so each module is tested before the next depends on it.

## Tasks

- [x] 1. Project scaffolding and configuration
  - Create `backtest/` directory with subdirectories: `__tests__/`, `data/`, `results/`
  - Add `vitest` and `fast-check` as dev dependencies: `pnpm add -D vitest fast-check`
  - Add `vitest` config to `package.json` (include `backtest/__tests__/**` test files, CommonJS environment)
  - Add a `"backtest:test"` script to `package.json`: `vitest --run --reporter=verbose backtest/__tests__`
  - Create `backtest/types.ts` exporting all shared interfaces: `CacheOptions`, `FundingRateRecord`, `LendingRateRecord`, `PriceRecord`, `AlignedTick`, `SimulatorParams`, `TickSnapshot`, `SimulationMetrics`, `GridParams`, `GridResult`
  - _Requirements: 1.4, 2.4, 3.4, 4.1, 4.10, 5.1_

- [-] 2. Implement data alignment utility
  - Create `backtest/align.ts` exporting `alignDataSeries(funding, lending, prices, startTs, endTs): AlignedTick[]`
  - Compute timestamp intersection across all three arrays; apply linear interpolation for missing lending rate hours (per Requirement 2.3); log a `[WARN]` for any price gap > 2 consecutive hours (per Requirement 3.5); trim to requested window
  - [x] 2.1 Implement `alignDataSeries` in `backtest/align.ts`
    - _Requirements: 2.3, 3.5_
  - [ ]* 2.2 Write property test for lending rate interpolation (Property 3)
    - **Property 3: Lending rate interpolation fills all gaps**
    - **Validates: Requirements 2.3**
    - File: `backtest/__tests__/fetch-lending-rates.test.ts`
  - [ ]* 2.3 Write property test for price gap warning (Property 4)
    - **Property 4: Price gap warning fires for gaps exceeding 2 hours**
    - **Validates: Requirements 3.5**
    - File: `backtest/__tests__/fetch-prices.test.ts`

- [x] 3. Implement funding rate fetcher
  - Create `backtest/fetch-funding-rates.ts` exporting `fetchFundingRates(market, startTs, endTs, opts): Promise<FundingRateRecord[]>`
  - Fetch from `https://drift-historical-data-v2.s3.eu-west-1.amazonaws.com/program/dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH/market/{MARKET}/fundingRates`
  - Cache to/from `backtest/data/funding-{MARKET}.json`; throw on non-200; skip invalid records and log count
  - [x] 3.1 Implement `fetchFundingRates` with cache read/write and HTTP error handling
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 3.2 Write property test for parsed record shape (Property 1 — funding)
    - **Property 1: Parsed records have correct shape**
    - **Validates: Requirements 1.4**
    - File: `backtest/__tests__/fetch-funding-rates.test.ts`
  - [ ]* 3.3 Write property test for invalid record filtering (Property 2)
    - **Property 2: Invalid records are filtered from parsed output**
    - **Validates: Requirements 1.5**
    - File: `backtest/__tests__/fetch-funding-rates.test.ts`
  - [ ]* 3.4 Write unit tests for cache-hit behaviour and HTTP error throwing
    - Mock `fs` and `fetch`; assert no network call on cache hit; assert thrown error contains status code and URL
    - _Requirements: 1.2, 1.3_
    - File: `backtest/__tests__/fetch-funding-rates.test.ts`

- [x] 4. Implement lending rate fetcher
  - Create `backtest/fetch-lending-rates.ts` exporting `fetchLendingRates(startTs, endTs, opts, fallbackRate?): Promise<LendingRateRecord[]>`
  - Attempt Drift S3 `spotMarkets` endpoint for USDC utilisation; fall back to constant 5% APY with `[WARN]` log; cache to/from `backtest/data/lending-USDC.json`
  - [x] 4.1 Implement `fetchLendingRates` with S3 fetch, fallback logic, and cache
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 4.2 Write property test for parsed record shape (Property 1 — lending)
    - **Property 1: Parsed records have correct shape**
    - **Validates: Requirements 2.4**
    - File: `backtest/__tests__/fetch-lending-rates.test.ts`
  - [ ]* 4.3 Write unit test for fallback constant rate and `[WARN]` log
    - Mock fetch to return non-200; assert fallback rate used and warning logged
    - _Requirements: 2.1_
    - File: `backtest/__tests__/fetch-lending-rates.test.ts`

- [x] 5. Implement price fetcher
  - Create `backtest/fetch-prices.ts` exporting `fetchPrices(asset, startTs, endTs, opts): Promise<PriceRecord[]>`
  - Fetch hourly SOL/USD OHLC from CoinGecko free API; implement 429 retry (60s delay, up to 3 attempts); cache to/from `backtest/data/prices-SOL.json`
  - [x] 5.1 Implement `fetchPrices` with cache, 429 retry logic, and gap warning
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 5.2 Write property test for parsed record shape (Property 1 — prices)
    - **Property 1: Parsed records have correct shape**
    - **Validates: Requirements 3.4**
    - File: `backtest/__tests__/fetch-prices.test.ts`
  - [ ]* 5.3 Write unit test for HTTP 429 retry behaviour
    - Mock fetch to return 429 twice then 200; assert 3 total calls and correct result
    - _Requirements: 3.3_
    - File: `backtest/__tests__/fetch-prices.test.ts`

- [x] 6. Checkpoint — data layer complete
  - Ensure all tests pass: `pnpm backtest:test`
  - Ask the user if questions arise before proceeding to the simulation engine.

- [x] 7. Implement simulator engine
  - Create `backtest/simulator.ts` exporting `simulate(params, fundingRates, lendingRates, prices): TickSnapshot[]`
  - Implement full tick loop: initial allocation (4.2), spot yield accrual (4.3), funding payment (4.4/4.5), mark-to-market (4.6), delta check + rebalance (4.7), margin health check + emergency deleveraging (4.8), NAV computation (4.9)
  - Throw on invalid params (`shortPerpSizeRatio + bufferRatio >= 1`) and empty tick array
  - [x] 7.1 Implement `simulate` with full tick-by-tick logic
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ]* 7.2 Write property test for initial capital conservation (Property 5)
    - **Property 5: Initial capital is exactly conserved at tick 0**
    - **Validates: Requirements 4.1, 4.2**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.3 Write property test for spot yield accrual (Property 6)
    - **Property 6: Spot yield accrual is arithmetically exact**
    - **Validates: Requirements 4.3**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.4 Write property test for positive funding accrual (Property 7)
    - **Property 7: Positive funding payment accrues to spot balance**
    - **Validates: Requirements 4.4**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.5 Write property test for negative funding buffer drain (Property 8)
    - **Property 8: Negative funding drains buffer before spot balance**
    - **Validates: Requirements 4.5**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.6 Write property test for short notional mark-to-market (Property 9)
    - **Property 9: Short notional tracks current SOL price**
    - **Validates: Requirements 4.6**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.7 Write property test for rebalance trigger and adjustment (Property 10)
    - **Property 10: Rebalance fires and adjusts notional when threshold is exceeded**
    - **Validates: Requirements 4.7**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.8 Write property test for margin breach deleveraging (Property 11)
    - **Property 11: Margin breach halves short notional**
    - **Validates: Requirements 4.8**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.9 Write property test for NAV formula invariant (Property 12)
    - **Property 12: NAV formula invariant holds at every tick**
    - **Validates: Requirements 4.9**
    - File: `backtest/__tests__/simulator.test.ts`
  - [ ]* 7.10 Write property test for output length (Property 13)
    - **Property 13: Simulator output length equals input tick count**
    - **Validates: Requirements 4.10**
    - File: `backtest/__tests__/simulator.test.ts`

- [x] 8. Checkpoint — simulator complete
  - Ensure all tests pass: `pnpm backtest:test`
  - Ask the user if questions arise before proceeding to metrics.

- [x] 9. Implement metrics calculator
  - Create `backtest/metrics.ts` exporting `computeMetrics(snapshots): SimulationMetrics` and `evaluatePassCriteria(metrics): { passed: boolean; failures: string[] }`
  - Implement blended APY (5.1), Sharpe ratio with zero-stdDev guard (5.2), max drawdown (5.3), rebalance/funding/health breach counts (5.4–5.6), worst 30-day rolling window APY (8.4)
  - Throw `Error("Insufficient data: need >= 168 ticks")` when `snapshots.length < 168`
  - [x] 9.1 Implement `computeMetrics` and `evaluatePassCriteria` in `backtest/metrics.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.1, 8.4_
  - [ ]* 9.2 Write property test for blended APY formula (Property 14)
    - **Property 14: Blended APY formula is arithmetically correct**
    - **Validates: Requirements 5.1**
    - File: `backtest/__tests__/metrics.test.ts`
  - [ ]* 9.3 Write property test for Sharpe ratio formula (Property 15)
    - **Property 15: Sharpe ratio formula is arithmetically correct**
    - **Validates: Requirements 5.2**
    - File: `backtest/__tests__/metrics.test.ts`
  - [ ]* 9.4 Write property test for max drawdown bounds (Property 16)
    - **Property 16: Max drawdown is bounded and zero for monotone-increasing NAV**
    - **Validates: Requirements 5.3**
    - File: `backtest/__tests__/metrics.test.ts`
  - [ ]* 9.5 Write property test for metrics count consistency (Property 17)
    - **Property 17: Metrics counts are consistent with snapshot flags**
    - **Validates: Requirements 5.4, 5.5, 5.6**
    - File: `backtest/__tests__/metrics.test.ts`
  - [ ]* 9.6 Write property test for worst 30-day window APY (Property 20)
    - **Property 20: Worst 30-day window APY is the minimum over all rolling windows**
    - **Validates: Requirements 8.4**
    - File: `backtest/__tests__/metrics.test.ts`
  - [ ]* 9.7 Write property test for pass criteria logic (Property 19)
    - **Property 19: Pass criteria logic is a pure logical conjunction**
    - **Validates: Requirements 8.1**
    - File: `backtest/__tests__/pass-criteria.test.ts`
  - [ ]* 9.8 Write unit tests for insufficient-data error and PASS/FAIL output formatting
    - Assert `computeMetrics` throws on < 168 ticks; assert PASS string and FAIL string with correct failure list
    - _Requirements: 5.7, 8.2, 8.3_
    - File: `backtest/__tests__/metrics.test.ts`

- [x] 10. Checkpoint — metrics complete
  - Ensure all tests pass: `pnpm backtest:test`
  - Ask the user if questions arise before proceeding to grid search.

- [x] 11. Implement grid search module
  - Create `backtest/grid-search.ts` exporting `runGridSearch(baseParams, dataByMarket, outputDir): Promise<GridResult[]>`
  - Build Cartesian product of axes: `shortPerpSizeRatio` × `rebalanceThresholdPct` × `minMarginHealthRatio` × `market` = 192 combinations
  - Per combination: call `alignDataSeries` → `simulate` → `computeMetrics`; catch and log errors per combination without halting sweep
  - Write `grid-search-results.csv` and `grid-search-summary.json` (top-5 filtered by drawdown < 10% and zero 1.2 breaches, sorted by blended APY descending) to `outputDir`
  - Throw before sweep if `outputDir` is not writable
  - [x] 11.1 Implement `runGridSearch` in `backtest/grid-search.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 11.2 Write property test for top-5 summary filter and sort invariants (Property 18)
    - **Property 18: Top-5 summary respects filter and sort invariants**
    - **Validates: Requirements 6.4**
    - File: `backtest/__tests__/grid-search.test.ts`
  - [ ]* 11.3 Write unit test for 192-combination count and error-resilience
    - Assert Cartesian product produces exactly 192 combinations; assert a throwing combination is skipped and logged without halting
    - _Requirements: 6.1, 6.5_
    - File: `backtest/__tests__/grid-search.test.ts`

- [x] 12. Implement CLI entry point
  - Create `backtest/run-backtest.ts` as the CLI entry point
  - Parse `--market`, `--months`, `--grid` args (defaults: SOL-PERP, 12, false)
  - Orchestrate: fetch all three data sources → print date range + record counts → `alignDataSeries` → `simulate` → `computeMetrics` → print PASS/FAIL output
  - When `--grid`: call `runGridSearch` and print summary table to stdout
  - Exit with code 1 if any data source returns zero records
  - Read default strategy params from `config/drift.ts` (`shortPerpSizeRatio`, `bufferRatio`, `rebalanceThresholdPct`, `minMarginHealthRatio`)
  - [x] 12.1 Implement `backtest/run-backtest.ts` with full orchestration logic
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2, 8.3_
  - [ ]* 12.2 Write unit tests for CLI argument parsing defaults and overrides
    - Assert default values applied when args omitted; assert overrides applied when args provided
    - _Requirements: 7.1_
    - File: `backtest/__tests__/run-backtest.test.ts`

- [x] 13. Final checkpoint — full integration validation
  - Ensure all tests pass: `pnpm backtest:test`
  - Verify `backtest/run-backtest.ts` can be invoked via `pnpm ts-node backtest/run-backtest.ts --help` without runtime errors
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each property test must run a minimum of 100 `fast-check` iterations (`{ numRuns: 100 }`)
- Each property test must include a comment: `// Feature: delta-neutral-backtest, Property N: <title>`
- Cache files are plain JSON arrays in `backtest/data/`; delete a file to force a refresh
- Results are written to `backtest/results/`; both directories are gitignored
- The toolkit has no runtime dependency on `@drift-labs/sdk` or `@solana/web3.js` — only `config/drift.ts` is imported for default params

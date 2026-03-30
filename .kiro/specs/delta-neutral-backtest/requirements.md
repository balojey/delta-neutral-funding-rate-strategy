# Requirements Document

## Introduction

The delta-neutral backtest feature is a standalone TypeScript simulation toolkit that measures the historical performance of the 50/40/10 delta-neutral funding rate strategy using real Drift Protocol mainnet data. It fetches and caches historical funding rates, USDC lending rates, and SOL/USD prices, then runs a tick-by-tick hourly simulation to compute blended APY, Sharpe ratio, max drawdown, rebalance frequency, and margin health behaviour. A parameter sensitivity grid search sweeps over key strategy parameters to identify the optimal configuration before mainnet deployment.

## Glossary

- **Simulator**: The core tick-by-tick hourly simulation engine that models NAV evolution over time
- **DataFetcher**: The set of modules responsible for fetching and caching historical market data from external APIs
- **MetricsCalculator**: The module that computes performance metrics (APY, Sharpe, drawdown, etc.) from a simulation run
- **GridSearch**: The module that sweeps a parameter grid and runs the Simulator for each combination
- **NAV**: Net Asset Value — the total value of the strategy position at a given tick (spot balance + buffer + unrealized P&L)
- **FundingRate**: The hourly rate paid between longs and shorts on a perpetual futures market; positive means longs pay shorts
- **LendingRate**: The annualised USDC spot lending rate on Drift Protocol at a given hour
- **ShortNotional**: The USD value of the short perpetual position, equal to short size in SOL multiplied by the current SOL/USD price
- **Delta**: The net directional exposure, computed as spot balance minus short notional
- **MarginHealth**: A proxy for margin safety, computed as (spot balance + buffer) / short notional
- **Drawdown**: The percentage decline from a peak NAV to a subsequent trough NAV
- **BlendedAPY**: The annualised return on initial capital, combining spot lending yield and funding rate income
- **SharpeRatio**: The ratio of mean daily NAV return to the standard deviation of daily NAV returns, annualised
- **RebalanceEvent**: A tick at which the absolute delta divided by NAV exceeds the rebalance threshold, triggering a notional adjustment
- **SOL-PERP**: The SOL perpetual futures market on Drift Protocol (market index 1)
- **BTC-PERP**: The BTC perpetual futures market on Drift Protocol (market index 2)

---

## Requirements

### Requirement 1: Fetch Historical Funding Rate Data

**User Story:** As a strategy analyst, I want to fetch and cache historical funding rate data from the Drift S3 bucket, so that the Simulator can replay real market conditions without repeated network calls.

#### Acceptance Criteria

1. WHEN the DataFetcher is invoked for a given market (SOL-PERP or BTC-PERP), THE DataFetcher SHALL download hourly funding rate records from `https://drift-historical-data-v2.s3.eu-west-1.amazonaws.com/program/dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH/market/{MARKET}/fundingRates`
2. WHEN the funding rate data file already exists in the local `backtest/data/` cache directory, THE DataFetcher SHALL load from the cache file without making a network request
3. WHEN the Drift S3 endpoint returns a non-200 HTTP status, THE DataFetcher SHALL throw an error containing the HTTP status code and the requested URL
4. THE DataFetcher SHALL parse the downloaded data into an array of records each containing: timestamp (Unix seconds), market name, and hourly funding rate as a decimal (e.g. 0.0001 = 0.01%)
5. WHEN the downloaded dataset contains records with missing or non-numeric funding rate values, THE DataFetcher SHALL skip those records and log the count of skipped records to stdout

---

### Requirement 2: Fetch Historical USDC Lending Rate Data

**User Story:** As a strategy analyst, I want to fetch and cache historical USDC spot lending rates from Drift Protocol, so that the Simulator can accurately model the spot yield component of the strategy.

#### Acceptance Criteria

1. WHEN the DataFetcher is invoked for USDC lending rates, THE DataFetcher SHALL retrieve hourly USDC spot lending rate snapshots covering the requested date range
2. WHEN the USDC lending rate data file already exists in the local `backtest/data/` cache directory, THE DataFetcher SHALL load from the cache file without making a network request
3. WHEN no lending rate data is available for a given hour, THE DataFetcher SHALL interpolate the rate from the nearest available surrounding data points
4. THE DataFetcher SHALL parse lending rate records into an array each containing: timestamp (Unix seconds) and annualised lending rate as a decimal (e.g. 0.05 = 5% APY)

---

### Requirement 3: Fetch Historical SOL/USD Price Data

**User Story:** As a strategy analyst, I want to fetch and cache historical SOL/USD prices, so that the Simulator can update short notional values and compute delta accurately at each tick.

#### Acceptance Criteria

1. WHEN the DataFetcher is invoked for SOL/USD prices, THE DataFetcher SHALL retrieve hourly OHLC price records from CoinGecko, Birdeye, or Pyth oracle history covering the requested date range
2. WHEN the price data file already exists in the local `backtest/data/` cache directory, THE DataFetcher SHALL load from the cache file without making a network request
3. WHEN the price API returns a rate-limit error (HTTP 429), THE DataFetcher SHALL retry the request after a 60-second delay for up to 3 attempts before throwing an error
4. THE DataFetcher SHALL parse price records into an array each containing: timestamp (Unix seconds) and close price in USD as a number
5. WHEN price data has gaps larger than 2 consecutive hours, THE DataFetcher SHALL log a warning to stdout identifying the gap start time and duration

---

### Requirement 4: Tick-by-Tick Hourly Simulation

**User Story:** As a strategy analyst, I want to run a tick-by-tick hourly simulation of the strategy NAV, so that I can measure how the strategy would have performed under real historical market conditions.

#### Acceptance Criteria

1. THE Simulator SHALL accept as inputs: initial USDC capital, shortPerpSizeRatio, bufferRatio, rebalanceThresholdPct, minMarginHealthRatio, market name, and aligned arrays of hourly funding rates, lending rates, and SOL/USD prices
2. WHEN the Simulator is initialised, THE Simulator SHALL set spot balance to `initialCapital * (1 - shortPerpSizeRatio - bufferRatio)`, short notional to `initialCapital * shortPerpSizeRatio`, and buffer to `initialCapital * bufferRatio`
3. WHEN processing each hourly tick, THE Simulator SHALL accrue spot yield by adding `spotBalance * (lendingRate / 8760)` to the spot balance
4. WHEN the hourly funding rate is positive at a given tick, THE Simulator SHALL add `shortNotional * fundingRate` to the spot balance (longs pay shorts — strategy receives)
5. WHEN the hourly funding rate is negative at a given tick, THE Simulator SHALL deduct `abs(shortNotional * fundingRate)` from the buffer first; IF the buffer is exhausted, THE Simulator SHALL deduct the remainder from the spot balance
6. WHEN processing each hourly tick, THE Simulator SHALL update short notional to `shortSizeInSol * currentSolPrice` to reflect mark-to-market price changes
7. WHEN `abs(delta) / nav` exceeds `rebalanceThresholdPct / 100` at a given tick, THE Simulator SHALL record a RebalanceEvent and adjust short notional toward spot balance to restore delta neutrality
8. WHEN margin health falls below 1.2 at a given tick, THE Simulator SHALL halve the short notional to simulate a reduce-only emergency deleveraging and record a margin health breach event
9. WHEN processing each hourly tick, THE Simulator SHALL compute NAV as `spotBalance + buffer + unrealizedPnl` where unrealized P&L is the mark-to-market gain or loss on the short position since entry
10. THE Simulator SHALL return a time-series array of per-tick state snapshots each containing: timestamp, NAV, spot balance, buffer, short notional, delta, margin health, funding payment, and rebalance flag

---

### Requirement 5: Performance Metrics Calculation

**User Story:** As a strategy analyst, I want to compute standardised performance metrics from a simulation run, so that I can objectively compare strategy configurations and assess risk-adjusted returns.

#### Acceptance Criteria

1. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL compute blended APY as `((finalNAV / initialNAV) ^ (8760 / totalHours) - 1) * 100` expressed as a percentage
2. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL compute the Sharpe ratio as `(meanDailyReturn / stdDevDailyReturn) * sqrt(365)` using daily NAV changes
3. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL compute max drawdown as the largest percentage decline from any peak NAV to any subsequent trough NAV within the simulation window
4. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL count the total number of RebalanceEvents recorded by the Simulator
5. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL count the total number of hours where the funding rate was negative (strategy paid funding)
6. WHEN given a time-series of NAV snapshots, THE MetricsCalculator SHALL count the total number of ticks where margin health fell below 1.5 and separately below 1.2
7. WHEN the simulation window contains fewer than 168 hourly ticks (7 days), THE MetricsCalculator SHALL return an error indicating insufficient data for reliable metric computation

---

### Requirement 6: Parameter Sensitivity Grid Search

**User Story:** As a strategy analyst, I want to run the backtest across a grid of parameter combinations, so that I can identify the configuration that maximises risk-adjusted returns while staying within margin safety bounds.

#### Acceptance Criteria

1. THE GridSearch SHALL sweep the following parameter axes: `shortPerpSizeRatio` in [0.25, 0.30, 0.35, 0.40, 0.45, 0.50], `rebalanceThresholdPct` in [1, 2, 3, 5], `minMarginHealthRatio` in [1.3, 1.5, 1.8, 2.0], and market in [SOL-PERP, BTC-PERP]
2. WHEN running the grid search, THE GridSearch SHALL execute one Simulator run per parameter combination using the same historical dataset
3. WHEN all grid search runs are complete, THE GridSearch SHALL write results to `backtest/results/grid-search-results.csv` with one row per parameter combination containing all output metrics
4. WHEN all grid search runs are complete, THE GridSearch SHALL write a summary JSON to `backtest/results/grid-search-summary.json` identifying the top 5 parameter combinations ranked by blended APY subject to max drawdown < 10% and zero margin health breaches below 1.2
5. WHEN a grid search run throws an error for a specific parameter combination, THE GridSearch SHALL log the error and continue with the remaining combinations without halting the entire sweep

---

### Requirement 7: Backtest Entry Point and CLI

**User Story:** As a strategy analyst, I want a single entry point script that orchestrates data fetching, simulation, and reporting, so that I can run the full backtest with a single command.

#### Acceptance Criteria

1. THE Simulator entry point (`backtest/run-backtest.ts`) SHALL accept command-line arguments for: `--market` (SOL-PERP or BTC-PERP, default SOL-PERP), `--months` (lookback window in months, default 12), `--grid` (boolean flag to run grid search instead of single run)
2. WHEN `--grid` is not specified, THE entry point SHALL run a single simulation using the parameter values from `config/drift.ts` and print the metrics summary to stdout
3. WHEN `--grid` is specified, THE entry point SHALL run the full GridSearch sweep and print a summary table to stdout upon completion
4. WHEN data fetching completes, THE entry point SHALL print the date range and record count for each fetched dataset to stdout before starting the simulation
5. IF any required data source returns no records for the requested date range, THEN THE entry point SHALL exit with a non-zero status code and a descriptive error message

---

### Requirement 8: Pass Criteria Validation

**User Story:** As a strategy analyst, I want the backtest to automatically validate results against the go/no-go pass criteria, so that I get a clear pass or fail signal without manually inspecting every metric.

#### Acceptance Criteria

1. WHEN a simulation run completes, THE MetricsCalculator SHALL evaluate: blended APY > 15%, max drawdown < 10%, and zero margin health breaches below 1.2
2. WHEN all three pass criteria are met, THE entry point SHALL print "PASS: Strategy meets all go/no-go criteria" to stdout
3. WHEN one or more pass criteria are not met, THE entry point SHALL print "FAIL: [list of failed criteria with actual values]" to stdout
4. WHEN the worst 30-day rolling window within the simulation is identified, THE MetricsCalculator SHALL compute the APY for that window and verify it is positive; IF it is not positive, THE entry point SHALL include "worst 30-day window APY is negative" in the FAIL output

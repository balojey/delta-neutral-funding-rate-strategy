# Requirements Document

## Introduction

This feature implements a Delta-Neutral Funding Rate Harvesting Strategy as a new Voltr vault configuration on Solana. The vault deploys USDC capital into Drift Protocol in a delta-neutral configuration: 50% to Drift spot market USDC lending, 40% as margin for a short perpetual futures position (SOL-PERP or BTC-PERP), and 10% held as a liquid buffer. Yield is generated from two sources simultaneously — perpetual funding rate payments collected by the short leg, and USDC lending interest on the spot deposit. Four new manager scripts handle the perp lifecycle (open, rebalance, compound, close), and new config values in `config/drift.ts` drive all operational parameters.

Target blended APY: 18–40% depending on market conditions, with 25% reliably achievable in neutral-to-bull markets.

## Glossary

- **Vault**: The Voltr on-chain yield vault accepting USDC and issuing LP tokens to depositors.
- **Strategy**: The `drift_user` adaptor PDA registered against the vault, initialized with `enableMarginTrading: true`.
- **DriftClient**: The `@drift-labs/sdk` `DriftClient` instance used to build remaining accounts and submit perp instructions.
- **VaultStrategyAuth**: The PDA authority derived by `VoltrClient.findVaultStrategyAddresses` that owns the Drift sub-account.
- **Short_Perp_Position**: The short perpetual futures position (SOL-PERP primary, BTC-PERP secondary) held inside the Drift cross-margin sub-account.
- **Spot_Deposit**: The USDC balance deposited into Drift's spot market (market index 0) that earns lending yield.
- **Funding_Rate**: The hourly payment rate on Drift perpetual markets; positive means longs pay shorts.
- **Delta**: The net directional price exposure of the vault, defined as `spot_notional − abs(short_perp_notional)`.
- **Margin_Health_Ratio**: Drift's account health metric; values below 1.0 trigger liquidation.
- **Buffer**: The liquid USDC portion (10% of NAV) held outside Drift to cover negative funding periods and margin top-ups.
- **Manager**: The keypair loaded from `MANAGER_FILE_PATH` that acts as delegatee on the Drift sub-account.
- **NAV**: Net Asset Value of the vault, equal to the sum of spot deposit value, unrealized perp P&L, and buffer balance.
- **LUT**: Address Lookup Table used to compress large account sets into versioned transactions.
- **sendAndConfirmOptimisedTx**: The shared utility in `src/utils/helper.ts` used by all scripts to simulate, price, and confirm transactions.

## Requirements

### Requirement 1: Drift Constants Extension

**User Story:** As a manager, I want SOL-PERP and BTC-PERP market constants available in `src/constants/drift.ts`, so that scripts can reference perp market indices without hardcoding values.

#### Acceptance Criteria

1. THE `src/constants/drift.ts` module SHALL export a `DRIFT.PERP` namespace containing at minimum `SOL` and `BTC` entries, each with a `MARKET_INDEX` numeric field.
2. THE `src/constants/drift.ts` module SHALL export a `DRIFT.PERP.SOL.MARKET_INDEX` value equal to the Drift Protocol SOL-PERP market index (1).
3. THE `src/constants/drift.ts` module SHALL export a `DRIFT.PERP.BTC.MARKET_INDEX` value equal to the Drift Protocol BTC-PERP market index (2).
4. WHEN a script imports `DRIFT` from `src/constants/drift.ts`, THE script SHALL be able to reference `DRIFT.PERP.SOL.MARKET_INDEX` and `DRIFT.PERP.BTC.MARKET_INDEX` without TypeScript compilation errors.

---

### Requirement 2: Configuration Parameters

**User Story:** As a manager, I want all strategy operational parameters defined in `config/drift.ts`, so that I can tune the strategy without modifying script source code.

#### Acceptance Criteria

1. THE `config/drift.ts` module SHALL export a `perpMarketIndex` value referencing `DRIFT.PERP.SOL.MARKET_INDEX` as the default perp market.
2. THE `config/drift.ts` module SHALL export a `shortPerpSizeRatio` numeric constant equal to `0.40`, representing the fraction of vault NAV to deploy as the short perp notional.
3. THE `config/drift.ts` module SHALL export a `bufferRatio` numeric constant equal to `0.10`, representing the fraction of vault NAV to retain as liquid USDC.
4. THE `config/drift.ts` module SHALL export a `rebalanceThresholdPct` numeric constant equal to `2`, representing the delta deviation percentage that triggers rebalancing.
5. THE `config/drift.ts` module SHALL export a `minMarginHealthRatio` numeric constant equal to `1.5`, representing the margin health floor below which de-risking is triggered.
6. THE `config/drift.ts` module SHALL export a `perpOrderSize` BN value representing the base order size (in the perp market's base asset units with appropriate decimals) used when opening or adjusting the short position.
7. WHEN `config/drift.ts` is imported, THE TypeScript compiler SHALL resolve all references to `DRIFT.PERP.*` without errors, requiring the constants extension in Requirement 1 to be present.

---

### Requirement 3: Open Short Perpetual Position (`manager-open-short-perp.ts`)

**User Story:** As a manager, I want a script that opens or adjusts a short perpetual position on Drift, so that the vault can begin collecting funding rate payments.

#### Acceptance Criteria

1. WHEN `manager-open-short-perp.ts` is executed, THE script SHALL load the manager keypair from `MANAGER_FILE_PATH` and the RPC URL from `HELIUS_RPC_URL`.
2. WHEN `manager-open-short-perp.ts` is executed, THE script SHALL read `perpMarketIndex` and `perpOrderSize` from `config/drift.ts` to determine the target market and position size.
3. WHEN `manager-open-short-perp.ts` is executed, THE script SHALL construct a Drift `placeAndTakePerpOrder` instruction for a short position using the `DriftClient` with `direction: PositionDirection.SHORT`.
4. WHEN the Drift instruction is constructed, THE script SHALL use `DriftClient.getRemainingAccounts` with `writablePerpMarketIndexes` set to `[perpMarketIndex]` to populate remaining accounts.
5. WHEN the transaction is submitted, THE script SHALL call `sendAndConfirmOptimisedTx` from `src/utils/helper.ts` with the LUT accounts derived from `lookupTableAddress` and `DRIFT.LOOKUP_TABLE_ADDRESSES` when `useLookupTable` is `true`.
6. WHEN the transaction confirms, THE script SHALL log the transaction signature to stdout.
7. IF the transaction simulation fails, THEN THE script SHALL throw an error with a descriptive message before attempting to send.

---

### Requirement 4: Rebalance Delta (`manager-rebalance-delta.ts`)

**User Story:** As a manager, I want a script that rebalances the short perp notional to match the spot deposit notional, so that the vault maintains delta neutrality within the configured threshold.

#### Acceptance Criteria

1. WHEN `manager-rebalance-delta.ts` is executed, THE script SHALL fetch the current Drift sub-account state for `VaultStrategyAuth` using `DriftClient`.
2. WHEN the sub-account state is fetched, THE script SHALL compute `current_delta` as `spot_notional − abs(short_perp_notional)` using on-chain position data.
3. WHEN `abs(current_delta / total_nav) > rebalanceThresholdPct / 100`, THE script SHALL construct and submit a Drift perp order instruction to adjust the short position size toward delta zero.
4. WHEN `abs(current_delta / total_nav) <= rebalanceThresholdPct / 100`, THE script SHALL log that no rebalance is needed and exit without submitting a transaction.
5. WHEN a rebalance transaction is submitted, THE script SHALL use `sendAndConfirmOptimisedTx` with the appropriate LUT accounts.
6. WHEN the rebalance transaction confirms, THE script SHALL log the new delta and transaction signature to stdout.
7. IF the margin health ratio is below `minMarginHealthRatio` at the time of execution, THEN THE script SHALL log a warning and reduce the short position size rather than increasing it, regardless of delta direction.

---

### Requirement 5: Compound Yield (`manager-compound-yield.ts`)

**User Story:** As a manager, I want a script that withdraws accrued funding and lending yield from the Drift account and re-deposits it into the strategy, so that the position size grows over time and compounds returns.

#### Acceptance Criteria

1. WHEN `manager-compound-yield.ts` is executed, THE script SHALL compute the withdrawable yield as the Drift account's free collateral above the amount required to maintain the current short position at `minMarginHealthRatio`.
2. WHEN withdrawable yield is greater than zero, THE script SHALL call the existing `manager-withdraw-user.ts` logic (or equivalent withdraw instruction) to move yield USDC back to the vault.
3. WHEN the withdrawal confirms, THE script SHALL call the existing `manager-deposit-user.ts` logic (or equivalent deposit instruction) to re-deposit the withdrawn amount into the Drift spot market.
4. WHEN both the withdrawal and re-deposit confirm, THE script SHALL log the compounded amount and both transaction signatures to stdout.
5. IF withdrawable yield is zero or negative, THEN THE script SHALL log that no compounding is available and exit without submitting any transaction.
6. WHEN `manager-compound-yield.ts` is executed, THE script SHALL use `sendAndConfirmOptimisedTx` for all on-chain transactions.

---

### Requirement 6: Close Short Perpetual Position (`manager-close-short-perp.ts`)

**User Story:** As a manager, I want a script that gracefully closes the short perpetual position before a full vault withdrawal, so that the vault can return to a fully liquid USDC state.

#### Acceptance Criteria

1. WHEN `manager-close-short-perp.ts` is executed, THE script SHALL fetch the current short perp position size from the Drift sub-account for `VaultStrategyAuth`.
2. WHEN a non-zero short position exists, THE script SHALL construct a Drift `placeAndTakePerpOrder` instruction with `direction: PositionDirection.LONG` and a size equal to the current short position to fully close it.
3. WHEN the close instruction is constructed, THE script SHALL use `DriftClient.getRemainingAccounts` with `writablePerpMarketIndexes` set to `[perpMarketIndex]`.
4. WHEN the transaction is submitted, THE script SHALL use `sendAndConfirmOptimisedTx` with the appropriate LUT accounts.
5. WHEN the close transaction confirms, THE script SHALL log the closed position size and transaction signature to stdout.
6. IF no open short position exists, THEN THE script SHALL log that there is no position to close and exit without submitting a transaction.

---

### Requirement 7: Margin Health Monitoring

**User Story:** As a manager, I want the rebalance and compound scripts to check the margin health ratio before acting, so that the vault never approaches liquidation during automated operations.

#### Acceptance Criteria

1. WHEN `manager-rebalance-delta.ts` or `manager-compound-yield.ts` fetches the Drift sub-account, THE script SHALL read the margin health ratio from the account data.
2. WHEN the margin health ratio is below `minMarginHealthRatio` (1.5), THE script SHALL not increase the short position size.
3. WHEN the margin health ratio is below `1.2`, THE script SHALL construct and submit a reduce-only order to decrease the short position size by 50%, regardless of current delta.
4. WHEN a margin-triggered reduction is submitted, THE script SHALL log a warning including the current health ratio and the action taken.
5. IF the margin health ratio cannot be read from the sub-account, THEN THE script SHALL throw an error and halt execution rather than proceeding with an unknown health state.

---

### Requirement 8: Round-Trip Position Lifecycle

**User Story:** As a manager, I want the four new scripts to form a complete and reversible position lifecycle, so that the vault can be fully opened and fully closed without residual on-chain state.

#### Acceptance Criteria

1. THE four scripts (`manager-open-short-perp.ts`, `manager-rebalance-delta.ts`, `manager-compound-yield.ts`, `manager-close-short-perp.ts`) SHALL be executable in sequence without requiring manual on-chain state cleanup between steps.
2. WHEN `manager-open-short-perp.ts` is followed by `manager-close-short-perp.ts` with no intervening price change, THE resulting Drift sub-account SHALL have zero open perp positions.
3. WHEN `manager-compound-yield.ts` is executed multiple times in sequence, THE script SHALL produce the same outcome as executing it once if no new yield has accrued between executions (idempotent with respect to zero-yield state).
4. FOR ALL valid vault states, executing `manager-close-short-perp.ts` followed by `manager-withdraw-user.ts` SHALL leave the vault in a fully liquid USDC state with no open Drift positions.

---

### Requirement 9: Transaction Construction Standards

**User Story:** As a developer, I want all new scripts to follow the existing transaction construction conventions, so that the codebase remains consistent and maintainable.

#### Acceptance Criteria

1. THE four new scripts SHALL each load keypairs exclusively from `MANAGER_FILE_PATH` via `process.env` and the RPC URL from `HELIUS_RPC_URL`.
2. THE four new scripts SHALL read all operational parameters from `config/base.ts` and `config/drift.ts` and SHALL NOT hardcode any addresses, amounts, or market indices.
3. THE four new scripts SHALL use `VersionedTransaction` with `TransactionMessage.compileToV0Message` for all on-chain submissions.
4. THE four new scripts SHALL call `sendAndConfirmOptimisedTx` from `src/utils/helper.ts` for every transaction submission.
5. WHEN `useLookupTable` is `true` in `config/base.ts`, THE four new scripts SHALL pass the combined LUT addresses (`DRIFT.LOOKUP_TABLE_ADDRESSES` and `lookupTableAddress`) to `getAddressLookupTableAccounts` before building the versioned transaction.
6. THE four new scripts SHALL follow the `{role}-{action}.ts` naming convention and be placed in `src/scripts/`.

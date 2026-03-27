# Implementation Plan: Delta-Neutral Funding Rate Strategy

## Overview

Extend the existing Voltr vault scripting toolkit with perp constants, config parameters, and four new manager scripts that implement the full delta-neutral funding rate harvesting lifecycle on Drift Protocol.

## Tasks

- [x] 1. Extend `src/constants/drift.ts` with PERP namespace
  - Add `PERP` key to the existing `DRIFT` object with `SOL: { MARKET_INDEX: 1 }` and `BTC: { MARKET_INDEX: 2 }` entries
  - Ensure no existing fields are modified or removed
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.1 Write property test for PERP namespace completeness
    - **Property 1: PERP namespace is structurally complete**
    - Assert `DRIFT.PERP.SOL.MARKET_INDEX === 1` and `DRIFT.PERP.BTC.MARKET_INDEX === 2`
    - Assert both values are of type `number`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 2. Extend `config/drift.ts` with perp strategy parameters
  - Add `import { BN } from "@coral-xyz/anchor"` if not already present
  - Export `perpMarketIndex = DRIFT.PERP.SOL.MARKET_INDEX`
  - Export `shortPerpSizeRatio = 0.40`
  - Export `bufferRatio = 0.10`
  - Export `rebalanceThresholdPct = 2`
  - Export `minMarginHealthRatio = 1.5`
  - Export `perpOrderSize = new BN(1_000_000_000)` (1 SOL in 9-decimal base units)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 2.1 Write property test for config type correctness
    - **Property 2: Config exports are type-correct and reference PERP constants**
    - Assert `perpMarketIndex === DRIFT.PERP.SOL.MARKET_INDEX`
    - Assert `shortPerpSizeRatio === 0.40`, `bufferRatio === 0.10`, `rebalanceThresholdPct === 2`, `minMarginHealthRatio === 1.5`
    - Assert `perpOrderSize` is a `BN` instance with value `> 0`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

- [x] 3. Checkpoint — Ensure constants and config compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement `src/scripts/manager-open-short-perp.ts`
  - [x] 4.1 Scaffold the script with keypair loading and PDA derivation
    - Load `payerKp` from `MANAGER_FILE_PATH` and RPC from `HELIUS_RPC_URL`
    - Derive `strategy` PDA: `[Buffer.from("drift_user"), ADAPTOR_PROGRAM_ID]`
    - Derive `vaultStrategyAuth` via `vc.findVaultStrategyAddresses(vault, strategy)`
    - Derive `user` PDA: `[Buffer.from("user"), vaultStrategyAuth, subAccountId (le2)]`
    - Derive `userStats` PDA: `[Buffer.from("user_stats"), vaultStrategyAuth]`
    - _Requirements: 3.1, 9.1, 9.2_

  - [x] 4.2 Build and submit the `placeAndTakePerpOrder` SHORT instruction
    - Create `DriftClient`, subscribe, fetch `userAccounts` for `vaultStrategyAuth`
    - Build `orderParams` with `OrderType.MARKET`, `PositionDirection.SHORT`, `baseAssetAmount: perpOrderSize`, `marketIndex: perpMarketIndex`
    - Get instruction via `driftClient.getPlaceAndTakePerpOrderIx(orderParams, subAccountId)`
    - Build `remainingAccounts` via `driftClient.getRemainingAccounts({ userAccounts, writablePerpMarketIndexes: [perpMarketIndex] })`
    - Call `driftClient.unsubscribe()` in a `finally` block
    - Resolve LUT accounts and call `sendAndConfirmOptimisedTx`
    - Log transaction signature to stdout
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 9.3, 9.4, 9.5_

- [x] 5. Implement `src/scripts/manager-close-short-perp.ts`
  - [x] 5.1 Scaffold the script and read current short position
    - Load keypair and derive PDAs (same pattern as task 4.1)
    - Create `DriftClient`, subscribe
    - Fetch `user` via `driftClient.getUser(subAccountId, vaultStrategyAuth)`
    - Read `perpPosition = user.getPerpPosition(perpMarketIndex)`
    - If `perpPosition` is null or `baseAssetAmount.isZero()`, log "no open position" and exit cleanly
    - _Requirements: 6.1, 6.6, 9.1, 9.2_

  - [x] 5.2 Build and submit the closing LONG instruction
    - Compute `closeSize = perpPosition.baseAssetAmount.abs()`
    - Build `orderParams` with `OrderType.MARKET`, `PositionDirection.LONG`, `baseAssetAmount: closeSize`, `marketIndex: perpMarketIndex`, `reduceOnly: true`
    - Get instruction via `driftClient.getPlaceAndTakePerpOrderIx(orderParams, subAccountId)`
    - Build `remainingAccounts` via `driftClient.getRemainingAccounts({ writablePerpMarketIndexes: [perpMarketIndex] })`
    - Call `driftClient.unsubscribe()` in a `finally` block
    - Resolve LUT accounts and call `sendAndConfirmOptimisedTx`
    - Log closed position size and transaction signature
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 9.3, 9.4, 9.5_

  - [ ]* 5.3 Write property test for close no-op on empty position
    - **Property 9: Close is a no-op when no position exists**
    - Generate null and zero `baseAssetAmount` perp position values
    - Assert `shouldSubmitClose(position) === false` for all such inputs
    - **Validates: Requirements 6.6**

- [x] 6. Checkpoint — Ensure open and close scripts are wired correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement `src/scripts/manager-rebalance-delta.ts`
  - [x] 7.1 Scaffold the script, fetch sub-account state, and check margin health
    - Load keypair and derive PDAs (same pattern as task 4.1)
    - Create `DriftClient`, subscribe
    - Fetch `user` via `driftClient.getUser(subAccountId, vaultStrategyAuth)`
    - Read `healthRatio = user.getHealth() / 100`; if unreadable, throw with descriptive message and halt
    - If `healthRatio < 1.2`: build a reduce-only order for 50% of current short size, submit, log warning with health ratio, exit
    - _Requirements: 4.1, 7.1, 7.3, 7.4, 7.5_

  - [x] 7.2 Compute delta and decide rebalance direction
    - Read `perpPosition = user.getPerpPosition(perpMarketIndex)` and `spotPosition = user.getSpotPosition(DRIFT.SPOT.USDC.MARKET_INDEX)` (market index 0)
    - Compute `spot_notional`, `perp_notional`, `current_delta = spot_notional - perp_notional`
    - Compute `delta_pct = abs(current_delta) / total_nav` (use `user.getFreeCollateral()` as conservative `total_nav` proxy)
    - If `delta_pct <= rebalanceThresholdPct / 100`, log "no rebalance needed" and exit without submitting
    - If `healthRatio < minMarginHealthRatio` and delta requires increasing the short, log warning and exit without submitting
    - _Requirements: 4.2, 4.3, 4.4, 4.7, 7.2_

  - [x] 7.3 Build and submit the rebalance perp order
    - Compute adjustment size and direction (SHORT to increase, LONG to reduce)
    - Build `orderParams` and get instruction via `driftClient.getPlaceAndTakePerpOrderIx`
    - Build `remainingAccounts` via `driftClient.getRemainingAccounts({ writablePerpMarketIndexes: [perpMarketIndex] })`
    - Call `driftClient.unsubscribe()` in a `finally` block
    - Resolve LUT accounts and call `sendAndConfirmOptimisedTx`
    - Log new delta and transaction signature
    - _Requirements: 4.3, 4.5, 4.6, 9.3, 9.4, 9.5_

  - [ ]* 7.4 Write property test for delta threshold branching
    - **Property 3: Delta computation is consistent with position data**
    - Generate arbitrary positive `spot_notional`, `perp_notional`, `total_nav` values using `fast-check`
    - Assert `shouldRebalance(spot, perp, nav) === (Math.abs(spot - Math.abs(perp)) / nav > 0.02)`
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [ ]* 7.5 Write property test for health suppressing short increase
    - **Property 4: Rebalance is suppressed when health is below floor**
    - Generate health values in `[0.0, 1.5)` and delta values requiring short increase
    - Assert `shouldIncreaseShort(health, delta) === false` for all such inputs
    - **Validates: Requirements 4.7, 7.2**

  - [ ]* 7.6 Write property test for critical health triggering reduce-only
    - **Property 5: Critical health triggers reduce-only order**
    - Generate health values in `[0.0, 1.2)` and arbitrary non-zero position sizes
    - Assert `getAction(health, positionSize)` returns `{ type: "reduce", size: positionSize * 0.5, reduceOnly: true }`
    - **Validates: Requirements 7.3, 7.4**

  - [ ]* 7.7 Write property test for health unreadable halting execution
    - **Property 10: Health unreadable halts execution**
    - Mock `DriftClient` to throw on `getHealth()`
    - Assert the script throws before any instruction is built
    - **Validates: Requirements 7.5**

- [x] 8. Implement `src/scripts/manager-compound-yield.ts`
  - [x] 8.1 Scaffold the script and compute withdrawable yield
    - Load keypair and derive PDAs (same pattern as task 4.1)
    - Create `DriftClient`, subscribe
    - Fetch `user` via `driftClient.getUser(subAccountId, vaultStrategyAuth)`
    - Read `healthRatio`; if unreadable, throw with descriptive message and halt
    - Compute `freeCollateral = user.getFreeCollateral()`
    - Compute `required_margin` from current short notional and `minMarginHealthRatio`
    - Compute `withdrawable = freeCollateral - required_margin`
    - If `withdrawable <= 0`, log "no yield available to compound" and exit with code 0
    - _Requirements: 5.1, 5.5, 7.1, 7.5_

  - [x] 8.2 Build and submit the withdraw instruction
    - Build withdraw instruction using the same pattern as `manager-withdraw-user.ts` (inline, not imported)
    - Use `withdrawable` as the withdraw amount
    - Resolve LUT accounts and call `sendAndConfirmOptimisedTx`
    - Log withdraw transaction signature
    - _Requirements: 5.2, 5.6, 9.3, 9.4, 9.5_

  - [x] 8.3 Build and submit the re-deposit instruction
    - Build deposit instruction using the same pattern as `manager-deposit-user.ts` (inline, not imported)
    - Use `withdrawable` as the deposit amount
    - Resolve LUT accounts and call `sendAndConfirmOptimisedTx`
    - Call `driftClient.unsubscribe()` in a `finally` block
    - Log compounded amount and both transaction signatures
    - _Requirements: 5.3, 5.4, 5.6, 9.3, 9.4, 9.5_

  - [ ]* 8.4 Write property test for compound yield non-negative guard
    - **Property 6: Compound yield is non-negative**
    - Generate arbitrary `freeCollateral` and `required_margin` BN values using `fast-check`
    - Assert `computeWithdrawable(fc, rm) > 0` iff `fc > rm`; if `<= 0`, no transaction is submitted
    - **Validates: Requirements 5.1, 5.5**

  - [ ]* 8.5 Write property test for compound idempotence under zero-yield state
    - **Property 7: Compound is idempotent under zero-yield state**
    - Generate account states where `freeCollateral <= required_margin`
    - Assert calling compound logic twice produces the same result as once (no state change, no tx submitted)
    - **Validates: Requirements 8.3**

- [x] 9. Final checkpoint — Ensure all tests pass and scripts are wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` (TypeScript PBT library); install with `pnpm add -D fast-check` if not present
- Each script follows the standalone, self-contained pattern — no cross-script imports
- All four scripts call `driftClient.unsubscribe()` in a `finally` block to prevent hanging WebSocket connections
- `perpOrderSize` in `config/drift.ts` must be adjusted by the operator before running open/rebalance scripts (1 SOL default)
- LUT resolution: when `useLookupTable` is true, pass `[...DRIFT.LOOKUP_TABLE_ADDRESSES, lookupTableAddress]`; otherwise pass `[...DRIFT.LOOKUP_TABLE_ADDRESSES]`

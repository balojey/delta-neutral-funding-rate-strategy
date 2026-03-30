# Implementation Plan: Devnet Integration Testing

## Overview

Minimal changes to make the full 8-step delta-neutral strategy lifecycle runnable against Drift devnet: add a devnet config file, add `driftEnv` to the base config, update six manager scripts to import `driftEnv` instead of hardcoding `"mainnet-beta"`, and verify the four pure helper functions are correctly exported and unit-testable.

## Tasks

- [x] 1. Add `driftEnv` export to `config/base.ts`
  - Import `DriftEnv` from `@drift-labs/sdk`
  - Add `export const driftEnv: DriftEnv = "mainnet-beta"` to `config/base.ts`
  - _Requirements: 2.3_

- [x] 2. Create `config/devnet.ts` with devnet-specific Drift constants
  - Export `driftEnv: DriftEnv = "devnet"`
  - Export `DRIFT_DEVNET` object with `PROGRAM_ID`, `SPOT.STATE`, `LOOKUP_TABLE_ADDRESSES`, and oracle addresses matching devnet values
  - Add comment documenting the devnet USDC mint address and the required `assetMintAddress` value for `config/base.ts`
  - Add comments with airdrop commands for Admin, Manager, and User keypairs
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3_

- [x] 3. Update manager scripts to import `driftEnv` from config
  - [x] 3.1 Update `src/scripts/manager-open-short-perp.ts`
    - Add `import { driftEnv } from "../../config/base"` (replacing hardcoded `"mainnet-beta"`)
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Update `src/scripts/manager-close-short-perp.ts`
    - Add `import { driftEnv } from "../../config/base"`
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Update `src/scripts/manager-rebalance-delta.ts`
    - Add `import { driftEnv } from "../../config/base"`
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Update `src/scripts/manager-compound-yield.ts`
    - Add `import { driftEnv } from "../../config/base"`
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

  - [x] 3.5 Update `src/scripts/manager-deposit-user.ts`
    - Add `import { driftEnv } from "../../config/base"`
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

  - [x] 3.6 Update `src/scripts/manager-withdraw-user.ts`
    - Add `import { driftEnv } from "../../config/base"`
    - Pass `env: driftEnv` to the `DriftClient` constructor
    - _Requirements: 2.1, 2.2_

- [x] 4. Verify and test pure helper exports
  - [x] 4.1 Verify `shouldSubmitClose` is exported from `manager-close-short-perp.ts`
    - Confirm the function signature: `(perpPosition: { baseAssetAmount: BN } | null | undefined) => boolean`
    - Confirm it returns `false` for `null`, `false` for `baseAssetAmount` of zero, and `true` for non-zero
    - _Requirements: 9.3, 11.3, 11.4, 11.5_

  - [ ]* 4.2 Write unit tests for `shouldSubmitClose`
    - **Property 1: null position returns false** — `shouldSubmitClose(null) === false`
    - **Property 1: zero baseAssetAmount returns false** — `shouldSubmitClose({ baseAssetAmount: new BN(0) }) === false`
    - **Property 1: non-zero baseAssetAmount returns true** — `shouldSubmitClose({ baseAssetAmount: new BN(-1_000_000_000) }) === true`
    - **Validates: Requirements 9.3, 11.3, 11.4, 11.5**

  - [x] 4.3 Verify `shouldRebalance` is exported from `manager-rebalance-delta.ts`
    - Confirm the function signature: `(spotNotional: number, perpNotional: number, totalNav: number) => boolean`
    - Confirm equal spot and perp notional returns `false` for any positive `totalNav`
    - _Requirements: 7.1, 11.2_

  - [ ]* 4.4 Write unit tests for `shouldRebalance`
    - **Property 2: zero delta never triggers rebalance** — `shouldRebalance(x, x, totalNav) === false` for any `totalNav > 0`
    - **Validates: Requirements 7.1, 11.2**

  - [x] 4.5 Verify `computeWithdrawable` is exported from `manager-compound-yield.ts`
    - Confirm the function signature: `(freeCollateral: BN, requiredMargin: BN) => BN`
    - Confirm result is always `>= 0` (clamps to zero when `freeCollateral < requiredMargin`)
    - _Requirements: 8.1, 8.4_

  - [ ]* 4.6 Write unit tests for `computeWithdrawable`
    - **Property 3: never returns negative** — result is always `>= 0` for any BN inputs
    - Test: `computeWithdrawable(new BN(0), new BN(1_000)).isZero() === true`
    - Test: `computeWithdrawable(new BN(500), new BN(1_000)).isZero() === true`
    - Test: `computeWithdrawable(new BN(1_500), new BN(1_000)).eq(new BN(500)) === true`
    - **Validates: Requirements 8.1, 8.4**

  - [x] 4.7 Verify `getAction` is exported from `manager-rebalance-delta.ts`
    - Confirm the function signature: `(healthRatio: number, positionSize: number) => { type: "reduce"; size: number; reduceOnly: true } | null`
    - Confirm it returns a non-null reduce action for `healthRatio < 1.2` and `null` at exactly `1.2`
    - _Requirements: 7.3_

  - [ ]* 4.8 Write unit tests for `getAction`
    - **Property 4: health below 1.2 always returns reduce action** — `getAction(h, size) !== null` for any `h < 1.2` and `size > 0`
    - Test boundary: `getAction(1.2, 1_000_000_000) === null`
    - Test below: `getAction(1.19, 1_000_000_000) !== null`
    - **Validates: Requirements 7.3**

- [x] 5. Checkpoint — Ensure all types check and scripts are importable
  - Run `pnpm tsc --noEmit` to confirm no type errors across all modified files
  - Ensure all six manager scripts compile cleanly with the new `driftEnv` import
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- To run against devnet: swap the `driftEnv` import in each script from `../../config/base` to `../../config/devnet`, and update `assetMintAddress` in `config/base.ts` to the devnet USDC mint (documented in `config/devnet.ts`)
- No new scripts are required — all changes are config additions and import updates
- Property tests validate pure functions only; integration properties (idempotence of close/rebalance) are verified manually per the devnet checklist in `design.md`

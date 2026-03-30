# Design Document: Devnet Integration Testing

## Overview

This design covers the minimal set of changes needed to make the full 8-step delta-neutral strategy lifecycle runnable against Drift devnet. The existing scripts are structurally correct — the work is:

1. Add `config/devnet.ts` with devnet-specific Drift constants and a `driftEnv` export.
2. Add `driftEnv` to `config/base.ts` (mainnet default) so scripts can import it without conditional logic.
3. Update the four manager scripts that hardcode `env: "mainnet-beta"` to import `driftEnv` from config instead.

No new scripts are required. No existing script logic changes beyond the `env` field.

---

## Architecture

The project follows a flat script-per-operation pattern. There is no shared service layer — each script is self-contained and reads all config from `config/base.ts` and `config/drift.ts`. The design preserves this pattern exactly.

```
config/
  base.ts          ← add: export const driftEnv = "mainnet-beta"
  devnet.ts        ← new: devnet constants + driftEnv = "devnet"
  drift.ts         ← unchanged

src/scripts/
  manager-open-short-perp.ts     ← change: import driftEnv, pass to DriftClient
  manager-close-short-perp.ts    ← change: import driftEnv, pass to DriftClient
  manager-rebalance-delta.ts     ← change: import driftEnv, pass to DriftClient
  manager-compound-yield.ts      ← change: import driftEnv, pass to DriftClient
  manager-deposit-user.ts        ← change: import driftEnv, pass to DriftClient
  manager-withdraw-user.ts       ← change: import driftEnv, pass to DriftClient
```

---

## Component Design

### `config/devnet.ts`

A new config file that mirrors the shape of `config/drift.ts` and `src/constants/drift.ts` but with devnet values. Scripts switch between mainnet and devnet by changing which config they import — or more practically, by the developer swapping the import path before a devnet run.

The file also exports `driftEnv: DriftEnv = "devnet"` so the four manager scripts can pass the correct value to `DriftClient` without any runtime detection logic.

Key devnet values to populate:
- `DRIFT_DEVNET.PROGRAM_ID` — Drift devnet program ID
- `DRIFT_DEVNET.SPOT.STATE` — Drift devnet state account
- `DRIFT_DEVNET.LOOKUP_TABLE_ADDRESSES` — devnet LUT(s)
- `driftEnv` — `"devnet"`

The file includes comments for:
- Devnet USDC mint (to set as `assetMintAddress` in `config/base.ts`)
- Airdrop commands for Admin, Manager, User keypairs

### `config/base.ts` — `driftEnv` addition

Add a single export:
```typescript
import { DriftEnv } from "@drift-labs/sdk";
export const driftEnv: DriftEnv = "mainnet-beta";
```

This is the only change to `base.ts`. All four manager scripts import `driftEnv` from `../../config/base` (or `../../config/devnet` when testing on devnet).

### Manager scripts — `env` field

The four scripts that construct `DriftClient` currently hardcode `env: "mainnet-beta"`. Each is updated to:

```typescript
import { driftEnv } from "../../config/base";
// ...
const driftClient = new DriftClient({
  connection,
  wallet: new Wallet(payerKp),
  env: driftEnv,
  skipLoadUsers: true,
});
```

The same change applies to `manager-deposit-user.ts` and `manager-withdraw-user.ts` which also construct `DriftClient`.

---

## Data Flow

No data flow changes. The lifecycle sequence is unchanged:

```
admin-init-vault        → vault + LUT created
admin-add-adaptor       → adaptor registered
manager-init-user       → Drift sub-account created (enableMarginTrading: true)
user-deposit-vault      → USDC → vault
manager-deposit-user    → vault USDC → Drift spot
manager-open-short-perp → short SOL-PERP opened
query-strategy-positions → positionValue readable
manager-rebalance-delta → delta checked, order submitted or skipped
manager-compound-yield  → free collateral withdrawn + re-deposited, or skipped
manager-close-short-perp → short closed or skipped (idempotent)
manager-withdraw-user   → Drift USDC → vault
user-instant-withdraw-vault → vault USDC → user
```

---

## Correctness Properties

### Property 1: `shouldSubmitClose` — null position returns false

`shouldSubmitClose(null)` must return `false`. Verified by inspection of the exported pure function in `manager-close-short-perp.ts`.

```typescript
// Example
assert(shouldSubmitClose(null) === false);
assert(shouldSubmitClose({ baseAssetAmount: new BN(0) }) === false);
assert(shouldSubmitClose({ baseAssetAmount: new BN(-1_000_000_000) }) === true);
```

### Property 2: `shouldRebalance` — zero delta never triggers rebalance

For any `totalNav > 0`, `shouldRebalance(x, x, totalNav)` must return `false` (spot equals perp notional → delta is zero).

```typescript
// Example
assert(shouldRebalance(1_000_000, 1_000_000, 2_000_000) === false);
```

### Property 3: `computeWithdrawable` — never returns negative

`computeWithdrawable(freeCollateral, requiredMargin)` must always return a value `>= 0` regardless of inputs.

```typescript
// Property: for all BN inputs, result >= 0
assert(computeWithdrawable(new BN(0), new BN(1_000)).isZero());
assert(computeWithdrawable(new BN(500), new BN(1_000)).isZero());
assert(computeWithdrawable(new BN(1_500), new BN(1_000)).eq(new BN(500)));
```

### Property 4: `getAction` — health below 1.2 always returns reduce action

`getAction(h, size)` must return a non-null reduce action for any `h < 1.2` and any `size > 0`.

```typescript
// Example
assert(getAction(1.19, 1_000_000_000) !== null);
assert(getAction(1.2, 1_000_000_000) === null);  // boundary: 1.2 is not below threshold
```

### Property 5: Idempotence of close script (integration)

Running `manager-close-short-perp.ts` twice when no position exists must produce the same log output both times and submit zero transactions. This is verified manually during the devnet test run (Step 7 pass criteria).

### Property 6: Idempotence of rebalance script (integration)

Running `manager-rebalance-delta.ts` twice when delta is within threshold must produce the same log output both times and submit zero transactions. Verified manually during the devnet test run (Step 5 pass criteria).

---

## Error Handling

All scripts already propagate errors to the top-level `main()` call. No new error handling infrastructure is needed. The devnet-specific concern is that Drift devnet can be unstable — the testing plan recommends retrying failed RPC calls before concluding a code bug exists. This is handled operationally, not in code.

---

## Devnet Test Execution Checklist

This checklist is the operational companion to the requirements. It is not code — it documents the manual steps a developer follows to run Phase 1.

```
Pre-flight:
  [ ] config/base.ts: assetMintAddress = devnet USDC mint
  [ ] config/base.ts: vaultAddress = "" (will be filled after step 1)
  [ ] config/base.ts: lookupTableAddress = "" (will be filled after step 1)
  [ ] config/base.ts: driftEnv = "mainnet-beta"  ← swap import to config/devnet.ts in scripts
  [ ] HELIUS_RPC_URL = devnet endpoint
  [ ] Admin, Manager, User keypairs airdropped with devnet SOL

Step 1 — Init:
  [ ] pnpm ts-node src/scripts/admin-init-vault.ts
        → copy vault address → config/base.ts vaultAddress
        → copy LUT address  → config/base.ts lookupTableAddress
  [ ] pnpm ts-node src/scripts/admin-add-adaptor.ts
  [ ] pnpm ts-node src/scripts/manager-init-user.ts

Step 2 — Fund:
  [ ] pnpm ts-node src/scripts/user-deposit-vault.ts
  [ ] pnpm ts-node src/scripts/manager-deposit-user.ts

Step 3 — Open short:
  [ ] pnpm ts-node src/scripts/manager-open-short-perp.ts

Step 4 — Query:
  [ ] pnpm ts-node src/scripts/query-strategy-positions.ts
        → verify positionValue > 0

Step 5 — Rebalance:
  [ ] pnpm ts-node src/scripts/manager-rebalance-delta.ts
        → expect "No rebalance needed" or order confirmation

Step 6 — Compound:
  [ ] pnpm ts-node src/scripts/manager-compound-yield.ts
        → expect "No yield available to compound." on devnet

Step 7 — Close:
  [ ] pnpm ts-node src/scripts/manager-close-short-perp.ts
        → verify position closed
  [ ] pnpm ts-node src/scripts/manager-close-short-perp.ts  (run again)
        → verify "No open short position to close." (idempotence check)

Step 8 — Withdraw:
  [ ] pnpm ts-node src/scripts/manager-withdraw-user.ts
  [ ] pnpm ts-node src/scripts/user-instant-withdraw-vault.ts
        → verify user USDC balance restored
```

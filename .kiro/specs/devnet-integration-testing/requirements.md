# Requirements Document

## Introduction

This feature implements and validates a complete devnet integration test suite for the delta-neutral funding rate strategy. The suite exercises the full 8-step lifecycle of the strategy scripts against Drift devnet: vault and strategy initialization, funding, opening a short perpetual position, querying state, rebalancing delta, compounding yield, closing the position, and withdrawing. The goal is to confirm that all PDAs derive correctly, remaining accounts are ordered correctly, transactions simulate and confirm without error, and the full lifecycle completes without residual on-chain state.

## Glossary

- **Vault**: The Voltr on-chain yield vault that accepts USDC and issues LP tokens to depositors.
- **Strategy**: The `drift_user` PDA-based adaptor that routes vault capital into Drift Protocol.
- **DriftClient**: The `@drift-labs/sdk` client used to build Drift instructions and query user state.
- **vaultStrategyAuth**: The PDA authority derived by `vc.findVaultStrategyAddresses(vault, strategy)` that owns the Drift sub-account.
- **Lifecycle**: The ordered sequence of 8 steps from vault initialization through final user withdrawal.
- **Devnet**: The Solana devnet cluster used for integration testing, with Drift-specific program IDs and state addresses that differ from mainnet.
- **LUT**: Address Lookup Table — a Solana account that compresses large account lists in versioned transactions.
- **perpPosition**: The Drift perp position object returned by `driftUser.getPerpPosition(marketIndex)`.
- **baseAssetAmount**: The signed integer field on a `perpPosition` representing the position size; negative for shorts.
- **freeCollateral**: The USDC value available above the maintenance margin requirement, returned by `driftUser.getFreeCollateral()`.
- **healthRatio**: The margin health ratio returned by `driftUser.getHealth() / 100`; below 1.2 triggers emergency reduce.
- **Admin**: The keypair loaded from `ADMIN_FILE_PATH` that initializes and configures the vault.
- **Manager**: The keypair loaded from `MANAGER_FILE_PATH` that operates the strategy (deposit, open, rebalance, compound, close, withdraw).
- **User**: The keypair loaded from `USER_FILE_PATH` that deposits into and withdraws from the vault.

## Requirements

### Requirement 1: Devnet Environment Configuration

**User Story:** As a developer, I want a devnet-specific configuration that overrides mainnet constants, so that all scripts target the correct Drift devnet program IDs, state addresses, and oracle addresses without modifying the mainnet config.

#### Acceptance Criteria

1. THE System SHALL provide a `config/devnet.ts` file that exports devnet-specific values for `DRIFT.PROGRAM_ID`, `DRIFT.SPOT.STATE`, `DRIFT.LOOKUP_TABLE_ADDRESSES`, and all oracle addresses used by the scripts.
2. WHEN `HELIUS_RPC_URL` points to a devnet endpoint, THE System SHALL use the devnet constants from `config/devnet.ts` rather than the mainnet constants in `src/constants/drift.ts`.
3. THE System SHALL document the devnet USDC mint address and the required value for `assetMintAddress` in `config/base.ts` within `config/devnet.ts` as a comment.
4. THE System SHALL document the required airdrop commands for the Admin, Manager, and User keypairs in `config/devnet.ts` as comments.

### Requirement 2: DriftClient Devnet Targeting

**User Story:** As a developer, I want all scripts that instantiate `DriftClient` to target devnet when running against devnet, so that the SDK resolves the correct program IDs and does not attempt mainnet-only RPC calls.

#### Acceptance Criteria

1. WHEN a script instantiates `DriftClient`, THE Script SHALL pass `env: "devnet"` when the target cluster is devnet.
2. THE System SHALL ensure that `manager-open-short-perp.ts`, `manager-close-short-perp.ts`, `manager-rebalance-delta.ts`, and `manager-compound-yield.ts` all use a configurable `env` value rather than a hardcoded `"mainnet-beta"` string.
3. THE `config/devnet.ts` SHALL export a `driftEnv` constant set to `"devnet"` and `config/base.ts` (or an equivalent base config) SHALL export a `driftEnv` constant set to `"mainnet-beta"`, so scripts can import the correct value without conditional logic.

### Requirement 3: Step 1 — Vault & Strategy Initialization

**User Story:** As an Admin, I want to initialize the vault, register the Drift adaptor, and create the Drift user sub-account, so that the strategy infrastructure is ready to receive capital.

#### Acceptance Criteria

1. WHEN `admin-init-vault.ts` is executed, THE Script SHALL create the vault on-chain and print the vault address and LUT address to stdout.
2. WHEN `admin-add-adaptor.ts` is executed after vault initialization, THE Script SHALL register the `ADAPTOR_PROGRAM_ID` adaptor on the vault and confirm the transaction.
3. WHEN `manager-init-user.ts` is executed with `enableMarginTrading: true`, THE Script SHALL create the Drift sub-account with the Manager as delegatee and confirm the transaction.
4. IF any of the three initialization scripts encounters an unhandled error, THEN THE Script SHALL print the error message to stderr and exit with a non-zero code.
5. WHEN `manager-init-user.ts` completes successfully, THE Drift sub-account SHALL be queryable via `driftClient.getUserAccountsForAuthority(vaultStrategyAuth)` and return a non-empty array.

### Requirement 4: Step 2 — Fund the Strategy

**User Story:** As a User and Manager, I want to deposit USDC into the vault and then move it into the Drift spot market, so that the strategy has collateral available for the short position.

#### Acceptance Criteria

1. WHEN `user-deposit-vault.ts` is executed with a non-zero `depositAmountVault`, THE Script SHALL transfer USDC from the user's ATA into the vault and confirm the transaction.
2. WHEN `manager-deposit-user.ts` is executed after a user deposit, THE Script SHALL move USDC from the vault into the Drift spot market (market index 0 for USDC) and confirm the transaction.
3. WHEN `manager-deposit-user.ts` completes successfully, THE Drift sub-account SHALL show a non-zero USDC spot balance readable via `driftUser.getSpotPosition(driftMarketIndex)`.
4. IF `depositAmountVault` is set to zero, THEN THE `user-deposit-vault.ts` script SHALL revert the transaction and print an error indicating the amount must be greater than zero.

### Requirement 5: Step 3 — Open Short Perpetual Position

**User Story:** As a Manager, I want to open a short SOL-PERP position on Drift, so that the strategy begins collecting funding rate payments.

#### Acceptance Criteria

1. WHEN `manager-open-short-perp.ts` is executed with a non-zero `perpOrderSize`, THE Script SHALL submit a market short order on the configured `perpMarketIndex` and confirm the transaction.
2. WHEN the short order confirms, THE Drift sub-account's `getPerpPosition(perpMarketIndex)` SHALL return a position with a negative `baseAssetAmount`.
3. THE Script SHALL build remaining accounts using `driftClient.getRemainingAccounts` with `writablePerpMarketIndexes: [marketIndex]` and append them to the instruction's `keys` array before submission.
4. IF the Drift sub-account has insufficient free collateral to open the requested position size, THEN THE Script SHALL surface the simulation error to stderr before attempting to send the transaction.

### Requirement 6: Step 4 — Query Strategy State

**User Story:** As a Manager, I want to query the current strategy position value, so that I can verify the on-chain state is consistent with the expected capital deployment.

#### Acceptance Criteria

1. WHEN `query-strategy-positions.ts` is executed after a deposit and short position are open, THE Script SHALL print a non-zero `positionValue` for the `drift_user` strategy allocation.
2. THE Script SHALL print the vault's `totalValue` and each strategy allocation's public key, strategy address, and `positionValue` to stdout.
3. WHEN no strategy allocations exist, THE Script SHALL print the vault `totalValue` and exit cleanly without error.

### Requirement 7: Step 5 — Rebalance Delta

**User Story:** As a Manager, I want the rebalance script to adjust the short position size when delta drift exceeds the threshold, and exit cleanly when no rebalance is needed, so that the portfolio stays delta-neutral without unnecessary transactions.

#### Acceptance Criteria

1. WHEN `manager-rebalance-delta.ts` is executed and the absolute delta divided by total NAV is less than or equal to `rebalanceThresholdPct / 100`, THE Script SHALL log "No rebalance needed — delta within threshold." and exit without submitting any transaction.
2. WHEN `manager-rebalance-delta.ts` is executed and the absolute delta divided by total NAV exceeds `rebalanceThresholdPct / 100`, THE Script SHALL submit a market order to adjust the short position toward delta neutrality and confirm the transaction.
3. WHEN `manager-rebalance-delta.ts` is executed and `healthRatio` is below 1.2, THE Script SHALL submit a reduce-only market order to close 50% of the short position and log a warning before any delta calculation.
4. WHEN `manager-rebalance-delta.ts` is executed and delta requires increasing the short but `healthRatio` is below `minMarginHealthRatio`, THE Script SHALL log a warning and exit without submitting any transaction.
5. FOR ALL executions of `manager-rebalance-delta.ts` when no position exists and delta is zero, THE Script SHALL log "No rebalance needed — delta within threshold." and exit cleanly (idempotence property).

### Requirement 8: Step 6 — Compound Yield

**User Story:** As a Manager, I want the compound script to withdraw free collateral above the margin floor and re-deposit it, so that accrued yield is reinvested; and to exit cleanly when no yield is available, so that it is safe to run on a schedule.

#### Acceptance Criteria

1. WHEN `manager-compound-yield.ts` is executed and `freeCollateral` minus `requiredMargin` is zero or negative, THE Script SHALL log "No yield available to compound." and exit without submitting any transaction.
2. WHEN `manager-compound-yield.ts` is executed and withdrawable yield is positive, THE Script SHALL submit a withdraw transaction followed by a deposit transaction and log both transaction signatures.
3. WHEN `manager-compound-yield.ts` is executed and `driftUser.getHealth()` throws an error, THE Script SHALL throw an error with a descriptive message and halt without submitting any transaction.
4. FOR ALL executions of `manager-compound-yield.ts` when no yield has accrued, THE Script SHALL exit cleanly without error (safe for cron scheduling).

### Requirement 9: Step 7 — Close Short Position

**User Story:** As a Manager, I want to close the short perpetual position before withdrawing, so that no residual perp exposure remains in the Drift sub-account.

#### Acceptance Criteria

1. WHEN `manager-close-short-perp.ts` is executed and a non-zero short position exists, THE Script SHALL submit a reduce-only market long order equal to the absolute `baseAssetAmount` of the short and confirm the transaction.
2. WHEN the close order confirms, THE Drift sub-account's `getPerpPosition(perpMarketIndex)` SHALL return null or a position with `baseAssetAmount` equal to zero.
3. WHEN `manager-close-short-perp.ts` is executed and no open position exists (`perpPosition` is null or `baseAssetAmount` is zero), THE Script SHALL log "No open short position to close." and exit without submitting any transaction.
4. FOR ALL executions of `manager-close-short-perp.ts` when no position exists, THE Script SHALL log "No open short position to close." and exit cleanly (idempotence property).

### Requirement 10: Step 8 — Withdraw

**User Story:** As a Manager and User, I want to withdraw USDC from Drift back to the vault and then from the vault back to the user, so that the full lifecycle completes with no residual on-chain positions.

#### Acceptance Criteria

1. WHEN `manager-withdraw-user.ts` is executed after the short position is closed, THE Script SHALL withdraw USDC from the Drift spot market back to the vault and confirm the transaction.
2. WHEN `user-instant-withdraw-vault.ts` is executed after the manager withdrawal, THE Script SHALL transfer USDC from the vault back to the user's ATA and confirm the transaction.
3. WHEN the full lifecycle (Steps 1–8) completes, THE Drift sub-account SHALL have no open perp positions and no USDC stranded in the Drift spot market beyond rounding dust.
4. IF `manager-withdraw-user.ts` is executed before the short position is closed, THEN THE Script SHALL not prevent the withdrawal but the caller is responsible for ensuring the position is closed first (no guard required in the script itself).

### Requirement 11: Full Lifecycle Idempotence and Clean Exit

**User Story:** As a developer running the test suite, I want the close and rebalance scripts to be safe to run multiple times, so that accidental double-execution does not cause errors or unexpected state changes.

#### Acceptance Criteria

1. FOR ALL executions of `manager-close-short-perp.ts` when `shouldSubmitClose(perpPosition)` returns false, THE Script SHALL produce identical output ("No open short position to close.") regardless of how many times it is called.
2. FOR ALL executions of `manager-rebalance-delta.ts` when delta is within threshold, THE Script SHALL produce identical output ("No rebalance needed — delta within threshold.") regardless of how many times it is called.
3. THE `shouldSubmitClose` function exported from `manager-close-short-perp.ts` SHALL return false when `perpPosition` is null.
4. THE `shouldSubmitClose` function exported from `manager-close-short-perp.ts` SHALL return false when `perpPosition.baseAssetAmount` is zero.
5. THE `shouldSubmitClose` function exported from `manager-close-short-perp.ts` SHALL return true when `perpPosition.baseAssetAmount` is non-zero.

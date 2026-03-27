# Ranger Earn — Yield Protocol Integration Guide

> Source: [docs.ranger.finance](https://docs.ranger.finance)

This guide documents everything needed to integrate a DeFi protocol as a yield source
for Ranger Earn vaults on Solana. It covers architecture, adaptor development, vault
creation, strategy setup, fund allocation, automation, monitoring, and go-to-market.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Key Participants & Roles](#2-key-participants--roles)
3. [Prerequisites](#3-prerequisites)
4. [Vault Creation](#4-vault-creation)
5. [Adaptor Development](#5-adaptor-development)
6. [Strategy Setup](#6-strategy-setup)
7. [Fund Allocation](#7-fund-allocation)
8. [CPI Integration (Composing Protocols)](#8-cpi-integration-composing-protocols)
9. [Automation — Bots & Scripts](#9-automation--bots--scripts)
10. [Monitoring & API](#10-monitoring--api)
11. [Security Best Practices](#11-security-best-practices)
12. [Deployed Program Addresses](#12-deployed-program-addresses)
13. [Go-To-Market Checklist](#13-go-to-market-checklist)
14. [Reference Links](#14-reference-links)

---

## 1. Overview & Architecture

Ranger Earn is a non-custodial yield infrastructure protocol on Solana. It lets vault
managers deploy user deposits into one or more DeFi strategies through a standardized
adaptor interface.

### Two Core Programs

| Program | Role |
|---|---|
| `voltr-vault` | Manages user deposits, LP token accounting, and fee collection |
| Adaptor (custom) | Bridges the vault to a specific DeFi protocol via CPI |

### Fund Flow

```
User deposits → Vault holds idle assets
                    ↓  (manager allocates)
              Vault calls Adaptor via CPI
                    ↓
              Adaptor calls Target Protocol via CPI
                    ↓
              Protocol holds assets, issues receipt tokens
                    ↓
              Adaptor reports position value back to Vault
```

### Integration Paths

There are two ways to integrate with Ranger Earn:

| Path | Who | What |
|---|---|---|
| Adaptor (Yield Protocol) | DeFi protocols wanting to be a yield source | Build a custom on-chain adaptor program |
| CPI Integration (Composing Protocol) | Protocols building on top of vaults | Call vault deposit/withdraw instructions via CPI |

---

## 2. Key Participants & Roles

| Participant | Responsibilities |
|---|---|
| **Users** | Deposit assets, receive LP tokens, withdraw assets + yield |
| **Vault Admin** | Create vault, add/remove adaptors, update config, calibrate high water mark |
| **Vault Manager** | Allocate funds between strategies, claim protocol rewards |
| **Yield Protocols** | Build adaptors that wrap protocol-specific deposit/withdraw logic |
| **Composing Protocols** | CPI into vaults to build derivatives, tranching, fractional reserve products |

### Permissions Matrix

| Action | Users | Admin | Manager | Yield Protocol | Composing Protocol |
|---|---|---|---|---|---|
| Deposit/Withdraw from vault | ✓ | | | | ✓ |
| Create vault | | ✓ | | | |
| Add/Remove adaptors | | ✓ | | | |
| Set fees and configuration | | ✓ | | | |
| Allocate funds to strategies | | | ✓ | | |
| Create adaptors | | | | ✓ | |
| CPI into vaults | | | | | ✓ |

---

## 3. Prerequisites

Before creating a vault or building an adaptor, ensure you have:

### 3.1 SOL for Fees

~**0.15 SOL** for vault creation (account rent) plus additional SOL for ongoing
transactions (strategy initialization, fund allocation, etc.).

### 3.2 Solana RPC Endpoint

A reliable RPC is required for all on-chain operations. Recommended providers:
- [Helius](https://helius.dev/)
- [Triton](https://triton.one/)
- [QuickNode](https://quicknode.com/)

### 3.3 Admin and Manager Keypairs

| Role | Responsibilities |
|---|---|
| **Admin** | Add/remove adaptors, initialize strategies, update vault config, calibrate high water mark |
| **Manager** | Allocate funds between strategies, claim protocol rewards |

Keep these keypairs separate and secure. Never share private keys.

### 3.4 SDK & Dependencies

```bash
npm install @voltr/vault-sdk @solana/web3.js @coral-xyz/anchor
```

### 3.5 Asset Token Mint Address

Know the SPL token mint your vault will accept. Example — USDC mainnet:
```
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

---

## 4. Vault Creation

A vault is an on-chain smart contract that accepts deposits in a single asset (e.g. USDC,
SOL) and deploys those funds into one or more DeFi strategies to generate yield. Users
receive LP tokens representing their proportional share.

### 4.1 Vault Configuration Parameters

```typescript
import { BN } from "@coral-xyz/anchor";
import { VaultConfig, VaultParams, VoltrClient } from "@voltr/vault-sdk";

const vaultConfig: VaultConfig = {
  maxCap: new BN("18446744073709551615"), // Uncapped (u64 max) — set a real cap in production
  startAtTs: new BN(0),                   // Activation timestamp (0 = immediate)
  lockedProfitDegradationDuration: new BN(86400), // 24 hours in seconds
  managerPerformanceFee: 1000,            // 10% in basis points
  adminPerformanceFee: 500,               // 5% in basis points
  managerManagementFee: 50,               // 0.5% in basis points
  adminManagementFee: 25,                 // 0.25% in basis points
  redemptionFee: 10,                      // 0.1% in basis points
  issuanceFee: 10,                        // 0.1% in basis points
  withdrawalWaitingPeriod: new BN(0),     // Waiting period in seconds (0 = immediate)
};

const vaultParams: VaultParams = {
  config: vaultConfig,
  name: "My Ranger Earn Vault",           // Max 32 characters
  description: "Short vault description", // Max 64 characters
};
```

### 4.2 Full Vault Creation Script

```typescript
import { BN } from "@coral-xyz/anchor";
import { VaultConfig, VaultParams, VoltrClient } from "@voltr/vault-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";

// Load keypairs
const adminKp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("/path/to/admin.json", "utf-8")))
);
const managerKp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("/path/to/manager.json", "utf-8")))
);

// Generate a new vault keypair
const vaultKp = Keypair.generate();

const connection = new Connection("your-solana-rpc-url");
const client = new VoltrClient(connection);

const createVaultIx = await client.createInitializeVaultIx(vaultParams, {
  vault: vaultKp,
  vaultAssetMint: new PublicKey("your-asset-mint"),
  admin: adminKp.publicKey,
  manager: managerKp.publicKey,
  payer: adminKp.publicKey,
});

const txSig = await sendAndConfirmTransaction(
  [createVaultIx],
  connection,
  [adminKp, vaultKp]
);

console.log("Vault created:", vaultKp.publicKey.toBase58());
console.log("Transaction:", txSig);
// IMPORTANT: Save your vault public key — needed for all subsequent operations
```

### 4.3 Vault Account Structure

```typescript
interface Vault {
  name: string;           // Max 32 bytes
  description: string;    // Max 64 bytes
  asset: {
    mint: PublicKey;      // Token mint address
    idleAuth: PublicKey;  // Idle token authority
    totalValue: BN;       // Total assets in vault
  };
  vaultConfiguration: {
    maxCap: BN;
    startAtTs: BN;
    lockedProfitDegradationDuration: BN;
    withdrawalWaitingPeriod: BN;
  };
  feeConfiguration: {
    managerPerformanceFee: number;  // In basis points
    adminPerformanceFee: number;
    managerManagementFee: number;
    adminManagementFee: number;
    redemptionFee: number;
    issuanceFee: number;
  };
  feeState: {
    accumulatedLpAdminFees: BN;
    accumulatedLpManagerFees: BN;
    accumulatedLpProtocolFees: BN;
  };
  highWaterMark: {
    highestAssetPerLpDecimalBits: BN;
    lastUpdatedTs: BN;
  };
  admin: PublicKey;
  manager: PublicKey;
}
```

### 4.4 Vault Lifecycle

1. Create the vault (admin)
2. Initialize strategies — connect to DeFi protocols (admin)
3. Add LP token metadata — name, symbol, logo (admin)
4. Allocate funds — deploy idle assets to strategies (manager)
5. Run automation bots — rebalancing, reward claiming (manager)
6. Monitor performance via API or SDK

---

## 5. Adaptor Development

An adaptor is a Solana program that bridges a Ranger Earn vault with your DeFi protocol.
The vault calls your adaptor via CPI; your adaptor then calls your protocol via CPI.

### 5.1 How It Works

When a vault manager allocates or deallocates funds, the vault program:

1. Transfers tokens to/from the `vault_strategy_auth` PDA
2. Calls your adaptor's `deposit` or `withdraw` instruction via CPI
3. Reads the returned `u64` (via Solana's `get_return_data`) to track position value

### 5.2 Core Requirements

Every adaptor must implement exactly these three instructions at minimum:

| Instruction | Called When | Must Return |
|---|---|---|
| `initialize` | Strategy is first created | `Result<()>` |
| `deposit` | Vault allocates funds to strategy | `Result<u64>` — current position value in underlying token terms |
| `withdraw` | Vault deallocates funds from strategy | `Result<u64>` — remaining position value in underlying token terms |

### 5.3 Accounts Passed by the Vault

The vault always passes accounts in this fixed order:

**Initialize:** `payer`, `vault_strategy_auth` (signer), `strategy`, `system_program`, + remaining accounts

**Deposit / Withdraw:** `vault_strategy_auth` (signer), `strategy`, `vault_asset_mint`,
`vault_strategy_asset_ata`, `asset_token_program`, + remaining accounts

Protocol-specific accounts are appended via `remaining_accounts`.

### 5.4 Key Concept: Strategy = Your Protocol's State

The vault passes a `strategy` account to your adaptor. This maps to your protocol's own
state — a market PDA, a reserve, a lending pool, etc. Validate this mapping:

```rust
// Example: strategy must be the ctoken market account
#[account(constraint = strategy.key() == market.key())]
pub strategy: AccountInfo<'info>,
```

Each vault strategy is a 1:1 mapping to a specific instance of your protocol.

### 5.5 Initialize Instruction

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// The strategy account — must match your protocol's state account
    /// CHECK: check in CPI call
    #[account(constraint = strategy.key() == market.key())]
    pub strategy: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    // Protocol-specific accounts below...
}
```

Key responsibilities:
- Create protocol-specific accounts (e.g. market state, token mints)
- Initialize token accounts (e.g. receipt token ATAs)
- Configure protocol-specific parameters

### 5.6 Deposit Instruction

```rust
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: must match protocol state
    #[account(constraint = strategy.key() == market.key())]
    pub strategy: AccountInfo<'info>,

    #[account(mut)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The vault_strategy_asset_ata — holds tokens to be deposited
    #[account(mut)]
    pub user_token_ata: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,

    // Protocol-specific accounts below...
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<u64> {
    if amount > 0 {
        // CPI to your protocol to deposit tokens
        your_protocol::cpi::deposit(..., amount)?;

        // Reload accounts to reflect updated state
        ctx.accounts.reload_protocol_state()?;
    }

    // Return the total position value in underlying token terms
    let position_value = calculate_position_value(&ctx)?;
    Ok(position_value)
}
```

The returned `u64` is critical — the vault uses it to track the strategy's position
value and calculate P&L.

### 5.7 Withdraw Instruction

```rust
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<u64> {
    // Convert the requested liquidity amount to protocol units
    let protocol_amount = convert_to_protocol_units(&ctx, amount)?;

    // CPI to your protocol to withdraw
    your_protocol::cpi::withdraw(..., protocol_amount)?;

    // Reload accounts
    ctx.accounts.reload_protocol_state()?;

    // Return the remaining position value in underlying token terms
    let remaining_value = calculate_position_value(&ctx)?;
    Ok(remaining_value)
}
```

After the CPI returns, the vault sweeps any tokens in `vault_strategy_asset_ata` back
to idle.

### 5.8 Position Value Calculation

Your adaptor must accurately calculate position value in underlying token terms.

```rust
// Receipt-token based (e.g. cToken, collateral token)
fn calculate_position_value(
    receipt_token_balance: u64,
    total_liquidity: u64,
    total_receipt_supply: u64,
) -> u64 {
    (receipt_token_balance as u128)
        .checked_mul(total_liquidity as u128)
        .unwrap()
        .checked_div(total_receipt_supply as u128)
        .unwrap() as u64
}

// Shares-based (e.g. vault shares)
fn calculate_position_value(
    user_shares: u64,
    total_aum: u64,
    total_shares: u64,
) -> u64 {
    (user_shares as u128)
        .checked_mul(total_aum as u128)
        .unwrap()
        .checked_div(total_shares as u128)
        .unwrap() as u64
}
```

### 5.9 Additional Instructions

Adaptors are not limited to the three core instructions. Depending on your protocol:

- **Multi-step withdrawals** — Some protocols (e.g. Drift vaults) require a
  request/withdraw flow. Add `request_withdraw` and `cancel_request_withdraw`
  alongside the core `withdraw`.
- **Reward harvesting** — Add `claim_rewards` or `harvest` instructions to collect
  yield, optionally swapping reward tokens back to the vault's base asset.
- **Multiple strategy types** — A single adaptor can support multiple strategy types
  within the same protocol (e.g. a Drift adaptor can handle vault depositor strategies,
  spot lending, and curve strategies).

### 5.10 Remaining Accounts

Protocol-specific accounts beyond the fixed ones are passed via `remaining_accounts`:

```rust
// Common uses:
// - Market/oracle data for equity calculations
// - Protocol state accounts needed for CPI calls
// - Additional token accounts for reward claiming or swaps
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<u64> {
    let remaining = &ctx.remaining_accounts;
    // Parse and forward to protocol CPIs as needed
}
```

### 5.11 Error Handling

```rust
#[error_code]
pub enum AdaptorError {
    #[msg("Invalid amount provided.")]
    InvalidAmount,
    #[msg("Math overflow.")]
    MathOverflow,
    // Add protocol-specific errors as needed
}
```

### 5.12 Account Validation Patterns

**PDA Verification:**
```rust
#[account(
    mut,
    seeds = [MARKET_SEED, token_mint.key().as_ref()],
    bump,
    seeds::program = protocol_program.key()
)]
pub market: Account<'info, Market>,
```

**ATA Verification:**
```rust
#[account(
    mut,
    associated_token::mint = ctoken_mint,
    associated_token::authority = user,
    associated_token::token_program = ctoken_token_program,
)]
pub user_ctoken_ata: Box<InterfaceAccount<'info, TokenAccount>>,
```

### 5.13 Adaptor Implementation Checklist

- [ ] Implemented core three instructions (Initialize, Deposit, Withdraw)
- [ ] Deposit and Withdraw return accurate `u64` position values
- [ ] Strategy account correctly maps to protocol state
- [ ] Protocol-specific accounts validated (PDAs, ATAs, ownership)
- [ ] Used checked math operations for all arithmetic
- [ ] Handled token decimal conversions correctly
- [ ] Added any protocol-specific instructions (multi-step withdrawals, reward harvesting)
- [ ] Remaining accounts correctly parsed and forwarded where needed
- [ ] Tested deposit, withdraw, and edge cases (zero amount, first deposit)

---

## 6. Strategy Setup

After creating a vault, you need to set up strategies so funds can be deployed to DeFi
protocols. This is a two-step process:

1. **Add the adaptor** to your vault (one-time per adaptor program)
2. **Initialize the strategy** for each specific protocol/market you want to deploy to

### 6.1 Adaptors vs. Strategies

| Concept | Definition |
|---|---|
| **Adaptor** | An on-chain program that knows how to interact with a category of protocols (e.g. the Kamino adaptor interacts with Kamino) |
| **Strategy** | A specific deployment target within an adaptor (e.g. "lend USDC on Kamino Main Market") |

A vault can have multiple strategies across multiple adaptors.

### 6.2 Built-in Adaptor Program IDs

```typescript
import {
  LENDING_ADAPTOR_PROGRAM_ID,
  DRIFT_ADAPTOR_PROGRAM_ID,
} from "@voltr/vault-sdk";
```

| Adaptor | Program ID |
|---|---|
| Lending Adaptor | `aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz` |
| Drift Adaptor | `EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP` |
| Kamino Adaptor | `to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR` |
| Raydium Adaptor | `A5a3Xo2JaKbXNShSHHP4Fe1LxcxNuCZs97gy3FJMSzkM` |
| Jupiter Adaptor | `EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM` |
| Trustful Adaptor | `3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ` |

### 6.3 Available Strategy Types

| Strategy Type | Adaptor | Protocols |
|---|---|---|
| Lending | Lending Adaptor | Kamino, Marginfi, Save, Drift Spot, Jupiter Lend |
| Drift Perps/JLP | Drift Adaptor | Drift Protocol |
| Raydium CLMM | Raydium Adaptor | Raydium |
| Off-chain | Trustful Adaptor | CEX, OTC, MPC |

### 6.4 Step 1: Add Adaptor

```typescript
import { VoltrClient } from "@voltr/vault-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";

const connection = new Connection("your-rpc-url");
const client = new VoltrClient(connection);

const adminKp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("/path/to/admin.json", "utf-8")))
);

const vault = new PublicKey("your-vault-pubkey");
const adaptorProgramId = new PublicKey("adaptor-program-id");

const addAdaptorIx = await client.createAddAdaptorIx({
  vault,
  admin: adminKp.publicKey,
  payer: adminKp.publicKey,
  adaptorProgram: adaptorProgramId,
});

const txSig = await sendAndConfirmTransaction(
  [addAdaptorIx],
  connection,
  [adminKp]
);

console.log("Adaptor added:", txSig);
```

### 6.5 Step 2: Initialize Strategy

Strategy initialization is protocol-specific — each protocol requires different
remaining accounts and an `instructionDiscriminator`.

```typescript
import { VoltrClient } from "@voltr/vault-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const connection = new Connection("your-rpc-url");
const client = new VoltrClient(connection);

const adminKp = Keypair.fromSecretKey(/* ... */);
const managerKp = Keypair.fromSecretKey(/* ... */);
const vault = new PublicKey("your-vault-pubkey");
const strategy = new PublicKey("strategy-pda");
const adaptorProgram = new PublicKey("adaptor-program-id");

const instructionDiscriminator = Buffer.from([/* 8-byte discriminator */]);

const initStrategyIx = await client.createInitializeStrategyIx(
  { instructionDiscriminator },
  {
    payer: adminKp.publicKey,
    manager: managerKp.publicKey,
    vault,
    strategy,
    adaptorProgram,
    remainingAccounts: [
      // Protocol-specific accounts
    ],
  }
);

const txSig = await sendAndConfirmTransaction(
  [initStrategyIx],
  connection,
  [adminKp]
);
```

### 6.6 Protocol-Specific Initialization Scripts

| Protocol / Adaptor | Scripts |
|---|---|
| Kamino Adaptor | [Kamino Vault](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-initialize-kvault.ts), [Kamino Lending Market](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-initialize-market.ts) |
| Drift Adaptor | [Drift Lend](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-init-earn.ts), [Drift Perps](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-init-user.ts) |
| Jupiter Adaptor | [Spot via Jupiter Swap](https://github.com/voltrxyz/spot-scripts/blob/main/src/scripts/manager-initialize-spot.ts), [Jupiter Lend](https://github.com/voltrxyz/spot-scripts/blob/main/src/scripts/manager-initialize-earn.ts) |
| Trustful Adaptor | [Centralised Exchanges](https://github.com/voltrxyz/trustful-scripts/blob/main/src/scripts/manager-initialize-arbitrary.ts) |

### 6.7 Required Account Structure

Strategy initialization requires:

1. **Core Accounts**: `payer`, `vault`, `manager`, `strategy`, `protocolProgram`
2. **Protocol-Specific Accounts**: Protocol program account, required protocol state
   accounts, token accounts and authorities, system accounts (RENT, etc.)

---

## 7. Fund Allocation

Once strategies are initialized, the vault manager deploys idle assets into them.

### 7.1 Idle vs. Deployed Funds

| State | Description |
|---|---|
| **Idle Funds** | Assets sitting in the vault, not yet deployed to any strategy |
| **Deployed Funds** | Assets actively earning yield in a DeFi protocol via a strategy |

Always keep a buffer of idle funds to handle user withdrawals without needing to
unwind positions.

### 7.2 Setup

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  VoltrClient,
  LENDING_ADAPTOR_PROGRAM_ID,
  SEEDS,
} from "@voltr/vault-sdk";
import { BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";

const managerKp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync("/path/to/manager.json", "utf-8")))
);
const manager = managerKp.publicKey;

const connection = new Connection("your-rpc-url");
const client = new VoltrClient(connection);

const vault = new PublicKey("your-vault-address");
const vaultAssetMint = new PublicKey("your-asset-mint");
```

### 7.3 Depositing Funds to a Strategy

```typescript
// 1. Derive strategy address
const counterPartyTa = new PublicKey("protocol-token-account");

const [strategy] = PublicKey.findProgramAddressSync(
  [SEEDS.STRATEGY, counterPartyTa.toBuffer()],
  LENDING_ADAPTOR_PROGRAM_ID
);

const { vaultStrategyAuth } = client.findVaultStrategyAddresses(vault, strategy);

const vaultStrategyAssetAta = getAssociatedTokenAddressSync(
  vaultAssetMint,
  vaultStrategyAuth,
  true
);

// 2. Create ATA if it doesn't exist
let transactionIxs: TransactionInstruction[] = [];
try {
  await getAccount(connection, vaultStrategyAssetAta);
} catch {
  transactionIxs.push(
    createAssociatedTokenAccountInstruction(
      manager,
      vaultStrategyAssetAta,
      vaultStrategyAuth,
      vaultAssetMint
    )
  );
}

// 3. Create deposit instruction
const depositAmount = new BN("1000000"); // 1 USDC (6 decimals)

const depositIx = await client.createDepositStrategyIx(
  { depositAmount },
  {
    manager,
    vault,
    vaultAssetMint,
    assetTokenProgram: TOKEN_PROGRAM_ID,
    strategy,
    remainingAccounts: [
      { pubkey: counterPartyTa, isSigner: false, isWritable: true },
      { pubkey: protocolProgram, isSigner: false, isWritable: false },
      // Additional protocol-specific accounts...
    ],
  }
);

transactionIxs.push(depositIx);

// 4. Send transaction
const txSig = await sendAndConfirmOptimisedTx(
  transactionIxs,
  "your-rpc-url",
  managerKp
);
```

### 7.4 Withdrawing Funds from a Strategy

```typescript
// 1. Get counterparty token account authority
const counterPartyTaAuth = await getAccount(
  connection,
  counterPartyTa,
  "confirmed"
).then((account) => account.owner);

// 2. Create ATA if needed (same pattern as deposit)
let transactionIxs: TransactionInstruction[] = [];

// 3. Create withdrawal instruction
const withdrawAmount = new BN("500000"); // 0.5 USDC

const withdrawIx = await client.createWithdrawStrategyIx(
  { withdrawAmount },
  {
    manager,
    vault,
    vaultAssetMint,
    assetTokenProgram: TOKEN_PROGRAM_ID,
    strategy,
    remainingAccounts: [
      { pubkey: counterPartyTaAuth, isSigner: false, isWritable: true },
      { pubkey: counterPartyTa, isSigner: false, isWritable: true },
      { pubkey: protocolProgram, isSigner: false, isWritable: false },
    ],
  }
);

transactionIxs.push(withdrawIx);

const txSig = await sendAndConfirmOptimisedTx(
  transactionIxs,
  "your-rpc-url",
  managerKp
);
```

### 7.5 Protocol-Specific Deposit/Withdraw Scripts

| Protocol / Adaptor | Deposit | Withdraw |
|---|---|---|
| Kamino Vault | [manager-deposit-kvault.ts](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-deposit-kvault.ts) | [manager-withdraw-kvault.ts](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-withdraw-kvault.ts) |
| Kamino Lending | [manager-deposit-market.ts](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-deposit-market.ts) | [manager-withdraw-market.ts](https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-withdraw-market.ts) |
| Drift Lend | [manager-deposit-earn.ts](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-deposit-earn.ts) | [manager-withdraw-earn.ts](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-withdraw-earn.ts) |
| Drift Perps | [manager-deposit-user.ts](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-deposit-user.ts) | [manager-withdraw-user.ts](https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-withdraw-user.ts) |
| Jupiter Lend | [manager-deposit-earn.ts](https://github.com/voltrxyz/spot-scripts/blob/main/src/scripts/manager-deposit-earn.ts) | [manager-withdraw-earn.ts](https://github.com/voltrxyz/spot-scripts/blob/main/src/scripts/manager-withdraw-earn.ts) |
| Trustful | [manager-deposit-arbitrary.ts](https://github.com/voltrxyz/trustful-scripts/blob/main/src/scripts/manager-deposit-arbitrary.ts) | [manager-withdraw-arbitrary.ts](https://github.com/voltrxyz/trustful-scripts/blob/main/src/scripts/manager-withdraw-arbitrary.ts) |

### 7.6 Best Practices

- Keep idle reserves — don't deploy 100% of funds; leave a buffer for user withdrawals
- Batch operations — combine ATA creation and allocation in a single transaction
- Monitor allocations — track how funds are distributed across strategies
- Automate — use bots/scripts for regular rebalancing

### 7.7 Troubleshooting

| Issue | Solution |
|---|---|
| Transaction too large | Use Lookup Tables |
| Insufficient funds | Check idle balance, ensure enough SOL for gas |
| Authority error | Verify manager keypair matches vault's manager |
| ATA not found | Create the ATA before the allocation instruction |

---

## 8. CPI Integration (Composing Protocols)

If your protocol needs to deposit into or withdraw from Ranger Earn vaults on-chain
(rather than being a yield source), use CPI integration.

### 8.1 How It Works

Users deposit assets into a vault and receive LP tokens representing their share.
Withdrawals follow a two-step process to ensure vault stability:

1. **Request withdrawal** — locks LP tokens into an escrow receipt
2. **Claim withdrawal** — after the vault's waiting period, burns locked LP tokens and
   returns underlying assets

Vaults with a zero waiting period support **instant withdrawal** (single transaction).

```
Deposit:          User Assets ──► Vault ──► LP Tokens to User

Withdraw:         LP Tokens ──► Escrow Receipt ──(waiting period)──► Assets to User

Cancel Withdraw:  Escrow Receipt ──► LP Tokens back to User

Instant Withdraw: LP Tokens ──► Assets to User (single transaction)
```

### 8.2 Vault Program Address

| Network | Program Address |
|---|---|
| Mainnet | `vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8` |

### 8.3 CPI Instructions

| Instruction | Purpose |
|---|---|
| `deposit_vault` | Deposit assets and receive LP tokens |
| `request_withdraw_vault` | Lock LP tokens into an escrow receipt |
| `withdraw_vault` | Claim assets after the waiting period |
| `cancel_request_withdraw_vault` | Cancel a pending withdrawal request |
| `instant_withdraw_vault` | Withdraw assets instantly (zero waiting period vaults only) |

### 8.4 PDA Derivation

All PDAs are derived from the Ranger Earn Vault program
(`vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8`):

| Account | Seeds |
|---|---|
| `protocol` | `["protocol"]` |
| `vault_asset_idle_auth` | `["vault_asset_idle_auth", vault_key]` |
| `vault_lp_mint_auth` | `["vault_lp_mint_auth", vault_key]` |
| `request_withdraw_vault_receipt` | `["request_withdraw_vault_receipt", vault_key, user_key]` |

### 8.5 Error Handling

| Error | Cause |
|---|---|
| `InvalidAmount` | Input amount is zero or invalid |
| `MaxCapExceeded` | Deposit would exceed the vault's maximum capacity |
| `WithdrawalNotYetAvailable` | `withdraw_vault` called before the waiting period has passed |
| `InstantWithdrawNotAllowed` | `instant_withdraw_vault` called on a vault with a non-zero waiting period |
| `OperationNotAllowed` | The protocol has globally disabled the attempted operation |

### 8.6 Reference Repository

Full reference implementations: [github.com/voltrxyz/vault-cpi](https://github.com/voltrxyz/vault-cpi)

### 8.7 Use Cases for Composing Protocols

- Build derivatives such as junior/senior tranching
- Create fractional reserve systems backed by vault LP tokens
- Compose vault yields into new structured products
- Build lending markets that accept vault LP tokens as collateral

---

## 9. Automation — Bots & Scripts

Vault operations require automation for optimal performance. Manual operations miss
yield opportunities and leave value uncollected.

### 9.1 Why Automation Is Needed

| Task | Why It Needs Automation |
|---|---|
| **Rebalancing** | Yield rates change frequently; manual rebalancing misses optimal allocations |
| **Reward claiming** | Protocol rewards accrue continuously; manual claiming leaves value uncollected |
| **Reward swapping** | Claimed reward tokens need to be swapped to base asset to compound |
| **Position monitoring** | Raydium CLMM positions go out-of-range; Drift positions need risk monitoring |
| **Fee harvesting** | Accumulated fees should be harvested periodically |

### 9.2 Script Repositories

| Repository | Use Case |
|---|---|
| [voltrxyz/lend-scripts](https://github.com/voltrxyz/lend-scripts) | Lending strategy init (Project0, Save) |
| [voltrxyz/kamino-scripts](https://github.com/voltrxyz/kamino-scripts) | Kamino strategy init, rewards claiming |
| [voltrxyz/drift-scripts](https://github.com/voltrxyz/drift-scripts) | Drift vaults/lend/perps strategy init, position management |
| [voltrxyz/spot-scripts](https://github.com/voltrxyz/spot-scripts) | Jupiter Swap/Lend strategy init |
| [voltrxyz/client-raydium-clmm-scripts](https://github.com/voltrxyz/client-raydium-clmm-scripts) | Raydium CLMM strategy init |
| [voltrxyz/trustful-scripts](https://github.com/voltrxyz/trustful-scripts) | Trustful adaptor strategy init |
| [voltrxyz/rebalance-bot-template](https://github.com/voltrxyz/rebalance-bot-template) | Production-ready rebalance bot (equal-weight allocation) |

### 9.3 Rebalance Bot Template

The [rebalance-bot-template](https://github.com/voltrxyz/rebalance-bot-template) is a
production-ready bot that handles core automation tasks. It distributes funds equally
across lending strategies on a fixed schedule and includes:

- **Rebalance loop** — equal-weight allocation across all strategies, triggered on
  interval and on new deposits
- **Refresh loop** — keeps on-chain receipt values up to date
- **Harvest fee loop** — collects protocol/admin/manager fees
- **Claim reward loops** — claims Kamino farm rewards and swaps them back via Jupiter

Supports Drift, Jupiter Lend, Kamino Market, and Kamino Vault strategies out of the box.

```bash
git clone https://github.com/voltrxyz/rebalance-bot-template.git
cd rebalance-bot-template
pnpm install
cp .env.example .env   # fill in your vault addresses and keypair
pnpm run build && pnpm start
```

### 9.4 Basic Rebalancing Script Structure

```typescript
import { VoltrClient } from "@voltr/vault-sdk";
import { Connection, Keypair } from "@solana/web3.js";

async function main() {
  const connection = new Connection(process.env.RPC_URL!);
  const client = new VoltrClient(connection);

  const managerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.MANAGER_KEY!))
  );

  // 1. Check current allocations
  const vaultData = await client.getVault(vaultPubkey);
  const idleBalance = vaultData.asset.totalValue;

  // 2. Check strategy yields (via API or protocol SDKs)
  // 3. Determine optimal allocation
  // 4. Execute rebalance transactions

  console.log("Rebalance complete");
}

main().catch(console.error);
```

### 9.5 Key Considerations for Automation

- **Gas budget** — Ensure your manager wallet has enough SOL for all automated
  transactions. Monitor and top up regularly.
- **Error handling** — Scripts should handle transaction failures gracefully (retry
  logic, alerting).
- **Rate limiting** — Respect RPC provider rate limits. Use exponential backoff on
  failures.
- **Idempotency** — Design scripts to be safely re-runnable in case of partial failures.

---

## 10. Monitoring & API

### 10.1 Ranger Earn REST API

The Ranger Earn API provides read-only endpoints for querying vault data.

- **Base URL**: `https://api.voltr.xyz`
- **Authentication**: Public — no API key required
- **Interactive docs**: [api.voltr.xyz/docs](https://api.voltr.xyz/docs)

The API builds and returns unsigned, serialized versioned transactions as base58
encoded strings. Your client signs and broadcasts them — private keys never leave
the client.

### 10.2 Typical API Workflow

1. Send a POST request to a transaction creation endpoint (e.g. `/vault/{pubkey}/deposit`)
2. Receive a JSON response containing the serialized transaction string
3. Deserialize, sign with the user's wallet, and send to the Solana network

### 10.3 SDK Query Methods

Use the SDK for real-time data or data not available through the API.

```typescript
import { VoltrClient } from "@voltr/vault-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("your-rpc-url");
const client = new VoltrClient(connection);
const vault = new PublicKey("your-vault-address");

// Vault state
const vaultData = await client.getVault(vault);
console.log("Total assets:", vaultData.asset.totalValue.toString());
console.log("Admin:", vaultData.admin.toBase58());
console.log("Manager:", vaultData.manager.toBase58());

// Fee information
const adminFees = await client.getAccumulatedAdminFeesForVault(vault);
const managerFees = await client.getAccumulatedManagerFeesForVault(vault);
console.log("Admin fees (LP):", adminFees.toString());
console.log("Manager fees (LP):", managerFees.toString());

// High water mark
const hwm = await client.getHighWaterMarkForVault(vault);
console.log("Highest asset per LP:", hwm.highestAssetPerLp);
console.log("Last updated:", new Date(hwm.lastUpdatedTs * 1000));

// LP supply breakdown
const assetPerLp = await client.getCurrentAssetPerLpForVault(vault);
const lpBreakdown = await client.getVaultLpSupplyBreakdown(vault);
console.log("Circulating LP:", lpBreakdown.circulating.toString());
console.log("Unharvested fees:", lpBreakdown.unharvestedFees.toString());
console.log("Total LP:", lpBreakdown.total.toString());
```

### 10.4 When to Use API vs. SDK

| Use Case | Recommended |
|---|---|
| Dashboard / UI showing vault data | Ranger Earn API |
| Monitoring vault APY over time | Ranger Earn API |
| User deposit/withdraw UI | Ranger Earn API |
| Checking fees before harvesting | SDK (real-time) |
| Automation scripts (rebalancing) | SDK |

### 10.5 Key Metrics to Monitor

- **Share price trend** — is the vault generating positive yield?
- **Total assets vs. idle assets** — what percentage is deployed vs. idle?
- **APY** — is performance meeting expectations?
- **Fee accumulation** — are fees ready to harvest?
- **Strategy health** — are all strategies performing as expected?

### 10.6 Recommended Alert Triggers

- Share price decreasing (potential loss event)
- Idle balance dropping below threshold (withdrawal pressure)
- Strategy returning errors
- SOL balance running low on admin/manager wallets

---

## 11. Security Best Practices

### 11.1 Role-Based Access Control

- Clear separation between admin and manager roles in the vault
- Strict validation of admin and manager signatures for privileged operations
- Manager-only access for strategy operations (deposits and withdrawals)
- Admin-only access for strategy addition and removal

### 11.2 PDA Authorization

Ranger Earn uses PDAs for critical vault components:

| PDA | Controls |
|---|---|
| `vault_asset_idle_auth` | Idle assets |
| `vault_lp_mint_auth` | LP token minting |
| `vault_lp_fee_auth` | Fee collection |

PDAs are derived using unique seeds tied to the vault's public key. All PDA seeds are
validated in each instruction.

### 11.3 Asset Safety

- Strict accounting of total assets across idle and deployed positions
- Validation of asset mint addresses and associated token accounts
- Atomic transaction handling for deposits and withdrawals
- Maximum cap enforcement to prevent overflow risks

### 11.4 Adaptor Security

#### Strategy Mapping Validation

Always validate that the `strategy` account passed by the vault matches your protocol's
expected state account:

```rust
#[account(constraint = strategy.key() == market.key())]
pub strategy: AccountInfo<'info>,
```

#### PDA Derivation Security

```rust
#[account(
    mut,
    seeds = [MARKET_SEED, token_mint.key().as_ref()],
    bump,
    seeds::program = protocol_program.key()
)]
pub market: Account<'info, Market>,
```

Key considerations: use consistent seed ordering, verify seeds against the correct
program, validate bump values.

#### Token Account Safety

```rust
#[account(
    mut,
    associated_token::mint = ctoken_mint,
    associated_token::authority = user,
    associated_token::token_program = ctoken_token_program,
)]
pub user_ctoken_ata: Box<InterfaceAccount<'info, TokenAccount>>,
```

### 11.5 Position Value Accuracy

The vault relies on the `u64` returned by deposit and withdraw to track strategy
positions and compute P&L. Inaccurate values lead to incorrect fee calculations.

```rust
// Always reload accounts after CPI calls before computing position value
ctx.accounts.user_ctoken_ata.reload()?;
ctx.accounts.market.reload()?;

let position_value = ctx
    .accounts
    .market
    .ctoken_to_liquidity(ctx.accounts.user_ctoken_ata.amount);
Ok(position_value)
```

#### Handling Edge Cases (First Deposit)

```rust
fn liquidity_to_ctoken(&self, liquidity_amount: u64) -> u64 {
    if self.liquidity_deposited == 0 {
        return liquidity_amount; // Handle zero supply on first deposit
    }
    (liquidity_amount as u128)
        .checked_mul(self.ctokens_minted as u128)
        .unwrap()
        .checked_div(self.liquidity_deposited as u128)
        .unwrap() as u64
}
```

### 11.6 CPI Safety

```rust
// Delegate validation to the target program
/// CHECK: check in CPI call
#[account(mut)]
pub market_liquidity_ata: AccountInfo<'info>,

// Build CPI contexts carefully
ctoken_market_program::cpi::deposit_market(
    CpiContext::new(
        ctx.accounts.ctoken_market_program.to_account_info(),
        ctoken_market_program::cpi::accounts::DepositOrWithdraw {
            user: ctx.accounts.user.to_account_info(),
            market: ctx.accounts.market.to_account_info(),
            liquidity_mint: ctx.accounts.token_mint.to_account_info(),
            // ... map all required accounts
        },
    ),
    amount,
)?;
```

### 11.7 Arithmetic Safety

Always use checked operations to prevent overflows:

```rust
// Use checked math
let ctoken_amount = amount
    .checked_mul(ctx.accounts.user_ctoken_ata.amount)
    .ok_or(AdaptorError::MathOverflow)?
    .checked_div(authority_holdings)
    .ok_or(AdaptorError::MathOverflow)?;

// Use u128 for intermediate calculations to prevent overflow
let result = (value_a as u128)
    .checked_mul(value_b as u128)
    .unwrap()
    .checked_div(value_c as u128)
    .unwrap() as u64;
```

### 11.8 Token Security

- Strict validation of token program addresses
- Verification of token mint addresses
- Proper authority checks for token operations
- Support for both Token and Token-2022 programs

### 11.9 Testing Requirements

1. **Core Flow Tests** — Deposit, withdraw, and initialize with valid inputs
2. **Edge Cases** — First deposit (zero supply), full withdrawal, zero-amount operations
3. **Position Value Tests** — Verify returned `u64` values match expected position values
4. **Integration Tests** — End-to-end tests with the vault program calling your adaptor
5. **Error Cases** — Invalid accounts, overflow scenarios, unauthorized access

### 11.10 Developer Responsibilities

As a vault/adaptor developer, you are solely responsible for:

- Conducting thorough security reviews and testing
- Obtaining independent security audits before mainnet deployment
- Implementing appropriate access controls and safety mechanisms
- Monitoring and maintaining your deployed contracts
- Responding to security incidents or vulnerabilities
- Ensuring compliance with all applicable laws and regulations

### 11.11 Security Checklist

- [ ] Strategy mapping validation implemented
- [ ] PDA derivation uses consistent seeds with correct program
- [ ] Token account ownership and associations validated
- [ ] All arithmetic uses checked operations
- [ ] u128 used for intermediate multiplication before division
- [ ] Accounts reloaded after CPI calls before computing position value
- [ ] First deposit (zero supply) edge case handled
- [ ] CPI contexts map all required accounts correctly
- [ ] Custom error types defined for all failure scenarios
- [ ] Independent security audit completed before mainnet

---

## 12. Deployed Program Addresses

All programs are deployed on Solana Mainnet:

| Program | Address |
|---|---|
| **Vault** | `vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8` |
| **Lending Adaptor** | `aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz` |
| **Drift Adaptor** | `EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP` |
| **Raydium Adaptor** | `A5a3Xo2JaKbXNShSHHP4Fe1LxcxNuCZs97gy3FJMSzkM` |
| **Kamino Adaptor** | `to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR` |
| **Jupiter Adaptor** | `EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM` |
| **Trustful Adaptor** | `3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ` |

**Upgrade Authority (Multi-sig)**: `7p4d84NuXbuDhaAq9H3Yp3vpBSDLQWousp1a4jBVoBgU`

---

## 13. Go-To-Market Checklist

After your vault is created, strategies are initialized, and funds are allocated, use
this checklist before going live.

### Pre-Launch

- [ ] **Vault created** with correct configuration — [Vault Creation](https://docs.ranger.finance/vault-owners/initialization/create-vault)
- [ ] **LP token metadata set up** — name, symbol, logo — [LP Token Metadata](https://docs.ranger.finance/vault-owners/initialization/lp-metadata)
- [ ] **Strategies initialized** and funds allocated — [Strategy Setup Guide](https://docs.ranger.finance/vault-owners/strategies/setup-guide)
- [ ] **Automation running** — rebalancing, reward claiming — [Running Bots & Scripts](https://docs.ranger.finance/vault-owners/operations/bots-and-scripts)
- [ ] **LP token verified on Jupiter** to avoid wallet warnings — [Token Verification](https://docs.ranger.finance/vault-owners/go-to-market/token-verification)
- [ ] **Contact Ranger team** for indexing and listing — [Indexing & Listing](https://docs.ranger.finance/vault-owners/go-to-market/indexing-and-listing)

### For Yield Protocol Adaptors

- [ ] Adaptor program deployed and verified on-chain
- [ ] All three core instructions implemented and tested (initialize, deposit, withdraw)
- [ ] Position value calculation verified against expected values
- [ ] Edge cases tested (first deposit, full withdrawal, zero amounts)
- [ ] Independent security audit completed
- [ ] Adaptor registered with Ranger team for discovery

### Ongoing Operations

- [ ] Monitor share price trend daily
- [ ] Ensure automation bots are running and funded with SOL
- [ ] Harvest fees periodically
- [ ] Rebalance across strategies as yield rates change
- [ ] Monitor strategy health and protocol risk

---

## 14. Reference Links

| Resource | URL |
|---|---|
| Ranger Earn Docs | https://docs.ranger.finance |
| Ranger Earn SDK Docs | https://voltrxyz.github.io/vault-sdk/ |
| REST API | https://api.voltr.xyz |
| API Interactive Docs | https://api.voltr.xyz/docs |
| Base Scripts | https://github.com/voltrxyz/base-scripts |
| Vault CPI Reference | https://github.com/voltrxyz/vault-cpi |
| Rebalance Bot Template | https://github.com/voltrxyz/rebalance-bot-template |
| Kamino Scripts | https://github.com/voltrxyz/kamino-scripts |
| Drift Scripts | https://github.com/voltrxyz/drift-scripts |
| Jupiter/Spot Scripts | https://github.com/voltrxyz/spot-scripts |
| Lend Scripts | https://github.com/voltrxyz/lend-scripts |
| Raydium CLMM Scripts | https://github.com/voltrxyz/client-raydium-clmm-scripts |
| Trustful Scripts | https://github.com/voltrxyz/trustful-scripts |
| Security Audits | https://docs.ranger.finance/security/audits |
| For Yield Protocols | https://docs.ranger.finance/explore/yield-protocols |
| For Composing Protocols | https://docs.ranger.finance/explore/composing-protocols |
| For Vault Managers | https://docs.ranger.finance/explore/vault-owners |

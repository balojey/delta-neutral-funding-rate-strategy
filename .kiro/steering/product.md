# Product

Voltr Vault Client Scripts is a TypeScript scripting toolkit for interacting with the Voltr Vault protocol on Solana. It provides operational scripts for three roles — admin, manager, and user — to manage yield vaults and deploy capital into DeFi strategies.

## Core Concepts

- **Vault**: An on-chain yield vault that accepts a single asset (e.g. USDC) and issues LP tokens to depositors
- **Strategy**: An external protocol integration (currently Drift spot markets) where vault funds are deployed to earn yield
- **Roles**:
  - **Admin**: Initializes and configures vaults, manages fees, adds adaptors
  - **Manager**: Deploys vault capital into/out of strategies
  - **User**: Deposits/withdraws from vaults, queries positions

## Supported Strategies

- **Drift User Strategy**: Drift spot market with optional margin trading
- **Drift Earn Strategy**: Drift spot market vault (no margin, simpler)

## Key Protocol Details

- All amounts use the token's smallest unit (e.g. `1_000_000` = 1 USDC with 6 decimals; LP tokens always use 9 decimals)
- Fees are expressed in basis points (500 = 5%)
- Address Lookup Tables (LUTs) are used to reduce transaction size for complex strategy interactions
- The vault's `assetMintAddress` must directly match the Drift spot market asset — no swaps occur

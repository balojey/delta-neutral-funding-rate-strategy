import { BN } from "@coral-xyz/anchor";
import { DRIFT } from "../src/constants/drift";

export const depositStrategyAmount = 1_000_000;
export const withdrawStrategyAmount = 1_000_000;

// DRIFT VARIABLES: ONLY MAIN MARKET SUPPORTED, CHANGE AND ALIGN TO ASSET TOKEN
export const driftMarketIndex = DRIFT.SPOT.USDC.MARKET_INDEX;
export const enableMarginTrading = false;

// DIRECT WITHDRAW
export const directWithdrawDiscriminator: number[] = [];

// PERP STRATEGY PARAMETERS
export const perpMarketIndex = DRIFT.PERP.SOL.MARKET_INDEX;
export const shortPerpSizeRatio = 0.40;        // fraction of NAV to deploy as short notional
export const bufferRatio = 0.10;               // fraction of NAV to hold as liquid USDC
export const rebalanceThresholdPct = 2;        // delta deviation % that triggers rebalance
export const minMarginHealthRatio = 1.5;       // health floor; below this, no size increases
export const perpOrderSize = new BN(1_000_000_000); // 1 SOL in base asset units (9 decimals)

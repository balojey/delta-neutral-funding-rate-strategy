import { DriftEnv } from "@drift-labs/sdk";

// Switch scripts to devnet by importing from this file instead of config/base.ts (for driftEnv)
// and replacing DRIFT constants in scripts with DRIFT_DEVNET below.

export const driftEnv: DriftEnv = "devnet";

// Devnet USDC mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
// Set assetMintAddress in config/base.ts to this value when running on devnet.

// Airdrop commands (run before executing scripts on devnet):
//   solana airdrop 2 <ADMIN_PUBKEY>  --url devnet
//   solana airdrop 2 <MANAGER_PUBKEY> --url devnet
//   solana airdrop 2 <USER_PUBKEY>   --url devnet
// For devnet USDC, use the Drift devnet faucet or spl-token mint commands.

export const DRIFT_DEVNET = {
  PROGRAM_ID: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
  LOOKUP_TABLE_ADDRESSES: ["D9cnvzswDikQDf53k4HpQ3KJ9y1Fv3HGGDFYgBpPP84"],
  SUB_ACCOUNT_ID: 0,
  PERP: {
    SOL: { MARKET_INDEX: 1 },
    BTC: { MARKET_INDEX: 2 },
  },
  SPOT: {
    STATE: "8UVjvYyoqP6sqMxiSCnDo7J9248x4DqX8K5f8AQNQQH6",
    SOL: {
      MARKET_INDEX: 1,
      ORACLE: "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix",
    },
    USDC: {
      MARKET_INDEX: 0,
      ORACLE: "5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7",
    },
  },
};

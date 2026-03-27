import "dotenv/config";
import * as fs from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAddressLookupTableAccounts, sendAndConfirmOptimisedTx } from "../utils/helper";
import { BN } from "@coral-xyz/anchor";
import { VoltrClient } from "@voltr/vault-sdk";
import { vaultAddress, lookupTableAddress, useLookupTable } from "../../config/base";
import { perpMarketIndex, rebalanceThresholdPct, minMarginHealthRatio } from "../../config/drift";
import { ADAPTOR_PROGRAM_ID, DRIFT } from "../constants/drift";
import { DriftClient, OrderType, PositionDirection, Wallet } from "@drift-labs/sdk";

const payerKpFile = fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8");
const payerKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerKpFile)));
const payer = payerKp.publicKey;

const vault = new PublicKey(vaultAddress);
const connection = new Connection(process.env.HELIUS_RPC_URL!);
const vc = new VoltrClient(connection);

// Pure helpers — safe to unit test
export const shouldRebalance = (
  spotNotional: number,
  perpNotional: number,
  totalNav: number
): boolean => {
  const delta = spotNotional - Math.abs(perpNotional);
  return Math.abs(delta) / totalNav > rebalanceThresholdPct / 100;
};

export const shouldIncreaseShort = (healthRatio: number, _deltaRequiresIncrease: boolean): boolean => {
  return healthRatio >= minMarginHealthRatio && _deltaRequiresIncrease;
};

export const getAction = (
  healthRatio: number,
  positionSize: number
): { type: "reduce"; size: number; reduceOnly: true } | null => {
  if (healthRatio < 1.2) {
    return { type: "reduce", size: positionSize * 0.5, reduceOnly: true };
  }
  return null;
};

const rebalanceDelta = async (
  protocolProgram: PublicKey,
  spotMarketIndex: number,
  marketIndex: number,
  subAccountId: BN,
  lookupTableAddresses: string[]
) => {
  const [strategy] = PublicKey.findProgramAddressSync(
    [Buffer.from("drift_user")],
    new PublicKey(ADAPTOR_PROGRAM_ID)
  );

  const { vaultStrategyAuth } = vc.findVaultStrategyAddresses(vault, strategy);

  const [user] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), vaultStrategyAuth.toBuffer(), subAccountId.toArrayLike(Buffer, "le", 2)],
    protocolProgram
  );

  const [userStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_stats"), vaultStrategyAuth.toBuffer()],
    protocolProgram
  );

  const driftClient = new DriftClient({
    connection,
    wallet: new Wallet(payerKp),
    env: "mainnet-beta",
    skipLoadUsers: true,
  });

  await driftClient.subscribe();

  try {
    const driftUser = driftClient.getUser(subAccountId.toNumber(), vaultStrategyAuth);

    let healthRatio: number;
    try {
      healthRatio = driftUser.getHealth() / 100;
    } catch (e) {
      throw new Error(`Cannot read margin health ratio: ${e}. Halting to avoid unsafe operation.`);
    }

    const perpPosition = driftUser.getPerpPosition(marketIndex);
    const currentShortSize = perpPosition ? perpPosition.baseAssetAmount.abs() : new BN(0);

    // Critical health: reduce-only 50% regardless of delta
    const criticalAction = getAction(healthRatio, currentShortSize.toNumber());
    if (criticalAction) {
      console.warn(`WARNING: Health ratio ${healthRatio} below 1.2. Submitting reduce-only order.`);
      const reduceSize = new BN(Math.floor(criticalAction.size));
      const orderParams = {
        orderType: OrderType.MARKET,
        direction: PositionDirection.LONG,
        baseAssetAmount: reduceSize,
        marketIndex,
        reduceOnly: true,
      };
      const ix = await driftClient.getPlaceAndTakePerpOrderIx(orderParams);
      const remainingAccounts = driftClient.getRemainingAccounts({
        userAccounts: [driftUser.getUserAccount()],
        writablePerpMarketIndexes: [marketIndex],
      });
      ix.keys.push(...remainingAccounts);
      const lutAccounts = await getAddressLookupTableAccounts(lookupTableAddresses, connection);
      const txSig = await sendAndConfirmOptimisedTx([ix], process.env.HELIUS_RPC_URL!, payerKp, [], lutAccounts);
      console.log(`Reduced short by 50% (health guard). Tx:`, txSig);
      return;
    }

    // Compute delta
    const freeCollateral = driftUser.getFreeCollateral();
    const totalNav = freeCollateral.toNumber();

    const spotPosition = driftUser.getSpotPosition(spotMarketIndex);
    const spotNotional = spotPosition ? spotPosition.scaledBalance.toNumber() : 0;
    const perpNotional = perpPosition ? perpPosition.baseAssetAmount.toNumber() : 0;

    if (!shouldRebalance(spotNotional, perpNotional, totalNav)) {
      console.log("No rebalance needed — delta within threshold.");
      return;
    }

    const delta = spotNotional - Math.abs(perpNotional);
    const deltaRequiresIncrease = delta > 0; // spot > perp notional → need bigger short

    if (deltaRequiresIncrease && healthRatio < minMarginHealthRatio) {
      console.warn(`WARNING: Health ratio ${healthRatio} below minMarginHealthRatio. Skipping short increase.`);
      return;
    }

    const adjustmentSize = new BN(Math.floor(Math.abs(delta) / 2));
    const direction = deltaRequiresIncrease ? PositionDirection.SHORT : PositionDirection.LONG;

    const orderParams = {
      orderType: OrderType.MARKET,
      direction,
      baseAssetAmount: adjustmentSize,
      marketIndex,
    };

    const ix = await driftClient.getPlaceAndTakePerpOrderIx(orderParams);
    const remainingAccounts = driftClient.getRemainingAccounts({
      userAccounts: [driftUser.getUserAccount()],
      writablePerpMarketIndexes: [marketIndex],
    });
    ix.keys.push(...remainingAccounts);

    const lutAccounts = await getAddressLookupTableAccounts(lookupTableAddresses, connection);
    const txSig = await sendAndConfirmOptimisedTx([ix], process.env.HELIUS_RPC_URL!, payerKp, [], lutAccounts);

    const newDelta = delta - (deltaRequiresIncrease ? adjustmentSize.toNumber() : -adjustmentSize.toNumber());
    console.log(`Rebalanced. New delta: ${newDelta}. Tx:`, txSig);
  } finally {
    await driftClient.unsubscribe();
  }
};

const main = async () => {
  await rebalanceDelta(
    new PublicKey(DRIFT.PROGRAM_ID),
    DRIFT.SPOT.USDC.MARKET_INDEX,
    perpMarketIndex,
    new BN(DRIFT.SUB_ACCOUNT_ID),
    useLookupTable
      ? [...DRIFT.LOOKUP_TABLE_ADDRESSES, lookupTableAddress]
      : [...DRIFT.LOOKUP_TABLE_ADDRESSES]
  );
};

main();

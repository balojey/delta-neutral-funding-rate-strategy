import "dotenv/config";
import * as fs from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAddressLookupTableAccounts, sendAndConfirmOptimisedTx } from "../utils/helper";
import { BN } from "@coral-xyz/anchor";
import { VoltrClient } from "@voltr/vault-sdk";
import { vaultAddress, lookupTableAddress, useLookupTable } from "../../config/base";
import { perpMarketIndex } from "../../config/drift";
import { ADAPTOR_PROGRAM_ID } from "../constants/drift";
import { driftEnv, DRIFT } from "../utils/cluster";
import { DriftClient, OrderType, PositionDirection, Wallet } from "@drift-labs/sdk";

const payerKpFile = fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8");
const payerKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerKpFile)));
const payer = payerKp.publicKey;

const vault = new PublicKey(vaultAddress);
const connection = new Connection(process.env.HELIUS_RPC_URL!);
const vc = new VoltrClient(connection);

// Pure helper — no SDK calls, safe to unit test
export const shouldSubmitClose = (
  perpPosition: { baseAssetAmount: BN } | null | undefined
): boolean => {
  if (!perpPosition) return false;
  return !perpPosition.baseAssetAmount.isZero();
};

const closeShortPerp = async (
  protocolProgram: PublicKey,
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
    env: driftEnv,
    skipLoadUsers: true,
  });

  await driftClient.subscribe();

  try {
    const driftUser = driftClient.getUser(subAccountId.toNumber(), vaultStrategyAuth);
    const perpPosition = driftUser.getPerpPosition(marketIndex);

    if (!shouldSubmitClose(perpPosition)) {
      console.log("No open short position to close.");
      return;
    }

    const closeSize = perpPosition!.baseAssetAmount.abs();

    const orderParams = {
      orderType: OrderType.MARKET,
      direction: PositionDirection.LONG,
      baseAssetAmount: closeSize,
      marketIndex,
      reduceOnly: true,
    };

    const ix = await driftClient.getPlaceAndTakePerpOrderIx(orderParams);

    const remainingAccounts = driftClient.getRemainingAccounts({
      userAccounts: [driftUser.getUserAccount()],
      writablePerpMarketIndexes: [marketIndex],
    });

    ix.keys.push(...remainingAccounts);

    const lookupTableAccounts = await getAddressLookupTableAccounts(lookupTableAddresses, connection);

    const txSig = await sendAndConfirmOptimisedTx(
      [ix],
      process.env.HELIUS_RPC_URL!,
      payerKp,
      [],
      lookupTableAccounts
    );

    console.log(`Closed short position of size ${closeSize.toString()}. Tx:`, txSig);
  } finally {
    await driftClient.unsubscribe();
  }
};

const main = async () => {
  await closeShortPerp(
    new PublicKey(DRIFT.PROGRAM_ID),
    perpMarketIndex,
    new BN(DRIFT.SUB_ACCOUNT_ID),
    useLookupTable
      ? [...DRIFT.LOOKUP_TABLE_ADDRESSES, lookupTableAddress]
      : [...DRIFT.LOOKUP_TABLE_ADDRESSES]
  );
};

main();

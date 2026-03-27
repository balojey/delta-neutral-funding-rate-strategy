import "dotenv/config";
import * as fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAddressLookupTableAccounts,
  sendAndConfirmOptimisedTx,
  setupTokenAccount,
} from "../utils/helper";
import { BN } from "@coral-xyz/anchor";
import { VoltrClient } from "@voltr/vault-sdk";
import {
  assetMintAddress,
  assetTokenProgram,
  vaultAddress,
  lookupTableAddress,
  useLookupTable,
} from "../../config/base";
import { driftMarketIndex, perpMarketIndex, minMarginHealthRatio } from "../../config/drift";
import { ADAPTOR_PROGRAM_ID, DISCRIMINATOR, DRIFT } from "../constants/drift";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const payerKpFile = fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8");
const payerKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerKpFile)));
const payer = payerKp.publicKey;

const vault = new PublicKey(vaultAddress);
const vaultAssetMint = new PublicKey(assetMintAddress);
const vaultAssetTokenProgram = new PublicKey(assetTokenProgram);

const connection = new Connection(process.env.HELIUS_RPC_URL!);
const vc = new VoltrClient(connection);

// Pure helper — safe to unit test
export const computeWithdrawable = (freeCollateral: BN, requiredMargin: BN): BN => {
  const withdrawable = freeCollateral.sub(requiredMargin);
  return withdrawable.gtn(0) ? withdrawable : new BN(0);
};

const compoundYield = async (
  protocolProgram: PublicKey,
  spotMarketIndex: number,
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

  const [counterPartyTa] = PublicKey.findProgramAddressSync(
    [Buffer.from("spot_market_vault"), new BN(spotMarketIndex).toArrayLike(Buffer, "le", 2)],
    protocolProgram
  );

  const [driftSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("drift_signer")],
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

    const freeCollateral = driftUser.getFreeCollateral();

    // Compute required margin from current short notional / minMarginHealthRatio
    const perpPosition = driftUser.getPerpPosition(perpMarketIndex);
    const shortNotional = perpPosition ? perpPosition.baseAssetAmount.abs() : new BN(0);
    const requiredMargin = shortNotional.divn(minMarginHealthRatio);

    const withdrawable = computeWithdrawable(freeCollateral, requiredMargin);

    if (withdrawable.isZero()) {
      console.log("No yield available to compound.");
      return;
    }

    const lutAccounts = await getAddressLookupTableAccounts(lookupTableAddresses, connection);
    const userAccounts = await driftClient.getUserAccountsForAuthority(vaultStrategyAuth);

    // --- Withdraw ---
    const withdrawIxs: TransactionInstruction[] = [];
    await setupTokenAccount(connection, payer, vaultAssetMint, vaultStrategyAuth, withdrawIxs, vaultAssetTokenProgram);

    const withdrawRemainingAccounts = [
      { pubkey: driftSigner, isSigner: false, isWritable: true },
      { pubkey: counterPartyTa, isSigner: false, isWritable: true },
      { pubkey: protocolProgram, isSigner: false, isWritable: false },
      { pubkey: userStats, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(DRIFT.SPOT.STATE), isSigner: false, isWritable: false },
      ...driftClient.getRemainingAccounts({
        userAccounts,
        useMarketLastSlotCache: false,
        writableSpotMarketIndexes: [spotMarketIndex],
      }),
    ];

    if (vaultAssetTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      withdrawRemainingAccounts.push({ pubkey: vaultAssetMint, isSigner: false, isWritable: false });
    }

    const withdrawIx = await vc.createWithdrawStrategyIx(
      {
        instructionDiscriminator: Buffer.from(DISCRIMINATOR.WITHDRAW_USER),
        withdrawAmount: withdrawable,
        additionalArgs: Buffer.from([...new BN(spotMarketIndex).toArrayLike(Buffer, "le", 2)]),
      },
      {
        manager: payer,
        vault,
        vaultAssetMint,
        assetTokenProgram: vaultAssetTokenProgram,
        strategy,
        remainingAccounts: withdrawRemainingAccounts,
        adaptorProgram: new PublicKey(ADAPTOR_PROGRAM_ID),
      }
    );

    withdrawIxs.push(withdrawIx);
    const txSig1 = await sendAndConfirmOptimisedTx(withdrawIxs, process.env.HELIUS_RPC_URL!, payerKp, [], lutAccounts);
    console.log("Yield withdrawn. Tx:", txSig1);

    // --- Re-deposit ---
    const depositIxs: TransactionInstruction[] = [];
    await setupTokenAccount(connection, payer, vaultAssetMint, vaultStrategyAuth, depositIxs, vaultAssetTokenProgram);

    const depositRemainingAccounts = [
      { pubkey: counterPartyTa, isSigner: false, isWritable: true },
      { pubkey: protocolProgram, isSigner: false, isWritable: false },
      { pubkey: userStats, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(DRIFT.SPOT.STATE), isSigner: false, isWritable: false },
      ...driftClient.getRemainingAccounts({
        userAccounts,
        useMarketLastSlotCache: false,
        writableSpotMarketIndexes: [spotMarketIndex],
      }),
    ];

    if (vaultAssetTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      depositRemainingAccounts.push({ pubkey: vaultAssetMint, isSigner: false, isWritable: false });
    }

    const depositIx = await vc.createDepositStrategyIx(
      {
        instructionDiscriminator: Buffer.from(DISCRIMINATOR.DEPOSIT_USER),
        depositAmount: withdrawable,
        additionalArgs: Buffer.from([...new BN(spotMarketIndex).toArrayLike(Buffer, "le", 2)]),
      },
      {
        manager: payer,
        vault,
        vaultAssetMint,
        assetTokenProgram: vaultAssetTokenProgram,
        strategy,
        remainingAccounts: depositRemainingAccounts,
        adaptorProgram: new PublicKey(ADAPTOR_PROGRAM_ID),
      }
    );

    depositIxs.push(depositIx);
    const txSig2 = await sendAndConfirmOptimisedTx(depositIxs, process.env.HELIUS_RPC_URL!, payerKp, [], lutAccounts);
    console.log(`Compounded ${withdrawable.toString()} units. Withdraw tx: ${txSig1}, Deposit tx: ${txSig2}`);
  } finally {
    await driftClient.unsubscribe();
  }
};

const main = async () => {
  await compoundYield(
    new PublicKey(DRIFT.PROGRAM_ID),
    driftMarketIndex,
    new BN(DRIFT.SUB_ACCOUNT_ID),
    useLookupTable
      ? [...DRIFT.LOOKUP_TABLE_ADDRESSES, lookupTableAddress]
      : [...DRIFT.LOOKUP_TABLE_ADDRESSES]
  );
};

main();

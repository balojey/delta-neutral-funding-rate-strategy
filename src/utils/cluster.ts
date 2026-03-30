import { DriftEnv } from "@drift-labs/sdk";
import { DRIFT as DRIFT_MAINNET } from "../constants/drift";
import { DRIFT_DEVNET, driftEnv as devnetEnv } from "../../config/devnet";

/**
 * Read CLUSTER env var to select mainnet-beta or devnet constants at runtime.
 *
 * Usage:
 *   CLUSTER=devnet pnpm ts-node src/scripts/<script>.ts
 *   CLUSTER=mainnet-beta pnpm ts-node src/scripts/<script>.ts  (default)
 */
const cluster = (process.env.CLUSTER ?? "mainnet-beta") as DriftEnv;

if (cluster !== "mainnet-beta" && cluster !== "devnet") {
  throw new Error(`Invalid CLUSTER value "${cluster}". Must be "mainnet-beta" or "devnet".`);
}

export const driftEnv: DriftEnv = cluster;

export const DRIFT =
  cluster === "devnet"
    ? DRIFT_DEVNET
    : DRIFT_MAINNET;

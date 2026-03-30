export interface CacheOptions {
  cacheDir: string;
  cacheKey: string;
}

export interface FundingRateRecord {
  timestamp: number;
  market: string;
  fundingRate: number;
}

export interface LendingRateRecord {
  timestamp: number;
  annualisedRate: number;
}

export interface PriceRecord {
  timestamp: number;
  closePrice: number;
}

export interface AlignedTick {
  timestamp: number;
  fundingRate: number;
  lendingRate: number;
  solPrice: number;
}

export interface SimulatorParams {
  initialCapital: number;
  shortPerpSizeRatio: number;
  bufferRatio: number;
  rebalanceThresholdPct: number;
  minMarginHealthRatio: number;
}

export interface TickSnapshot {
  timestamp: number;
  nav: number;
  spotBalance: number;
  buffer: number;
  shortNotional: number;
  shortSizeInSol: number;
  delta: number;
  marginHealth: number;
  fundingPayment: number;
  lendingYield: number;
  rebalanced: boolean;
  marginBreached: boolean;
  solPrice: number;
}

export interface SimulationMetrics {
  blendedAPY: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  rebalanceCount: number;
  negativeFundingHours: number;
  healthBreachesBelow1_5: number;
  healthBreachesBelow1_2: number;
  worstWindow30dAPY: number;
  totalHours: number;
  initialNAV: number;
  finalNAV: number;
}

export interface GridParams {
  shortPerpSizeRatio: number;
  rebalanceThresholdPct: number;
  minMarginHealthRatio: number;
  market: "SOL-PERP" | "BTC-PERP";
}

export interface GridResult extends GridParams, SimulationMetrics {}

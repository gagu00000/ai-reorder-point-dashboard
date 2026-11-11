/**
 * Shapes of the JSON files produced by `scripts/preprocess.py` and
 * `notebooks/02_reference_models_and_lstm.ipynb`, plus the in-memory dataset.
 * Units: demand in units/day, lead time in days.
 */

export const WEATHER_CODES = ["Cloudy", "Rainy", "Snowy", "Sunny"] as const;
export type WeatherCode = (typeof WEATHER_CODES)[number];

/** Exogenous drivers for a target day, in model order (shared with Python). */
export const EXOG_FEATURES = [
  "promotion", "epidemic", "w_rainy", "w_snowy", "w_sunny", "sin1", "cos1", "sin2", "cos2",
] as const;
export const N_EXOG = EXOG_FEATURES.length;

export interface SeriesFile {
  meta: {
    source: string;
    sourceUrl: string;
    license: string;
    generatedAt: string;
    startDate: string;
    endDate: string;
    nDays: number;
    units: Record<string, string>;
    split: {
      trainEnd: string; trainEndIdx: number;
      valStart: string; valEnd: string; valEndIdx: number;
      holdoutStart: string; holdoutStartIdx: number; holdoutEnd: string;
    };
    weatherCodes: string[];
    excludedColumns: { leakage: string[]; redundantFeature: string[] };
    target: string;
  };
  dates: string[];
  epidemic: number[];
  stores: { id: string; region: string; weather: number[] }[];
  skus: {
    id: string;
    store: string;
    product: string;
    category: string;
    demand: number[];
    unitsSold: number[];
    inventory: number[];
    unitsOrdered: number[];
    promotion: number[];
    discount: number[];
  }[];
}

export interface LeadTimeDistribution {
  values: number[];
  probs: number[];
  mean: number;
  sd: number;
  n: number;
}

export interface LeadTimesFile {
  method: string;
  assumption: string;
  totalOrders: number;
  matchedOrders: number;
  overall: LeadTimeDistribution;
  stores: Record<string, LeadTimeDistribution>;
  skus: Record<string, { L: number; sd: number; nOrders: number; unmatched: number }>;
}

export interface CostsFile {
  defaults: { holdingRatePerYear: number; orderCost: number; marginRate: number; daysPerYear: number };
  skus: Record<string, {
    medianPrice: number;
    maxInventory: number;
    orderQty: { min: number; median: number; max: number };
    asIs: { stockoutDayRate: number; avgInventory: number; ordersPerYear: number; fillRate: number };
  }>;
}

export interface LeaderboardRow {
  MAE: number; RMSE: number; WAPE: number; MAPE: number; sMAPE: number; Bias: number; MASE: number;
}

export interface ModelConfig {
  generatedAt: string;
  horizon: number;
  minHistory: number;
  exogFeatures: string[];
  futureEpidemic: string;
  ridge: { alpha: number; features: string[]; alphaGrid: Record<string, Record<string, number>> };
  ets: { bounds: Record<"smoothing_level" | "smoothing_trend" | "damping_trend", [number, number]>; initialState: string; selection: string };
  lstm: {
    weightsFile: string; window: number; trainedThroughIdx: number; epochs: number; bestEpoch: number;
    loss: number[]; valLoss: number[]; scales: Record<string, number>;
  };
  ensemble: { members: string[]; weights: Record<string, number>; rule: string };
  intervals: { source: string; byModel: Record<string, Record<"q025" | "q100" | "q900" | "q975", number[]>> };
  backtest: {
    validation: { origins: string[]; leaderboard: Record<"h1" | "h7" | "h14", Record<string, LeaderboardRow>> };
    holdout: {
      origins: string[];
      leaderboard: Record<"h1" | "h7" | "h14", Record<string, LeaderboardRow>>;
      intervalCoverage: Record<string, Record<string, number>>;
    };
  };
}

export interface LstmWeightsFile {
  format: "lstm-forecaster/v1";
  window: number;
  horizon: number;
  units: number;
  dense: number;
  encoderFeatures: string[];
  futureFeatures: string[];
  recurrentActivation: string;
  trainedThroughIdx: number;
  trainedThrough: string;
  layers: { name: "lstm" | "dense_hidden" | "dense_out"; weights: { shape: number[]; data: string }[] }[];
}

/** One SKU (store-product pair) held as typed arrays for fast numeric work. */
export interface SkuSeries {
  id: string;
  store: string;
  storeIndex: number;
  product: string;
  category: string;
  demand: Float64Array;
  unitsSold: Float64Array;
  inventory: Float64Array;
  unitsOrdered: Float64Array;
  promotion: Float64Array;
  discount: Float64Array;
}

export interface Dataset {
  dates: string[];
  epidemic: Float64Array;
  stores: { id: string; region: string; weather: Int8Array }[];
  skus: SkuSeries[];
  split: SeriesFile["meta"]["split"];
}

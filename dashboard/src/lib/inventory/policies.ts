/**
 * Reorder-point designs compared on the dashboard.
 *
 *   Baseline calculator  slide formula with static history: D̄ = historical mean, σ_D = historical sd.
 *   AI-enhanced          slide formula with predictive inputs: D̄ = forecast demand over the coming
 *                        lead time, σ_D = sd of forecast errors (what remains uncertain after forecasting).
 *   + Monte Carlo        reorder point = simulated service-level quantile of demand during lead time,
 *                        correcting the formula's Normal assumption (skewed demand / lead times).
 *   Adaptive             the AI design recomputed every day from a forecast made with data up to yesterday.
 */
import { mean, std } from "../stats/descriptive";
import { constantMean, demeaned, type DemandModel } from "./demandModel";
import { leadTimeMoments, type LeadTimeModel } from "./leadTimeModel";
import { monteCarloReorderPoint, simulateDdlt, stockoutProbability } from "./monteCarlo";
import { computeSafetyStock, type SafetyStockResult } from "./safetyStock";

export interface MonteCarloSummary {
  trials: number;
  mean: number;
  sd: number;
  skewness: number;
  reorderPoint: number;
  safetyStock: number;
  /** Stockout probability per cycle if the formula's reorder point were used instead. */
  formulaStockoutProbability: number;
}

export interface PolicyDesign {
  label: string;
  formula: SafetyStockResult;
  /** The reorder point this design actually uses (formula or Monte Carlo). */
  reorderPoint: number;
  method: "formula" | "monte-carlo";
  demandModel: DemandModel;
  leadTime: LeadTimeModel;
  monteCarlo?: MonteCarloSummary;
}

/** Baseline calculator: static historical mean and sd of demand over days 0..origin. */
export function baselineDesign(
  demand: ArrayLike<number>, origin: number, leadTime: LeadTimeModel, serviceLevel: number,
): PolicyDesign {
  const history = Float64Array.from({ length: origin + 1 }, (_, i) => demand[i]);
  const lt = leadTimeMoments(leadTime);
  const formula = computeSafetyStock({
    serviceLevel, dBar: mean(history), sigmaD: std(history, 1), leadTime: lt.mean, sigmaL: lt.sd,
  });
  return {
    label: "Baseline calculator",
    formula,
    reorderPoint: formula.reorderPoint,
    method: "formula",
    demandModel: { kind: "bootstrap", meanPath: constantMean(formula.dBar), residuals: demeaned(history) },
    leadTime,
  };
}

/**
 * AI-enhanced design. `forecast` starts the day after the origin; `residuals` are past forecast
 * errors (y − f). D̄ is the forecast mean over the next ⌈E[L]⌉ days.
 */
export function forecastDesign(
  forecast: ArrayLike<number>, residuals: ArrayLike<number>, leadTime: LeadTimeModel, serviceLevel: number,
): PolicyDesign {
  const lt = leadTimeMoments(leadTime);
  const window = Math.max(1, Math.min(forecast.length, Math.ceil(lt.mean)));
  const formula = computeSafetyStock({
    serviceLevel, dBar: mean(forecast, 0, window), sigmaD: std(residuals, 1), leadTime: lt.mean, sigmaL: lt.sd,
  });
  return {
    label: "AI-enhanced",
    formula,
    reorderPoint: formula.reorderPoint,
    method: "formula",
    demandModel: { kind: "bootstrap", meanPath: Float64Array.from(forecast), residuals: Float64Array.from(residuals) },
    leadTime,
  };
}

/** Replace the formula's reorder point by the Monte Carlo service-level quantile. */
export function withMonteCarlo(design: PolicyDesign, trials: number, seed: number): PolicyDesign {
  const r = simulateDdlt({ trials, seed, leadTime: design.leadTime, demand: design.demandModel });
  const sl = design.formula.serviceLevel;
  const rop = monteCarloReorderPoint(r, sl);
  return {
    ...design,
    label: `${design.label} + Monte Carlo`,
    reorderPoint: rop,
    method: "monte-carlo",
    monteCarlo: {
      trials,
      mean: r.mean,
      sd: r.sd,
      skewness: r.skewness,
      reorderPoint: rop,
      safetyStock: rop - r.mean,
      formulaStockoutProbability: stockoutProbability(r, design.formula.reorderPoint),
    },
  };
}

/**
 * Forecast errors (y − f) for horizons 1..maxH from the given origins: the uncertainty that remains
 * after forecasting, used as σ_D and as the bootstrap pool of the AI design.
 */
export function forecastResiduals(
  demand: ArrayLike<number>, origins: number[], maxH: number,
  forecastAt: (origin: number) => ArrayLike<number>,
): Float64Array {
  const out: number[] = [];
  for (const o of origins) {
    const f = forecastAt(o);
    for (let h = 1; h <= maxH && o + h < demand.length; h++) out.push(demand[o + h] - f[h - 1]);
  }
  return Float64Array.from(out);
}

/**
 * Adaptive AI reorder point for each day in [fromDay, toDay): forecast with data up to the previous
 * day, then size the reorder point (Monte Carlo quantile or formula).
 */
export function adaptiveReorderPoints(o: {
  fromDay: number;
  toDay: number;
  forecastAt: (origin: number) => ArrayLike<number>;
  residuals: ArrayLike<number>;
  leadTime: LeadTimeModel;
  serviceLevel: number;
  monteCarloTrials: number | null;
  seed: number;
}): Float64Array {
  const out = new Float64Array(o.toDay - o.fromDay);
  for (let t = o.fromDay; t < o.toDay; t++) {
    const design = forecastDesign(o.forecastAt(t - 1), o.residuals, o.leadTime, o.serviceLevel);
    out[t - o.fromDay] = o.monteCarloTrials
      ? withMonteCarlo(design, o.monteCarloTrials, o.seed + t).reorderPoint
      : design.reorderPoint;
  }
  return out;
}

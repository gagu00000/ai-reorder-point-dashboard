/**
 * Shared building blocks for the engine services: per-SKU context (lead time, costs), the AI
 * forecaster used for planning (ridge — best on validation and holdout), the pool of recent
 * forecast errors, and the optimisation problem specification.
 */
import { skuIndexById } from "../lib/data/dataset";
import { buildExog } from "../lib/data/features";
import type { SkuSeries } from "../lib/data/types";
import { ridgeForecast } from "../lib/forecasting/ridge";
import { skuCostParams, type CostParams, type CostSettings } from "../lib/inventory/cost";
import { demeaned } from "../lib/inventory/demandModel";
import { empiricalLeadTime, gammaLeadTime, leadTimeMoments, type LeadTimeModel } from "../lib/inventory/leadTimeModel";
import { forecastResiduals } from "../lib/inventory/policies";
import type { ProblemSpec, ServiceMetric } from "../lib/optimization/inventoryProblem";
import type { AppData } from "./appData";

export const HORIZON = 14;
/** Forecast errors come from daily origins in the 90 days before the planning origin (horizons 1–7). */
export const RESIDUAL_WINDOW = 90;
export const RESIDUAL_HORIZON = 7;

export interface LeadTimeChoice {
  model: "gamma" | "empirical";
  /** Overrides of the data-derived mean / sd (days); null keeps the data value. */
  mean: number | null;
  sd: number | null;
}

export interface SkuContext {
  index: number;
  sku: SkuSeries;
  costs: CostParams;
  dataLeadTime: { mean: number; sd: number };
  storePool: { values: number[]; probs: number[]; mean: number; sd: number };
}

export function skuContext(data: AppData, skuId: string, costOverrides: Partial<CostSettings> = {}): SkuContext {
  const index = skuIndexById(data.dataset, skuId);
  const sku = data.dataset.skus[index];
  const pool = data.leadTimes.stores[sku.store];
  return {
    index,
    sku,
    costs: skuCostParams(data.costs, skuId, costOverrides),
    dataLeadTime: { mean: data.leadTimes.skus[skuId].L, sd: pool.sd },
    storePool: { values: pool.values, probs: pool.probs, mean: pool.mean, sd: pool.sd },
  };
}

export function resolveLeadTime(ctx: SkuContext, choice: LeadTimeChoice): LeadTimeModel {
  if (choice.model === "empirical") return empiricalLeadTime(ctx.storePool);
  return gammaLeadTime(choice.mean ?? ctx.dataLeadTime.mean, choice.sd ?? ctx.dataLeadTime.sd);
}

export function leadTimeSummary(model: LeadTimeModel) {
  return leadTimeMoments(model);
}

/** Memoised ridge forecaster for one SKU (14-day forecasts from any origin). */
export function ridgeForecaster(data: AppData, ctx: SkuContext): (origin: number) => Float64Array {
  const cache = new Map<number, Float64Array>();
  return (origin) => {
    let f = cache.get(origin);
    if (!f) {
      f = ridgeForecast(ctx.sku.demand, buildExog(data.dataset, ctx.index, origin, HORIZON), origin, HORIZON, data.config.ridge.alpha);
      cache.set(origin, f);
    }
    return f;
  };
}

/** Errors (actual − forecast) of the planning forecaster over the 90 days before `origin`. */
export function recentForecastErrors(ctx: SkuContext, origin: number, forecastAt: (o: number) => ArrayLike<number>): Float64Array {
  const first = Math.max(60, origin - RESIDUAL_WINDOW);
  const origins: number[] = [];
  for (let o = first; o + RESIDUAL_HORIZON <= origin; o++) origins.push(o);
  return forecastResiduals(ctx.sku.demand, origins, RESIDUAL_HORIZON, forecastAt);
}

export interface OptimizationSettings {
  demandBasis: "ai" | "baseline";
  serviceMetric: ServiceMetric;
  serviceTarget: number;
  /** Maximum average inventory value (currency) or null. */
  budget: number | null;
  /** Storage capacity (units) or null. */
  capacity: number | null;
  /** Minimum and maximum order quantity (supplier limits). */
  minOrder: number | null;
  maxOrder: number | null;
  /** "rq" optimises reorder point and order quantity; "r" fixes Q at EOQ. */
  mode: "rq" | "r";
  evaluations: number;
  costs: { holdingRatePerYear: number; orderCost: number; marginRate: number };
  leadTime: LeadTimeChoice;
}

export function defaultOptimizationSettings(data: AppData): OptimizationSettings {
  const d = data.costs.defaults;
  return {
    demandBasis: "ai",
    serviceMetric: "cycleServiceLevel",
    serviceTarget: 0.95,
    budget: null,
    capacity: null,
    minOrder: null,
    maxOrder: null,
    mode: "rq",
    evaluations: 45,
    costs: { holdingRatePerYear: d.holdingRatePerYear, orderCost: d.orderCost, marginRate: d.marginRate },
    leadTime: { model: "gamma", mean: null, sd: null },
  };
}

/** Problem specification for Bayesian optimisation, planned from data up to `origin`. */
export function buildProblemSpec(data: AppData, skuId: string, origin: number, s: OptimizationSettings, seed = 42): ProblemSpec {
  const ctx = skuContext(data, skuId, s.costs);
  const lt = leadTimeMoments(resolveLeadTime(ctx, s.leadTime));
  let demand: ProblemSpec["demand"];
  if (s.demandBasis === "ai") {
    const forecastAt = ridgeForecaster(data, ctx);
    demand = { kind: "bootstrap", meanPath: forecastAt(origin), residuals: recentForecastErrors(ctx, origin, forecastAt) };
  } else {
    const history = Float64Array.from({ length: origin + 1 }, (_, k) => ctx.sku.demand[k]);
    let m = 0;
    for (const v of history) m += v;
    demand = { kind: "bootstrap", meanPath: [m / history.length], residuals: demeaned(history) };
  }
  const minOrder = s.minOrder ?? data.costs.skus[skuId].orderQty.min;
  return {
    demand,
    leadTime: lt,
    costs: ctx.costs,
    service: { metric: s.serviceMetric, target: s.serviceTarget },
    budget: s.budget,
    capacity: s.capacity,
    orderQtyLimits: { min: minOrder, max: s.maxOrder ?? Number.POSITIVE_INFINITY },
    horizonDays: 365,
    paths: 8,
    seed,
    fixedOrderQuantity: null,
  };
}

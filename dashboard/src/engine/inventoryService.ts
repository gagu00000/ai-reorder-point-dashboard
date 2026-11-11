/**
 * Step 2 services: the slide's safety-stock formula next to Monte Carlo for the baseline and
 * AI-enhanced designs, and the holdout replay of every policy (as-is, baseline, AI, optimised).
 */
import { asIsMetrics } from "../lib/inventory/asIs";
import { economicOrderQuantity, type CostSettings } from "../lib/inventory/cost";
import { leadTimeMoments } from "../lib/inventory/leadTimeModel";
import { ddltHistogram, simulateDdlt, stockoutProbability, monteCarloReorderPoint, type HistogramBin } from "../lib/inventory/monteCarlo";
import { adaptiveReorderPoints, baselineDesign, forecastDesign, type PolicyDesign } from "../lib/inventory/policies";
import type { PolicyMetrics } from "../lib/inventory/policySim";
import { replayPolicies, type ReplayPolicy } from "../lib/inventory/replay";
import type { SafetyStockResult } from "../lib/inventory/safetyStock";
import type { AppData } from "./appData";
import { recentForecastErrors, resolveLeadTime, ridgeForecaster, skuContext, type LeadTimeChoice } from "./planning";

export interface SafetyStockRequest {
  skuId: string;
  origin: number;
  serviceLevel: number;
  leadTime: LeadTimeChoice;
  trials: number;
  seed: number;
}

export interface DesignView {
  label: string;
  formula: SafetyStockResult;
  monteCarlo: {
    trials: number;
    mean: number;
    sd: number;
    skewness: number;
    reorderPoint: number;
    safetyStock: number;
    /** Stockout probability per cycle if the formula's reorder point is used. */
    formulaStockoutProbability: number;
  };
  histogram: HistogramBin[];
}

export interface SafetyStockResponse {
  skuId: string;
  origin: number;
  leadTime: {
    kind: "gamma" | "empirical";
    mean: number;
    sd: number;
    dataMean: number;
    dataSd: number;
    store: string;
    density: { x: number; y: number }[];          // Gamma density (days)
    storePool: { values: number[]; probs: number[] };
  };
  baseline: DesignView;
  ai: DesignView;
  forecastPath: number[];
  forecastErrorSd: number;
  historicalSd: number;
}

function view(design: PolicyDesign, trials: number, seed: number): DesignView {
  const r = simulateDdlt({ trials, seed, leadTime: design.leadTime, demand: design.demandModel });
  const sl = design.formula.serviceLevel;
  const rop = monteCarloReorderPoint(r, sl);
  return {
    label: design.label,
    formula: design.formula,
    monteCarlo: {
      trials, mean: r.mean, sd: r.sd, skewness: r.skewness, reorderPoint: rop, safetyStock: rop - r.mean,
      formulaStockoutProbability: stockoutProbability(r, design.formula.reorderPoint),
    },
    histogram: ddltHistogram(r, 60),
  };
}

function gammaDensity(mean: number, sd: number): { x: number; y: number }[] {
  if (sd <= 0) return [{ x: mean, y: 1 }];
  const k = (mean / sd) ** 2;
  const theta = sd ** 2 / mean;
  const logGammaK = lnGamma(k);
  const xMax = mean + 5 * sd;
  return Array.from({ length: 120 }, (_, i) => {
    const x = (xMax * (i + 0.5)) / 120;
    const y = Math.exp((k - 1) * Math.log(x) - x / theta - logGammaK - k * Math.log(theta));
    return { x, y };
  });
}

/** Lanczos approximation of ln Γ(z). */
function lnGamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function safetyStockAnalysis(data: AppData, req: SafetyStockRequest): SafetyStockResponse {
  const ctx = skuContext(data, req.skuId);
  const leadTime = resolveLeadTime(ctx, req.leadTime);
  const lt = leadTimeMoments(leadTime);
  const forecastAt = ridgeForecaster(data, ctx);
  const errors = recentForecastErrors(ctx, req.origin, forecastAt);
  const base = baselineDesign(ctx.sku.demand, req.origin, leadTime, req.serviceLevel);
  const ai = forecastDesign(forecastAt(req.origin), errors, leadTime, req.serviceLevel);
  return {
    skuId: req.skuId,
    origin: req.origin,
    leadTime: {
      kind: req.leadTime.model, mean: lt.mean, sd: lt.sd,
      dataMean: ctx.dataLeadTime.mean, dataSd: ctx.dataLeadTime.sd, store: ctx.sku.store,
      density: gammaDensity(lt.mean, lt.sd),
      storePool: { values: ctx.storePool.values, probs: ctx.storePool.probs },
    },
    baseline: view(base, req.trials, req.seed),
    ai: view(ai, req.trials, req.seed),
    forecastPath: Array.from(forecastAt(req.origin)),
    forecastErrorSd: ai.formula.sigmaD,
    historicalSd: base.formula.sigmaD,
  };
}

export interface SimulationRequest {
  skuId: string;
  /** Last day the plans may use; the replay covers the following days up to the end of the data. */
  origin: number;
  serviceLevel: number;
  leadTime: LeadTimeChoice;
  replications: number;
  /** Bayesian-optimised policy (from the optimisation service), if available. */
  optimized: { reorderPoint: number; orderQuantity: number } | null;
  /** Cost settings (same as the optimiser's), defaults from costs.json. */
  costs?: Partial<CostSettings>;
}

export interface PolicyRun {
  key: "asis" | "baseline" | "ai" | "optimized";
  label: string;
  metrics: PolicyMetrics;
  orderQuantity: number | null;
  /** Day-by-day path of the first replication (as-is: the recorded ledger). */
  onHand: number[];
  reorderPoint: number[] | null;
  ordersPlaced: number[];
  lost: number[];
}

export interface SimulationResponse {
  skuId: string;
  from: number;
  dates: string[];
  demand: number[];
  epidemic: number[];
  eoq: number;
  policies: PolicyRun[];
}

export function simulateHoldout(data: AppData, req: SimulationRequest): SimulationResponse {
  const { dataset } = data;
  const ctx = skuContext(data, req.skuId, req.costs ?? {});
  const leadTime = resolveLeadTime(ctx, req.leadTime);
  const from = req.origin + 1;
  const to = dataset.dates.length;
  if (from >= to) throw new Error("No unseen days left to replay");
  const forecastAt = ridgeForecaster(data, ctx);
  const errors = recentForecastErrors(ctx, req.origin, forecastAt);
  const base = baselineDesign(ctx.sku.demand, req.origin, leadTime, req.serviceLevel);
  const eoq = economicOrderQuantity(base.formula.dBar, ctx.costs.orderCost, ctx.costs.holdingPerUnitDay);
  const aiRop = adaptiveReorderPoints({
    fromDay: from, toDay: to, forecastAt, residuals: errors, leadTime,
    serviceLevel: req.serviceLevel, monteCarloTrials: 4000, seed: 500 + ctx.index,
  });

  const policies: ReplayPolicy[] = [
    { label: "Baseline calculator", reorderPoint: base.reorderPoint },
    { label: "AI forecast + Monte Carlo", reorderPoint: aiRop },
    ...(req.optimized ? [{ label: "AI + Bayesian-optimised", reorderPoint: req.optimized.reorderPoint, orderQuantity: req.optimized.orderQuantity }] : []),
  ];
  const results = replayPolicies({
    demand: ctx.sku.demand.subarray(from, to), initialOnHand: ctx.sku.inventory[from], orderQuantity: eoq,
    leadTime, costs: ctx.costs, policies, replications: req.replications, seed: 9000 + 100 * ctx.index,
  });

  const keys: PolicyRun["key"][] = ["baseline", "ai", "optimized"];
  const runs: PolicyRun[] = [{
    key: "asis",
    label: "As-is (historical ordering)",
    metrics: asIsMetrics(ctx.sku, from, to, ctx.costs),
    orderQuantity: null,
    onHand: Array.from(ctx.sku.inventory.subarray(from, to)),
    reorderPoint: null,
    ordersPlaced: Array.from(ctx.sku.unitsOrdered.subarray(from, to)),
    lost: Array.from({ length: to - from }, (_, k) => {
      const t = from + k;
      return ctx.sku.unitsSold[t] >= ctx.sku.inventory[t] ? Math.max(0, ctx.sku.demand[t] - ctx.sku.unitsSold[t]) : 0;
    }),
  }];
  results.forEach((r, i) => runs.push({
    key: keys[i],
    label: r.label,
    metrics: r.metrics,
    orderQuantity: policies[i].orderQuantity ?? eoq,
    onHand: Array.from(r.trace.onHandStart),
    reorderPoint: Array.from(r.trace.reorderPoint),
    ordersPlaced: Array.from(r.trace.orderQty),
    lost: Array.from(r.trace.lost),
  }));

  return {
    skuId: req.skuId, from,
    dates: dataset.dates.slice(from, to),
    demand: Array.from(ctx.sku.demand.subarray(from, to)),
    epidemic: Array.from(dataset.epidemic.subarray(from, to)),
    eoq,
    policies: runs,
  };
}

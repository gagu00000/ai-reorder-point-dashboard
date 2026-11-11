/**
 * Step 3 — the reorder-point optimisation problem solved by Bayesian optimisation.
 *
 *   decide   reorder point r (units) and order quantity Q (units) — or r only, with Q fixed
 *   minimise expected annual cost = holding + ordering + lost-sales shortage
 *   subject to
 *     service   cycle service level (or fill rate) ≥ target
 *     budget    average inventory value ≤ budget            (optional)
 *     capacity  peak on-hand units ≤ storage capacity       (optional)
 *     supplier  MOQ ≤ Q ≤ maximum order                     (search bounds)
 *
 * Each candidate (r, Q) is scored by the daily (s, Q) simulation of Part 2 over `paths` demand
 * scenarios of `horizonDays` days, with common random numbers, so every effect the slide formula
 * ignores (reorder undershoot, skew, lost sales, overlapping orders) is priced in.
 */
import { mean, std } from "../stats/descriptive";
import { Rng } from "../stats/prng";
import { economicOrderQuantity, type CostParams } from "../inventory/cost";
import { simulateDemandPath, type DemandModel } from "../inventory/demandModel";
import { gammaLeadTime, type LeadTimeModel } from "../inventory/leadTimeModel";
import { simulatePolicy } from "../inventory/policySim";
import { computeSafetyStock, type SafetyStockResult } from "../inventory/safetyStock";
import type { Bounds, ObjectiveValue } from "./bayesOpt";

export type ServiceMetric = "cycleServiceLevel" | "fillRate";

export interface ProblemSpec {
  demand: DemandModel;
  leadTime: { mean: number; sd: number };
  costs: CostParams;
  service: { metric: ServiceMetric; target: number };
  /** Maximum average inventory value (currency); null = unconstrained. */
  budget?: number | null;
  /** Maximum on-hand units (storage capacity); null = unconstrained. */
  capacity?: number | null;
  /** Supplier limits on the order quantity. */
  orderQtyLimits: { min: number; max: number };
  horizonDays: number;
  paths: number;
  seed: number;
  /** Fix Q (one-dimensional "reorder point only" mode). */
  fixedOrderQuantity?: number | null;
  /** Sensitivity multipliers: scale mean demand and demand noise. */
  demandScale?: number;
  noiseScale?: number;
}

export interface InventoryProblem {
  spec: ProblemSpec;
  demandPaths: Float64Array[];
  leadTime: LeadTimeModel;
  /** The slide formula evaluated on this problem's inputs (reference point and search range). */
  formula: SafetyStockResult;
  eoq: number;
  bounds: Bounds;
  constraintNames: string[];
}

export interface PolicyEvaluation {
  r: number;
  q: number;
  annualCost: number;
  annualHolding: number;
  annualOrdering: number;
  annualShortage: number;
  fillRate: number;
  cycleServiceLevel: number;
  service: number;
  avgOnHand: number;
  avgInventoryValue: number;
  maxOnHand: number;
  stockoutDayRate: number;
  ordersPerYear: number;
}

function scaledDemand(spec: ProblemSpec): DemandModel {
  const ds = spec.demandScale ?? 1;
  const ns = spec.noiseScale ?? 1;
  const meanPath = Float64Array.from(spec.demand.meanPath, (v) => v * ds);
  return spec.demand.kind === "bootstrap"
    ? { kind: "bootstrap", meanPath, residuals: Float64Array.from(spec.demand.residuals, (v) => v * ns) }
    : { kind: "normal", meanPath, sd: spec.demand.sd * ns };
}

export function buildInventoryProblem(spec: ProblemSpec): InventoryProblem {
  if (!(spec.service.target > 0 && spec.service.target < 1)) throw new Error("service target must be in (0, 1)");
  if (!(spec.paths >= 1 && spec.horizonDays >= 30)) throw new Error("need at least one path of 30+ days");
  const demand = scaledDemand(spec);
  const rng = new Rng(spec.seed);
  const demandPaths = Array.from({ length: spec.paths }, () => simulateDemandPath(demand, spec.horizonDays, rng));
  const leadTime = gammaLeadTime(spec.leadTime.mean, spec.leadTime.sd);

  const window = Math.max(1, Math.ceil(spec.leadTime.mean));
  const dBar = mean(demand.meanPath, 0, Math.min(window, demand.meanPath.length));
  const sigmaD = demand.kind === "bootstrap" ? std(demand.residuals, 1) : demand.sd;
  const formula = computeSafetyStock({
    serviceLevel: spec.service.metric === "cycleServiceLevel" ? spec.service.target : 0.95,
    dBar, sigmaD, leadTime: spec.leadTime.mean, sigmaL: spec.leadTime.sd,
  });
  const eoq = economicOrderQuantity(Math.max(dBar, 1e-6), spec.costs.orderCost, spec.costs.holdingPerUnitDay);

  // Reorder point: from below expected lead-time demand to well beyond the formula's tail plus one
  // day of demand (room for the undershoot of a daily-review system).
  const rLower = Math.max(0, formula.expectedDdlt - formula.sigmaDdlt);
  const rUpper = formula.expectedDdlt + 5 * formula.sigmaDdlt + 2 * dBar;
  const clampQ = (v: number) => Math.min(spec.orderQtyLimits.max, Math.max(spec.orderQtyLimits.min, v));
  const qLower = clampQ(0.5 * eoq);
  const qUpper = Math.max(clampQ(3 * eoq), qLower + 1);
  const oneD = spec.fixedOrderQuantity != null;
  const bounds: Bounds = oneD
    ? { names: ["reorderPoint"], lower: [rLower], upper: [rUpper] }
    : { names: ["reorderPoint", "orderQuantity"], lower: [rLower, qLower], upper: [rUpper, qUpper] };

  const constraintNames = ["service"];
  if (spec.budget != null) constraintNames.push("budget");
  if (spec.capacity != null) constraintNames.push("capacity");
  return { spec, demandPaths, leadTime, formula, eoq, bounds, constraintNames };
}

/** Expected performance of policy (r, Q) over the problem's scenarios (common random numbers). */
export function evaluateInventoryPolicy(p: InventoryProblem, r: number, q: number): PolicyEvaluation {
  let cost = 0, holding = 0, ordering = 0, shortage = 0, demand = 0, lost = 0, onHand = 0, stockoutDays = 0, orders = 0;
  let cycles = 0, stockoutCycles = 0, maxOnHand = 0;
  p.demandPaths.forEach((path, k) => {
    const m = simulatePolicy({
      demand: path, reorderPoint: r, orderQuantity: q, leadTime: p.leadTime,
      initialOnHand: r + q, costs: p.spec.costs, seed: p.spec.seed + 1000 + k,
    });
    cost += m.annualCost;
    const scale = p.spec.costs.daysPerYear / m.days;
    holding += m.holdingCost * scale;
    ordering += m.orderingCost * scale;
    shortage += m.shortageCost * scale;
    demand += m.totalDemand;
    lost += m.lost;
    onHand += m.avgOnHand;
    stockoutDays += m.stockoutDayRate;
    orders += m.orders * scale;
    cycles += m.completedCycles;
    stockoutCycles += m.stockoutCycles;
    maxOnHand = Math.max(maxOnHand, m.maxOnHand);
  });
  const n = p.demandPaths.length;
  const fillRate = demand > 0 ? 1 - lost / demand : 1;
  const csl = cycles > 0 ? 1 - stockoutCycles / cycles : 1;
  const avgOnHand = onHand / n;
  return {
    r, q,
    annualCost: cost / n,
    annualHolding: holding / n,
    annualOrdering: ordering / n,
    annualShortage: shortage / n,
    fillRate,
    cycleServiceLevel: csl,
    service: p.spec.service.metric === "fillRate" ? fillRate : csl,
    avgOnHand,
    avgInventoryValue: avgOnHand * p.spec.costs.unitPrice,
    maxOnHand,
    stockoutDayRate: stockoutDays / n,
    ordersPerYear: orders / n,
  };
}

/** Objective + constraints (≤ 0 feasible) in the form Bayesian optimisation expects. */
export function inventoryObjective(p: InventoryProblem): (x: number[]) => ObjectiveValue {
  const q0 = p.spec.fixedOrderQuantity;
  return (x) => {
    const r = x[0];
    const q = q0 != null ? q0 : x[1];
    const e = evaluateInventoryPolicy(p, r, q);
    const constraints = [p.spec.service.target - e.service];
    if (p.spec.budget != null) constraints.push(e.avgInventoryValue - p.spec.budget);
    if (p.spec.capacity != null) constraints.push(e.maxOnHand - p.spec.capacity);
    return { objective: e.annualCost, constraints, meta: { ...e, reorderPoint: r, orderQuantity: q } };
  };
}

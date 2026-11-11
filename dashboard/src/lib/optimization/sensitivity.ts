/**
 * AI-driven sensitivity analysis (Step 3). Instead of manual parameter sweeps:
 *
 * - `surrogateGrid`        the fitted GP surrogate over the decision space (cost surface, its
 *                          uncertainty and the probability that constraints hold) — instant, no new
 *                          simulations.
 * - `acquisitionSlice`     1-D view along the reorder point: GP mean ± 2σ and the acquisition.
 * - `policyTornado`        how the recommended policy's cost and service move if each input is ±δ off.
 * - `formulaTornado`       how the slide formula's reorder point moves with each input.
 * - `serviceTargetCurve`   optimal reorder point and cost for a range of service targets, warm-started
 *                          from earlier evaluations (raw simulation results do not depend on the target).
 */
import { expectedImprovement, probabilityFeasible } from "./acquisition";
import { bayesianOptimisation, toUnit, type Evaluation, type OptimisationResult } from "./bayesOpt";
import { gpPredict } from "./gp";
import { buildInventoryProblem, evaluateInventoryPolicy, inventoryObjective, type PolicyEvaluation, type ProblemSpec } from "./inventoryProblem";
import { computeSafetyStock, type SafetyStockInputs } from "../inventory/safetyStock";

export interface SurrogateGrid {
  x: number[];          // reorder points
  y: number[];          // order quantities (single value in 1-D mode)
  mean: number[][];     // [iy][ix] predicted annual cost
  sd: number[][];
  feasibility: number[][];
}

export function surrogateGrid(result: OptimisationResult, nx = 40, ny = 40): SurrogateGrid {
  const { bounds, objectiveGp, constraintGps } = result;
  if (!objectiveGp) throw new Error("no surrogate fitted yet");
  const d = bounds.names.length;
  const lin = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  const x = lin(bounds.lower[0], bounds.upper[0], nx);
  const y = d > 1 ? lin(bounds.lower[1], bounds.upper[1], ny) : [Number.NaN];
  const mean: number[][] = [], sd: number[][] = [], feasibility: number[][] = [];
  for (const yv of y) {
    const mRow: number[] = [], sRow: number[] = [], fRow: number[] = [];
    for (const xv of x) {
      const u = toUnit(bounds, d > 1 ? [xv, yv] : [xv]);
      const p = gpPredict(objectiveGp, u);
      mRow.push(p.mean);
      sRow.push(Math.sqrt(p.variance));
      fRow.push(constraintGps.reduce((acc, gp) => {
        const c = gpPredict(gp, u);
        return acc * probabilityFeasible(c.mean, Math.sqrt(c.variance));
      }, 1));
    }
    mean.push(mRow); sd.push(sRow); feasibility.push(fRow);
  }
  return { x, y, mean, sd, feasibility };
}

export interface SlicePoint { r: number; mean: number; lower: number; upper: number; feasibility: number; acquisition: number }

/** Posterior and constrained EI along the reorder point, with Q held at `q` (ignored in 1-D mode). */
export function acquisitionSlice(result: OptimisationResult, q: number | null, n = 120): SlicePoint[] {
  const { bounds, objectiveGp, constraintGps, best } = result;
  if (!objectiveGp) throw new Error("no surrogate fitted yet");
  return Array.from({ length: n }, (_, i) => {
    const r = bounds.lower[0] + ((bounds.upper[0] - bounds.lower[0]) * i) / (n - 1);
    const u = toUnit(bounds, bounds.names.length > 1 ? [r, q ?? (bounds.lower[1] + bounds.upper[1]) / 2] : [r]);
    const p = gpPredict(objectiveGp, u);
    const s = Math.sqrt(p.variance);
    const pf = constraintGps.reduce((acc, gp) => {
      const c = gpPredict(gp, u);
      return acc * probabilityFeasible(c.mean, Math.sqrt(c.variance));
    }, 1);
    return {
      r, mean: p.mean, lower: p.mean - 2 * s, upper: p.mean + 2 * s, feasibility: pf,
      acquisition: best ? expectedImprovement(p.mean, s, best.objective) * pf : pf,
    };
  });
}

export interface TornadoBar {
  name: string;
  lowLabel: string;
  highLabel: string;
  low: number;
  high: number;
}

export interface PolicyTornado {
  base: PolicyEvaluation;
  cost: TornadoBar[];
  service: TornadoBar[];
}

/** Re-simulate the recommended policy (r, Q) with each input moved by ±delta (others at base). */
export function policyTornado(spec: ProblemSpec, r: number, q: number, delta = 0.2): PolicyTornado {
  const evalWith = (s: ProblemSpec) => evaluateInventoryPolicy(buildInventoryProblem(s), r, q);
  const base = evalWith(spec);
  const lo = 1 - delta, hi = 1 + delta;
  const variants: [string, (f: number) => ProblemSpec][] = [
    ["Mean demand (D̄)", (f) => ({ ...spec, demandScale: (spec.demandScale ?? 1) * f })],
    ["Demand variability (σ_D)", (f) => ({ ...spec, noiseScale: (spec.noiseScale ?? 1) * f })],
    ["Lead time (L)", (f) => ({ ...spec, leadTime: { ...spec.leadTime, mean: spec.leadTime.mean * f } })],
    ["Lead-time variability (σ_L)", (f) => ({ ...spec, leadTime: { ...spec.leadTime, sd: spec.leadTime.sd * f } })],
    ["Holding cost (h)", (f) => ({ ...spec, costs: { ...spec.costs, holdingPerUnitDay: spec.costs.holdingPerUnitDay * f } })],
    ["Shortage cost (p)", (f) => ({ ...spec, costs: { ...spec.costs, shortagePerUnit: spec.costs.shortagePerUnit * f } })],
    ["Order cost (S)", (f) => ({ ...spec, costs: { ...spec.costs, orderCost: spec.costs.orderCost * f } })],
  ];
  const cost: TornadoBar[] = [];
  const service: TornadoBar[] = [];
  const pct = Math.round(delta * 100);
  for (const [name, make] of variants) {
    const a = evalWith(make(lo));
    const b = evalWith(make(hi));
    cost.push({ name, lowLabel: `−${pct}%`, highLabel: `+${pct}%`, low: a.annualCost, high: b.annualCost });
    service.push({ name, lowLabel: `−${pct}%`, highLabel: `+${pct}%`, low: a.service, high: b.service });
  }
  const swing = (t: TornadoBar) => Math.abs(t.high - t.low);
  cost.sort((a, b) => swing(b) - swing(a));
  service.sort((a, b) => swing(b) - swing(a));
  return { base, cost, service };
}

/** Sensitivity of the slide formula's reorder point to each input (±delta; service level ±2 pp). */
export function formulaTornado(inputs: SafetyStockInputs, delta = 0.2): { base: number; bars: TornadoBar[] } {
  const rop = (p: SafetyStockInputs) => computeSafetyStock(p).reorderPoint;
  const pct = Math.round(delta * 100);
  const bars: TornadoBar[] = (["dBar", "sigmaD", "leadTime", "sigmaL"] as const).map((k) => ({
    name: { dBar: "Mean demand (D̄)", sigmaD: "Demand variability (σ_D)", leadTime: "Lead time (L)", sigmaL: "Lead-time variability (σ_L)" }[k],
    lowLabel: `−${pct}%`, highLabel: `+${pct}%`,
    low: rop({ ...inputs, [k]: inputs[k] * (1 - delta) }),
    high: rop({ ...inputs, [k]: inputs[k] * (1 + delta) }),
  }));
  const slLo = Math.max(0.5, inputs.serviceLevel - 0.02);
  const slHi = Math.min(0.999, inputs.serviceLevel + 0.02);
  bars.push({ name: "Service level (Z)", lowLabel: `${(slLo * 100).toFixed(0)}%`, highLabel: `${(slHi * 100).toFixed(0)}%`,
    low: rop({ ...inputs, serviceLevel: slLo }), high: rop({ ...inputs, serviceLevel: slHi }) });
  bars.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return { base: rop(inputs), bars };
}

export interface ServiceTargetPoint {
  target: number;
  best: Evaluation | null;
  evaluations: number; // new simulations spent on this target
}

/** Re-express an evaluation's constraints for a different service target (others unchanged). */
function retarget(e: Evaluation, target: number): Evaluation {
  const constraints = [target - (e.meta?.service ?? 0), ...e.constraints.slice(1)];
  return { ...e, constraints, feasible: constraints.every((c) => c <= 0) };
}

/**
 * Optimal policy for each service target. Earlier evaluations are re-used with their constraint
 * recomputed for the new target, so each additional target needs only a few new simulations.
 * Finally every target's optimum is taken over the *whole* pool of simulations: a policy that meets
 * a higher target also meets every lower one, so the curve can never be cheaper at a higher target.
 */
export function serviceTargetCurve(
  spec: ProblemSpec, targets: number[], opts: { budgetPerTarget?: number; seed?: number } = {},
): ServiceTargetPoint[] {
  const sorted = [...targets].sort((a, b) => a - b);
  const spent: number[] = [];
  let pool: Evaluation[] = [];
  for (const target of sorted) {
    const s: ProblemSpec = { ...spec, service: { ...spec.service, target } };
    const problem = buildInventoryProblem(s);
    const warm = pool.map((e) => retarget(e, target));
    const budget = warm.length + (opts.budgetPerTarget ?? (pool.length ? 8 : 20));
    const res = bayesianOptimisation({
      bounds: problem.bounds, evaluate: inventoryObjective(problem), budget, seed: opts.seed ?? 1, warmStart: warm,
    });
    spent.push(res.evaluations.length - warm.length);
    pool = res.evaluations;
  }
  return sorted.map((target, i) => {
    let best: Evaluation | null = null;
    for (const e of pool.map((x) => retarget(x, target))) if (e.feasible && (!best || e.objective < best.objective)) best = e;
    return { target, best, evaluations: spent[i] };
  });
}

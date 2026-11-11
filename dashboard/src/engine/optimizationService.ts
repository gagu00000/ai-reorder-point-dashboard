/**
 * Step 3 services: Bayesian optimisation of the reorder point (and order quantity) under
 * constraints, the random-search and grid-search comparisons, and the sensitivity views.
 */
import { bayesianOptimisation, gridSearch, randomSearch, type Bounds, type Iteration } from "../lib/optimization/bayesOpt";
import {
  buildInventoryProblem, evaluateInventoryPolicy, inventoryObjective, type InventoryProblem, type PolicyEvaluation, type ProblemSpec,
} from "../lib/optimization/inventoryProblem";
import {
  acquisitionSlice, formulaTornado, policyTornado, serviceTargetCurve, surrogateGrid,
  type PolicyTornado, type SlicePoint, type SurrogateGrid, type TornadoBar,
} from "../lib/optimization/sensitivity";
import type { SafetyStockResult } from "../lib/inventory/safetyStock";
import type { AppData } from "./appData";
import { buildProblemSpec, type OptimizationSettings } from "./planning";

export interface OptimizationRequest {
  skuId: string;
  origin: number;
  settings: OptimizationSettings;
  seed: number;
}

export interface EvaluatedPoint {
  index: number;
  phase: Iteration["phase"];
  reorderPoint: number;
  orderQuantity: number;
  annualCost: number;
  service: number;
  feasible: boolean;
  bestSoFar: number | null;
  acquisition: number | null;
}

export interface ProgressEvent {
  point: EvaluatedPoint;
  budget: number;
}

export interface OptimizationResponse {
  skuId: string;
  origin: number;
  settings: OptimizationSettings;
  bounds: Bounds;
  constraintNames: string[];
  eoq: number;
  formula: SafetyStockResult;
  formulaPolicy: PolicyEvaluation;   // slide formula reorder point with Q = EOQ
  best: PolicyEvaluation | null;     // Bayesian-optimised policy
  points: EvaluatedPoint[];
  randomSearch: { bestSoFar: (number | null)[] };
  surrogate: SurrogateGrid;
  slice: SlicePoint[];
  formulaTornado: { base: number; bars: TornadoBar[] };
}

function toPoint(it: Iteration, fixedQ: number | null): EvaluatedPoint {
  const e = it.evaluation;
  return {
    index: it.index,
    phase: it.phase,
    reorderPoint: e.x[0],
    orderQuantity: fixedQ ?? e.x[1],
    annualCost: e.objective,
    service: e.meta?.service ?? Number.NaN,
    feasible: e.feasible,
    bestSoFar: it.bestFeasible?.objective ?? null,
    acquisition: it.acquisition,
  };
}

export function buildProblem(data: AppData, req: OptimizationRequest): { spec: ProblemSpec; problem: InventoryProblem } {
  let spec = buildProblemSpec(data, req.skuId, req.origin, req.settings, req.seed);
  let problem = buildInventoryProblem(spec);
  if (req.settings.mode === "r") {
    spec = { ...spec, fixedOrderQuantity: Math.max(spec.orderQtyLimits.min, Math.min(spec.orderQtyLimits.max, problem.eoq)) };
    problem = buildInventoryProblem(spec);
  }
  return { spec, problem };
}

export function optimize(data: AppData, req: OptimizationRequest, onProgress?: (e: ProgressEvent) => void): OptimizationResponse {
  const { spec, problem } = buildProblem(data, req);
  const fixedQ = spec.fixedOrderQuantity ?? null;
  const budget = req.settings.evaluations;
  const objective = inventoryObjective(problem);
  const bo = bayesianOptimisation({
    bounds: problem.bounds, evaluate: objective, budget, seed: 1,
    onIteration: (it) => onProgress?.({ point: toPoint(it, fixedQ), budget }),
  });
  const rs = randomSearch({ bounds: problem.bounds, evaluate: objective, budget, seed: 7 });
  const best = bo.best ? evaluateInventoryPolicy(problem, bo.best.x[0], fixedQ ?? bo.best.x[1]) : null;
  return {
    skuId: req.skuId,
    origin: req.origin,
    settings: req.settings,
    bounds: problem.bounds,
    constraintNames: problem.constraintNames,
    eoq: problem.eoq,
    formula: problem.formula,
    formulaPolicy: evaluateInventoryPolicy(problem, problem.formula.reorderPoint, fixedQ ?? problem.eoq),
    best,
    points: bo.trace.map((it) => toPoint(it, fixedQ)),
    randomSearch: { bestSoFar: rs.trace.map((it) => it.bestFeasible?.objective ?? null) },
    surrogate: surrogateGrid(bo, 36, fixedQ != null ? 1 : 30),
    slice: acquisitionSlice(bo, best ? best.q : null, 120),
    formulaTornado: formulaTornado(problem.formula),
  };
}

export interface GridValidation {
  evaluations: number;
  best: PolicyEvaluation | null;
  /** Grid points for the cost heat map: [r, q, annualCost, feasible 0/1]. */
  cells: [number, number, number, number][];
}

/** The "manual parameter sweep" Bayesian optimisation replaces: an exhaustive 30 × 30 grid. */
export function validateWithGrid(data: AppData, req: OptimizationRequest): GridValidation {
  const { spec, problem } = buildProblem(data, req);
  const fixedQ = spec.fixedOrderQuantity ?? null;
  const steps = fixedQ != null ? [60] : [30, 30];
  const g = gridSearch({ bounds: problem.bounds, evaluate: inventoryObjective(problem), steps });
  return {
    evaluations: g.evaluations.length,
    best: g.best ? evaluateInventoryPolicy(problem, g.best.x[0], fixedQ ?? g.best.x[1]) : null,
    cells: g.evaluations.map((e) => [e.x[0], fixedQ ?? e.x[1], e.objective, e.feasible ? 1 : 0]),
  };
}

export function policySensitivity(data: AppData, req: OptimizationRequest, reorderPoint: number, orderQuantity: number): PolicyTornado {
  const { spec } = buildProblem(data, req);
  return policyTornado(spec, reorderPoint, orderQuantity, 0.2);
}

export interface ServiceCurvePoint {
  target: number;
  reorderPoint: number | null;
  orderQuantity: number | null;
  annualCost: number | null;
  achieved: number | null;
  newSimulations: number;
}

export function serviceCurve(data: AppData, req: OptimizationRequest, targets: number[]): ServiceCurvePoint[] {
  const { spec } = buildProblem(data, req);
  const fixedQ = spec.fixedOrderQuantity ?? null;
  return serviceTargetCurve(spec, targets, { budgetPerTarget: 12, seed: 3 }).map((p) => ({
    target: p.target,
    reorderPoint: p.best ? p.best.x[0] : null,
    orderQuantity: p.best ? fixedQ ?? p.best.x[1] : null,
    annualCost: p.best ? p.best.objective : null,
    achieved: p.best?.meta?.service ?? null,
    newSimulations: p.evaluations,
  }));
}

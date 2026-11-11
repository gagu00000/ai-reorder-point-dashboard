/**
 * Step 3 on the real problem: Bayesian optimisation of (reorder point, order quantity) for
 * S001-P0001, planned at the end of the validation window from the AI demand model
 * (ridge forecast + bootstrapped forecast errors), checked against an exhaustive 30 × 30 grid.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { skuIndexById } from "../src/lib/data/dataset";
import { buildExog } from "../src/lib/data/features";
import type { CostsFile } from "../src/lib/data/types";
import { ridgeForecast } from "../src/lib/forecasting/ridge";
import { skuCostParams } from "../src/lib/inventory/cost";
import { forecastResiduals } from "../src/lib/inventory/policies";
import { bayesianOptimisation, gridSearch, randomSearch, type OptimisationResult } from "../src/lib/optimization/bayesOpt";
import {
  buildInventoryProblem, evaluateInventoryPolicy, inventoryObjective, type InventoryProblem, type ProblemSpec,
} from "../src/lib/optimization/inventoryProblem";
import { acquisitionSlice, formulaTornado, policyTornado, serviceTargetCurve, surrogateGrid } from "../src/lib/optimization/sensitivity";
import { loadDataset, loadLeadTimes, loadModelConfig, readData } from "./helpers";

/**
 * Default budget. Measured on 10 SKUs × 2 seeds against a 900-point grid: 45 evaluations give a
 * median gap of 0.0% (90th percentile 1.5%); random search with 45 evaluations: median 4.1%.
 * The grid itself is coarse — its 5th-best point is typically 1.7% above its best.
 */
const BO_BUDGET = 45;

let spec: ProblemSpec;
let problem: InventoryProblem;
let bo: OptimisationResult;
let grid: OptimisationResult;

beforeAll(() => {
  const ds = loadDataset();
  const lt = loadLeadTimes();
  const config = loadModelConfig();
  const costsFile = readData<CostsFile>("costs.json");
  const id = "S001-P0001";
  const i = skuIndexById(ds, id);
  const sku = ds.skus[i];
  const origin = ds.split.valEndIdx;
  const forecastAt = (o: number) => ridgeForecast(sku.demand, buildExog(ds, i, o, 14), o, 14, config.ridge.alpha);
  const origins = Array.from({ length: origin - 7 - ds.split.trainEndIdx + 1 }, (_, k) => ds.split.trainEndIdx + k);
  spec = {
    demand: { kind: "bootstrap", meanPath: forecastAt(origin), residuals: forecastResiduals(sku.demand, origins, 7, forecastAt) },
    leadTime: { mean: lt.skus[id].L, sd: lt.stores[sku.store].sd },
    costs: skuCostParams(costsFile, id),
    service: { metric: "cycleServiceLevel", target: 0.95 },
    orderQtyLimits: { min: costsFile.skus[id].orderQty.min, max: Number.POSITIVE_INFINITY },
    horizonDays: 365, paths: 8, seed: 42,
  };
  problem = buildInventoryProblem(spec);
  const objective = inventoryObjective(problem);
  bo = bayesianOptimisation({ bounds: problem.bounds, evaluate: objective, budget: BO_BUDGET, seed: 1 });
  grid = gridSearch({ bounds: problem.bounds, evaluate: objective, steps: [30, 30] });
}, 120_000);

describe("BO replaces the manual parameter sweep", () => {
  it("matches the 900-point grid optimum (within grid resolution) using 5% of the simulations", () => {
    expect(bo.evaluations).toHaveLength(BO_BUDGET);
    expect(grid.evaluations).toHaveLength(900);
    expect(bo.best!.objective).toBeLessThan(grid.best!.objective * 1.015);
  });

  it("beats random search with the same budget", () => {
    const rs = randomSearch({ bounds: problem.bounds, evaluate: inventoryObjective(problem), budget: BO_BUDGET, seed: 1 });
    expect(bo.best!.objective).toBeLessThan(rs.best!.objective);
  });

  it("recommends a feasible policy that meets the 95% cycle-service constraint", () => {
    expect(bo.best!.feasible).toBe(true);
    expect(bo.best!.meta!.cycleServiceLevel).toBeGreaterThanOrEqual(0.95);
  });

  it("beats the slide formula + EOQ policy on cost, because it prices in undershoot and lost sales", () => {
    const formula = evaluateInventoryPolicy(problem, problem.formula.reorderPoint, problem.eoq);
    expect(formula.cycleServiceLevel).toBeLessThan(0.95);
    expect(bo.best!.objective).toBeLessThan(formula.annualCost);
    expect(bo.best!.x[0]).toBeGreaterThan(problem.formula.reorderPoint);
  });

  it("is reproducible for a fixed seed", () => {
    const again = bayesianOptimisation({ bounds: problem.bounds, evaluate: inventoryObjective(problem), budget: 12, seed: 1 });
    const first = bayesianOptimisation({ bounds: problem.bounds, evaluate: inventoryObjective(problem), budget: 12, seed: 1 });
    expect(again.evaluations.map((e) => e.x)).toEqual(first.evaluations.map((e) => e.x));
  });
});

describe("constraints bind when they should", () => {
  it("cheaper shortages make the 95% service constraint the active limit", () => {
    const cheap: ProblemSpec = { ...spec, costs: { ...spec.costs, shortagePerUnit: spec.costs.shortagePerUnit * 0.02 } };
    const p = buildInventoryProblem(cheap);
    const res = bayesianOptimisation({ bounds: p.bounds, evaluate: inventoryObjective(p), budget: 30, seed: 2 });
    expect(res.best!.feasible).toBe(true);
    const csl = res.best!.meta!.cycleServiceLevel;
    expect(csl).toBeGreaterThanOrEqual(0.95);
    expect(csl).toBeLessThan(0.985); // pushed down towards the constraint, not far above it
  });

  it("a storage-capacity limit caps the peak stock of the recommended policy", () => {
    const unconstrained = bo.best!.meta!.maxOnHand;
    const capacity = Math.round(unconstrained * 0.85);
    const p = buildInventoryProblem({ ...spec, capacity });
    const res = bayesianOptimisation({ bounds: p.bounds, evaluate: inventoryObjective(p), budget: 30, seed: 3 });
    expect(p.constraintNames).toEqual(["service", "capacity"]);
    expect(res.best!.meta!.maxOnHand).toBeLessThanOrEqual(capacity);
  });

  it("one-dimensional mode optimises the reorder point with Q fixed", () => {
    const p = buildInventoryProblem({ ...spec, fixedOrderQuantity: 400 });
    const res = bayesianOptimisation({ bounds: p.bounds, evaluate: inventoryObjective(p), budget: 15, seed: 4 });
    expect(p.bounds.names).toEqual(["reorderPoint"]);
    expect(res.best!.meta!.orderQuantity).toBe(400);
  });
});

describe("AI-driven sensitivity views", () => {
  it("surrogate surface and acquisition slice come from the fitted GP", () => {
    const g = surrogateGrid(bo, 20, 15);
    expect(g.x).toHaveLength(20);
    expect(g.y).toHaveLength(15);
    expect(g.mean).toHaveLength(15);
    g.feasibility.flat().forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
    const slice = acquisitionSlice(bo, bo.best!.x[1], 50);
    expect(slice).toHaveLength(50);
    slice.forEach((s) => expect(s.upper).toBeGreaterThanOrEqual(s.lower));
  });

  it("policy tornado re-simulates the recommendation with each input ±20%", () => {
    const t = policyTornado(spec, bo.best!.x[0], bo.best!.x[1]);
    expect(t.base.annualCost).toBeCloseTo(bo.best!.objective, 6);
    expect(t.cost).toHaveLength(7);
    const swings = t.cost.map((b) => Math.abs(b.high - b.low));
    swings.slice(1).forEach((s, i) => expect(s).toBeLessThanOrEqual(swings[i]));
    const demand = t.cost.find((b) => b.name.startsWith("Mean demand"))!;
    expect(demand.high).toBeGreaterThan(demand.low);
  });

  it("formula tornado: every input raises the formula's reorder point when increased", () => {
    const t = formulaTornado({ serviceLevel: 0.95, dBar: 92.8145, sigmaD: 35.5362, leadTime: 2, sigmaL: 0.9727 });
    expect(t.base).toBeCloseTo(355.58, 1);
    t.bars.forEach((b) => expect(b.high).toBeGreaterThan(b.low));
  });

  it("service-target curve: higher targets never get cheaper; later targets reuse earlier simulations", () => {
    const cheap: ProblemSpec = { ...spec, costs: { ...spec.costs, shortagePerUnit: spec.costs.shortagePerUnit * 0.02 } };
    const curve = serviceTargetCurve(cheap, [0.9, 0.95, 0.99], { budgetPerTarget: 12, seed: 6 });
    expect(curve.map((c) => c.target)).toEqual([0.9, 0.95, 0.99]);
    curve.forEach((c) => expect(c.best!.feasible).toBe(true));
    const costs = curve.map((c) => c.best!.objective);
    expect(costs[1]).toBeGreaterThanOrEqual(costs[0]);
    expect(costs[2]).toBeGreaterThanOrEqual(costs[1]);
    // each target spends only its own 12 new simulations, yet its surrogate sees all earlier ones
    expect(curve.map((c) => c.evaluations)).toEqual([12, 12, 12]);
  });
});

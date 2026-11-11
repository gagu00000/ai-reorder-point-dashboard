/**
 * Step 3 integration test on unseen data: Bayesian-optimised (r, Q), planned at the end of the
 * validation window, replayed over the 60-day holdout for every 5th SKU (20 SKUs).
 * The full 100-SKU comparison is `npm run report:holdout` (docs/results/holdout_replay.md).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildExog } from "../src/lib/data/features";
import type { CostsFile } from "../src/lib/data/types";
import { ridgeForecast } from "../src/lib/forecasting/ridge";
import { economicOrderQuantity, skuCostParams } from "../src/lib/inventory/cost";
import { gammaLeadTime } from "../src/lib/inventory/leadTimeModel";
import { adaptiveReorderPoints, baselineDesign, forecastResiduals } from "../src/lib/inventory/policies";
import type { PolicyMetrics } from "../src/lib/inventory/policySim";
import { replayPolicies } from "../src/lib/inventory/replay";
import { bayesianOptimisation } from "../src/lib/optimization/bayesOpt";
import { buildInventoryProblem, inventoryObjective } from "../src/lib/optimization/inventoryProblem";
import { loadDataset, loadLeadTimes, loadModelConfig, readData } from "./helpers";

const LABELS = ["Baseline formula", "AI + MC (adaptive)", "BO on AI demand"] as const;
const runs: Record<(typeof LABELS)[number], PolicyMetrics[]> = { "Baseline formula": [], "AI + MC (adaptive)": [], "BO on AI demand": [] };
const plannedCsl: number[] = [];

function total(label: (typeof LABELS)[number]) {
  const m = runs[label];
  const sum = (f: (x: PolicyMetrics) => number) => m.reduce((a, x) => a + f(x), 0);
  return {
    cost: sum((x) => x.totalCost),
    fill: 1 - sum((x) => x.lost) / sum((x) => x.totalDemand),
    csl: 1 - sum((x) => x.stockoutCycles) / sum((x) => x.completedCycles),
  };
}

beforeAll(() => {
  const ds = loadDataset();
  const lt = loadLeadTimes();
  const config = loadModelConfig();
  const costsFile = readData<CostsFile>("costs.json");
  const origin = ds.split.valEndIdx;
  const from = origin + 1;
  const to = ds.dates.length;
  const H = config.horizon;

  for (let i = 0; i < ds.skus.length; i += 5) {
    const sku = ds.skus[i];
    const ltMoments = { mean: lt.skus[sku.id].L, sd: lt.stores[sku.store].sd };
    const leadTime = gammaLeadTime(ltMoments.mean, ltMoments.sd);
    const costs = skuCostParams(costsFile, sku.id);
    const cache = new Map<number, Float64Array>();
    const forecastAt = (o: number) => {
      if (!cache.has(o)) cache.set(o, ridgeForecast(sku.demand, buildExog(ds, i, o, H), o, H, config.ridge.alpha));
      return cache.get(o)!;
    };
    const valOrigins = Array.from({ length: origin - 7 - ds.split.trainEndIdx + 1 }, (_, k) => ds.split.trainEndIdx + k);
    const residuals = forecastResiduals(sku.demand, valOrigins, 7, forecastAt);
    const base = baselineDesign(sku.demand, origin, leadTime, 0.95);
    const eoq = economicOrderQuantity(base.formula.dBar, costs.orderCost, costs.holdingPerUnitDay);
    const aiMc = adaptiveReorderPoints({
      fromDay: from, toDay: to, forecastAt, residuals, leadTime, serviceLevel: 0.95, monteCarloTrials: 4000, seed: 500 + i,
    });
    const problem = buildInventoryProblem({
      demand: { kind: "bootstrap", meanPath: forecastAt(origin), residuals },
      leadTime: ltMoments, costs,
      service: { metric: "cycleServiceLevel", target: 0.95 },
      orderQtyLimits: { min: costsFile.skus[sku.id].orderQty.min, max: Number.POSITIVE_INFINITY },
      horizonDays: 365, paths: 8, seed: 42 + i,
    });
    const best = bayesianOptimisation({ bounds: problem.bounds, evaluate: inventoryObjective(problem), budget: 45, seed: 1 }).best!;
    plannedCsl.push(best.meta!.cycleServiceLevel);

    const replay = replayPolicies({
      demand: sku.demand.subarray(from, to), initialOnHand: sku.inventory[from], orderQuantity: eoq,
      leadTime, costs, replications: 30, seed: 9000 + 100 * i,
      policies: [
        { label: LABELS[0], reorderPoint: base.reorderPoint },
        { label: LABELS[1], reorderPoint: aiMc },
        { label: LABELS[2], reorderPoint: best.x[0], orderQuantity: best.x[1] },
      ],
    });
    replay.forEach((r) => runs[r.label as (typeof LABELS)[number]].push(r.metrics));
  }
}, 300_000);

describe("Bayesian-optimised policies on the unseen holdout (20 SKUs)", () => {
  it("every SKU's recommended policy met the 95% service constraint at planning time", () => {
    plannedCsl.forEach((c) => expect(c).toBeGreaterThanOrEqual(0.95));
  });

  it("cuts total cost by more than a quarter versus the baseline formula calculator", () => {
    expect(total("BO on AI demand").cost).toBeLessThan(0.75 * total("Baseline formula").cost);
    expect(total("BO on AI demand").cost).toBeLessThan(total("AI + MC (adaptive)").cost);
  });

  it("raises fill rate and cycle service above both formula-based policies", () => {
    for (const other of [LABELS[0], LABELS[1]] as const) {
      expect(total("BO on AI demand").fill).toBeGreaterThan(total(other).fill);
      expect(total("BO on AI demand").csl).toBeGreaterThan(total(other).csl + 0.05);
    }
  });
});

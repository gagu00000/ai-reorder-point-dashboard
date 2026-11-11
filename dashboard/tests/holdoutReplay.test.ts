/**
 * Integration test of Step 2 on data no model has seen: the 60-day holdout (2023-12-02 → 2024-01-30,
 * including the Dec-2023 epidemic) is replayed for all 100 SKUs under five reorder-point policies,
 * with common random numbers for lead times. Target cycle service level 95 %, Q = EOQ for every policy.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildExog } from "../src/lib/data/features";
import type { CostsFile } from "../src/lib/data/types";
import { ridgeForecast } from "../src/lib/forecasting/ridge";
import { asIsMetrics } from "../src/lib/inventory/asIs";
import { economicOrderQuantity, skuCostParams } from "../src/lib/inventory/cost";
import { gammaLeadTime } from "../src/lib/inventory/leadTimeModel";
import { adaptiveReorderPoints, baselineDesign, forecastResiduals, withMonteCarlo } from "../src/lib/inventory/policies";
import type { PolicyMetrics } from "../src/lib/inventory/policySim";
import { replayPolicies } from "../src/lib/inventory/replay";
import { mean, std } from "../src/lib/stats/descriptive";
import { loadDataset, loadLeadTimes, loadModelConfig, readData } from "./helpers";

const POLICIES = ["Baseline formula", "Baseline + MC", "AI formula (adaptive)", "AI + MC (adaptive)"] as const;
type Label = (typeof POLICIES)[number] | "As-is";

interface Totals { fill: number; csl: number; stockoutDayRate: number; totalCost: number; shortageCost: number; avgOnHand: number }

const perPolicy = new Map<Label, PolicyMetrics[]>();
const sigma = { baseline: [] as number[], ai: [] as number[] };
const rop = { formula: [] as number[], mc: [] as number[] };

function totals(label: Label): Totals {
  const runs = perPolicy.get(label)!;
  const sum = (f: (m: PolicyMetrics) => number) => runs.reduce((a, m) => a + f(m), 0);
  const cycles = sum((m) => m.completedCycles);
  return {
    fill: 1 - sum((m) => m.lost) / sum((m) => m.totalDemand),
    csl: cycles > 0 ? 1 - sum((m) => m.stockoutCycles) / cycles : Number.NaN,
    stockoutDayRate: sum((m) => m.stockoutDayRate) / runs.length,
    totalCost: sum((m) => m.totalCost),
    shortageCost: sum((m) => m.shortageCost),
    avgOnHand: sum((m) => m.avgOnHand),
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
  const SL = 0.95;

  ds.skus.forEach((sku, i) => {
    const leadTime = gammaLeadTime(lt.skus[sku.id].L, lt.stores[sku.store].sd);
    const costs = skuCostParams(costsFile, sku.id);
    const cache = new Map<number, Float64Array>();
    const forecastAt = (o: number) => {
      if (!cache.has(o)) cache.set(o, ridgeForecast(sku.demand, buildExog(ds, i, o, H), o, H, config.ridge.alpha));
      return cache.get(o)!;
    };
    // Forecast errors over the validation window (daily origins, horizons 1–7): the AI's σ_D.
    const valOrigins = Array.from({ length: origin - 7 - ds.split.trainEndIdx + 1 }, (_, k) => ds.split.trainEndIdx + k);
    const residuals = forecastResiduals(sku.demand, valOrigins, 7, forecastAt);

    const base = baselineDesign(sku.demand, origin, leadTime, SL);
    const baseMc = withMonteCarlo(base, 20_000, 100 + i);
    const shared = { fromDay: from, toDay: to, forecastAt, residuals, leadTime, serviceLevel: SL, seed: 500 + i };
    const results = replayPolicies({
      demand: sku.demand.subarray(from, to),
      initialOnHand: sku.inventory[from],
      orderQuantity: economicOrderQuantity(base.formula.dBar, costs.orderCost, costs.holdingPerUnitDay),
      leadTime, costs, replications: 20, seed: 9000 + 100 * i,
      policies: [
        { label: POLICIES[0], reorderPoint: base.reorderPoint },
        { label: POLICIES[1], reorderPoint: baseMc.reorderPoint },
        { label: POLICIES[2], reorderPoint: adaptiveReorderPoints({ ...shared, monteCarloTrials: null }) },
        { label: POLICIES[3], reorderPoint: adaptiveReorderPoints({ ...shared, monteCarloTrials: 4000 }) },
      ],
    });
    for (const r of results) perPolicy.set(r.label as Label, [...(perPolicy.get(r.label as Label) ?? []), r.metrics]);
    perPolicy.set("As-is", [...(perPolicy.get("As-is") ?? []), asIsMetrics(sku, from, to, costs)]);
    sigma.baseline.push(base.formula.sigmaD);
    sigma.ai.push(std(residuals, 1));
    rop.formula.push(base.reorderPoint);
    rop.mc.push(baseMc.reorderPoint);
  });
}, 300_000);

describe("holdout replay — 100 SKUs × 60 unseen days", () => {
  it("forecasting shrinks demand uncertainty: σ_D of forecast errors < σ_D of raw history", () => {
    expect(mean(sigma.ai)).toBeLessThan(mean(sigma.baseline) * 0.9);
  });

  it("Monte Carlo raises the reorder point (right-skewed lead-time demand)", () => {
    expect(mean(rop.mc)).toBeGreaterThan(mean(rop.formula));
  });

  it("Monte Carlo correction improves fill rate and cuts shortage cost, for both baseline and AI", () => {
    for (const [plain, mc] of [[POLICIES[0], POLICIES[1]], [POLICIES[2], POLICIES[3]]] as const) {
      expect(totals(mc).fill).toBeGreaterThan(totals(plain).fill);
      expect(totals(mc).shortageCost).toBeLessThan(totals(plain).shortageCost);
    }
  });

  it("AI + Monte Carlo has the lowest total cost of the simulated policies", () => {
    const costs = POLICIES.map((p) => totals(p).totalCost);
    expect(Math.min(...costs)).toBe(totals("AI + MC (adaptive)").totalCost);
  });

  it("every simulated policy stocks out on fewer days than the historical (as-is) ordering", () => {
    for (const p of POLICIES) expect(totals(p).stockoutDayRate).toBeLessThan(totals("As-is").stockoutDayRate);
  });

  it("documented limitation: in a daily-review system no formula-based design reaches the 95 % cycle target", () => {
    // Orders trigger after the position has already fallen below s (undershoot ≈ a third of SS) and
    // holdout demand differs from history. Step 3 (Bayesian optimisation over the full simulation)
    // addresses this by treating service as an explicit constraint.
    for (const p of POLICIES) expect(totals(p).csl).toBeLessThan(0.95);
  });
});

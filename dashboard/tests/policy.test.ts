import { describe, expect, it } from "vitest";
import { skuIndexById } from "../src/lib/data/dataset";
import { asIsMetrics } from "../src/lib/inventory/asIs";
import { costParams, economicOrderQuantity, skuCostParams } from "../src/lib/inventory/cost";
import { gammaLeadTime } from "../src/lib/inventory/leadTimeModel";
import { baselineDesign, forecastDesign, withMonteCarlo } from "../src/lib/inventory/policies";
import { simulatePolicy, simulatePolicyReplications } from "../src/lib/inventory/policySim";
import type { CostsFile } from "../src/lib/data/types";
import { loadDataset, loadLeadTimes, readData } from "./helpers";

const costs = costParams(50, { holdingRatePerYear: 0.25, orderCost: 50, marginRate: 0.4, daysPerYear: 365 });

describe("cost model", () => {
  it("converts annual holding to per day and computes EOQ", () => {
    expect(costs.holdingPerUnitDay).toBeCloseTo((0.25 * 50) / 365, 12);
    expect(costs.shortagePerUnit).toBe(20);
    // EOQ = sqrt(2 * 100/day * 50 / (12.5/365)) = sqrt(292000) ≈ 540.4
    expect(economicOrderQuantity(100, 50, costs.holdingPerUnitDay)).toBeCloseTo(Math.sqrt(292000), 9);
  });
});

describe("(s, Q) policy simulation", () => {
  const fixedLead = gammaLeadTime(2, 0);

  it("conserves stock: start + receipts − sales = end; sales + lost = demand", () => {
    const demand = Float64Array.from({ length: 200 }, (_, t) => 80 + 40 * Math.sin(t / 5));
    const r = simulatePolicy({
      demand, reorderPoint: 150, orderQuantity: 300, leadTime: gammaLeadTime(2, 1),
      initialOnHand: 400, costs, seed: 1, record: true,
    });
    const tr = r.trace!;
    const receipts = tr.receipts.reduce((a, b) => a + b, 0);
    const sameDay = Array.from(tr.orderLeadTime).reduce((a, l, t) => a + (l === 0 ? tr.orderQty[t] : 0), 0);
    expect(400 + receipts + sameDay - r.sales).toBeCloseTo(tr.onHandEnd[199], 6);
    expect(r.sales + r.lost).toBeCloseTo(r.totalDemand, 6);
    expect(r.totalCost).toBeCloseTo(r.holdingCost + r.orderingCost + r.shortageCost, 6);
  });

  it("never stocks out when s covers deterministic lead-time demand", () => {
    const demand = new Float64Array(120).fill(10);
    const r = simulatePolicy({ demand, reorderPoint: 20, orderQuantity: 50, leadTime: fixedLead, initialOnHand: 60, costs, seed: 2 });
    expect(r.lost).toBe(0);
    expect(r.fillRate).toBe(1);
    expect(r.cycleServiceLevel).toBe(1);
    // 120 days × 10 units = 1200 units; starting with 60 means 1140 must be ordered in lots of 50
    expect(r.orders).toBeGreaterThanOrEqual(Math.floor(1140 / 50));
  });

  it("stocks out when s is below lead-time demand", () => {
    const demand = new Float64Array(120).fill(10);
    const r = simulatePolicy({ demand, reorderPoint: 5, orderQuantity: 50, leadTime: fixedLead, initialOnHand: 60, costs, seed: 2 });
    expect(r.lost).toBeGreaterThan(0);
    expect(r.cycleServiceLevel!).toBeLessThan(1);
  });

  it("uses common random numbers: the same seed gives identical lead-time draws", () => {
    const demand = Float64Array.from({ length: 90 }, (_, t) => 60 + (t % 7) * 5);
    const opts = { demand, reorderPoint: 150, orderQuantity: 200, leadTime: gammaLeadTime(2, 1), initialOnHand: 200, costs, seed: 9 };
    expect(simulatePolicy(opts).totalCost).toBe(simulatePolicy(opts).totalCost);
    const reps = simulatePolicyReplications(opts, 20);
    expect(reps.fillRate).toBeGreaterThan(0);
    expect(reps.fillRate).toBeLessThanOrEqual(1);
  });

  it("a higher reorder point raises service and holding cost", () => {
    const demand = Float64Array.from({ length: 365 }, (_, t) => 100 + 30 * Math.sin(t / 9));
    const run = (s: number) => simulatePolicyReplications(
      { demand, reorderPoint: s, orderQuantity: 400, leadTime: gammaLeadTime(2, 1), initialOnHand: 400, costs, seed: 4 }, 30);
    const low = run(150), high = run(400);
    expect(high.fillRate).toBeGreaterThan(low.fillRate);
    expect(high.holdingCost).toBeGreaterThan(low.holdingCost);
  });
});

describe("as-is policy from the ledger", () => {
  it("matches the stockout rate in costs.json over the full history", () => {
    const ds = loadDataset();
    const costsFile = readData<CostsFile>("costs.json");
    for (const id of ["S001-P0001", "S004-P0013"]) {
      const sku = ds.skus[skuIndexById(ds, id)];
      const m = asIsMetrics(sku, 0, ds.dates.length, skuCostParams(costsFile, id));
      expect(m.stockoutDayRate).toBeCloseTo(costsFile.skus[id].asIs.stockoutDayRate, 4);
      expect(m.avgOnHand).toBeCloseTo(costsFile.skus[id].asIs.avgInventory, 2);
    }
  });
});

describe("policy designs", () => {
  const ds = loadDataset();
  const lt = loadLeadTimes();
  const sku = ds.skus[skuIndexById(ds, "S001-P0001")];
  const leadTime = gammaLeadTime(lt.skus[sku.id].L, lt.stores.S001.sd);

  it("baseline uses the slide formula on static history", () => {
    const d = baselineDesign(sku.demand, ds.dates.length - 1, leadTime, 0.95);
    expect(d.formula.safetyStock).toBeCloseTo(169.9547, 3);
    expect(d.reorderPoint).toBe(d.formula.reorderPoint);
  });

  it("Monte Carlo raises the reorder point to correct the right-skewed tail", () => {
    const base = baselineDesign(sku.demand, ds.dates.length - 1, leadTime, 0.95);
    const mc = withMonteCarlo(base, 50_000, 21);
    expect(mc.method).toBe("monte-carlo");
    expect(mc.monteCarlo!.skewness).toBeGreaterThan(0.5);
    expect(mc.reorderPoint).toBeGreaterThan(base.reorderPoint);
    expect(mc.monteCarlo!.formulaStockoutProbability).toBeGreaterThan(0.05);
  });

  it("AI design takes D̄ from the forecast over the lead time and σ_D from forecast errors", () => {
    const forecast = [120, 110, 100, 90];
    const residuals = [-20, 10, 5, -5, 15, -10];
    const d = forecastDesign(forecast, residuals, gammaLeadTime(2, 1), 0.95);
    expect(d.formula.dBar).toBe(115);
    expect(d.formula.sigmaD).toBeCloseTo(Math.sqrt((400 + 100 + 25 + 25 + 225 + 100 - 6 * (-5 / 6) ** 2) / 5), 9);
  });
});

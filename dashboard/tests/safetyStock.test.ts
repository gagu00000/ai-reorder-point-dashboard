/**
 * Step 2 — dynamic safety stock. The slide formula is checked against the hand calculations in
 * notebooks/01_data_audit.ipynb, and the Monte Carlo engine against the notebook's 200k-trial run.
 */
import { describe, expect, it } from "vitest";
import { skuIndexById } from "../src/lib/data/dataset";
import { empiricalLeadTime, gammaLeadTime, leadTimeMoments, leadTimeSampler, stochasticRoundDays } from "../src/lib/inventory/leadTimeModel";
import {
  cycleFillRate, ddltHistogram, expectedShortage, monteCarloSafetyStock, simulateDdlt, stockoutProbability,
} from "../src/lib/inventory/monteCarlo";
import { computeSafetyStock, impliedServiceLevel } from "../src/lib/inventory/safetyStock";
import { mean, std } from "../src/lib/stats/descriptive";
import { Rng } from "../src/lib/stats/prng";
import { loadDataset, loadLeadTimes } from "./helpers";

describe("slide formula: SS = Z·√(σ_D²·L + D̄²·σ_L²), ROP = D̄·L + SS", () => {
  it("reproduces the S001-P0001 hand calculation (notebook 01, section 5)", () => {
    const r = computeSafetyStock({ serviceLevel: 0.95, dBar: 92.8145, sigmaD: 35.5362, leadTime: 2, sigmaL: 0.9727 });
    expect(r.z).toBeCloseTo(1.644854, 6);
    expect(r.demandTerm).toBeCloseTo(2525.65, 1);
    expect(r.leadTimeTerm).toBeCloseTo(8150.4, 0);
    expect(r.sigmaDdlt).toBeCloseTo(103.325, 2);
    expect(r.safetyStock).toBeCloseTo(169.95, 1);
    expect(r.reorderPoint).toBeCloseTo(355.58, 1);
    expect(r.leadTimeShare).toBeCloseTo(0.7634, 3);
  });

  it("reproduces the same calculation from the raw dataset and lead-time file", () => {
    const ds = loadDataset();
    const lt = loadLeadTimes();
    const y = ds.skus[skuIndexById(ds, "S001-P0001")].demand;
    const r = computeSafetyStock({
      serviceLevel: 0.95, dBar: mean(y), sigmaD: std(y, 1),
      leadTime: lt.skus["S001-P0001"].L, sigmaL: lt.stores.S001.sd,
    });
    expect(r.safetyStock).toBeCloseTo(169.9547, 3);
    expect(r.reorderPoint).toBeCloseTo(355.5836, 3);
  });

  it("reproduces the Phase 1 worked example (652.46 / 1613.60)", () => {
    const r = computeSafetyStock({ serviceLevel: 0.95, dBar: 137.3064, sigmaD: 108.1879, leadTime: 7, sigmaL: 2 });
    expect(r.safetyStock).toBeCloseTo(652.46, 1);
    expect(r.reorderPoint).toBeCloseTo(1613.6, 1);
  });

  it("reduces to the textbook Z·σ_D·√L when lead time is certain", () => {
    const r = computeSafetyStock({ serviceLevel: 0.9, dBar: 100, sigmaD: 30, leadTime: 4, sigmaL: 0 });
    expect(r.safetyStock).toBeCloseTo(r.z * 30 * 2, 10);
    expect(r.leadTimeShare).toBe(0);
  });

  it("reduces to Z·D̄·σ_L when demand is certain", () => {
    const r = computeSafetyStock({ serviceLevel: 0.99, dBar: 50, sigmaD: 0, leadTime: 3, sigmaL: 1.5 });
    expect(r.safetyStock).toBeCloseTo(r.z * 50 * 1.5, 10);
  });

  it("rejects invalid inputs", () => {
    expect(() => computeSafetyStock({ serviceLevel: 1, dBar: 1, sigmaD: 1, leadTime: 1, sigmaL: 1 })).toThrow();
    expect(() => computeSafetyStock({ serviceLevel: 0.95, dBar: -1, sigmaD: 1, leadTime: 1, sigmaL: 1 })).toThrow();
  });

  it("implied service level inverts the formula", () => {
    const r = computeSafetyStock({ serviceLevel: 0.97, dBar: 80, sigmaD: 20, leadTime: 3, sigmaL: 1 });
    expect(impliedServiceLevel(r.reorderPoint, r.expectedDdlt, r.sigmaDdlt)).toBeCloseTo(0.97, 10);
  });
});

describe("random number generation", () => {
  it("is reproducible for a given seed", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const xs = Array.from({ length: 5 }, () => a.uniform());
    expect(Array.from({ length: 5 }, () => b.uniform())).toEqual(xs);
    expect(c.uniform()).not.toBe(xs[0]);
  });

  it("produces correct moments for uniform, Normal and Gamma draws", () => {
    const rng = new Rng(1);
    const n = 200_000;
    const u = Float64Array.from({ length: n }, () => rng.uniform());
    const z = Float64Array.from({ length: n }, () => rng.normal());
    expect(mean(u)).toBeCloseTo(0.5, 2);
    expect(std(u)).toBeCloseTo(Math.sqrt(1 / 12), 2);
    expect(mean(z)).toBeCloseTo(0, 2);
    expect(std(z)).toBeCloseTo(1, 2);
    for (const [shape, scale] of [[0.6, 2], [4.2, 0.5]]) {
      const g = Float64Array.from({ length: n }, () => rng.gamma(shape, scale));
      expect(mean(g) / (shape * scale)).toBeCloseTo(1, 2);
      expect(std(g) / (Math.sqrt(shape) * scale)).toBeCloseTo(1, 1);
    }
  });
});

describe("lead-time models", () => {
  it("Gamma sampler matches the requested mean and sd (the formula's L and σ_L)", () => {
    const rng = new Rng(9);
    const draw = leadTimeSampler(gammaLeadTime(2, 0.9727), rng);
    const xs = Float64Array.from({ length: 200_000 }, draw);
    expect(mean(xs)).toBeCloseTo(2, 2);
    expect(std(xs)).toBeCloseTo(0.9727, 2);
    expect(xs.reduce((a, b) => Math.min(a, b), Infinity)).toBeGreaterThan(0);
  });

  it("empirical model reproduces the S001 supplier pool", () => {
    const pool = loadLeadTimes().stores.S001;
    const m = leadTimeMoments(empiricalLeadTime(pool));
    // probabilities are stored to 6 decimals, so moments agree to ~1e-6
    expect(m.mean).toBeCloseTo(pool.mean, 5);
    // the pool file stores the sample sd (ddof = 1); the model uses the population sd
    expect(m.sd).toBeCloseTo(pool.sd * Math.sqrt((pool.n - 1) / pool.n), 5);
  });

  it("stochastic rounding to whole days preserves the mean", () => {
    const rng = new Rng(5);
    const xs = Float64Array.from({ length: 100_000 }, () => stochasticRoundDays(2.3, rng));
    expect(mean(xs)).toBeCloseTo(2.3, 2);
    expect(new Set(xs)).toEqual(new Set([2, 3]));
  });
});

describe("Monte Carlo demand during lead time", () => {
  const ds = loadDataset();
  const y = ds.skus[skuIndexById(ds, "S001-P0001")].demand;
  const pool = loadLeadTimes().stores.S001;
  const dBar = mean(y);
  const sigmaD = std(y, 0);
  const demand = { kind: "bootstrap" as const, meanPath: [dBar], residuals: Float64Array.from(y, (v) => v - dBar) };

  it("matches the variance identity σ_D²·E[L] + D̄²·Var(L) and the notebook's tail results", () => {
    const leadTime = empiricalLeadTime(pool);
    const lt = leadTimeMoments(leadTime);
    const r = simulateDdlt({ trials: 200_000, seed: 11, leadTime, demand });
    const theorySd = Math.sqrt(sigmaD ** 2 * lt.mean + dBar ** 2 * lt.sd ** 2);
    expect(r.mean / (dBar * lt.mean)).toBeCloseTo(1, 2);
    expect(r.sd / theorySd).toBeCloseTo(1, 2);
    // Notebook 01 (NumPy RNG, 200k trials): skew 1.41, MC SS 224.4, formula SS 165.8, P(stockout) 9.5%.
    expect(r.skewness).toBeGreaterThan(1.3);
    expect(r.skewness).toBeLessThan(1.5);
    expect(Math.abs(monteCarloSafetyStock(r, 0.95) - 224.41)).toBeLessThan(4);
    const formulaRop = dBar * lt.mean + 1.6448536 * theorySd;
    expect(Math.abs(stockoutProbability(r, formulaRop) - 0.0949)).toBeLessThan(0.004);
  });

  it("with Gamma lead times it shares the formula's inputs exactly", () => {
    const r = simulateDdlt({ trials: 100_000, seed: 3, leadTime: gammaLeadTime(2, 0.9727), demand });
    expect(r.leadTime.sampledMean).toBeCloseTo(2, 2);
    expect(r.leadTime.sampledSd).toBeCloseTo(0.9727, 2);
    expect(r.mean / (dBar * 2)).toBeCloseTo(1, 2);
    // fractional final days remove a little within-day variance (≤ σ_D²/4), so allow 2 %
    const theorySd = Math.sqrt(sigmaD ** 2 * 2 + dBar ** 2 * 0.9727 ** 2);
    expect(Math.abs(r.sd / theorySd - 1)).toBeLessThan(0.02);
  });

  it("tail measures are consistent", () => {
    const r = simulateDdlt({ trials: 50_000, seed: 8, leadTime: gammaLeadTime(2, 1), demand });
    const rop = monteCarloSafetyStock(r, 0.95) + r.mean;
    expect(stockoutProbability(r, rop)).toBeCloseTo(0.05, 2);
    expect(expectedShortage(r, rop)).toBeGreaterThan(0);
    expect(expectedShortage(r, rop * 2)).toBeLessThan(expectedShortage(r, rop));
    expect(cycleFillRate(r, rop, 400)).toBeGreaterThan(0.95);
    const hist = ddltHistogram(r, 50);
    expect(hist).toHaveLength(50);
    expect(hist.reduce((a, b) => a + b.count, 0)).toBe(r.trials);
  });

  it("is reproducible: same seed, same distribution", () => {
    const opts = { trials: 2000, seed: 77, leadTime: gammaLeadTime(3, 1), demand };
    expect(simulateDdlt(opts).sorted).toEqual(simulateDdlt(opts).sorted);
  });
});

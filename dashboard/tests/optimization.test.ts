/** Bayesian-optimisation engine: Sobol design, GP surrogate (parity with scikit-learn), acquisition, benchmarks. */
import { describe, expect, it } from "vitest";
import { expectedImprovement, probabilityFeasible } from "../src/lib/optimization/acquisition";
import { bayesianOptimisation, gridSearch, randomSearch } from "../src/lib/optimization/bayesOpt";
import { fitGp, fitGpFixed, gpPredict } from "../src/lib/optimization/gp";
import { Sobol } from "../src/lib/optimization/sobol";
import { readFixture } from "./helpers";

interface GpFixture {
  X: number[][]; y: number[]; Xs: number[][];
  signalVar: number; lengthscales: number[]; noiseVar: number;
  mean: number[]; sd: number[]; logMarginalLikelihood: number;
}

describe("Sobol sequence", () => {
  it("produces the standard 2-D points", () => {
    expect(new Sobol(2).take(5)).toEqual([[0.5, 0.5], [0.75, 0.25], [0.25, 0.75], [0.375, 0.375], [0.875, 0.875]]);
  });

  it("is evenly spread: each quarter of each axis gets a quarter of 256 points", () => {
    const pts = new Sobol(3).take(256);
    for (let j = 0; j < 3; j++) {
      const counts = [0, 0, 0, 0];
      pts.forEach((p) => counts[Math.floor(p[j] * 4)]++);
      counts.forEach((c) => expect(Math.abs(c - 64)).toBeLessThanOrEqual(1));
    }
  });
});

describe("Gaussian process (Matérn 5/2 ARD)", () => {
  const fx = readFixture<GpFixture>("gp.json");

  it("matches scikit-learn's posterior mean, sd and log marginal likelihood", () => {
    const model = fitGpFixed(fx.X, fx.y, { lengthscales: fx.lengthscales, signalVar: fx.signalVar, noiseVar: fx.noiseVar }, false);
    // we add a 1e-10 numerical jitter to the kernel diagonal; scikit-learn does not
    expect(model.logMarginalLikelihood).toBeCloseTo(fx.logMarginalLikelihood, 7);
    fx.Xs.forEach((x, i) => {
      const p = gpPredict(model, x);
      expect(p.mean).toBeCloseTo(fx.mean[i], 8);
      expect(Math.sqrt(p.variance)).toBeCloseTo(fx.sd[i], 7);
    });
  });

  it("hyper-parameter fitting improves the marginal likelihood and interpolates the data", () => {
    const fixed = fitGpFixed(fx.X, fx.y, { lengthscales: [1, 1], signalVar: 1, noiseVar: 0.3 });
    const fitted = fitGp(fx.X, fx.y);
    expect(fitted.logMarginalLikelihood).toBeGreaterThan(fixed.logMarginalLikelihood);
    fx.X.forEach((x, i) => expect(Math.abs(gpPredict(fitted, x).mean - fx.y[i])).toBeLessThan(0.15));
    const near = gpPredict(fitted, fx.X[0]).variance;
    const far = gpPredict(fitted, [1.6, -0.6]).variance;
    expect(far).toBeGreaterThan(near * 10);
  });
});

describe("acquisition functions", () => {
  it("expected improvement has the closed form value σ·φ(0) at the incumbent", () => {
    expect(expectedImprovement(0, 1, 0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
    expect(expectedImprovement(5, 0, 3)).toBe(0);
    expect(expectedImprovement(1, 0, 3)).toBe(2);
  });

  it("probability of feasibility is Φ(−μ/σ)", () => {
    expect(probabilityFeasible(0, 1)).toBeCloseTo(0.5, 12);
    expect(probabilityFeasible(-1.6448536, 1)).toBeCloseTo(0.95, 6);
    expect(probabilityFeasible(1, 0)).toBe(0);
  });
});

describe("Bayesian optimisation on benchmarks", () => {
  const branin = ([x1, x2]: number[]) => {
    const b = 5.1 / (4 * Math.PI ** 2), c = 5 / Math.PI, t = 1 / (8 * Math.PI);
    return { objective: (x2 - b * x1 ** 2 + c * x1 - 6) ** 2 + 10 * (1 - t) * Math.cos(x1) + 10, constraints: [] };
  };
  const bounds = { names: ["x1", "x2"], lower: [-5, 0], upper: [10, 15] };

  it("finds the Branin minimum (0.397887) within 40 evaluations and beats random search", () => {
    const bo = bayesianOptimisation({ bounds, evaluate: branin, budget: 40, seed: 3 });
    const rs = randomSearch({ bounds, evaluate: branin, budget: 40, seed: 3 });
    expect(bo.best!.objective).toBeLessThan(0.45);
    expect(bo.best!.objective).toBeLessThan(rs.best!.objective);
    // convergence trace is monotone non-increasing
    const curve = bo.trace.map((t) => t.bestFeasible!.objective);
    curve.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(curve[i]));
  });

  it("respects a black-box constraint: min (x − 0.8)² subject to x ≤ 0.5", () => {
    const res = bayesianOptimisation({
      bounds: { names: ["x"], lower: [0], upper: [1] },
      evaluate: ([x]) => ({ objective: (x - 0.8) ** 2, constraints: [x - 0.5] }),
      budget: 20, seed: 5,
    });
    expect(res.best!.feasible).toBe(true);
    expect(res.best!.x[0]).toBeGreaterThan(0.47);
    expect(res.best!.x[0]).toBeLessThanOrEqual(0.5);
  });

  it("grid search enumerates the full grid", () => {
    const g = gridSearch({ bounds, evaluate: branin, steps: [5, 4] });
    expect(g.evaluations).toHaveLength(20);
    expect(g.evaluations[0].x).toEqual([-5, 0]);
    expect(g.evaluations[19].x).toEqual([10, 15]);
  });
});

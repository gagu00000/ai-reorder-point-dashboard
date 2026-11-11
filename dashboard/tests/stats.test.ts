import { describe, expect, it } from "vitest";
import { accuracy } from "../src/lib/forecasting/metrics";
import { mean, quantile, std } from "../src/lib/stats/descriptive";
import { choleskySolve } from "../src/lib/stats/linalg";
import { nelderMead } from "../src/lib/stats/nelderMead";
import { normalCdf, normalPpf } from "../src/lib/stats/normal";
import { readFixture } from "./helpers";

describe("normal distribution", () => {
  it("Φ⁻¹ matches scipy.stats.norm.ppf to 1e-9", () => {
    for (const { p, z } of readFixture<{ p: number; z: number }[]>("normal.json")) {
      expect(Math.abs(normalPpf(p) - z)).toBeLessThan(1e-9);
    }
  });

  it("Z for a 95% service level is 1.644854", () => {
    expect(normalPpf(0.95)).toBeCloseTo(1.6448536269514722, 12);
  });

  it("Φ inverts Φ⁻¹ across the tails", () => {
    for (const p of [1e-6, 0.001, 0.2, 0.5, 0.77, 0.999, 1 - 1e-6]) {
      expect(normalCdf(normalPpf(p))).toBeCloseTo(p, 12);
    }
  });
});

describe("descriptive statistics", () => {
  const x = [3, 1, 4, 1, 5, 9, 2, 6];
  it("mean, sample sd", () => {
    expect(mean(x)).toBe(3.875);
    // np.std([3,1,4,1,5,9,2,6], ddof=1)
    expect(std(x, 1)).toBeCloseTo(2.748376143938713, 12);
  });
  it("quantile uses NumPy's linear interpolation", () => {
    // np.quantile([3,1,4,1,5,9,2,6], [0.1, 0.5, 0.95]) = [1.0, 3.5, 7.95]
    expect(quantile(x, 0.1)).toBeCloseTo(1.0, 12);
    expect(quantile(x, 0.5)).toBeCloseTo(3.5, 12);
    expect(quantile(x, 0.95)).toBeCloseTo(7.95, 12);
  });
});

describe("linear algebra and optimisation", () => {
  it("Cholesky solves a symmetric positive-definite system", () => {
    const a = Float64Array.from([4, 2, 0.6, 2, 5, 1, 0.6, 1, 3]);
    const x = choleskySolve(a, 3, [1, 2, 3]);
    const back = [0, 1, 2].map((i) => a[i * 3] * x[0] + a[i * 3 + 1] * x[1] + a[i * 3 + 2] * x[2]);
    back.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i], 12));
  });

  it("Nelder–Mead finds the Rosenbrock minimum", () => {
    const res = nelderMead(([a, b]) => (1 - a) ** 2 + 100 * (b - a * a) ** 2, [-1.2, 1], { maxIterations: 2000 });
    expect(res.x[0]).toBeCloseTo(1, 4);
    expect(res.x[1]).toBeCloseTo(1, 4);
  });
});

describe("accuracy metrics", () => {
  it("match the Python reference definitions", () => {
    const fx = readFixture<{ y: number[]; f: number[]; scale: number[]; expected: Record<string, number> }>("metrics.json");
    const got = accuracy(fx.y, fx.f, fx.scale);
    for (const [k, v] of Object.entries(fx.expected)) {
      expect(got[k as keyof typeof got]).toBeCloseTo(v, 12);
    }
  });
});

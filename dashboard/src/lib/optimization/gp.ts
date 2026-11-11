/**
 * Gaussian-process regression — the surrogate model of Bayesian optimisation.
 *
 * Kernel: Matérn 5/2 with automatic relevance determination (one length-scale per input),
 *   k(x, x') = σ_f² (1 + √5·r + 5r²/3) exp(−√5·r),  r² = Σ ((x_i − x'_i) / ℓ_i)²,
 * plus Gaussian observation noise σ_n² (simulation objectives are jagged, not smooth).
 * Inputs are expected in the unit cube; outputs are standardised unless told otherwise.
 * Hyper-parameters maximise the log marginal likelihood (multi-start Nelder–Mead).
 * The fitted model is plain data so it can be sent from a Web Worker to the UI.
 */
import { choleskyDecompose } from "../stats/linalg";
import { nelderMead } from "../stats/nelderMead";

export interface GpHyper {
  lengthscales: number[];
  signalVar: number;
  noiseVar: number;
}

export interface GpModel {
  d: number;
  n: number;
  X: Float64Array;     // n × d, unit-cube inputs
  yMean: number;
  ySd: number;
  hyper: GpHyper;
  L: Float64Array;     // Cholesky factor of K + σ_n² I (standardised space)
  alpha: Float64Array; // (K + σ_n² I)⁻¹ y (standardised space)
  logMarginalLikelihood: number;
}

const SQRT5 = Math.sqrt(5);
const JITTER = 1e-10;

/** Hyper-parameter search ranges (unit-cube inputs, standardised outputs). */
const RANGES = {
  logLengthscale: [Math.log(0.02), Math.log(5)],
  logSignalVar: [Math.log(0.05), Math.log(20)],
  logNoiseVar: [Math.log(1e-6), Math.log(0.5)],
} as const;

export function matern52(
  a: ArrayLike<number>, aOff: number, b: ArrayLike<number>, bOff: number, d: number,
  lengthscales: ArrayLike<number>, signalVar: number,
): number {
  let r2 = 0;
  for (let i = 0; i < d; i++) {
    const z = (a[aOff + i] - b[bOff + i]) / lengthscales[i];
    r2 += z * z;
  }
  const r = Math.sqrt(r2);
  return signalVar * (1 + SQRT5 * r + (5 * r2) / 3) * Math.exp(-SQRT5 * r);
}

/** Fit with fixed hyper-parameters. `normalizeY = false` keeps outputs on their raw scale. */
export function fitGpFixed(X: number[][], y: number[], hyper: GpHyper, normalizeY = true): GpModel {
  const n = X.length;
  if (n === 0 || y.length !== n) throw new Error("GP needs matching, non-empty X and y");
  const d = X[0].length;
  const flat = new Float64Array(n * d);
  X.forEach((row, i) => row.forEach((v, j) => (flat[i * d + j] = v)));
  let yMean = 0;
  let ySd = 1;
  if (normalizeY) {
    yMean = y.reduce((a, b) => a + b, 0) / n;
    const v = y.reduce((a, b) => a + (b - yMean) ** 2, 0) / n;
    ySd = v > 1e-24 ? Math.sqrt(v) : 1;
  }
  const ys = Float64Array.from(y, (v) => (v - yMean) / ySd);
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const k = matern52(flat, i * d, flat, j * d, d, hyper.lengthscales, hyper.signalVar);
      K[i * n + j] = k;
      K[j * n + i] = k;
    }
    K[i * n + i] += hyper.noiseVar + JITTER;
  }
  const L = choleskyDecompose(K, n);
  // alpha = L^-T L^-1 y
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = ys[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * z[k];
    z[i] = s / L[i * n + i];
  }
  const alpha = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * alpha[k];
    alpha[i] = s / L[i * n + i];
  }
  let quad = 0;
  let logDet = 0;
  for (let i = 0; i < n; i++) {
    quad += ys[i] * alpha[i];
    logDet += Math.log(L[i * n + i]);
  }
  const lml = -0.5 * quad - logDet - 0.5 * n * Math.log(2 * Math.PI);
  return { d, n, X: flat, yMean, ySd, hyper, L, alpha, logMarginalLikelihood: lml };
}

const sigmoid = (u: number) => 1 / (1 + Math.exp(-u));
const toRange = (u: number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * sigmoid(u);
const fromRange = (v: number, [lo, hi]: readonly [number, number]) => {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, (v - lo) / (hi - lo)));
  return Math.log(p / (1 - p));
};

function decodeHyper(u: number[], d: number): GpHyper {
  return {
    lengthscales: u.slice(0, d).map((v) => Math.exp(toRange(v, RANGES.logLengthscale))),
    signalVar: Math.exp(toRange(u[d], RANGES.logSignalVar)),
    noiseVar: Math.exp(toRange(u[d + 1], RANGES.logNoiseVar)),
  };
}

function encodeHyper(h: GpHyper): number[] {
  return [
    ...h.lengthscales.map((l) => fromRange(Math.log(l), RANGES.logLengthscale)),
    fromRange(Math.log(h.signalVar), RANGES.logSignalVar),
    fromRange(Math.log(h.noiseVar), RANGES.logNoiseVar),
  ];
}

export const DEFAULT_HYPER = (d: number): GpHyper => ({ lengthscales: new Array(d).fill(0.3), signalVar: 1, noiseVar: 1e-3 });

/** Fit hyper-parameters by maximising the log marginal likelihood (standardised outputs). */
export function fitGp(X: number[][], y: number[], warmStart?: GpHyper): GpModel {
  const d = X[0].length;
  const objective = (u: number[]) => {
    try {
      return -fitGpFixed(X, y, decodeHyper(u, d)).logMarginalLikelihood;
    } catch {
      return Number.POSITIVE_INFINITY; // numerically non-positive-definite: reject
    }
  };
  const starts = [encodeHyper(DEFAULT_HYPER(d)), encodeHyper({ lengthscales: new Array(d).fill(1), signalVar: 1, noiseVar: 0.05 })];
  if (warmStart) starts.unshift(encodeHyper(warmStart));
  let best = { x: starts[0], fx: objective(starts[0]) };
  for (const s of starts) {
    const r = nelderMead(objective, s, { maxIterations: 120, step: 0.8, fTolerance: 1e-7, xTolerance: 1e-4 });
    if (r.fx < best.fx) best = { x: r.x, fx: r.fx };
  }
  if (!Number.isFinite(best.fx)) {
    // every candidate was numerically singular (e.g. duplicated inputs): fall back to a noisy model
    return fitGpFixed(X, y, { ...DEFAULT_HYPER(d), noiseVar: 0.1 });
  }
  return fitGpFixed(X, y, decodeHyper(best.x, d));
}

/** Posterior mean and variance of the latent function at x (unit-cube coordinates, original units). */
export function gpPredict(model: GpModel, x: ArrayLike<number>): { mean: number; variance: number } {
  const { n, d, X, L, alpha, hyper } = model;
  const k = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    k[i] = matern52(X, i * d, x, 0, d, hyper.lengthscales, hyper.signalVar);
    mean += k[i] * alpha[i];
  }
  // v = L^-1 k ; variance = k(x,x) - v·v
  let vv = 0;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = k[i];
    for (let j = 0; j < i; j++) s -= L[i * n + j] * v[j];
    v[i] = s / L[i * n + i];
    vv += v[i] * v[i];
  }
  const variance = Math.max(0, hyper.signalVar - vv);
  return { mean: model.yMean + model.ySd * mean, variance: variance * model.ySd ** 2 };
}

/**
 * Exponential smoothing: simple (SES) and damped-trend Holt, error-correction form identical to
 * statsmodels' `ExponentialSmoothing` with a known initial state:
 *
 *   ŷ(t|t-1) = l(t-1) + φ·b(t-1)
 *   l(t)     = α·y(t) + (1-α)·(l(t-1) + φ·b(t-1))
 *   b(t)     = β·(l(t) - l(t-1)) + (1-β)·φ·b(t-1)
 *
 * Parameters are chosen by minimising the one-step SSE within the same bounds statsmodels uses
 * (α, β ∈ [1e-4, 0.9999], β ≤ α, φ ∈ [0.8, 0.98]); the model with the lower AIC is kept.
 */
import { mean } from "../stats/descriptive";
import { nelderMead } from "../stats/nelderMead";

export type EtsKind = "SES" | "Holt-damped";

export interface EtsParams {
  alpha: number;
  beta: number | null;
  phi: number | null;
}

export interface EtsFit extends EtsParams {
  kind: EtsKind;
  l0: number;
  b0: number;
  sse: number;
  aic: number;
  level: number;
  trend: number;
  /** One-step-ahead fitted values over the fitting window. */
  fitted: Float64Array;
}

export const ETS_BOUNDS = { alpha: [1e-4, 0.9999], beta: [1e-4, 0.9999], phi: [0.8, 0.98] } as const;

/** Heuristic initial state, identical to the Python reference. */
export function etsInitialState(y: ArrayLike<number>): { l0: number; b0: number } {
  const first = mean(y, 0, 7);
  return { l0: first, b0: (mean(y, 7, 14) - first) / 7 };
}

/** Run the recursion over y[0..n); returns fitted values, SSE and the final state. */
export function etsFilter(
  y: ArrayLike<number>, n: number, p: EtsParams, l0: number, b0: number, fitted?: Float64Array,
): { sse: number; level: number; trend: number } {
  let level = l0;
  let trend = p.beta === null ? 0 : b0;
  const phi = p.phi ?? 0;
  let sse = 0;
  for (let t = 0; t < n; t++) {
    const yhat = p.beta === null ? level : level + phi * trend;
    if (fitted) fitted[t] = yhat;
    sse += (y[t] - yhat) ** 2;
    if (p.beta === null) {
      level = p.alpha * y[t] + (1 - p.alpha) * level;
    } else {
      const newLevel = p.alpha * y[t] + (1 - p.alpha) * (level + phi * trend);
      trend = p.beta * (newLevel - level) + (1 - p.beta) * phi * trend;
      level = newLevel;
    }
  }
  return { sse, level, trend };
}

export function etsForecastFromState(level: number, trend: number, phi: number | null, horizon: number): Float64Array {
  const out = new Float64Array(horizon);
  let damp = 0;
  for (let h = 0; h < horizon; h++) {
    if (phi !== null) damp += phi ** (h + 1);
    out[h] = phi === null ? level : level + damp * trend;
  }
  return out;
}

export function etsAic(sse: number, n: number, k: number): number {
  return n * Math.log(sse / n) + 2 * k;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
const toBound = (x: number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * sigmoid(x);
const fromBound = (v: number, [lo, hi]: readonly [number, number]) => logit((v - lo) / (hi - lo));

/** Map unconstrained optimiser coordinates to valid parameters. β = α·u keeps β ≤ α. */
function decode(kind: EtsKind, x: number[]): EtsParams {
  const alpha = toBound(x[0], ETS_BOUNDS.alpha);
  if (kind === "SES") return { alpha, beta: null, phi: null };
  const beta = Math.max(ETS_BOUNDS.beta[0], alpha * sigmoid(x[1]));
  return { alpha, beta, phi: toBound(x[2], ETS_BOUNDS.phi) };
}

function encodeStart(kind: EtsKind, alpha: number, betaShare: number, phi: number): number[] {
  const a = fromBound(alpha, ETS_BOUNDS.alpha);
  return kind === "SES" ? [a] : [a, logit(betaShare), fromBound(phi, ETS_BOUNDS.phi)];
}

/** Fit one ETS kind on y[0..n): coarse grid search, then Nelder–Mead from the two best starts. */
export function fitEtsKind(y: ArrayLike<number>, n: number, kind: EtsKind): EtsFit {
  const { l0, b0 } = etsInitialState(y);
  const objective = (x: number[]) => etsFilter(y, n, decode(kind, x), l0, b0).sse;

  const alphas = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
  const shares = kind === "SES" ? [0.5] : [0.01, 0.1, 0.5, 0.99];
  const phis = kind === "SES" ? [0.9] : [0.81, 0.9, 0.97];
  const grid: { x: number[]; fx: number }[] = [];
  for (const a of alphas) for (const s of shares) for (const p of phis) {
    const x = encodeStart(kind, a, s, p);
    grid.push({ x, fx: objective(x) });
  }
  grid.sort((u, v) => u.fx - v.fx);

  let best = grid[0];
  for (const start of grid.slice(0, 2)) {
    const res = nelderMead(objective, start.x, { maxIterations: 400, step: 0.6, fTolerance: 1e-12, xTolerance: 1e-7 });
    if (res.fx < best.fx) best = { x: res.x, fx: res.fx };
  }
  const params = decode(kind, best.x);
  const fitted = new Float64Array(n);
  const { sse, level, trend } = etsFilter(y, n, params, l0, b0, fitted);
  const k = kind === "SES" ? 1 : 3;
  return { kind, ...params, l0, b0, sse, aic: etsAic(sse, n, k), level, trend, fitted };
}

/** Fit SES and damped Holt on y[0..origin] and keep the lower AIC. */
export function fitEts(y: ArrayLike<number>, origin: number): EtsFit {
  const n = origin + 1;
  const ses = fitEtsKind(y, n, "SES");
  const holt = fitEtsKind(y, n, "Holt-damped");
  return ses.aic <= holt.aic ? ses : holt;
}

export function etsForecast(y: ArrayLike<number>, origin: number, horizon: number): Float64Array {
  const fit = fitEts(y, origin);
  return etsForecastFromState(fit.level, fit.trend, fit.phi, horizon);
}

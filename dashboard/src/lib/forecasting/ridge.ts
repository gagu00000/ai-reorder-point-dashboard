/**
 * Per-SKU ridge regression with recursive multi-step forecasting (mirror of the Python reference).
 *
 * Features for target day t (RIDGE_FEATURES order):
 *   lag1, lag7, lag14, roll7 = mean(z[t-7..t-1]), roll28 = mean(z[t-28..t-1]), then the 9 exogenous
 *   drivers of day t (promotion, epidemic, weather one-hot, yearly Fourier terms).
 * Features are standardised on the training rows (population sd), the intercept is not penalised,
 * and forecasts are floored at zero. Later horizon steps use earlier predictions as lags.
 */
import { N_EXOG } from "../data/types";
import { choleskySolve } from "../stats/linalg";

export const MIN_HISTORY = 28;
export const RIDGE_FEATURES = ["lag1", "lag7", "lag14", "roll7", "roll28",
  "promotion", "epidemic", "w_rainy", "w_snowy", "w_sunny", "sin1", "cos1", "sin2", "cos2"] as const;
export const N_RIDGE = RIDGE_FEATURES.length;

export interface RidgeFit {
  alpha: number;
  mean: Float64Array;
  scale: Float64Array;
  coef: Float64Array;
  intercept: number;
  nRows: number;
}

/** Write the feature row for day t into `out[offset..offset+N_RIDGE)`. `z` must cover days < t. */
export function ridgeRow(z: ArrayLike<number>, exog: Float64Array, t: number, out: Float64Array, offset = 0): void {
  let r7 = 0;
  let r28 = 0;
  for (let k = 1; k <= 28; k++) {
    r28 += z[t - k];
    if (k <= 7) r7 += z[t - k];
  }
  out[offset] = z[t - 1];
  out[offset + 1] = z[t - 7];
  out[offset + 2] = z[t - 14];
  out[offset + 3] = r7 / 7;
  out[offset + 4] = r28 / 28;
  for (let j = 0; j < N_EXOG; j++) out[offset + 5 + j] = exog[t * N_EXOG + j];
}

/** Fit on rows t = MIN_HISTORY..origin using actual demand y and exogenous matrix `exog`. */
export function fitRidge(y: ArrayLike<number>, exog: Float64Array, origin: number, alpha: number): RidgeFit {
  const nRows = origin - MIN_HISTORY + 1;
  if (nRows < N_RIDGE + 2) throw new Error(`ridge needs at least ${MIN_HISTORY + N_RIDGE + 2} days of history`);
  const p = N_RIDGE;
  const x = new Float64Array(nRows * p);
  let yMean = 0;
  for (let r = 0; r < nRows; r++) {
    ridgeRow(y, exog, MIN_HISTORY + r, x, r * p);
    yMean += y[MIN_HISTORY + r];
  }
  yMean /= nRows;

  const mu = new Float64Array(p);
  const sd = new Float64Array(p);
  for (let r = 0; r < nRows; r++) for (let j = 0; j < p; j++) mu[j] += x[r * p + j];
  for (let j = 0; j < p; j++) mu[j] /= nRows;
  for (let r = 0; r < nRows; r++) for (let j = 0; j < p; j++) sd[j] += (x[r * p + j] - mu[j]) ** 2;
  for (let j = 0; j < p; j++) {
    sd[j] = Math.sqrt(sd[j] / nRows);
    if (sd[j] < 1e-12) sd[j] = 1;
  }

  const gram = new Float64Array(p * p);
  const rhs = new Float64Array(p);
  const zRow = new Float64Array(p);
  for (let r = 0; r < nRows; r++) {
    for (let j = 0; j < p; j++) zRow[j] = (x[r * p + j] - mu[j]) / sd[j];
    const yc = y[MIN_HISTORY + r] - yMean;
    for (let i = 0; i < p; i++) {
      rhs[i] += zRow[i] * yc;
      for (let j = 0; j <= i; j++) gram[i * p + j] += zRow[i] * zRow[j];
    }
  }
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < i; j++) gram[j * p + i] = gram[i * p + j];
    gram[i * p + i] += alpha;
  }
  return { alpha, mean: mu, scale: sd, coef: choleskySolve(gram, p, rhs), intercept: yMean, nRows };
}

export function ridgePredictRow(fit: RidgeFit, row: Float64Array): number {
  let s = fit.intercept;
  for (let j = 0; j < N_RIDGE; j++) s += ((row[j] - fit.mean[j]) / fit.scale[j]) * fit.coef[j];
  return s;
}

/** Recursive forecast for days origin+1..origin+horizon. `exog` must cover those days. */
export function ridgeForecastFromFit(
  y: ArrayLike<number>, exog: Float64Array, origin: number, fit: RidgeFit, horizon: number,
): Float64Array {
  const z = new Float64Array(origin + 1 + horizon);
  for (let t = 0; t <= origin; t++) z[t] = y[t];
  const row = new Float64Array(N_RIDGE);
  const out = new Float64Array(horizon);
  for (let h = 0; h < horizon; h++) {
    const t = origin + 1 + h;
    ridgeRow(z, exog, t, row);
    out[h] = Math.max(0, ridgePredictRow(fit, row));
    z[t] = out[h];
  }
  return out;
}

export function ridgeForecast(
  y: ArrayLike<number>, exog: Float64Array, origin: number, horizon: number, alpha: number,
): Float64Array {
  return ridgeForecastFromFit(y, exog, origin, fitRidge(y, exog, origin, alpha), horizon);
}

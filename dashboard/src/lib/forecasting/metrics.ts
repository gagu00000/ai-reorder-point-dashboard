/** Point-forecast accuracy metrics (definitions identical to scripts/reference_models.py). */

export interface AccuracyMetrics {
  MAE: number;   // mean absolute error, units/day
  RMSE: number;  // root mean squared error, units/day
  WAPE: number;  // sum|e| / sum|y| — headline metric
  MAPE: number;  // mean |e|/|y| — unstable for low demand, shown for familiarity
  sMAPE: number; // mean 2|e|/(|f|+|y|)
  Bias: number;  // sum(e) / sum(y): > 0 means over-forecasting
  MASE?: number; // mean |e| / in-sample naive MAE: < 1 beats the naive forecast
}

/** `y` actuals, `f` forecasts, optional per-row MASE scale (in-sample one-step naive MAE). */
export function accuracy(y: ArrayLike<number>, f: ArrayLike<number>, maseScale?: ArrayLike<number>): AccuracyMetrics {
  const n = y.length;
  if (n === 0 || f.length !== n) throw new Error("accuracy needs equal-length, non-empty arrays");
  let abs = 0, sq = 0, ape = 0, sape = 0, err = 0, absY = 0, ySum = 0, scaled = 0;
  for (let i = 0; i < n; i++) {
    const e = f[i] - y[i];
    abs += Math.abs(e);
    sq += e * e;
    ape += Math.abs(e) / Math.abs(y[i]);
    sape += (2 * Math.abs(e)) / (Math.abs(f[i]) + Math.abs(y[i]));
    err += e;
    absY += Math.abs(y[i]);
    ySum += y[i];
    if (maseScale) scaled += Math.abs(e) / maseScale[i];
  }
  const out: AccuracyMetrics = {
    MAE: abs / n,
    RMSE: Math.sqrt(sq / n),
    WAPE: abs / absY,
    MAPE: ape / n,
    sMAPE: sape / n,
    Bias: err / ySum,
  };
  if (maseScale) out.MASE = scaled / n;
  return out;
}

/** Mean absolute one-step naive error over y[from..to) — the MASE denominator. */
export function naiveMaeScale(y: ArrayLike<number>, from = 0, to = y.length): number {
  let s = 0;
  for (let i = from + 1; i < to; i++) s += Math.abs(y[i] - y[i - 1]);
  return s / (to - from - 1);
}

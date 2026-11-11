/** Descriptive statistics on numeric arrays (no allocation beyond what is stated). */

export type Numeric = ArrayLike<number>;

export function sum(x: Numeric, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i];
  return s;
}

export function mean(x: Numeric, from = 0, to = x.length): number {
  if (to <= from) throw new Error("mean of an empty range");
  return sum(x, from, to) / (to - from);
}

/** Variance with `ddof` delta degrees of freedom (0 = population, 1 = sample). */
export function variance(x: Numeric, ddof = 1, from = 0, to = x.length): number {
  const n = to - from;
  if (n - ddof <= 0) throw new Error("not enough observations for variance");
  const m = mean(x, from, to);
  let ss = 0;
  for (let i = from; i < to; i++) ss += (x[i] - m) ** 2;
  return ss / (n - ddof);
}

export function std(x: Numeric, ddof = 1, from = 0, to = x.length): number {
  return Math.sqrt(variance(x, ddof, from, to));
}

/** Quantile with linear interpolation between order statistics (NumPy's default method). */
export function quantile(x: Numeric, p: number): number {
  if (x.length === 0) throw new Error("quantile of an empty array");
  if (p < 0 || p > 1) throw new Error(`quantile probability ${p} outside [0, 1]`);
  const sorted = Float64Array.from(x).sort();
  return quantileSorted(sorted, p);
}

/** Same as `quantile` for data already sorted ascending. */
export function quantileSorted(sorted: Numeric, p: number): number {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

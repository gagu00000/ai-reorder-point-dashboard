/**
 * Daily demand generator for simulations: demand(day k) = mean(k) + residual, floored at zero.
 *
 * - mean path: a forecast (AI policy) or a constant historical average (baseline).
 * - residuals: bootstrapped from observed errors (keeps real skew and fat tails), or Normal(0, sd).
 * Days beyond the end of the mean path reuse its last value.
 */
import type { Rng } from "../stats/prng";

export type DemandModel =
  | { kind: "bootstrap"; meanPath: ArrayLike<number>; residuals: ArrayLike<number> }
  | { kind: "normal"; meanPath: ArrayLike<number>; sd: number };

export function constantMean(value: number, length = 1): Float64Array {
  return new Float64Array(length).fill(value);
}

/** Residuals of a series around its own mean: the baseline's view of demand uncertainty. */
export function demeaned(values: ArrayLike<number>): Float64Array {
  let m = 0;
  for (let i = 0; i < values.length; i++) m += values[i];
  m /= values.length;
  return Float64Array.from(values, (v) => v - m);
}

export function demandSampler(model: DemandModel, rng: Rng): (dayIndex: number) => number {
  const path = model.meanPath;
  if (path.length === 0) throw new Error("demand model needs a mean path");
  const meanAt = (k: number) => path[Math.min(k, path.length - 1)];
  if (model.kind === "bootstrap") {
    const res = model.residuals;
    if (res.length === 0) throw new Error("bootstrap demand model needs residuals");
    return (k) => Math.max(0, meanAt(k) + res[rng.int(res.length)]);
  }
  return (k) => Math.max(0, meanAt(k) + model.sd * rng.normal());
}

/** A full synthetic demand path of `days` days (e.g. one simulated year). */
export function simulateDemandPath(model: DemandModel, days: number, rng: Rng): Float64Array {
  const sample = demandSampler(model, rng);
  return Float64Array.from({ length: days }, (_, k) => sample(k));
}

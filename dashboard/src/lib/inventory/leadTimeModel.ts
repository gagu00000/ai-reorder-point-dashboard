/**
 * Supplier lead-time distributions used by the Monte Carlo engines (all in days).
 *
 * - `gamma`:     continuous Gamma with the SKU's mean lead time L and its store's σ_L — the same
 *                two numbers the slide formula uses, so formula and simulation are comparable.
 *                Positive and right-skewed, like real supplier delays. σ_L = 0 gives a fixed L.
 * - `empirical`: the observed lead-time distribution of a store's supplier lanes (whole days).
 */
import type { LeadTimeDistribution } from "../data/types";
import type { Rng } from "../stats/prng";

export type LeadTimeModel =
  | { kind: "gamma"; mean: number; sd: number }
  | { kind: "empirical"; values: number[]; probs: number[] };

export function gammaLeadTime(mean: number, sd: number): LeadTimeModel {
  if (!(mean > 0)) throw new Error("mean lead time must be positive");
  if (!(sd >= 0)) throw new Error("lead-time sd must be non-negative");
  return { kind: "gamma", mean, sd };
}

export function empiricalLeadTime(dist: Pick<LeadTimeDistribution, "values" | "probs">): LeadTimeModel {
  if (dist.values.length === 0 || dist.values.length !== dist.probs.length) throw new Error("invalid empirical lead-time distribution");
  return { kind: "empirical", values: dist.values.slice(), probs: dist.probs.slice() };
}

/** Exact mean and standard deviation of the model (what the formula should be given). */
export function leadTimeMoments(model: LeadTimeModel): { mean: number; sd: number } {
  if (model.kind === "gamma") return { mean: model.mean, sd: model.sd };
  const total = model.probs.reduce((a, b) => a + b, 0);
  const mean = model.values.reduce((a, v, i) => a + (v * model.probs[i]) / total, 0);
  const variance = model.values.reduce((a, v, i) => a + ((v - mean) ** 2 * model.probs[i]) / total, 0);
  return { mean, sd: Math.sqrt(variance) };
}

/** Returns a function that draws one lead time (days, possibly fractional for `gamma`). */
export function leadTimeSampler(model: LeadTimeModel, rng: Rng): () => number {
  if (model.kind === "gamma") {
    if (model.sd === 0) return () => model.mean;
    const shape = (model.mean / model.sd) ** 2;
    const scale = model.sd ** 2 / model.mean;
    return () => rng.gamma(shape, scale);
  }
  const cumulative = new Float64Array(model.probs.length);
  model.probs.reduce((acc, p, i) => (cumulative[i] = acc + p), 0);
  return () => model.values[rng.discrete(cumulative)];
}

/**
 * Mean-preserving rounding to whole days for the daily inventory simulation:
 * 2.3 days becomes 2 with probability 0.7 and 3 with probability 0.3. A result of 0 means the
 * delivery lands the same day (sub-day lead time), before that day's demand — keeping E[L] exact.
 */
export function stochasticRoundDays(days: number, rng: Rng): number {
  const lo = Math.floor(days);
  return rng.uniform() < days - lo ? lo + 1 : lo;
}

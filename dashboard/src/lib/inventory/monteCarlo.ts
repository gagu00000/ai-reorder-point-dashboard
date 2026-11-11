/**
 * Monte Carlo simulation of demand during lead time (DDLT) — the risk distribution a reorder point
 * must cover. Each trial draws a lead time L, then sums daily demand over those L days (a fractional
 * final day contributes pro rata). The result is kept sorted so quantiles and tail measures are cheap
 * and the object is plain data that can cross a Web Worker boundary.
 *
 * For a random sum the variance is exactly σ_D²·E[L] + D̄²·Var(L): the expression under the slide's
 * square root. Monte Carlo reproduces that variance, and additionally reveals the *shape* (skew) that
 * the formula's Normal approximation ignores.
 */
import { quantileSorted } from "../stats/descriptive";
import { Rng } from "../stats/prng";
import { demandSampler, type DemandModel } from "./demandModel";
import { leadTimeMoments, leadTimeSampler, type LeadTimeModel } from "./leadTimeModel";

export interface DdltOptions {
  trials: number;
  seed: number;
  leadTime: LeadTimeModel;
  demand: DemandModel;
}

export interface DdltResult {
  trials: number;
  /** Demand during lead time per trial, sorted ascending (units). */
  sorted: Float64Array;
  mean: number;
  sd: number;
  skewness: number;
  /** Moments of the lead-time model and of the lead times actually drawn. */
  leadTime: { mean: number; sd: number; sampledMean: number; sampledSd: number };
}

export function simulateDdlt({ trials, seed, leadTime, demand }: DdltOptions): DdltResult {
  if (!(trials >= 100)) throw new Error("use at least 100 Monte Carlo trials");
  const rng = new Rng(seed);
  const drawLeadTime = leadTimeSampler(leadTime, rng);
  const drawDemand = demandSampler(demand, rng);
  const out = new Float64Array(trials);
  let lSum = 0;
  let lSq = 0;
  for (let i = 0; i < trials; i++) {
    const l = drawLeadTime();
    lSum += l;
    lSq += l * l;
    const whole = Math.floor(l);
    let total = 0;
    for (let k = 0; k < whole; k++) total += drawDemand(k);
    const frac = l - whole;
    if (frac > 0) total += frac * drawDemand(whole);
    out[i] = total;
  }
  out.sort();
  let m = 0;
  for (let i = 0; i < trials; i++) m += out[i];
  m /= trials;
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < trials; i++) {
    const d = out[i] - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= trials;
  m3 /= trials;
  const lMean = lSum / trials;
  const moments = leadTimeMoments(leadTime);
  return {
    trials,
    sorted: out,
    mean: m,
    sd: Math.sqrt(m2),
    skewness: m2 > 0 ? m3 / m2 ** 1.5 : 0,
    leadTime: { ...moments, sampledMean: lMean, sampledSd: Math.sqrt(Math.max(0, lSq / trials - lMean ** 2)) },
  };
}

export function ddltQuantile(r: DdltResult, p: number): number {
  return quantileSorted(r.sorted, p);
}

/** Reorder point that achieves cycle service level `p` under the simulated distribution. */
export function monteCarloReorderPoint(r: DdltResult, serviceLevel: number): number {
  return ddltQuantile(r, serviceLevel);
}

/** Safety stock = service-level quantile − mean demand during lead time. */
export function monteCarloSafetyStock(r: DdltResult, serviceLevel: number): number {
  return ddltQuantile(r, serviceLevel) - r.mean;
}

/** P(demand during lead time > reorder point): stockout probability per replenishment cycle. */
export function stockoutProbability(r: DdltResult, reorderPoint: number): number {
  return 1 - countAtMost(r.sorted, reorderPoint) / r.trials;
}

/** E[(DDLT − ROP)⁺]: expected units short per replenishment cycle. */
export function expectedShortage(r: DdltResult, reorderPoint: number): number {
  let s = 0;
  for (let i = countAtMost(r.sorted, reorderPoint); i < r.trials; i++) s += r.sorted[i] - reorderPoint;
  return s / r.trials;
}

/** Fill rate implied per cycle when ordering Q units: 1 − E[shortage] / Q. */
export function cycleFillRate(r: DdltResult, reorderPoint: number, orderQuantity: number): number {
  return Math.max(0, 1 - expectedShortage(r, reorderPoint) / orderQuantity);
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  density: number;
}

/** Equal-width histogram over the central range (0.1%–99.9%), with tails folded into the end bins. */
export function ddltHistogram(r: DdltResult, bins = 60): HistogramBin[] {
  const lo = ddltQuantile(r, 0.001);
  const hi = ddltQuantile(r, 0.999);
  const width = (hi - lo) / bins || 1;
  const counts = new Array<number>(bins).fill(0);
  for (const v of r.sorted) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)))]++;
  return counts.map((count, i) => ({
    x0: lo + i * width,
    x1: lo + (i + 1) * width,
    count,
    density: count / (r.trials * width),
  }));
}

/** Number of sorted values ≤ x (binary search). */
function countAtMost(sorted: Float64Array, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

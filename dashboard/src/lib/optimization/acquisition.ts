/**
 * Acquisition functions for constrained Bayesian optimisation (minimisation).
 *
 * Constrained Expected Improvement (Gardner et al. 2014; Gelbart et al. 2014):
 *   a(x) = EI(x) × Π_k P(c_k(x) ≤ 0)
 * where each constraint c_k has its own GP. Until a feasible point has been found, the search
 * maximises the probability of feasibility alone.
 */
import { normalCdf, normalPdf } from "../stats/normal";

/** E[max(best − f(x) − ξ, 0)] for f(x) ~ N(mean, sd²). */
export function expectedImprovement(mean: number, sd: number, best: number, xi = 0): number {
  const improvement = best - mean - xi;
  if (sd <= 1e-12) return Math.max(0, improvement);
  const z = improvement / sd;
  return improvement * normalCdf(z) + sd * normalPdf(z);
}

/** P(c(x) ≤ 0) for c(x) ~ N(mean, sd²). */
export function probabilityFeasible(mean: number, sd: number): number {
  if (sd <= 1e-12) return mean <= 0 ? 1 : 0;
  return normalCdf(-mean / sd);
}

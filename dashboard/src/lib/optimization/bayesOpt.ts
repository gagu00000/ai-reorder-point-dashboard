/**
 * Constrained Bayesian optimisation (minimise an expensive black-box objective subject to
 * black-box constraints c_k(x) ≤ 0), plus random and grid search for comparison.
 *
 * Loop: Sobol initial design → fit a GP to the objective and one GP per constraint → evaluate the
 * point maximising constrained Expected Improvement over a randomly shifted Sobol candidate set plus
 * local perturbations of the incumbent → repeat until the evaluation budget is spent.
 * The recommendation is the best *evaluated* feasible point (never an unverified model prediction).
 */
import { Rng } from "../stats/prng";
import { expectedImprovement, probabilityFeasible } from "./acquisition";
import { fitGp, gpPredict, type GpHyper, type GpModel } from "./gp";
import { Sobol } from "./sobol";

export interface Bounds {
  names: string[];
  lower: number[];
  upper: number[];
}

export interface ObjectiveValue {
  objective: number;
  /** Each must be ≤ 0 for the point to be feasible. */
  constraints: number[];
  /** Extra measurements kept for display (e.g. service level, average inventory). */
  meta?: Record<string, number>;
}

export interface Evaluation extends ObjectiveValue {
  x: number[];
  feasible: boolean;
}

export interface Iteration {
  index: number;               // 1-based evaluation number
  phase: "warm-start" | "initial" | "bayes" | "random" | "grid";
  evaluation: Evaluation;
  bestFeasible: Evaluation | null;
  acquisition: number | null;  // value of the acquisition at the chosen point
}

export interface OptimisationResult {
  bounds: Bounds;
  evaluations: Evaluation[];
  trace: Iteration[];
  best: Evaluation | null;
  objectiveGp: GpModel | null;
  constraintGps: GpModel[];
}

export interface BayesOptOptions {
  bounds: Bounds;
  evaluate: (x: number[]) => ObjectiveValue;
  /** Total number of evaluations, including the initial design. */
  budget: number;
  nInitial?: number;
  seed?: number;
  candidates?: number;
  /** Re-use evaluations from an earlier run (e.g. a different service target). */
  warmStart?: Evaluation[];
  onIteration?: (it: Iteration) => void;
}

export const toUnit = (b: Bounds, x: number[]) => x.map((v, i) => (v - b.lower[i]) / (b.upper[i] - b.lower[i]));
export const fromUnit = (b: Bounds, u: number[]) => u.map((v, i) => b.lower[i] + v * (b.upper[i] - b.lower[i]));
const isFeasible = (c: number[]) => c.every((v) => v <= 0);

function bestFeasible(evals: Evaluation[]): Evaluation | null {
  let best: Evaluation | null = null;
  for (const e of evals) if (e.feasible && (!best || e.objective < best.objective)) best = e;
  return best;
}

class Recorder {
  readonly evaluations: Evaluation[] = [];
  readonly trace: Iteration[] = [];
  constructor(private readonly evaluate: (x: number[]) => ObjectiveValue, private readonly onIteration?: (it: Iteration) => void) {}

  add(x: number[], phase: Iteration["phase"], acquisition: number | null, known?: ObjectiveValue): Evaluation {
    const v = known ?? this.evaluate(x);
    const e: Evaluation = { ...v, x, feasible: isFeasible(v.constraints) };
    this.evaluations.push(e);
    const it: Iteration = { index: this.evaluations.length, phase, evaluation: e, bestFeasible: bestFeasible(this.evaluations), acquisition };
    this.trace.push(it);
    this.onIteration?.(it);
    return e;
  }
}

export function bayesianOptimisation(o: BayesOptOptions): OptimisationResult {
  const { bounds, budget } = o;
  const d = bounds.names.length;
  const nInitial = o.nInitial ?? Math.max(4, 2 * d + 2);
  const rng = new Rng(o.seed ?? 1);
  const rec = new Recorder(o.evaluate, o.onIteration);

  for (const e of o.warmStart ?? []) rec.add(e.x, "warm-start", null, e);
  const sobol = new Sobol(d);
  while (rec.evaluations.length < Math.min(budget, nInitial)) {
    rec.add(fromUnit(bounds, sobol.next()), "initial", null);
  }

  let objectiveGp: GpModel | null = null;
  let constraintGps: GpModel[] = [];
  const hypers: (GpHyper | undefined)[] = [];
  const nCandidates = o.candidates ?? (d === 1 ? 256 : 1024);

  while (rec.evaluations.length < budget) {
    const X = rec.evaluations.map((e) => toUnit(bounds, e.x));
    objectiveGp = fitGp(X, rec.evaluations.map((e) => e.objective), hypers[0]);
    hypers[0] = objectiveGp.hyper;
    const nc = rec.evaluations[0].constraints.length;
    constraintGps = Array.from({ length: nc }, (_, k) => {
      const gp = fitGp(X, rec.evaluations.map((e) => e.constraints[k]), hypers[k + 1]);
      hypers[k + 1] = gp.hyper;
      return gp;
    });

    const incumbent = bestFeasible(rec.evaluations);
    const anchor = incumbent ?? rec.evaluations.reduce((a, b) =>
      (b.constraints.reduce((s, c) => s + Math.max(0, c), 0) < a.constraints.reduce((s, c) => s + Math.max(0, c), 0) ? b : a));
    const candidates = candidateSet(d, nCandidates, rng, toUnit(bounds, anchor.x));

    let bestScore = -Infinity;
    let chosen: number[] | null = null;
    for (const u of candidates) {
      if (X.some((xi) => xi.every((v, j) => Math.abs(v - u[j]) < 1e-4))) continue;
      let pf = 1;
      for (const gp of constraintGps) {
        const p = gpPredict(gp, u);
        pf *= probabilityFeasible(p.mean, Math.sqrt(p.variance));
      }
      let score = pf;
      if (incumbent) {
        const p = gpPredict(objectiveGp, u);
        score = expectedImprovement(p.mean, Math.sqrt(p.variance), incumbent.objective) * pf;
      }
      if (score > bestScore) { bestScore = score; chosen = u; }
    }
    if (!chosen) break;
    rec.add(fromUnit(bounds, chosen), "bayes", bestScore);
  }

  return {
    bounds,
    evaluations: rec.evaluations,
    trace: rec.trace,
    best: bestFeasible(rec.evaluations),
    objectiveGp,
    constraintGps,
  };
}

/** Randomly shifted Sobol points plus Gaussian perturbations around the anchor (unit cube). */
function candidateSet(d: number, n: number, rng: Rng, anchor: number[]): number[][] {
  const shift = Array.from({ length: d }, () => rng.uniform());
  const sobol = new Sobol(d);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(sobol.next().map((v, j) => (v + shift[j]) % 1));
  const local = Math.max(32, Math.floor(n / 8));
  for (let i = 0; i < local; i++) {
    const scale = i % 2 === 0 ? 0.03 : 0.1;
    out.push(anchor.map((v) => Math.min(1, Math.max(0, v + scale * rng.normal()))));
  }
  return out;
}

/** Uniform random search with the same evaluation budget (comparison for the convergence chart). */
export function randomSearch(o: { bounds: Bounds; evaluate: (x: number[]) => ObjectiveValue; budget: number; seed?: number }): OptimisationResult {
  const rng = new Rng(o.seed ?? 2);
  const rec = new Recorder(o.evaluate);
  for (let i = 0; i < o.budget; i++) {
    rec.add(fromUnit(o.bounds, o.bounds.names.map(() => rng.uniform())), "random", null);
  }
  return { bounds: o.bounds, evaluations: rec.evaluations, trace: rec.trace, best: bestFeasible(rec.evaluations), objectiveGp: null, constraintGps: [] };
}

/** Exhaustive grid search ("manual parameter sweep"): `steps[i]` points per dimension. */
export function gridSearch(o: { bounds: Bounds; evaluate: (x: number[]) => ObjectiveValue; steps: number[] }): OptimisationResult {
  const rec = new Recorder(o.evaluate);
  const d = o.bounds.names.length;
  const idx = new Array(d).fill(0);
  const total = o.steps.reduce((a, b) => a * b, 1);
  for (let n = 0; n < total; n++) {
    const u = idx.map((k, j) => (o.steps[j] === 1 ? 0.5 : k / (o.steps[j] - 1)));
    rec.add(fromUnit(o.bounds, u), "grid", null);
    for (let j = 0; j < d; j++) {
      if (++idx[j] < o.steps[j]) break;
      idx[j] = 0;
    }
  }
  return { bounds: o.bounds, evaluations: rec.evaluations, trace: rec.trace, best: bestFeasible(rec.evaluations), objectiveGp: null, constraintGps: [] };
}

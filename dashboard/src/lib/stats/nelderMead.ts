/** Unconstrained Nelder–Mead minimiser (constraints are handled by reparameterisation). */

export interface NelderMeadOptions {
  maxIterations?: number;
  /** Stop when the spread of function values across the simplex falls below this. */
  fTolerance?: number;
  /** Stop when every vertex lies within this distance of the best vertex (per coordinate). */
  xTolerance?: number;
  /** Initial simplex step per coordinate. */
  step?: number;
}

export interface NelderMeadResult {
  x: number[];
  fx: number;
  iterations: number;
}

export function nelderMead(
  f: (x: number[]) => number, start: number[], options: NelderMeadOptions = {},
): NelderMeadResult {
  const { maxIterations = 500, fTolerance = 1e-10, xTolerance = 1e-8, step = 0.5 } = options;
  const n = start.length;
  let simplex = [start.slice()];
  for (let i = 0; i < n; i++) {
    const v = start.slice();
    v[i] += step;
    simplex.push(v);
  }
  let values = simplex.map(f);

  const combine = (a: number[], b: number[], t: number) => a.map((ai, i) => ai + t * (b[i] - ai));

  let iter = 0;
  for (; iter < maxIterations; iter++) {
    const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);

    const best = simplex[0];
    const worst = simplex[n];
    const spreadF = Math.abs(values[n] - values[0]);
    const spreadX = Math.max(...simplex.slice(1).map((v) => Math.max(...v.map((vi, i) => Math.abs(vi - best[i])))));
    if (spreadF <= fTolerance * (Math.abs(values[0]) + 1e-12) && spreadX <= xTolerance) break;

    const centroid = new Array(n).fill(0);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) centroid[i] += simplex[k][i] / n;

    const reflected = combine(centroid, worst, -1);
    const fr = f(reflected);
    if (fr < values[0]) {
      const expanded = combine(centroid, worst, -2);
      const fe = f(expanded);
      if (fe < fr) { simplex[n] = expanded; values[n] = fe; } else { simplex[n] = reflected; values[n] = fr; }
      continue;
    }
    if (fr < values[n - 1]) { simplex[n] = reflected; values[n] = fr; continue; }

    const outside = fr < values[n];
    const contracted = outside ? combine(centroid, reflected, 0.5) : combine(centroid, worst, 0.5);
    const fc = f(contracted);
    if (fc < (outside ? fr : values[n])) { simplex[n] = contracted; values[n] = fc; continue; }

    for (let k = 1; k <= n; k++) {
      simplex[k] = combine(best, simplex[k], 0.5);
      values[k] = f(simplex[k]);
    }
  }
  const bestIdx = values.indexOf(Math.min(...values));
  return { x: simplex[bestIdx], fx: values[bestIdx], iterations: iter };
}

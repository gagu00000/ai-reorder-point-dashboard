/** Weighted ensemble of model forecasts; weights default to inverse WAPE (normalised to 1). */

export function inverseErrorWeights(errors: Record<string, number>): Record<string, number> {
  const inv = Object.fromEntries(Object.entries(errors).map(([k, e]) => [k, 1 / e]));
  const total = Object.values(inv).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, v / total]));
}

export function combineForecasts(forecasts: Record<string, ArrayLike<number>>, weights: Record<string, number>): Float64Array {
  const names = Object.keys(weights);
  if (names.length === 0) throw new Error("ensemble needs at least one member");
  const horizon = forecasts[names[0]].length;
  const out = new Float64Array(horizon);
  for (const name of names) {
    const f = forecasts[name];
    if (!f) throw new Error(`missing forecast for ensemble member ${name}`);
    for (let h = 0; h < horizon; h++) out[h] += weights[name] * f[h];
  }
  return out;
}

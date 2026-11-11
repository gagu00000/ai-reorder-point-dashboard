/**
 * Benchmark forecasts. `y` holds demand for days 0..origin (inclusive); each returns `horizon` values.
 * The static mean is the demand input of the *baseline* reorder-point calculator.
 */
import { mean } from "../stats/descriptive";

export function staticMeanForecast(y: ArrayLike<number>, origin: number, horizon: number): Float64Array {
  return new Float64Array(horizon).fill(mean(y, 0, origin + 1));
}

export function naiveForecast(y: ArrayLike<number>, origin: number, horizon: number): Float64Array {
  return new Float64Array(horizon).fill(y[origin]);
}

export function movingAverageForecast(y: ArrayLike<number>, origin: number, horizon: number, window = 28): Float64Array {
  if (origin + 1 < window) throw new Error(`moving average needs ${window} days of history`);
  return new Float64Array(horizon).fill(mean(y, origin + 1 - window, origin + 1));
}

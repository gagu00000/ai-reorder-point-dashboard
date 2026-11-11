/**
 * Conformal-style prediction intervals: the band at horizon h is the point forecast plus the
 * empirical quantiles of past errors (y − f) observed at that horizon. As new data arrives the
 * residual pools grow, so the bands adapt to the latest forecast performance.
 */
import { quantileSorted } from "../stats/descriptive";

export interface IntervalOffsets {
  q025: number[];
  q100: number[];
  q900: number[];
  q975: number[];
}

export interface ForecastBands {
  lower95: Float64Array;
  lower80: Float64Array;
  upper80: Float64Array;
  upper95: Float64Array;
}

/** `residualsByHorizon[h-1]` holds the (y − f) errors seen at horizon h. */
export function offsetsFromResiduals(residualsByHorizon: ArrayLike<number>[]): IntervalOffsets {
  const out: IntervalOffsets = { q025: [], q100: [], q900: [], q975: [] };
  for (const r of residualsByHorizon) {
    if (r.length === 0) throw new Error("no residuals for a horizon");
    const sorted = Float64Array.from(r).sort();
    out.q025.push(quantileSorted(sorted, 0.025));
    out.q100.push(quantileSorted(sorted, 0.1));
    out.q900.push(quantileSorted(sorted, 0.9));
    out.q975.push(quantileSorted(sorted, 0.975));
  }
  return out;
}

/** Apply offsets to a forecast; lower bounds are floored at zero demand. */
export function applyIntervals(forecast: ArrayLike<number>, offsets: IntervalOffsets): ForecastBands {
  const n = forecast.length;
  const band = (q: number[], floor: boolean) =>
    Float64Array.from({ length: n }, (_, h) => (floor ? Math.max(0, forecast[h] + q[h]) : forecast[h] + q[h]));
  return {
    lower95: band(offsets.q025, true),
    lower80: band(offsets.q100, true),
    upper80: band(offsets.q900, false),
    upper95: band(offsets.q975, false),
  };
}

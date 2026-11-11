import { addDays, fourierTerms } from "./calendar";
import { N_EXOG, WEATHER_CODES, type Dataset, type WeatherCode } from "./types";

/**
 * Assumptions for days after the forecast origin. Anything not given falls back to:
 * - promotion: recorded value if the day exists in the data, otherwise 0 (no promotion planned)
 * - weather:   recorded value if the day exists, otherwise the weather on the origin day
 * - epidemic:  the state on the origin day (persistence) — never the recorded future value
 */
export interface FutureScenario {
  promotion?: ArrayLike<number>;   // indexed by horizon step 0..H-1
  weather?: ArrayLike<WeatherCode>;
  epidemic?: ArrayLike<number>;
}

const RAINY = WEATHER_CODES.indexOf("Rainy");
const SNOWY = WEATHER_CODES.indexOf("Snowy");
const SUNNY = WEATHER_CODES.indexOf("Sunny");

/** Fill one exogenous row (EXOG_FEATURES order) into `out` at `offset`. */
export function writeExogRow(
  out: Float64Array, offset: number, promotion: number, epidemic: number, weatherCode: number, isoDate: string,
): void {
  const [s1, c1, s2, c2] = fourierTerms(isoDate);
  out[offset] = promotion;
  out[offset + 1] = epidemic;
  out[offset + 2] = weatherCode === RAINY ? 1 : 0;
  out[offset + 3] = weatherCode === SNOWY ? 1 : 0;
  out[offset + 4] = weatherCode === SUNNY ? 1 : 0;
  out[offset + 5] = s1;
  out[offset + 6] = c1;
  out[offset + 7] = s2;
  out[offset + 8] = c2;
}

/**
 * Exogenous matrix for one SKU covering days 0..origin+horizon (row-major, N_EXOG columns).
 * Rows after `origin` follow the forecast-time information rules above, so no model ever
 * sees the realised epidemic status of a future day.
 */
export function buildExog(
  dataset: Dataset, skuIndex: number, origin: number, horizon: number, scenario: FutureScenario = {},
): Float64Array {
  const sku = dataset.skus[skuIndex];
  const weather = dataset.stores[sku.storeIndex].weather;
  const nObserved = dataset.dates.length;
  if (origin >= nObserved) throw new Error(`origin ${origin} is beyond the observed data (${nObserved} days)`);
  const total = origin + horizon + 1;
  const out = new Float64Array(total * N_EXOG);
  for (let t = 0; t < total; t++) {
    const step = t - origin - 1; // horizon step for future rows
    const future = t > origin;
    const exists = t < nObserved;
    const iso = exists ? dataset.dates[t] : addDays(dataset.dates[nObserved - 1], t - nObserved + 1);
    const promotion = future && scenario.promotion ? scenario.promotion[step] : exists ? sku.promotion[t] : 0;
    const epidemic = future
      ? scenario.epidemic ? scenario.epidemic[step] : dataset.epidemic[origin]
      : dataset.epidemic[t];
    const weatherCode = future && scenario.weather
      ? WEATHER_CODES.indexOf(scenario.weather[step])
      : exists ? weather[t] : weather[origin];
    writeExogRow(out, t * N_EXOG, promotion, epidemic, weatherCode, iso);
  }
  return out;
}

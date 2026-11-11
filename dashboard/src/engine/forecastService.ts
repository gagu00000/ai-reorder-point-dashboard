/**
 * Step 1 service: 14-day forecasts from every model for one SKU, with conformal-style bands,
 * the ridge model's driver effects, and the leaderboards from the offline backtests.
 */
import { buildExog } from "../lib/data/features";
import { N_EXOG } from "../lib/data/types";
import { staticMeanForecast } from "../lib/forecasting/baselines";
import { combineForecasts } from "../lib/forecasting/ensemble";
import { fitEts, etsForecastFromState } from "../lib/forecasting/ets";
import { applyIntervals } from "../lib/forecasting/intervals";
import { lstmInput, type LstmInput, type LstmSpec } from "../lib/forecasting/lstm";
import { fitRidge, ridgeForecastFromFit, RIDGE_FEATURES } from "../lib/forecasting/ridge";
import type { AppData } from "./appData";
import { HORIZON, recentForecastErrors, ridgeForecaster, skuContext } from "./planning";

export type ModelKey = "baseline" | "ets" | "ridge" | "lstm" | "ensemble";
export const MODEL_KEYS: ModelKey[] = ["ridge", "lstm", "ensemble", "ets", "baseline"];
/** Names used in model_config.json (leaderboards, interval offsets, ensemble weights). */
export const MODEL_CONFIG_NAME: Record<ModelKey, string> = {
  baseline: "Static mean (baseline)", ets: "ETS", ridge: "Ridge", lstm: "LSTM", ensemble: "Ensemble",
};

export interface LstmRunner {
  spec: LstmSpec;
  forecast(inputs: LstmInput[], scales: number[]): Promise<Float64Array[]>;
}

export interface ForecastRequest {
  skuId: string;
  /** Last observed day index; forecasts start the day after. */
  origin: number;
  historyDays: number;
}

export interface Band { lower80: number[]; upper80: number[]; lower95: number[]; upper95: number[] }

export interface DriverEffect {
  feature: "promotion" | "epidemic" | "w_rainy" | "w_snowy" | "w_sunny";
  label: string;
  /** Change in daily demand when the driver switches on (units/day), holding everything else fixed. */
  unitsPerDay: number;
  /** Same, relative to the SKU's average daily demand. */
  relative: number;
}

export interface ForecastResponse {
  skuId: string;
  origin: number;
  historyStart: number;
  dates: string[];               // history + horizon
  actual: (number | null)[];     // observed demand (null in the future)
  futureActual: (number | null)[]; // recorded demand for future days, if the dataset has them (backtest view)
  epidemic: number[];            // recorded for history, assumed (persistence) for the future
  promotion: number[];
  forecasts: Partial<Record<ModelKey, number[]>>;
  bands: Partial<Record<ModelKey, Band>>;
  drivers: DriverEffect[];
  /** Multiplier applied to the validation-calibrated band widths for this SKU (recent errors ÷ validation errors). */
  bandScale: number;
  etsKind: string;
  averageDemand: number;
  lstmAvailable: boolean;
}

const DRIVER_LABELS: Record<DriverEffect["feature"], string> = {
  promotion: "Promotion running",
  epidemic: "Epidemic period",
  w_rainy: "Rainy day (vs cloudy)",
  w_snowy: "Snowy day (vs cloudy)",
  w_sunny: "Sunny day (vs cloudy)",
};

export async function forecastSku(data: AppData, req: ForecastRequest, lstm: LstmRunner | null): Promise<ForecastResponse> {
  const { dataset, config } = data;
  const ctx = skuContext(data, req.skuId);
  const { origin } = req;
  const y = ctx.sku.demand;
  const exog = buildExog(dataset, ctx.index, origin, HORIZON);

  const ridgeFit = fitRidge(y, exog, origin, config.ridge.alpha);
  const ets = fitEts(y, origin);
  const forecasts: Partial<Record<ModelKey, Float64Array>> = {
    baseline: staticMeanForecast(y, origin, HORIZON),
    ets: etsForecastFromState(ets.level, ets.trend, ets.phi, HORIZON),
    ridge: ridgeForecastFromFit(y, exog, origin, ridgeFit, HORIZON),
  };
  let lstmAvailable = false;
  if (lstm) {
    const scale = config.lstm.scales[req.skuId];
    const [f] = await lstm.forecast([lstmInput(y, exog, origin, scale, lstm.spec)], [scale]);
    forecasts.lstm = f;
    lstmAvailable = true;
  }
  const members = config.ensemble.members.filter((m) => m !== "LSTM" || lstmAvailable);
  const total = members.reduce((a, m) => a + config.ensemble.weights[m], 0);
  const weights = Object.fromEntries(members.map((m) => [m, config.ensemble.weights[m] / total]));
  const byConfigName: Record<string, Float64Array> = { ETS: forecasts.ets!, Ridge: forecasts.ridge!, LSTM: forecasts.lstm ?? new Float64Array(HORIZON) };
  forecasts.ensemble = combineForecasts(byConfigName, weights);

  // Bands: validation-calibrated interval offsets, rescaled to this SKU's recent forecast errors so
  // they widen after a shock (e.g. an epidemic) and narrow again as the model catches up.
  const bandScale = localBandScale(data, ctx, origin);
  const bands: Partial<Record<ModelKey, Band>> = {};
  for (const [key, f] of Object.entries(forecasts) as [ModelKey, Float64Array][]) {
    const offsets = config.intervals.byModel[MODEL_CONFIG_NAME[key]];
    if (!offsets) continue;
    const scaled = {
      q025: offsets.q025.map((v) => v * bandScale), q100: offsets.q100.map((v) => v * bandScale),
      q900: offsets.q900.map((v) => v * bandScale), q975: offsets.q975.map((v) => v * bandScale),
    };
    const b = applyIntervals(f, scaled);
    bands[key] = { lower80: [...b.lower80], upper80: [...b.upper80], lower95: [...b.lower95], upper95: [...b.upper95] };
  }

  // Driver effects: a one-unit change in a 0/1 driver moves the prediction by coef / scale.
  let avg = 0;
  for (let t = 0; t <= origin; t++) avg += y[t];
  avg /= origin + 1;
  const drivers = (["promotion", "epidemic", "w_sunny", "w_rainy", "w_snowy"] as const).map((feature) => {
    const j = RIDGE_FEATURES.indexOf(feature);
    const units = ridgeFit.coef[j] / ridgeFit.scale[j];
    return { feature, label: DRIVER_LABELS[feature], unitsPerDay: units, relative: units / avg };
  });

  const historyStart = Math.max(0, origin - req.historyDays + 1);
  const nObserved = dataset.dates.length;
  const dates: string[] = [];
  const actual: (number | null)[] = [];
  const futureActual: (number | null)[] = [];
  const epidemic: number[] = [];
  const promotion: number[] = [];
  for (let t = historyStart; t <= origin + HORIZON; t++) {
    const future = t > origin;
    dates.push(t < nObserved ? dataset.dates[t] : addIsoDays(dataset.dates[nObserved - 1], t - nObserved + 1));
    actual.push(future ? null : y[t]);
    futureActual.push(future && t < nObserved ? y[t] : null);
    epidemic.push(exog[t * N_EXOG + 1]);
    promotion.push(exog[t * N_EXOG]);
  }

  const plain = (f: Float64Array) => Array.from(f, (v) => Math.round(v * 100) / 100);
  return {
    skuId: req.skuId, origin, historyStart, dates, actual, futureActual, epidemic, promotion,
    forecasts: Object.fromEntries(Object.entries(forecasts).map(([k, v]) => [k, plain(v)])),
    bands, bandScale, drivers, etsKind: ets.kind, averageDemand: avg, lstmAvailable,
  };
}

/**
 * Ratio of this SKU's recent ridge forecast-error sd (last 90 days, horizons 1–7) to the pooled
 * validation error sd implied by the stored interval offsets; clamped to [0.5, 2.5].
 */
export function localBandScale(data: AppData, ctx: ReturnType<typeof skuContext>, origin: number): number {
  const offsets = data.config.intervals.byModel.Ridge;
  if (!offsets) return 1;
  let pooled = 0;
  for (let h = 0; h < 7; h++) pooled += (offsets.q975[h] - offsets.q025[h]) / (2 * 1.959964);
  pooled /= 7;
  const errors = recentForecastErrors(ctx, origin, ridgeForecaster(data, ctx));
  if (errors.length < 30 || pooled <= 0) return 1;
  let m = 0;
  for (const e of errors) m += e;
  m /= errors.length;
  let v = 0;
  for (const e of errors) v += (e - m) ** 2;
  const sd = Math.sqrt(v / (errors.length - 1));
  return Math.min(2.5, Math.max(0.5, sd / pooled));
}

export interface ModelScore { absError: number; actual: number }

export interface DayScore {
  day: number;
  date: string;
  skus: number;
  /** Sum over products of |forecast − actual| and of actual, for the 1-day-ahead forecast. */
  models: Partial<Record<ModelKey, ModelScore>>;
}

/**
 * Genuine out-of-sample check when day `day` arrives: every model forecasts it from data up to the
 * previous day (before learning from it), for all products, and the errors are summed.
 */
export async function scoreDay(data: AppData, day: number, lstm: LstmRunner | null): Promise<DayScore> {
  const { dataset, config } = data;
  const origin = day - 1;
  const models: Partial<Record<ModelKey, ModelScore>> = {};
  const add = (k: ModelKey, f: number, y: number) => {
    const s = (models[k] ??= { absError: 0, actual: 0 });
    s.absError += Math.abs(f - y);
    s.actual += y;
  };
  const lstmInputs: LstmInput[] = [];
  const scales: number[] = [];
  const point: { ets: number; ridge: number; y: number }[] = [];
  dataset.skus.forEach((sku, i) => {
    const y = sku.demand;
    const exog = buildExog(dataset, i, origin, HORIZON);
    const actual = y[day];
    const ridge = ridgeForecastFromFit(y, exog, origin, fitRidge(y, exog, origin, config.ridge.alpha), 1)[0];
    const ets = fitEts(y, origin);
    const etsF = etsForecastFromState(ets.level, ets.trend, ets.phi, 1)[0];
    add("baseline", staticMeanForecast(y, origin, 1)[0], actual);
    add("ets", etsF, actual);
    add("ridge", ridge, actual);
    point.push({ ets: etsF, ridge, y: actual });
    if (lstm) {
      lstmInputs.push(lstmInput(y, exog, origin, config.lstm.scales[sku.id], lstm.spec));
      scales.push(config.lstm.scales[sku.id]);
    }
  });
  const lstmF = lstm ? await lstm.forecast(lstmInputs, scales) : null;
  const members = config.ensemble.members.filter((m) => m !== "LSTM" || lstmF);
  const total = members.reduce((a, m) => a + config.ensemble.weights[m], 0);
  point.forEach((p, i) => {
    let ens = (config.ensemble.weights.ETS * p.ets + config.ensemble.weights.Ridge * p.ridge) / total;
    if (lstmF) {
      add("lstm", lstmF[i][0], p.y);
      ens += (config.ensemble.weights.LSTM * lstmF[i][0]) / total;
    }
    add("ensemble", ens, p.y);
  });
  return { day, date: dataset.dates[day], skus: dataset.skus.length, models };
}

function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

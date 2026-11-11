/**
 * Rolling-origin backtesting: refit at each origin, forecast `horizon` days, score against actuals.
 * Same protocol as the Python reference (origins every 7 days, full horizon observed).
 */
import type { Dataset } from "../data/types";
import { accuracy, naiveMaeScale, type AccuracyMetrics } from "./metrics";

/** Forecasts for every SKU from one origin: result[skuIndex] has `horizon` values. */
export type BatchForecaster = (dataset: Dataset, origin: number, horizon: number) => Float64Array[] | Promise<Float64Array[]>;

export interface BacktestRow {
  model: string;
  skuIndex: number;
  origin: number;
  h: number;      // 1-based horizon step
  y: number;
  f: number;
  maseScale: number;
}

export function rollingOrigins(start: number, lastTarget: number, horizon: number, step = 7): number[] {
  const out: number[] = [];
  for (let o = start; o <= lastTarget - horizon; o += step) out.push(o);
  return out;
}

/** In-sample naive MAE per SKU over the training period (MASE denominator). */
export function maseScales(dataset: Dataset): number[] {
  return dataset.skus.map((s) => naiveMaeScale(s.demand, 0, dataset.split.trainEndIdx + 1));
}

export async function runBacktest(
  dataset: Dataset, origins: number[], horizon: number, forecasters: Record<string, BatchForecaster>,
): Promise<BacktestRow[]> {
  const scales = maseScales(dataset);
  const rows: BacktestRow[] = [];
  for (const [model, forecaster] of Object.entries(forecasters)) {
    for (const origin of origins) {
      const forecasts = await forecaster(dataset, origin, horizon);
      forecasts.forEach((f, skuIndex) => {
        const y = dataset.skus[skuIndex].demand;
        for (let h = 1; h <= horizon; h++) {
          rows.push({ model, skuIndex, origin, h, y: y[origin + h], f: f[h - 1], maseScale: scales[skuIndex] });
        }
      });
    }
  }
  return rows;
}

/** Pooled accuracy per model over rows with horizon ≤ maxH (or exactly h = 1 when `exactH1`). */
export function leaderboard(rows: BacktestRow[], maxH: number, exactH1 = false): Record<string, AccuracyMetrics> {
  const groups = new Map<string, BacktestRow[]>();
  for (const r of rows) {
    if (exactH1 ? r.h !== 1 : r.h > maxH) continue;
    const list = groups.get(r.model) ?? [];
    list.push(r);
    groups.set(r.model, list);
  }
  const out: Record<string, AccuracyMetrics> = {};
  for (const [model, list] of groups) {
    out[model] = accuracy(list.map((r) => r.y), list.map((r) => r.f), list.map((r) => r.maseScale));
  }
  return out;
}

/** Errors (y − f) grouped by horizon step, for interval calibration. */
export function residualsByHorizon(rows: BacktestRow[], model: string, horizon: number): number[][] {
  const out: number[][] = Array.from({ length: horizon }, () => []);
  for (const r of rows) if (r.model === model) out[r.h - 1].push(r.y - r.f);
  return out;
}

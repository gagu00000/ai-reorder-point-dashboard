/**
 * Everything the analysis engine needs, loaded once per worker from the static JSON files.
 * Raw prices never reach this layer: only each SKU's median price, via costs.json.
 */
import { buildDataset } from "../lib/data/dataset";
import { applyUserRows, type UserRow } from "../lib/data/userData";
import type { CostsFile, Dataset, LeadTimesFile, LstmWeightsFile, ModelConfig, SeriesFile } from "../lib/data/types";

export interface AppData {
  dataset: Dataset;
  meta: SeriesFile["meta"];
  leadTimes: LeadTimesFile;
  costs: CostsFile;
  config: ModelConfig;
}

export type JsonFetcher = <T>(path: string) => Promise<T>;

export async function loadAppData(fetchJson: JsonFetcher): Promise<AppData> {
  const [series, leadTimes, costs, config] = await Promise.all([
    fetchJson<SeriesFile>("series.json"),
    fetchJson<LeadTimesFile>("leadtimes.json"),
    fetchJson<CostsFile>("costs.json"),
    fetchJson<ModelConfig>("model_config.json"),
  ]);
  return { dataset: buildDataset(series), meta: series.meta, leadTimes, costs, config };
}

/** The recorded data with the user's added rows applied (identity when there are none). */
export function withUserRows(base: AppData, rows: UserRow[]): AppData {
  return rows.length ? { ...base, dataset: applyUserRows(base.dataset, rows) } : base;
}

/**
 * Per-worker holder of the current data: the recorded files loaded once, plus the user's rows.
 * `setRows` is cheap to call repeatedly with the same rows.
 */
export function createDataHolder(fetchJson: JsonFetcher) {
  let base: Promise<AppData> | null = null;
  let current: AppData | null = null;
  let signature = "";
  const load = () => (base ??= loadAppData(fetchJson));
  return {
    async get(): Promise<AppData> {
      return current ?? (await load());
    },
    async base(): Promise<AppData> {
      return load();
    },
    async setRows(rows: UserRow[]): Promise<void> {
      const sig = rowsSignature(rows);
      if (sig === signature && current) return;
      current = withUserRows(await load(), rows);
      signature = sig;
    },
  };
}

/** Cheap identity for a list of rows that only ever grows (or is cleared). */
export function rowsSignature(rows: UserRow[]): string {
  const last = rows[rows.length - 1];
  return `${rows.length}|${last ? `${last.date}|${last.skuId}|${last.demand}` : ""}`;
}

export async function loadLstmWeights(fetchJson: JsonFetcher, config: ModelConfig): Promise<LstmWeightsFile> {
  return fetchJson<LstmWeightsFile>(config.lstm.weightsFile);
}

/** Light-weight description of the data for the UI thread (no demand arrays). */
export interface Catalog {
  skus: { id: string; store: string; product: string; category: string; region: string; meanDemand: number }[];
  dates: string[];
  epidemic: number[];
  meta: SeriesFile["meta"];
  leadTimes: Pick<LeadTimesFile, "method" | "assumption" | "totalOrders" | "matchedOrders" | "overall" | "stores">;
  costDefaults: CostsFile["defaults"];
  models: {
    backtest: ModelConfig["backtest"];
    ensemble: ModelConfig["ensemble"];
    ridgeAlpha: number;
    lstm: Omit<ModelConfig["lstm"], "scales">;
  };
}

export function catalogFrom(data: AppData): Catalog {
  const region = new Map(data.dataset.stores.map((s) => [s.id, s.region]));
  return {
    skus: data.dataset.skus.map((s) => {
      let m = 0;
      const n = data.dataset.split.valEndIdx + 1;
      for (let t = 0; t < n; t++) m += s.demand[t];
      return { id: s.id, store: s.store, product: s.product, category: s.category, region: region.get(s.store) ?? "", meanDemand: m / n };
    }),
    dates: data.dataset.dates,
    epidemic: Array.from(data.dataset.epidemic),
    meta: data.meta,
    leadTimes: {
      method: data.leadTimes.method, assumption: data.leadTimes.assumption, totalOrders: data.leadTimes.totalOrders,
      matchedOrders: data.leadTimes.matchedOrders, overall: data.leadTimes.overall, stores: data.leadTimes.stores,
    },
    costDefaults: data.costs.defaults,
    models: {
      backtest: data.config.backtest,
      ensemble: data.config.ensemble,
      ridgeAlpha: data.config.ridge.alpha,
      lstm: (({ scales: _scales, ...rest }) => rest)(data.config.lstm),
    },
  };
}

/** Browser fetcher for files under /data (respects Vite's base URL). */
export const browserFetcher: JsonFetcher = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
};

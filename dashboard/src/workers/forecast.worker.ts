/// <reference lib="webworker" />
/**
 * Forecast worker: data catalogue, Step 1 forecasts, out-of-sample scoring of each arriving day,
 * and LSTM fine-tuning on newly observed data (TensorFlow.js, loaded lazily; WebGL through
 * OffscreenCanvas where available, CPU otherwise). Fine-tuned weights persist in IndexedDB.
 */
import * as Comlink from "comlink";
import type * as TF from "@tensorflow/tfjs";
import { del, get, set } from "idb-keyval";
import { browserFetcher, catalogFrom, createDataHolder, loadLstmWeights, rowsSignature } from "../engine/appData";
import { forecastSku, scoreDay, type ForecastRequest, type LstmRunner } from "../engine/forecastService";
import { parseCsv } from "../lib/data/csvImport";
import { buildExog } from "../lib/data/features";
import { WEATHER_CODES } from "../lib/data/types";
import { dayIndex, validateUserRows, type UserRow } from "../lib/data/userData";
import { fineTuneLstm, fineTuneSample, loadLstm, lstmForecast, specFromWeights, type FineTuneSample, type LstmSpec } from "../lib/forecasting/lstm";

const MODEL_URL = "indexeddb://rop-lstm-v1";
const META_KEY = "rop-lstm-meta-v1";
/** Fine-tuning uses windows whose 14-day targets ended in the last 21 observed days. */
const REPLAY_DAYS = 21;

const holder = createDataHolder(browserFetcher);
let rows: UserRow[] = [];

interface LstmState {
  tf: typeof TF;
  model: TF.LayersModel;
  spec: LstmSpec;
  backend: string;
  version: number;
  /** Last day whose data the network has learnt from (the planning start counts as learnt). */
  knownThrough: number;
}

let lstmPromise: Promise<LstmState | null> | null = null;

// Model operations (predict / fit / load) run one at a time.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn);
  chain = p.catch(() => undefined);
  return p;
}

async function freshModel(tf: typeof TF) {
  const d = await holder.base();
  const weights = await loadLstmWeights(browserFetcher, d.config);
  return { model: loadLstm(tf, weights), spec: specFromWeights(weights) };
}

function lstm(): Promise<LstmState | null> {
  lstmPromise ??= (async () => {
    try {
      // TensorFlow.js yields between training batches with requestAnimationFrame when it exists.
      // Browsers pause animation frames for hidden pages, so a fine-tune started before the user
      // switched tabs would freeze (and block day scoring, which waits for the model). A worker draws
      // nothing, so hide rAF before TF.js loads and it falls back to plain task scheduling.
      Object.defineProperty(self, "requestAnimationFrame", { value: undefined, configurable: true, writable: true });
      const tf = await import("@tensorflow/tfjs");
      const canWebgl = typeof OffscreenCanvas !== "undefined";
      if (!canWebgl || !(await tf.setBackend("webgl").catch(() => false))) await tf.setBackend("cpu");
      await tf.ready();
      const { model, spec } = await freshModel(tf);
      const d = await holder.base();
      return { tf, model, spec, backend: tf.getBackend(), version: 0, knownThrough: d.dataset.split.valEndIdx };
    } catch {
      return null;
    }
  })();
  return lstmPromise;
}

function runner(s: LstmState): LstmRunner {
  return { spec: s.spec, forecast: (inputs, scales) => exclusive(async () => lstmForecast(s.tf, s.model, inputs, scales, s.spec)) };
}

/** Identifies the deployed dataset and trained models: saved state from another version is ignored. */
async function dataStamp(): Promise<string> {
  const b = await holder.base();
  return `${b.meta.generatedAt}|${b.config.generatedAt}`;
}

/** Signature of the user rows the network has seen (rows up to and including `day`). */
async function rowsSeenSignature(day: number) {
  const d = await holder.base();
  return rowsSignature(rows.filter((r) => dayIndex(d.dataset, r.date) <= day));
}

export interface LstmStatus {
  available: boolean;
  backend: string;
  version: number;
  knownThrough: number | null;
}

async function status(): Promise<LstmStatus> {
  const s = await lstm();
  return s ? { available: true, backend: s.backend, version: s.version, knownThrough: s.knownThrough } : { available: false, backend: "unavailable", version: 0, knownThrough: null };
}

export interface FineTuneReport {
  version: number;
  knownThrough: number;
  samples: number;
  loss: number[];
}

const api = {
  async setTimeline(newRows: UserRow[]) {
    rows = newRows;
    await holder.setRows(newRows);
  },
  async catalog() {
    return catalogFrom(await holder.get());
  },
  async forecast(req: ForecastRequest) {
    const [d, s] = await Promise.all([holder.get(), lstm()]);
    return forecastSku(d, req, s ? runner(s) : null);
  },
  /** Score every model on `day` using data up to the previous day (call before learning from it). */
  async scoreDay(day: number) {
    const [d, s] = await Promise.all([holder.get(), lstm()]);
    return scoreDay(d, day, s ? runner(s) : null);
  },
  async lstmStatus() {
    return status();
  },
  /** Last day index of the current data, and a stamp identifying the deployed data and models. */
  async timelineInfo() {
    const [d, b] = await Promise.all([holder.get(), holder.base()]);
    return { lastDay: d.dataset.dates.length - 1, recordedLastDay: b.dataset.dates.length - 1, stamp: await dataStamp() };
  },
  /** Recorded values for one product on one day (to pre-fill the entry form), or null beyond the data. */
  async recordedDay(skuId: string, day: number) {
    const { dataset } = await holder.get();
    if (day >= dataset.dates.length) return null;
    const sku = dataset.skus.find((s) => s.id === skuId);
    if (!sku) return null;
    return {
      date: dataset.dates[day],
      demand: sku.demand[day],
      promotion: sku.promotion[day] as 0 | 1,
      weather: WEATHER_CODES[dataset.stores[sku.storeIndex].weather[day]],
      epidemic: dataset.epidemic[day] as 0 | 1,
      unitsSold: sku.unitsSold[day],
      inventory: sku.inventory[day],
      unitsOrdered: sku.unitsOrdered[day],
    };
  },
  async validateRows(newRows: UserRow[], observedUntil: number) {
    return validateUserRows((await holder.get()).dataset, observedUntil, newRows);
  },
  /** Parse and validate a CSV without changing anything. */
  async previewCsv(text: string, observedUntil: number) {
    const parsed = parseCsv(text);
    if (parsed.errors.length) return { ...parsed, validation: null };
    const validation = validateUserRows((await holder.get()).dataset, observedUntil, parsed.rows);
    return { ...parsed, validation };
  },
  /** Re-use weights saved in this browser if they match the current timeline. */
  async restoreLstm(): Promise<LstmStatus> {
    const s = await lstm();
    if (!s) return status();
    await exclusive(async () => {
      const meta = await get<{ knownThrough: number; version: number; seen: string; stamp?: string }>(META_KEY).catch(() => undefined);
      if (!meta || meta.stamp !== (await dataStamp()) || meta.seen !== (await rowsSeenSignature(meta.knownThrough))) return;
      try {
        const saved = await s.tf.loadLayersModel(MODEL_URL);
        s.model.dispose();
        s.model = saved;
        s.version = meta.version;
        s.knownThrough = meta.knownThrough;
      } catch {
        // stale or missing entry: keep the base weights
      }
    });
    return status();
  },
  /** Fine-tune on windows whose targets fall in the recently observed days, then save. */
  async fineTune(observedUntil: number): Promise<FineTuneReport | null> {
    const s = await lstm();
    if (!s || observedUntil <= s.knownThrough) return null;
    const d = await holder.get();
    const firstTargetEnd = Math.max(s.knownThrough + 1, observedUntil - REPLAY_DAYS + 1);
    const samples: FineTuneSample[] = [];
    d.dataset.skus.forEach((sku, i) => {
      const exog = buildExog(d.dataset, i, observedUntil, s.spec.horizon);
      const scale = d.config.lstm.scales[sku.id];
      for (let end = firstTargetEnd; end <= observedUntil; end++) {
        const o = end - s.spec.horizon;
        if (o - s.spec.window + 1 >= 0) samples.push(fineTuneSample(sku.demand, exog, o, scale, s.spec));
      }
    });
    const loss = await exclusive(() => fineTuneLstm(s.tf, s.model, samples, s.spec, { epochs: 2, learningRate: 1e-4, batchSize: 128 }));
    s.version += 1;
    s.knownThrough = observedUntil;
    await exclusive(async () => {
      try {
        await s.model.save(MODEL_URL);
        await set(META_KEY, { knownThrough: observedUntil, version: s.version, seen: await rowsSeenSignature(observedUntil), stamp: await dataStamp() });
      } catch {
        // storage unavailable (private mode): the tuned model still lives for this session
      }
    });
    return { version: s.version, knownThrough: s.knownThrough, samples: samples.length, loss };
  },
  /** Back to the offline-trained weights; forget anything saved. */
  async resetLstm(): Promise<LstmStatus> {
    const s = await lstm();
    if (s) {
      await exclusive(async () => {
        const { model } = await freshModel(s.tf);
        s.model.dispose();
        s.model = model;
        s.version = 0;
        s.knownThrough = (await holder.base()).dataset.split.valEndIdx;
        await s.tf.io.removeModel(MODEL_URL).catch(() => undefined);
        await del(META_KEY).catch(() => undefined);
      });
    }
    return status();
  },
};

export type ForecastWorkerApi = typeof api;
Comlink.expose(api);

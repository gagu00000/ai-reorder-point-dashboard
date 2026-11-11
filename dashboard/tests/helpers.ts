import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataset } from "../src/lib/data/dataset";
import type { Dataset, LeadTimesFile, LstmWeightsFile, ModelConfig, SeriesFile } from "../src/lib/data/types";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../public/data");
const fixtureDir = resolve(here, "fixtures");

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T;
export const readData = <T>(name: string): T => readJson<T>(resolve(dataDir, name));
export const readFixture = <T>(name: string): T => readJson<T>(resolve(fixtureDir, name));

let cached: Dataset | undefined;
export function loadDataset(): Dataset {
  cached ??= buildDataset(readData<SeriesFile>("series.json"));
  return cached;
}

export const loadSeriesFile = () => readData<SeriesFile>("series.json");
export const loadModelConfig = () => readData<ModelConfig>("model_config.json");
export const loadLeadTimes = () => readData<LeadTimesFile>("leadtimes.json");
export const loadLstmWeights = () => readData<LstmWeightsFile>("lstm/weights.json");

/** Largest absolute difference between two numeric arrays of equal length. */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} vs ${b.length}`);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

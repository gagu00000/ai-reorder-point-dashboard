/**
 * UI-side handles to the three analysis workers. Workers start on first use and stay alive, so
 * each loads the data once. All heavy computation happens off the main thread.
 */
import * as Comlink from "comlink";
import type { ForecastWorkerApi } from "../workers/forecast.worker";
import type { OptimizeWorkerApi } from "../workers/optimize.worker";
import type { PlanningWorkerApi } from "../workers/planning.worker";

let forecast: Comlink.Remote<ForecastWorkerApi> | null = null;
let planning: Comlink.Remote<PlanningWorkerApi> | null = null;
let optimizer: Comlink.Remote<OptimizeWorkerApi> | null = null;

export function forecastWorker(): Comlink.Remote<ForecastWorkerApi> {
  forecast ??= Comlink.wrap<ForecastWorkerApi>(
    new Worker(new URL("../workers/forecast.worker.ts", import.meta.url), { type: "module", name: "forecast" }),
  );
  return forecast;
}

export function planningWorker(): Comlink.Remote<PlanningWorkerApi> {
  planning ??= Comlink.wrap<PlanningWorkerApi>(
    new Worker(new URL("../workers/planning.worker.ts", import.meta.url), { type: "module", name: "planning" }),
  );
  return planning;
}

export function optimizeWorker(): Comlink.Remote<OptimizeWorkerApi> {
  optimizer ??= Comlink.wrap<OptimizeWorkerApi>(
    new Worker(new URL("../workers/optimize.worker.ts", import.meta.url), { type: "module", name: "optimize" }),
  );
  return optimizer;
}

export const proxy = Comlink.proxy;

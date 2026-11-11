/**
 * UI-side handles to the three analysis workers. Workers start on first use and stay alive, so
 * each loads the data once. All heavy computation happens off the main thread.
 */
import * as Comlink from "comlink";
import { recoverFromStaleDeploy } from "../app/staleDeploy";
import type { ForecastWorkerApi } from "../workers/forecast.worker";
import type { OptimizeWorkerApi } from "../workers/optimize.worker";
import type { PlanningWorkerApi } from "../workers/planning.worker";

let forecast: Comlink.Remote<ForecastWorkerApi> | null = null;
let planning: Comlink.Remote<PlanningWorkerApi> | null = null;
let optimizer: Comlink.Remote<OptimizeWorkerApi> | null = null;

/** A worker whose script fails to load (e.g. replaced by a new deploy) triggers a one-time reload. */
function start(worker: Worker): Worker {
  worker.addEventListener("error", (event: Event) => {
    // A script that fails to load fires a plain Event; runtime errors inside the worker are
    // ErrorEvents with a message and are handled where the call is made.
    if (!(event instanceof ErrorEvent) || !event.message) recoverFromStaleDeploy();
  });
  return worker;
}

export function forecastWorker(): Comlink.Remote<ForecastWorkerApi> {
  forecast ??= Comlink.wrap<ForecastWorkerApi>(start(
    new Worker(new URL("../workers/forecast.worker.ts", import.meta.url), { type: "module", name: "forecast" }),
  ));
  return forecast;
}

export function planningWorker(): Comlink.Remote<PlanningWorkerApi> {
  planning ??= Comlink.wrap<PlanningWorkerApi>(start(
    new Worker(new URL("../workers/planning.worker.ts", import.meta.url), { type: "module", name: "planning" }),
  ));
  return planning;
}

export function optimizeWorker(): Comlink.Remote<OptimizeWorkerApi> {
  optimizer ??= Comlink.wrap<OptimizeWorkerApi>(start(
    new Worker(new URL("../workers/optimize.worker.ts", import.meta.url), { type: "module", name: "optimize" }),
  ));
  return optimizer;
}

export const proxy = Comlink.proxy;

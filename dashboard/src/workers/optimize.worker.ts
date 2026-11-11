/// <reference lib="webworker" />
/** Optimisation worker: Step 3 — Bayesian optimisation, grid validation and sensitivity analysis. */
import * as Comlink from "comlink";
import { browserFetcher, createDataHolder } from "../engine/appData";
import {
  optimize, policySensitivity, serviceCurve, validateWithGrid, type OptimizationRequest, type ProgressEvent,
} from "../engine/optimizationService";
import { defaultOptimizationSettings } from "../engine/planning";
import type { UserRow } from "../lib/data/userData";

const holder = createDataHolder(browserFetcher);

const api = {
  async setTimeline(rows: UserRow[]) {
    await holder.setRows(rows);
  },
  async defaults() {
    return defaultOptimizationSettings(await holder.get());
  },
  async optimize(req: OptimizationRequest, onProgress?: (e: ProgressEvent) => void) {
    return optimize(await holder.get(), req, onProgress);
  },
  async validateWithGrid(req: OptimizationRequest) {
    return validateWithGrid(await holder.get(), req);
  },
  async sensitivity(req: OptimizationRequest, reorderPoint: number, orderQuantity: number) {
    return policySensitivity(await holder.get(), req, reorderPoint, orderQuantity);
  },
  async serviceCurve(req: OptimizationRequest, targets: number[]) {
    return serviceCurve(await holder.get(), req, targets);
  },
};

export type OptimizeWorkerApi = typeof api;
Comlink.expose(api);

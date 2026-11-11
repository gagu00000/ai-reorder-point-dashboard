/// <reference lib="webworker" />
/** Planning worker: Step 2 — safety stock (formula vs Monte Carlo) and the policy replay on unseen days. */
import * as Comlink from "comlink";
import { browserFetcher, createDataHolder } from "../engine/appData";
import { safetyStockAnalysis, simulateHoldout, type SafetyStockRequest, type SimulationRequest } from "../engine/inventoryService";
import type { UserRow } from "../lib/data/userData";

const holder = createDataHolder(browserFetcher);

const api = {
  async setTimeline(rows: UserRow[]) {
    await holder.setRows(rows);
  },
  async safetyStock(req: SafetyStockRequest) {
    return safetyStockAnalysis(await holder.get(), req);
  },
  async simulate(req: SimulationRequest) {
    return simulateHoldout(await holder.get(), req);
  },
};

export type PlanningWorkerApi = typeof api;
Comlink.expose(api);

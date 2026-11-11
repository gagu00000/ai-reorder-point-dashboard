/** The services the Web Workers expose, exercised directly in Node. */
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogFrom, type AppData } from "../src/engine/appData";
import { forecastSku, type LstmRunner } from "../src/engine/forecastService";
import { safetyStockAnalysis, simulateHoldout } from "../src/engine/inventoryService";
import { optimize, serviceCurve, validateWithGrid } from "../src/engine/optimizationService";
import { defaultOptimizationSettings } from "../src/engine/planning";
import { buildDataset } from "../src/lib/data/dataset";
import type { CostsFile, SeriesFile } from "../src/lib/data/types";
import { loadLstm, lstmForecast, specFromWeights } from "../src/lib/forecasting/lstm";
import { loadLeadTimes, loadLstmWeights, loadModelConfig, readData } from "./helpers";

let data: AppData;
let runner: LstmRunner;
const SKU = "S001-P0001";
const ORIGIN = 699;

beforeAll(async () => {
  await tf.setBackend("cpu");
  const series = readData<SeriesFile>("series.json");
  data = { dataset: buildDataset(series), meta: series.meta, leadTimes: loadLeadTimes(), costs: readData<CostsFile>("costs.json"), config: loadModelConfig() };
  const weights = loadLstmWeights();
  const model = loadLstm(tf, weights);
  const spec = specFromWeights(weights);
  runner = { spec, forecast: async (inputs, scales) => lstmForecast(tf, model, inputs, scales, spec) };
});

describe("engine services", () => {
  it("catalogue lists 100 SKUs without shipping demand arrays", () => {
    const c = catalogFrom(data);
    expect(c.skus).toHaveLength(100);
    expect(Object.keys(c.skus[0])).not.toContain("demand");
  });

  it("forecast service returns every model with bands and driver effects", async () => {
    const r = await forecastSku(data, { skuId: SKU, origin: ORIGIN, historyDays: 90 }, runner);
    expect(r.dates).toHaveLength(90 + 14);
    for (const k of ["baseline", "ets", "ridge", "lstm", "ensemble"] as const) {
      expect(r.forecasts[k]).toHaveLength(14);
      expect(r.bands[k]!.upper95[0]).toBeGreaterThan(r.bands[k]!.lower95[0]);
    }
    const promo = r.drivers.find((d) => d.feature === "promotion")!;
    const epidemic = r.drivers.find((d) => d.feature === "epidemic")!;
    expect(promo.relative).toBeGreaterThan(0.1);   // promotions lift demand
    expect(epidemic.relative).toBeLessThan(0);     // epidemics depress demand
    expect(r.futureActual.filter((v) => v !== null)).toHaveLength(14);
  });

  it("forecast service degrades gracefully without the LSTM", async () => {
    const r = await forecastSku(data, { skuId: SKU, origin: ORIGIN, historyDays: 30 }, null);
    expect(r.lstmAvailable).toBe(false);
    expect(r.forecasts.lstm).toBeUndefined();
    expect(r.forecasts.ensemble).toHaveLength(14);
  });

  it("safety-stock service reproduces the hand calculation and compares formula with Monte Carlo", () => {
    const r = safetyStockAnalysis(data, {
      skuId: SKU, origin: 759, serviceLevel: 0.95, leadTime: { model: "gamma", mean: null, sd: null }, trials: 20_000, seed: 1,
    });
    expect(r.baseline.formula.safetyStock).toBeCloseTo(169.9547, 3);
    expect(r.ai.formula.sigmaD).toBeLessThan(r.baseline.formula.sigmaD);
    expect(r.baseline.monteCarlo.reorderPoint).toBeGreaterThan(r.baseline.formula.reorderPoint);
    expect(r.baseline.histogram).toHaveLength(60);
  });

  it("simulation service replays the holdout for every policy", () => {
    const r = simulateHoldout(data, {
      skuId: SKU, origin: ORIGIN, serviceLevel: 0.95, leadTime: { model: "gamma", mean: null, sd: null },
      replications: 5, optimized: { reorderPoint: 600, orderQuantity: 450 },
    });
    expect(r.dates).toHaveLength(60);
    expect(r.policies.map((p) => p.key)).toEqual(["asis", "baseline", "ai", "optimized"]);
    r.policies.forEach((p) => expect(p.onHand).toHaveLength(60));
  });

  it("optimisation service runs BO with progress events, and grid validation agrees", () => {
    const settings = { ...defaultOptimizationSettings(data), evaluations: 20 };
    const events: number[] = [];
    const req = { skuId: SKU, origin: ORIGIN, settings, seed: 42 };
    const r = optimize(data, req, (e) => events.push(e.point.index));
    expect(events).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.best).not.toBeNull();
    expect(r.best!.annualCost).toBeLessThan(r.formulaPolicy.annualCost);
    expect(r.surrogate.mean.length).toBeGreaterThan(1);
    const grid = validateWithGrid(data, req);
    expect(grid.evaluations).toBe(900);
    expect(r.best!.annualCost).toBeLessThan(grid.best!.annualCost * 1.05);
  });

  it("reorder-point-only mode and the service-target curve work", () => {
    const settings = { ...defaultOptimizationSettings(data), mode: "r" as const, evaluations: 12 };
    const req = { skuId: SKU, origin: ORIGIN, settings, seed: 42 };
    const r = optimize(data, req);
    expect(r.bounds.names).toEqual(["reorderPoint"]);
    expect(r.best!.q).toBeCloseTo(r.eoq, 6);
    const curve = serviceCurve(data, req, [0.9, 0.97]);
    expect(curve).toHaveLength(2);
  });
});

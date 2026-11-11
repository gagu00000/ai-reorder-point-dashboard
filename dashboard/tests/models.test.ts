import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { skuIndexById } from "../src/lib/data/dataset";
import { buildExog } from "../src/lib/data/features";
import { etsFilter, etsForecastFromState, etsInitialState, fitEts, fitEtsKind } from "../src/lib/forecasting/ets";
import { fineTuneLstm, fineTuneSample, lstmInput, loadLstm, predictScaled, specFromWeights } from "../src/lib/forecasting/lstm";
import { fitRidge, ridgeForecastFromFit } from "../src/lib/forecasting/ridge";
import { loadDataset, loadLstmWeights, loadModelConfig, maxAbsDiff, readFixture } from "./helpers";

interface RidgeCase {
  sku: string; origin: number; alpha: number;
  mean: number[]; scale: number[]; coef: number[]; intercept: number; forecast: number[];
}
interface EtsFixture {
  fixed: { sku: string; alpha: number; beta: number | null; phi: number | null; l0: number; b0: number;
    fittedHead: number[]; sse: number; level: number; trend: number; forecast: number[] }[];
  fitted: { sku: string; selected: string;
    candidates: { kind: "SES" | "Holt-damped"; sse: number; aic: number; forecast: number[] }[] }[];
}
interface LstmCase { sku: string; origin: number; scale: number; encoder: number[]; future: number[]; predictionScaled: number[] }

const ds = loadDataset();

describe("ridge regression (parity with the Python reference)", () => {
  for (const c of readFixture<RidgeCase[]>("ridge.json")) {
    it(`${c.sku} @ origin ${c.origin}`, () => {
      const idx = skuIndexById(ds, c.sku);
      const exog = buildExog(ds, idx, c.origin, 14);
      const fit = fitRidge(ds.skus[idx].demand, exog, c.origin, c.alpha);
      expect(maxAbsDiff(fit.mean, c.mean)).toBeLessThan(1e-9);
      expect(maxAbsDiff(fit.scale, c.scale)).toBeLessThan(1e-9);
      expect(maxAbsDiff(fit.coef, c.coef)).toBeLessThan(1e-8);
      expect(fit.intercept).toBeCloseTo(c.intercept, 9);
      const f = ridgeForecastFromFit(ds.skus[idx].demand, exog, c.origin, fit, 14);
      expect(maxAbsDiff(f, c.forecast)).toBeLessThan(1e-7);
    });
  }
});

describe("exponential smoothing", () => {
  const fx = readFixture<EtsFixture>("ets.json");

  it("recursions match the reference exactly for fixed parameters", () => {
    for (const c of fx.fixed) {
      const y = ds.skus[skuIndexById(ds, c.sku)].demand;
      const n = ds.split.trainEndIdx + 1;
      const { l0, b0 } = etsInitialState(y);
      expect(l0).toBeCloseTo(c.l0, 10);
      expect(b0).toBeCloseTo(c.b0, 10);
      const fitted = new Float64Array(n);
      const res = etsFilter(y, n, { alpha: c.alpha, beta: c.beta, phi: c.phi }, l0, b0, fitted);
      expect(maxAbsDiff(fitted.subarray(0, 30), c.fittedHead)).toBeLessThan(1e-9);
      expect(res.sse / c.sse).toBeCloseTo(1, 10);
      expect(maxAbsDiff(etsForecastFromState(res.level, res.trend, c.phi, 14), c.forecast)).toBeLessThan(1e-8);
    }
  });

  it("optimiser reaches statsmodels' SSE (or better) and selects the same model", () => {
    for (const c of fx.fitted) {
      const y = ds.skus[skuIndexById(ds, c.sku)].demand;
      const n = ds.split.trainEndIdx + 1;
      for (const cand of c.candidates) {
        const ours = fitEtsKind(y, n, cand.kind);
        expect(ours.sse).toBeLessThanOrEqual(cand.sse * (1 + 1e-5));
      }
      expect(fitEts(y, ds.split.trainEndIdx).kind).toBe(c.selected);
    }
  });
});

describe("LSTM in TensorFlow.js (parity with Keras)", () => {
  const weights = loadLstmWeights();
  const spec = specFromWeights(weights);
  const scales = loadModelConfig().lstm.scales;
  beforeAll(async () => {
    await tf.setBackend("cpu");
  });

  it("builds identical inputs from the dataset", () => {
    for (const c of readFixture<LstmCase[]>("lstm.json")) {
      const idx = skuIndexById(ds, c.sku);
      const inp = lstmInput(ds.skus[idx].demand, buildExog(ds, idx, c.origin, 14), c.origin, scales[c.sku], spec);
      expect(maxAbsDiff(inp.encoder, c.encoder)).toBeLessThan(1e-6);
      expect(maxAbsDiff(inp.future, c.future)).toBeLessThan(1e-6);
    }
  });

  it("reproduces Keras predictions from the exported weights", () => {
    const model = loadLstm(tf, weights);
    const cases = readFixture<LstmCase[]>("lstm.json");
    const preds = predictScaled(tf, model, cases.map((c) => ({
      encoder: Float32Array.from(c.encoder), future: Float32Array.from(c.future),
    })), spec);
    cases.forEach((c, i) => expect(maxAbsDiff(preds[i], c.predictionScaled)).toBeLessThan(1e-5));
    model.dispose();
  });

  it("repeated fine-tuning does not leak tensors", async () => {
    const model = loadLstm(tf, weights);
    const sku = ds.skus[0];
    const exog = buildExog(ds, 0, 720, 14);
    const samples = Array.from({ length: 20 }, (_, j) => fineTuneSample(sku.demand, exog, 690 + (j % 10), scales[sku.id], spec));
    await fineTuneLstm(tf, model, samples, spec, { epochs: 1 });
    const after1 = tf.memory().numTensors;
    for (let k = 0; k < 3; k++) await fineTuneLstm(tf, model, samples, spec, { epochs: 1 });
    expect(tf.memory().numTensors).toBe(after1);
    model.dispose();
  });

  it("fine-tunes on newly observed windows and changes its forecast", async () => {
    const model = loadLstm(tf, weights);
    const idx = 0;
    const sku = ds.skus[idx];
    const origin = 745;
    const exog = buildExog(ds, idx, origin, 14);
    const samples = [];
    for (let o = 700; o + 14 <= origin; o++) samples.push(fineTuneSample(sku.demand, exog, o, scales[sku.id], spec));
    const probe = lstmInput(sku.demand, exog, origin, scales[sku.id], spec);
    const before = predictScaled(tf, model, [probe], spec)[0];
    const losses = await fineTuneLstm(tf, model, samples, spec, { epochs: 3 });
    const after = predictScaled(tf, model, [probe], spec)[0];
    expect(losses).toHaveLength(3);
    losses.forEach((l) => expect(Number.isFinite(l)).toBe(true));
    expect(maxAbsDiff(before, after)).toBeGreaterThan(0);
    model.dispose();
  });
});

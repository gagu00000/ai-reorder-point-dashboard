/**
 * End-to-end check: the browser models reproduce the validation leaderboard computed in
 * notebooks/02_reference_models_and_lstm.ipynb (100 SKUs × 11 origins × 14 days).
 */
import * as tf from "@tensorflow/tfjs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildExog } from "../src/lib/data/features";
import type { Dataset } from "../src/lib/data/types";
import { movingAverageForecast, naiveForecast, staticMeanForecast } from "../src/lib/forecasting/baselines";
import { leaderboard, rollingOrigins, runBacktest, type BatchForecaster, type BacktestRow } from "../src/lib/forecasting/backtest";
import { combineForecasts } from "../src/lib/forecasting/ensemble";
import { etsForecast } from "../src/lib/forecasting/ets";
import { lstmForecast, lstmInput, loadLstm, specFromWeights } from "../src/lib/forecasting/lstm";
import { ridgeForecast } from "../src/lib/forecasting/ridge";
import { loadDataset, loadLstmWeights, loadModelConfig } from "./helpers";

const ds = loadDataset();
const config = loadModelConfig();
const H = config.horizon;
const perSku = (fn: (y: Float64Array, origin: number, skuIndex: number) => Float64Array): BatchForecaster =>
  (d: Dataset, origin: number) => d.skus.map((s, i) => fn(s.demand, origin, i));

let rows: BacktestRow[] = [];

beforeAll(async () => {
  await tf.setBackend("cpu");
  const weights = loadLstmWeights();
  const spec = specFromWeights(weights);
  const model = loadLstm(tf, weights);
  const scales = ds.skus.map((s) => config.lstm.scales[s.id]);
  const origins = rollingOrigins(ds.split.trainEndIdx, ds.split.valEndIdx, H);
  expect(origins.map((o) => ds.dates[o])).toEqual(config.backtest.validation.origins);

  rows = await runBacktest(ds, origins, H, {
    "Static mean (baseline)": perSku((y, o) => staticMeanForecast(y, o, H)),
    Naive: perSku((y, o) => naiveForecast(y, o, H)),
    "MA-28": perSku((y, o) => movingAverageForecast(y, o, H)),
    ETS: perSku((y, o) => etsForecast(y, o, H)),
    Ridge: perSku((y, o, i) => ridgeForecast(y, buildExog(ds, i, o, H), o, H, config.ridge.alpha)),
    LSTM: (d, o) => lstmForecast(tf, model, d.skus.map((s, i) => lstmInput(s.demand, buildExog(d, i, o, H), o, scales[i], spec)), scales, spec),
  });

  // Ensemble from the members' forecasts with the notebook's inverse-WAPE weights.
  const key = (r: BacktestRow) => `${r.skuIndex}|${r.origin}|${r.h}`;
  const byModel = new Map<string, Map<string, BacktestRow>>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, new Map());
    byModel.get(r.model)!.set(key(r), r);
  }
  const ensemble: BacktestRow[] = [];
  for (const r of byModel.get("Ridge")!.values()) {
    const k = key(r);
    const f = combineForecasts(
      Object.fromEntries(config.ensemble.members.map((m) => [m, [byModel.get(m)!.get(k)!.f]])),
      config.ensemble.weights,
    )[0];
    ensemble.push({ ...r, model: "Ensemble", f });
  }
  rows.push(...ensemble);
  model.dispose();
});

describe("validation leaderboard reproduced in the browser", () => {
  const expected = config.backtest.validation.leaderboard;

  // The notebook stores leaderboard values rounded to 6 decimals, so "exact" means within 5e-7.
  const STORED_ROUNDING = 5.000001e-7;

  it.each([
    ["Static mean (baseline)", 0],
    ["Naive", 0],
    ["MA-28", 0],
    ["Ridge", 1e-9],
    ["LSTM", 2e-5],
  ])("%s matches the notebook (relative tolerance %s beyond rounding)", (model, tol) => {
    const got14 = leaderboard(rows, 14)[model];
    const got1 = leaderboard(rows, 1, true)[model];
    for (const k of ["WAPE", "MAE", "RMSE", "MASE", "Bias"] as const) {
      for (const [got, exp] of [[got14[k]!, expected.h14[model][k]], [got1[k]!, expected.h1[model][k]]]) {
        expect(Math.abs(got - exp)).toBeLessThanOrEqual(STORED_ROUNDING + tol * Math.abs(exp));
      }
    }
  });

  it("ETS matches within optimiser tolerance (independent optimiser vs statsmodels)", () => {
    expect(Math.abs(leaderboard(rows, 14).ETS.WAPE - expected.h14.ETS.WAPE)).toBeLessThan(0.003);
  });

  it("Ensemble matches", () => {
    expect(Math.abs(leaderboard(rows, 14).Ensemble.WAPE - expected.h14.Ensemble.WAPE)).toBeLessThan(0.002);
  });

  it("ranking: Ridge and LSTM beat the static-mean baseline", () => {
    const board = leaderboard(rows, 14);
    expect(board.Ridge.WAPE).toBeLessThan(board["Static mean (baseline)"].WAPE);
    expect(board.LSTM.WAPE).toBeLessThan(board["Static mean (baseline)"].WAPE);
  });
});

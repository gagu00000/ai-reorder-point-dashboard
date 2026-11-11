/**
 * Global LSTM forecaster in TensorFlow.js.
 *
 * Architecture (identical to `build_lstm` in scripts/reference_models.py):
 *   encoder [window × 10] → LSTM(32, tanh / sigmoid) ─┐
 *   future  [horizon × 9 flattened] ──────────────────┴→ concat → Dense(64, relu) → Dense(horizon)
 * Encoder features per day: demand / SKU scale, then the 9 exogenous drivers.
 * Weights are trained offline (Keras) and fine-tuned in the browser as new data arrives.
 *
 * TensorFlow.js is passed in rather than imported so it can be loaded lazily inside a Web Worker.
 */
import type * as TF from "@tensorflow/tfjs";
import { N_EXOG, type LstmWeightsFile } from "../data/types";

export type Tf = typeof TF;

export interface LstmSpec {
  window: number;
  horizon: number;
  units: number;
  dense: number;
}

export function specFromWeights(file: LstmWeightsFile): LstmSpec {
  return { window: file.window, horizon: file.horizon, units: file.units, dense: file.dense };
}

/** Decode a base64 little-endian float32 buffer (works in browsers, workers and Node). */
export function decodeFloat32(base64: string): Float32Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function createLstmModel(tf: Tf, spec: LstmSpec): TF.LayersModel {
  const encoder = tf.input({ shape: [spec.window, N_EXOG + 1], name: "encoder" });
  const future = tf.input({ shape: [spec.horizon * N_EXOG], name: "future" });
  // Glorot initialisation instead of the default orthogonal one: the trained weights replace it
  // anyway, and TF.js logs a console warning when orthogonalising a matrix this size.
  const h = tf.layers.lstm({
    units: spec.units, activation: "tanh", recurrentActivation: "sigmoid",
    recurrentInitializer: "glorotUniform", name: "lstm",
  }).apply(encoder) as TF.SymbolicTensor;
  const z = tf.layers.concatenate({ name: "concat" }).apply([h, future]) as TF.SymbolicTensor;
  const hidden = tf.layers.dense({ units: spec.dense, activation: "relu", name: "dense_hidden" }).apply(z) as TF.SymbolicTensor;
  const out = tf.layers.dense({ units: spec.horizon, name: "dense_out" }).apply(hidden) as TF.SymbolicTensor;
  return tf.model({ inputs: [encoder, future], outputs: out, name: "lstm_forecaster" });
}

export function loadLstm(tf: Tf, file: LstmWeightsFile): TF.LayersModel {
  if (file.format !== "lstm-forecaster/v1") throw new Error(`Unsupported LSTM weights format ${file.format}`);
  if (file.recurrentActivation !== "sigmoid") throw new Error("LSTM weights must use a sigmoid recurrent activation");
  const model = createLstmModel(tf, specFromWeights(file));
  for (const layer of file.layers) {
    const tensors = layer.weights.map((w) => tf.tensor(decodeFloat32(w.data), w.shape, "float32"));
    model.getLayer(layer.name).setWeights(tensors);
    tensors.forEach((t) => t.dispose());
  }
  return model;
}

export interface LstmInput {
  encoder: Float32Array; // window × (1 + N_EXOG)
  future: Float32Array;  // horizon × N_EXOG
}

/** Build model inputs for forecasting from `origin` (last observed day). `exog` covers 0..origin+horizon. */
export function lstmInput(
  y: ArrayLike<number>, exog: Float64Array, origin: number, scale: number, spec: LstmSpec,
): LstmInput {
  const width = N_EXOG + 1;
  const lo = origin - spec.window + 1;
  if (lo < 0) throw new Error(`LSTM needs ${spec.window} days of history`);
  const encoder = new Float32Array(spec.window * width);
  for (let w = 0; w < spec.window; w++) {
    const t = lo + w;
    encoder[w * width] = y[t] / scale;
    for (let j = 0; j < N_EXOG; j++) encoder[w * width + 1 + j] = exog[t * N_EXOG + j];
  }
  const future = new Float32Array(spec.horizon * N_EXOG);
  future.set(exog.subarray((origin + 1) * N_EXOG, (origin + 1 + spec.horizon) * N_EXOG));
  return { encoder, future };
}

function stack(tf: Tf, inputs: LstmInput[], spec: LstmSpec): [TF.Tensor, TF.Tensor] {
  const width = N_EXOG + 1;
  const enc = new Float32Array(inputs.length * spec.window * width);
  const fut = new Float32Array(inputs.length * spec.horizon * N_EXOG);
  inputs.forEach((inp, i) => {
    enc.set(inp.encoder, i * spec.window * width);
    fut.set(inp.future, i * spec.horizon * N_EXOG);
  });
  return [
    tf.tensor3d(enc, [inputs.length, spec.window, width]),
    tf.tensor2d(fut, [inputs.length, spec.horizon * N_EXOG]),
  ];
}

/** Scaled predictions (one row of `horizon` values per input). */
export function predictScaled(tf: Tf, model: TF.LayersModel, inputs: LstmInput[], spec: LstmSpec): Float32Array[] {
  const [enc, fut] = stack(tf, inputs, spec);
  const out = model.predict([enc, fut]) as TF.Tensor;
  const flat = out.dataSync() as Float32Array;
  enc.dispose(); fut.dispose(); out.dispose();
  return inputs.map((_, i) => flat.slice(i * spec.horizon, (i + 1) * spec.horizon));
}

/** Demand forecasts in units/day: max(0, prediction) × SKU scale. */
export function lstmForecast(
  tf: Tf, model: TF.LayersModel, inputs: LstmInput[], scales: number[], spec: LstmSpec,
): Float64Array[] {
  return predictScaled(tf, model, inputs, spec).map((row, i) => Float64Array.from(row, (v) => Math.max(0, v) * scales[i]));
}

export interface FineTuneSample extends LstmInput {
  target: Float32Array; // horizon values, scaled
}

/** Training sample whose 14 targets are all observed (origin + horizon ≤ last observed day). */
export function fineTuneSample(
  y: ArrayLike<number>, exog: Float64Array, origin: number, scale: number, spec: LstmSpec,
): FineTuneSample {
  const target = new Float32Array(spec.horizon);
  for (let h = 0; h < spec.horizon; h++) target[h] = y[origin + 1 + h] / scale;
  return { ...lstmInput(y, exog, origin, scale, spec), target };
}

/**
 * Fine-tune on recent windows when new data arrives (small learning rate, few epochs).
 * Returns the training loss per epoch.
 */
export async function fineTuneLstm(
  tf: Tf, model: TF.LayersModel, samples: FineTuneSample[], spec: LstmSpec,
  options: { epochs?: number; learningRate?: number; batchSize?: number } = {},
): Promise<number[]> {
  if (samples.length === 0) return [];
  const { epochs = 3, learningRate = 1e-4, batchSize = 64 } = options;
  model.compile({ optimizer: tf.train.adam(learningRate), loss: "meanSquaredError" });
  const [enc, fut] = stack(tf, samples, spec);
  const tgt = new Float32Array(samples.length * spec.horizon);
  samples.forEach((s, i) => tgt.set(s.target, i * spec.horizon));
  const ys = tf.tensor2d(tgt, [samples.length, spec.horizon]);
  const history = await model.fit([enc, fut], ys, { epochs, batchSize, shuffle: true, verbose: 0 });
  enc.dispose(); fut.dispose(); ys.dispose();
  return (history.history.loss as number[]).map(Number);
}

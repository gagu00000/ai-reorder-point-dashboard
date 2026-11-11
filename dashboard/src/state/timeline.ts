/**
 * The data timeline: how new data arrives and what happens when it does.
 *
 * advance():  1. all workers receive the new data;
 *             2. every model is scored on each new day using data up to the previous day
 *                (genuine out-of-sample accuracy, recorded before any model learns from it);
 *             3. the planning date moves forward — every forecast, safety stock, replay and
 *                optimisation keyed on it recomputes;
 *             4. the LSTM fine-tunes after every 7 new days, or when streaming stops.
 * Everything is saved in this browser (IndexedDB) and restored on the next visit.
 */
import { del, get, set } from "idb-keyval";
import { forecastWorker, optimizeWorker, planningWorker } from "../engine/client";
import type { DayScore } from "../engine/forecastService";
import type { UserRow } from "../lib/data/userData";
import { INITIAL_OBSERVED_UNTIL, useAppStore, type LogEntry } from "./store";

const STORAGE_KEY = "rop-timeline-v1";
const FINE_TUNE_EVERY = 7;
const MAX_LOG = 200;

interface Saved {
  observedUntil: number;
  userRows: UserRow[];
  scores: DayScore[];
  log: LogEntry[];
}

const store = useAppStore;

function log(kind: LogEntry["kind"], message: string) {
  store.setState((s) => ({ log: [{ at: new Date().toISOString(), kind, message }, ...s.log].slice(0, MAX_LOG) }));
}

async function persist() {
  const { observedUntil, userRows, scores, log: entries } = store.getState();
  try {
    await set(STORAGE_KEY, { observedUntil, userRows, scores, log: entries } satisfies Saved);
  } catch {
    // storage unavailable (e.g. private browsing): the session still works, it just will not be remembered
  }
}

async function syncWorkers(rows: UserRow[]) {
  await Promise.all([
    forecastWorker().setTimeline(rows),
    planningWorker().setTimeline(rows),
    optimizeWorker().setTimeline(rows),
  ]);
}

async function refreshLstm() {
  const st = await forecastWorker().lstmStatus();
  store.setState((s) => ({ lstm: { ...st, tuning: s.lstm.tuning } }));
}

/** Load the saved timeline (if any) and bring every worker up to date. Call once at start-up. */
export async function hydrate() {
  let saved: Saved | undefined;
  try {
    saved = await get<Saved>(STORAGE_KEY);
  } catch {
    saved = undefined;
  }
  const rows = saved?.userRows ?? [];
  await syncWorkers(rows);
  store.setState({
    observedUntil: saved?.observedUntil ?? INITIAL_OBSERVED_UNTIL,
    userRows: rows,
    scores: saved?.scores ?? [],
    log: saved?.log ?? [],
    dataVersion: store.getState().dataVersion + 1,
    hydrated: true,
  });
  if (saved && saved.observedUntil > INITIAL_OBSERVED_UNTIL) log("restore", "Restored your added data and planning date from this browser.");
  // LSTM: re-use fine-tuned weights saved in this browser, or catch up on any days it has not learnt yet.
  forecastWorker().restoreLstm().then(async (st) => {
    store.setState((s) => ({ lstm: { ...st, tuning: s.lstm.tuning } }));
    if (st.available && st.knownThrough !== null && st.knownThrough < store.getState().observedUntil) await fineTune();
  });
}

let tuning: Promise<void> | null = null;

/** Fine-tune the LSTM on newly observed days (one run at a time). */
export function fineTune(): Promise<void> {
  tuning ??= (async () => {
    const { observedUntil } = store.getState();
    store.setState((s) => ({ lstm: { ...s.lstm, tuning: true } }));
    try {
      const report = await forecastWorker().fineTune(observedUntil);
      if (report) {
        const last = report.loss[report.loss.length - 1];
        log("finetune", `LSTM fine-tuned on ${report.samples.toLocaleString("en-US")} recent windows (v${report.version}, training loss ${last.toFixed(4)}).`);
        await persist();
      }
    } finally {
      store.setState((s) => ({ lstm: { ...s.lstm, tuning: false } }));
      await refreshLstm();
      tuning = null;
    }
  })();
  return tuning;
}

/**
 * New data arrives. Without `rows`, the next recorded day is revealed for every product.
 * With rows (already validated), they are applied and the planning date moves to `lastDay`.
 */
export async function advance(opts: { rows?: UserRow[]; lastDay?: number; source: "stream" | "manual" | "csv" }) {
  const state = store.getState();
  if (state.busy) return;
  const from = state.observedUntil + 1;
  const to = opts.lastDay ?? from;
  const rows = opts.rows?.length ? [...state.userRows, ...opts.rows] : state.userRows;
  store.setState({ busy: `Scoring ${to - from + 1} new day${to > from ? "s" : ""}…` });
  try {
    await syncWorkers(rows);
    const newScores: DayScore[] = [];
    for (let d = from; d <= to; d++) {
      store.setState({ busy: `Scoring day ${d - from + 1} of ${to - from + 1} against every model…` });
      newScores.push(await forecastWorker().scoreDay(d));
    }
    store.setState((s) => ({
      observedUntil: to,
      userRows: rows,
      scores: [...s.scores, ...newScores],
      dataVersion: s.dataVersion + 1,
    }));
    const first = newScores[0];
    const span = newScores.length === 1 ? first.date : `${first.date} → ${newScores[newScores.length - 1].date}`;
    const what = opts.source === "stream" ? `Recorded day${newScores.length > 1 ? "s" : ""} revealed` : opts.source === "manual" ? "Your entry added" : "CSV appended";
    const entered = opts.rows?.length ? ` (${opts.rows.length} row${opts.rows.length === 1 ? "" : "s"} of yours)` : "";
    const err = newScores.reduce((a, s) => a + s.models.ridge!.absError, 0);
    const actual = newScores.reduce((a, s) => a + s.models.ridge!.actual, 0);
    log(opts.source, `${what}: ${span}${entered}. Ridge next-day error across all products: ${(100 * err / actual).toFixed(1)}%. `
      + "Forecasts, safety stock and plans refreshed.");
    await persist();
  } finally {
    store.setState({ busy: null });
  }
  const { lstm, observedUntil, streaming } = store.getState();
  if (lstm.available && lstm.knownThrough !== null && (observedUntil - lstm.knownThrough >= FINE_TUNE_EVERY || (!streaming && opts.source !== "stream"))) {
    void fineTune();
  }
}

let streamTimer: ReturnType<typeof setTimeout> | null = null;

/** Reveal recorded days one by one until paused or none are left. */
export function startStreaming(lastRecordedDay: number) {
  if (store.getState().streaming) return;
  store.setState({ streaming: true });
  const step = async () => {
    const { observedUntil, streaming } = store.getState();
    if (!streaming) return;
    if (observedUntil >= lastRecordedDay) {
      stopStreaming();
      return;
    }
    await advance({ source: "stream" });
    streamTimer = setTimeout(step, 400);
  };
  void step();
}

export function stopStreaming() {
  if (streamTimer) clearTimeout(streamTimer);
  streamTimer = null;
  const was = store.getState().streaming;
  store.setState({ streaming: false });
  const { lstm, observedUntil } = store.getState();
  if (was && lstm.available && lstm.knownThrough !== null && observedUntil > lstm.knownThrough) void fineTune();
}

/** Forget everything added in this browser and return to the original planning date. */
export async function resetTimeline() {
  stopStreaming();
  store.setState({ busy: "Resetting…" });
  try {
    await syncWorkers([]);
    await forecastWorker().resetLstm();
    try {
      await del(STORAGE_KEY);
    } catch {
      // nothing saved
    }
    store.setState((s) => ({
      observedUntil: INITIAL_OBSERVED_UNTIL,
      userRows: [],
      scores: [],
      log: [],
      runs: {},
      dataVersion: s.dataVersion + 1,
    }));
    log("reset", "Reset to the original data and planning date; the LSTM is back to its offline-trained weights.");
    await refreshLstm();
  } finally {
    store.setState({ busy: null });
  }
}

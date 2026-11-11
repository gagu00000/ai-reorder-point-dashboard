/**
 * The data timeline: how new data arrives and what happens when it does.
 *
 * advance():  0. the new data is re-validated against the *current* timeline (a preview made
 *                before other days arrived can never be applied out of order);
 *             1. all workers receive the new data;
 *             2. every model is scored on each new day using data up to the previous day
 *                (genuine out-of-sample accuracy, recorded before any model learns from it);
 *             3. the planning date moves forward — every forecast, safety stock, replay and
 *                optimisation keyed on it recomputes;
 *             4. the LSTM fine-tunes after every 7 new days, or when streaming stops.
 * Failures are reported (update log + message next to the controls), never thrown at the UI.
 * Everything is saved in this browser (IndexedDB) together with a stamp of the deployed data, and
 * restored on the next visit only if that stamp still matches.
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
  stamp?: string;
  observedUntil: number;
  userRows: UserRow[];
  scores: DayScore[];
  log: LogEntry[];
}

export type AdvanceResult = { ok: true } | { ok: false; reason: string };

const store = useAppStore;
let dataStamp = "";

function log(kind: LogEntry["kind"], message: string) {
  store.setState((s) => ({ log: [{ at: new Date().toISOString(), kind, message }, ...s.log].slice(0, MAX_LOG) }));
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function persist() {
  const { observedUntil, userRows, scores, log: entries } = store.getState();
  try {
    await set(STORAGE_KEY, { stamp: dataStamp, observedUntil, userRows, scores, log: entries } satisfies Saved);
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
  try {
    const st = await forecastWorker().lstmStatus();
    store.setState((s) => ({ lstm: { ...st, tuning: s.lstm.tuning } }));
  } catch {
    store.setState((s) => ({ lstm: { ...s.lstm, available: false, backend: "unavailable" } }));
  }
}

/** Load the saved timeline (if it belongs to this deployment) and bring every worker up to date. */
export async function hydrate() {
  let saved: Saved | undefined;
  try {
    saved = await get<Saved>(STORAGE_KEY);
  } catch {
    saved = undefined;
  }
  let note: string | null = null;
  try {
    dataStamp = (await forecastWorker().timelineInfo()).stamp;
    if (saved && saved.stamp !== dataStamp) {
      note = "Data saved in this browser belonged to an earlier version of the dashboard and was cleared.";
      saved = undefined;
    }
    await syncWorkers(saved?.userRows ?? []);
    const info = await forecastWorker().timelineInfo();
    if (saved && (saved.observedUntil < INITIAL_OBSERVED_UNTIL || saved.observedUntil > info.lastDay)) {
      note = "Saved planning date was not valid for this data and was reset.";
      saved = undefined;
      await syncWorkers([]);
    }
  } catch (err) {
    note = `Saved data could not be restored (${message(err)}); starting from the original data.`;
    saved = undefined;
    await syncWorkers([]).catch(() => undefined);
  }
  if (!saved) await del(STORAGE_KEY).catch(() => undefined);

  store.setState({
    observedUntil: saved?.observedUntil ?? INITIAL_OBSERVED_UNTIL,
    userRows: saved?.userRows ?? [],
    scores: saved?.scores ?? [],
    log: saved?.log ?? [],
    dataVersion: store.getState().dataVersion + 1,
    hydrated: true,
  });
  if (note) log("restore", note);
  else if (saved && saved.observedUntil > INITIAL_OBSERVED_UNTIL) log("restore", "Restored your added data and planning date from this browser.");

  // LSTM: re-use fine-tuned weights saved in this browser, or catch up on days it has not learnt yet.
  forecastWorker().restoreLstm().then(
    async (st) => {
      store.setState((s) => ({ lstm: { ...st, tuning: s.lstm.tuning } }));
      if (st.available && st.knownThrough !== null && st.knownThrough < store.getState().observedUntil) await fineTune();
    },
    () => store.setState((s) => ({ lstm: { ...s.lstm, available: false, backend: "unavailable" } })),
  );
}

let tuning: Promise<void> | null = null;

/** Fine-tune the LSTM on newly observed days (one run at a time; failures are logged, not thrown). */
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
    } catch (err) {
      log("error", `LSTM fine-tuning failed (${message(err)}); the other models are unaffected.`);
    } finally {
      store.setState((s) => ({ lstm: { ...s.lstm, tuning: false } }));
      await refreshLstm();
      tuning = null;
    }
  })();
  return tuning;
}

/**
 * New data arrives. Without `rows`, recorded days are revealed up to `lastDay` (default: the next
 * day). With rows, they are re-validated against the current timeline before anything changes.
 */
export async function advance(opts: { rows?: UserRow[]; lastDay?: number; source: "stream" | "manual" | "csv" }): Promise<AdvanceResult> {
  const state = store.getState();
  if (state.busy) return { ok: false, reason: "Another update is still running — try again in a moment." };
  const from = state.observedUntil + 1;
  store.setState({ busy: "Checking the new data…", dataError: null });
  let result: AdvanceResult = { ok: true };
  try {
    let added: UserRow[] = [];
    let to: number;
    if (opts.rows?.length) {
      const v = await forecastWorker().validateRows(opts.rows, state.observedUntil);
      if (v.errors.length || v.lastDay === null) {
        result = { ok: false, reason: v.errors[0] ?? "The data could not be added." };
        store.setState({ dataError: result.reason });
        return result;
      }
      added = v.rows;
      to = v.lastDay;
    } else {
      const info = await forecastWorker().timelineInfo();
      to = Math.min(opts.lastDay ?? from, info.lastDay);
      if (to < from) {
        result = { ok: false, reason: "There are no recorded days left to reveal." };
        store.setState({ dataError: result.reason });
        return result;
      }
    }

    const rows = added.length ? [...state.userRows, ...added] : state.userRows;
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
    const entered = added.length ? ` (${added.length} row${added.length === 1 ? "" : "s"} of yours)` : "";
    const err = newScores.reduce((a, s) => a + s.models.ridge!.absError, 0);
    const actual = newScores.reduce((a, s) => a + s.models.ridge!.actual, 0);
    log(opts.source, `${what}: ${span}${entered}. Ridge next-day error across all products: ${(100 * err / actual).toFixed(1)}%. `
      + "Forecasts, safety stock and plans refreshed.");
    await persist();
  } catch (err) {
    // Put every worker back on the data the store still describes.
    await syncWorkers(store.getState().userRows).catch(() => undefined);
    result = { ok: false, reason: `Adding data failed: ${message(err)}` };
    store.setState({ dataError: result.reason });
    log("error", result.reason);
  } finally {
    store.setState({ busy: null });
  }
  if (!result.ok) return result;

  const { lstm, observedUntil, streaming } = store.getState();
  if (lstm.available && lstm.knownThrough !== null && (observedUntil - lstm.knownThrough >= FINE_TUNE_EVERY || (!streaming && opts.source !== "stream"))) {
    void fineTune();
  }
  return result;
}

let streamTimer: ReturnType<typeof setTimeout> | null = null;

/** Reveal recorded days one by one until paused, none are left, or something fails. */
export function startStreaming() {
  if (store.getState().streaming) return;
  store.setState({ streaming: true, dataError: null });
  const step = async () => {
    if (!store.getState().streaming) return;
    const info = await forecastWorker().timelineInfo().catch(() => null);
    if (!info || store.getState().observedUntil >= info.lastDay) {
      stopStreaming();
      return;
    }
    const r = await advance({ source: "stream" });
    if (!r.ok && !r.reason.startsWith("Another update")) {
      stopStreaming();
      return;
    }
    if (store.getState().streaming) streamTimer = setTimeout(() => void step(), 400);
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
  store.setState({ busy: "Resetting…", dataError: null });
  try {
    await syncWorkers([]);
    await forecastWorker().resetLstm();
    await del(STORAGE_KEY).catch(() => undefined);
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
  } catch (err) {
    log("error", `Reset failed: ${message(err)}`);
  } finally {
    store.setState({ busy: null });
  }
}

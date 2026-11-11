/**
 * Application state (Zustand). Holds what the user has chosen and the data timeline; heavy results
 * are cached by `useWorkerQuery` and the optimisation-run slice below.
 */
import { create } from "zustand";
import type { DayScore } from "../engine/forecastService";
import type { EvaluatedPoint, OptimizationResponse } from "../engine/optimizationService";
import type { LeadTimeChoice, OptimizationSettings } from "../engine/planning";
import type { UserRow } from "../lib/data/userData";

/** Day index of the last validation day: where planning starts before any new data arrives. */
export const INITIAL_OBSERVED_UNTIL = 699;

export interface OptimizationRun {
  key: string;
  status: "running" | "done" | "error";
  progress: EvaluatedPoint[];
  budget: number;
  result: OptimizationResponse | null;
  error: string | null;
}

export interface LogEntry {
  at: string;            // ISO timestamp
  kind: "stream" | "manual" | "csv" | "finetune" | "reset" | "restore" | "error";
  message: string;
}

/** Most optimisation runs kept in memory (older, finished ones are dropped). */
const MAX_RUNS = 24;

export interface LstmInfo {
  available: boolean;
  backend: string;
  version: number;
  knownThrough: number | null;
  tuning: boolean;
}

interface AppState {
  skuId: string;
  /** Index of the last day the planner has observed. Days after it are "the future". */
  observedUntil: number;
  /** Rows the user added (form or CSV). Recorded days revealed by streaming are not stored here. */
  userRows: UserRow[];
  /** Bumped whenever the data the models see changes (cache keys include it). */
  dataVersion: number;
  hydrated: boolean;
  busy: string | null;     // what the timeline is doing right now, for the UI
  /** Why the last attempt to add data failed (shown next to the controls), or null. */
  dataError: string | null;
  streaming: boolean;
  scores: DayScore[];
  log: LogEntry[];
  lstm: LstmInfo;

  serviceLevel: number;
  leadTime: LeadTimeChoice;
  mcTrials: number;
  optSettings: OptimizationSettings | null;
  runs: Record<string, OptimizationRun>;

  setSku: (id: string) => void;
  setServiceLevel: (v: number) => void;
  setLeadTime: (v: Partial<LeadTimeChoice>) => void;
  setMcTrials: (v: number) => void;
  setOptSettings: (v: OptimizationSettings) => void;
  patchOptSettings: (v: Partial<OptimizationSettings>) => void;
  upsertRun: (key: string, patch: Partial<OptimizationRun>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  skuId: "S001-P0001",
  observedUntil: INITIAL_OBSERVED_UNTIL,
  userRows: [],
  dataVersion: 0,
  hydrated: false,
  busy: null,
  dataError: null,
  streaming: false,
  scores: [],
  log: [],
  lstm: { available: false, backend: "loading", version: 0, knownThrough: null, tuning: false },

  serviceLevel: 0.95,
  leadTime: { model: "gamma", mean: null, sd: null },
  mcTrials: 20_000,
  optSettings: null,
  runs: {},

  setSku: (skuId) => set({ skuId }),
  // The global service level is a cycle service level (the formula's Z); it only drives the
  // optimiser's target when the optimiser is also constrained on cycle service, not on fill rate.
  setServiceLevel: (serviceLevel) => set((s) => ({
    serviceLevel,
    optSettings: s.optSettings && s.optSettings.serviceMetric === "cycleServiceLevel"
      ? { ...s.optSettings, serviceTarget: serviceLevel } : s.optSettings,
  })),
  setLeadTime: (v) => set((s) => {
    const leadTime = { ...s.leadTime, ...v };
    return { leadTime, optSettings: s.optSettings ? { ...s.optSettings, leadTime } : s.optSettings };
  }),
  setMcTrials: (mcTrials) => set({ mcTrials }),
  setOptSettings: (optSettings) => set({ optSettings }),
  patchOptSettings: (v) => set((s) => (s.optSettings ? { optSettings: { ...s.optSettings, ...v } } : {})),
  upsertRun: (key, patch) => set((s) => {
    const prev = s.runs[key] ?? { key, status: "running", progress: [], budget: 0, result: null, error: null };
    const runs = { ...s.runs, [key]: { ...prev, ...patch } };
    // Keep memory bounded during long streaming sessions: drop the oldest finished runs.
    const keys = Object.keys(runs);
    for (let i = 0; keys.length - i > MAX_RUNS && i < keys.length; i++) {
      if (keys[i] !== key && runs[keys[i]].status !== "running") delete runs[keys[i]];
    }
    return { runs };
  }),
}));

/** Stable key identifying an optimisation problem on the current data. */
export function optimizationKey(skuId: string, origin: number, dataVersion: number, settings: OptimizationSettings): string {
  return `${skuId}|${origin}|${dataVersion}|${JSON.stringify(settings)}`;
}

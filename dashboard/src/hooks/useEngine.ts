/**
 * Typed hooks over the analysis workers. Every key includes the data version, so new data
 * automatically refreshes every view; nothing runs until the saved timeline has been restored.
 */
import { useCallback, useEffect } from "react";
import { forecastWorker, optimizeWorker, planningWorker, proxy } from "../engine/client";
import type { ProgressEvent } from "../engine/optimizationService";
import { optimizationKey, useAppStore } from "../state/store";
import { useWorkerQuery } from "./useWorkerQuery";

export function useCatalog() {
  const { hydrated, dataVersion } = useAppStore();
  return useWorkerQuery(hydrated ? `catalog|${dataVersion}` : null, () => forecastWorker().catalog(), 0);
}

export function useForecast(historyDays: number) {
  const { skuId, observedUntil, hydrated, dataVersion, lstm } = useAppStore();
  const key = hydrated ? `forecast|${skuId}|${observedUntil}|${dataVersion}|lstm${lstm.version}|${historyDays}` : null;
  return useWorkerQuery(key, () => forecastWorker().forecast({ skuId, origin: observedUntil, historyDays }));
}

export function useSafetyStock() {
  const { skuId, observedUntil, serviceLevel, leadTime, mcTrials, hydrated, dataVersion } = useAppStore();
  const key = hydrated ? `ss|${skuId}|${observedUntil}|${dataVersion}|${serviceLevel}|${JSON.stringify(leadTime)}|${mcTrials}` : null;
  return useWorkerQuery(key, () => planningWorker().safetyStock({
    skuId, origin: observedUntil, serviceLevel, leadTime, trials: mcTrials, seed: 7,
  }), 200);
}

/** Load default optimisation settings once, aligned with the global service level and lead time. */
export function useOptimizationSettings() {
  const { optSettings, setOptSettings, hydrated } = useAppStore();
  useEffect(() => {
    if (optSettings || !hydrated) return;
    optimizeWorker().defaults().then((d) => {
      const { serviceLevel, leadTime } = useAppStore.getState();
      if (!useAppStore.getState().optSettings) setOptSettings({ ...d, serviceTarget: serviceLevel, leadTime });
    });
  }, [optSettings, setOptSettings, hydrated]);
  return optSettings;
}

/**
 * The Bayesian-optimisation run for the current SKU, data and settings. With `auto`, it starts as
 * soon as it is needed (e.g. the overview needs the optimised policy); otherwise on `start()`.
 */
export function useOptimization(auto: boolean) {
  const settings = useOptimizationSettings();
  const { skuId, observedUntil, dataVersion, busy, streaming } = useAppStore();
  const key = settings ? optimizationKey(skuId, observedUntil, dataVersion, settings) : null;
  const run = useAppStore((s) => (key ? s.runs[key] : undefined));

  const start = useCallback(() => {
    if (!key || !settings) return;
    const existing = useAppStore.getState().runs[key];
    if (existing && existing.status !== "error") return;
    const { upsertRun } = useAppStore.getState();
    upsertRun(key, { status: "running", progress: [], budget: settings.evaluations, result: null, error: null });
    const onProgress = (e: ProgressEvent) => {
      const current = useAppStore.getState().runs[key];
      useAppStore.getState().upsertRun(key, { progress: [...(current?.progress ?? []), e.point] });
    };
    optimizeWorker()
      .optimize({ skuId, origin: observedUntil, settings, seed: 42 }, proxy(onProgress))
      .then(
        (result) => useAppStore.getState().upsertRun(key, { status: "done", result }),
        (err: unknown) => useAppStore.getState().upsertRun(key, { status: "error", error: err instanceof Error ? err.message : String(err) }),
      );
  }, [key, settings, skuId, observedUntil]);

  // While data is arriving (or streaming), wait for the timeline to settle before re-optimising,
  // so a 60-day stream does not queue 60 optimisations behind each other in the worker.
  useEffect(() => {
    if (auto && key && !run && !busy && !streaming) start();
  }, [auto, key, run, start, busy, streaming]);

  return { key, run, start, settings };
}

/** Number of recorded days after the planning date (the replay needs at least one). */
export function useUnseenDays(): number | null {
  const catalog = useCatalog().data;
  const observedUntil = useAppStore((s) => s.observedUntil);
  return catalog ? catalog.dates.length - 1 - observedUntil : null;
}

export function useSimulation(optimized: { reorderPoint: number; orderQuantity: number } | null, ready: boolean) {
  const { skuId, observedUntil, serviceLevel, leadTime, optSettings, dataVersion } = useAppStore();
  const unseen = useUnseenDays();
  const costs = optSettings?.costs;
  const key = ready && unseen !== null && unseen > 0
    ? `sim|${skuId}|${observedUntil}|${dataVersion}|${serviceLevel}|${JSON.stringify(leadTime)}|${JSON.stringify(costs)}|${optimized ? `${optimized.reorderPoint.toFixed(2)}:${optimized.orderQuantity.toFixed(2)}` : "none"}`
    : null;
  return useWorkerQuery(key, () => planningWorker().simulate({
    skuId, origin: observedUntil, serviceLevel, leadTime, replications: 30, optimized, costs,
  }), 150);
}

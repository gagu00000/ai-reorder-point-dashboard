/** Step 3 — AI-driven sensitivity analysis: Bayesian optimisation of the reorder point under constraints. */
import { Box, Grid3x3, LineChart, Play, Sparkles } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { EChart, baseAxis, baseGrid, baseLegend, baseTooltip, type EChartOption } from "../components/charts/EChart";
import { Button, ErrorNote, Insight, Note, NumberField, Segmented, Skeleton, Slider, Toggle } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { BusyDot, Panel, PageHeader } from "../components/ui/Panel";
import { COLORS } from "../app/theme";
import { optimizeWorker } from "../engine/client";
import type { EvaluatedPoint, OptimizationResponse } from "../engine/optimizationService";
import { useOptimization } from "../hooks/useEngine";
import { useWorkerQuery } from "../hooks/useWorkerQuery";
import { fmt2, fmtInt, fmtPct, fmtSignedPct } from "../lib/format";
import type { TornadoBar } from "../lib/optimization/sensitivity";
import { webglAvailable } from "../lib/webgl";
import { useAppStore } from "../state/store";

const Surface3D = lazy(() => import("../components/charts/Surface3D"));

/** Round up to a "nice" axis limit (1, 2 or 5 × a power of ten). */
function niceCeil(v: number): number {
  if (!(v > 0)) return v;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const costAxisLabel = { color: COLORS.faint, fontSize: 11, formatter: (v: number) => fmtInt(v) };

function convergenceOption(points: EvaluatedPoint[], budget: number, random: (number | null)[] | null, formulaCost: number | null): EChartOption {
  const idx = Array.from({ length: Math.max(budget, points.length) }, (_, i) => i + 1);
  // Exploratory probes can cost 10–30× the optimum; cap the axis so convergence stays readable
  // and draw clipped probes as triangles on the top edge (their true cost is in the tooltip).
  const best = points.reduce((m, p) => Math.min(m, p.bestSoFar ?? Infinity), Infinity);
  const cap = niceCeil(Math.max((formulaCost ?? 0) * 1.15, Number.isFinite(best) ? best * 2.5 : 0)) || undefined;
  const plot = (p: EvaluatedPoint) => (cap && p.annualCost > cap
    ? { value: cap, symbol: "triangle", symbolSize: 9, realCost: p.annualCost }
    : { value: p.annualCost, realCost: p.annualCost });
  return {
    grid: { ...baseGrid, top: 52, left: 64 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis",
      formatter: (ps: { seriesName: string; marker: string; data: unknown; value: unknown; axisValue: string }[]) => [`simulation #${ps[0]?.axisValue}`, ...ps
        .filter((p) => p.value !== "-" && p.value != null)
        .map((p) => {
          const d = p.data as { realCost?: number } | number;
          const v = typeof d === "object" && d && "realCost" in d ? d.realCost! : (p.value as number);
          return `${p.marker}${p.seriesName}: <b>${fmtInt(v)}</b>`;
        })].join("<br/>") },
    xAxis: { ...baseAxis(), type: "category", data: idx, name: "simulation #", nameLocation: "middle", nameGap: 24 },
    yAxis: { ...baseAxis(), type: "value", name: "annual cost", scale: true, max: cap, axisLabel: costAxisLabel },
    series: [
      { name: "Each evaluation (feasible)", type: "scatter", symbolSize: 6, itemStyle: { color: "rgba(34,211,238,0.55)" },
        data: points.map((p) => (p.feasible ? plot(p) : "-")) },
      { name: "Each evaluation (breaks a constraint)", type: "scatter", symbolSize: 6, itemStyle: { color: "rgba(244,63,94,0.6)" },
        data: points.map((p) => (!p.feasible ? plot(p) : "-")) },
      ...(random ? [{ name: "Random search — best so far", type: "line", step: "end", symbol: "none", data: random.map((v) => v ?? "-"),
        lineStyle: { color: COLORS.faint, width: 1.5, type: "dashed" }, itemStyle: { color: COLORS.faint } }] : []),
      { name: "Bayesian optimisation — best so far", type: "line", step: "end", symbol: "none", data: points.map((p) => p.bestSoFar ?? "-"),
        lineStyle: { color: COLORS.opt, width: 2.5 }, itemStyle: { color: COLORS.opt },
        markLine: formulaCost ? { symbol: "none", silent: true, lineStyle: { color: COLORS.baseline, type: "dashed" },
          label: { color: COLORS.baseline, fontSize: 10, formatter: "slide formula + EOQ", position: "insideEndTop" }, data: [{ yAxis: formulaCost }] } : undefined },
    ],
  };
}

function surfaceOption(r: OptimizationResponse, points: EvaluatedPoint[]): EChartOption {
  const g = r.surrogate;
  const twoD = g.y.length > 1 && Number.isFinite(g.y[0]);
  if (!twoD) return {};
  const dx = (g.x[1] - g.x[0]) / 2, dy = (g.y[1] - g.y[0]) / 2;
  // Colour by log-cost: probes at very low reorder points cost 10–30× the optimum and would
  // otherwise flatten the colour scale over the region that matters.
  const cells: [number, number, number, number, number][] = [];
  g.y.forEach((q, iy) => g.x.forEach((x, ix) => {
    const m = g.mean[iy][ix];
    cells.push([x, q, m, g.feasibility[iy][ix], Math.log(Math.max(m, 1))]);
  }));
  const logs = cells.map((c) => c[4]);
  return {
    grid: { left: 64, right: 90, top: 52, bottom: 44 },
    legend: { ...baseLegend, left: 0 },
    tooltip: { ...baseTooltip, trigger: "item", formatter: (p: { seriesName: string; value: number[] }) =>
      p.seriesName === "Surrogate cost"
        ? `ROP ${fmtInt(p.value[0])} · Q ${fmtInt(p.value[1])}<br/>predicted cost ${fmtInt(p.value[2])}<br/>P(constraints met) ${fmtPct(p.value[3], 0)}`
        : `${p.seriesName}<br/>ROP ${fmtInt(p.value[0])} · Q ${fmtInt(p.value[1])}` },
    visualMap: { type: "continuous", dimension: 4, seriesIndex: 0, min: Math.min(...logs),
      max: Math.min(Math.max(...logs), Math.log(3 * Math.exp(Math.min(...logs)))), right: 0, top: "middle",
      itemHeight: 160, text: ["high cost", "low cost"], textStyle: { color: COLORS.faint, fontSize: 10 }, calculable: false,
      formatter: (v: number) => fmtInt(Math.exp(v)),
      inRange: { color: ["#a7f3d0", "#22d3ee", "#7c3aed", "#4c1d95", "#1e1b4b"] } },
    xAxis: { ...baseAxis(), type: "value", name: "reorder point (units)", nameLocation: "middle", nameGap: 26, min: g.x[0] - dx, max: g.x[g.x.length - 1] + dx,
      axisLabel: { ...costAxisLabel, showMinLabel: false, showMaxLabel: false } },
    yAxis: { ...baseAxis(), type: "value", name: "order quantity", min: g.y[0] - dy, max: g.y[g.y.length - 1] + dy,
      axisLabel: { ...costAxisLabel, showMinLabel: false, showMaxLabel: false } },
    series: [
      { name: "Surrogate cost", type: "custom", data: cells, encode: { x: 0, y: 1 },
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; visual: (k: string) => string }) => {
          const p0 = api.coord([api.value(0) - dx, api.value(1) + dy]);
          const p1 = api.coord([api.value(0) + dx, api.value(1) - dy]);
          const feasible = api.value(3);
          return { type: "rect", shape: { x: p0[0], y: p0[1], width: p1[0] - p0[0] + 0.5, height: p1[1] - p0[1] + 0.5 },
            style: { fill: api.visual("color"), opacity: feasible < 0.5 ? 0.22 : 0.92 } };
        } },
      { name: "Simulations run by BO", type: "scatter", symbolSize: 7, data: points.map((p) => [p.reorderPoint, p.orderQuantity]),
        itemStyle: { color: "rgba(255,255,255,0.9)", borderColor: "#0a0f1c", borderWidth: 1 } },
      { name: "Slide formula + EOQ", type: "scatter", symbol: "diamond", symbolSize: 14, data: [[r.formulaPolicy.r, r.formulaPolicy.q]],
        itemStyle: { color: COLORS.baseline, borderColor: "#0a0f1c", borderWidth: 1.5 } },
      ...(r.best ? [{ name: "Recommended policy", type: "scatter", symbol: "pin", symbolSize: 30, data: [[r.best.r, r.best.q]],
        itemStyle: { color: COLORS.opt, borderColor: "#fff", borderWidth: 1.5 } }] : []),
    ],
  };
}

function sliceOption(r: OptimizationResponse): EChartOption {
  const s = r.slice;
  const ref = r.best?.annualCost ?? r.formulaPolicy.annualCost;
  const yMax = niceCeil(Math.max(ref * 2.5, r.formulaPolicy.annualCost * 1.15));
  return {
    grid: { ...baseGrid, top: 52, left: 64, right: 56 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? (Math.abs(v) < 10 ? v.toFixed(3) : fmtInt(v)) : "—") },
    xAxis: { ...baseAxis(), type: "value", name: "reorder point (units)", nameLocation: "middle", nameGap: 24, min: s[0].r, max: s[s.length - 1].r,
      axisLabel: { ...costAxisLabel, showMinLabel: false, showMaxLabel: false } },
    yAxis: [
      { ...baseAxis(), type: "value", name: "annual cost", min: 0, max: yMax, axisLabel: costAxisLabel },
      { ...baseAxis({ splitLine: { show: false } }), type: "value", name: "acquisition", position: "right", axisLabel: { show: false } },
    ],
    series: [
      { name: "±2σ", type: "line", stack: "band", symbol: "none", data: s.map((p) => [p.r, p.lower]), lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "GP uncertainty (±2σ)", type: "line", stack: "band", symbol: "none", data: s.map((p) => [p.r, p.upper - p.lower]),
        lineStyle: { opacity: 0 }, areaStyle: { color: COLORS.optSoft }, itemStyle: { color: COLORS.opt }, tooltip: { show: false } },
      { name: "GP predicted cost", type: "line", symbol: "none", data: s.map((p) => [p.r, p.mean]), lineStyle: { color: COLORS.opt, width: 2 }, itemStyle: { color: COLORS.opt },
        markLine: { symbol: "none", silent: true, label: { fontSize: 10, color: COLORS.text, formatter: "{b}" },
          data: [
            { name: "formula", xAxis: r.formulaPolicy.r, lineStyle: { color: COLORS.baseline, type: "dashed" } },
            ...(r.best ? [{ name: "recommended", xAxis: r.best.r, lineStyle: { color: COLORS.safe } }] : []),
          ] } },
      { name: "Expected improvement × P(feasible)", type: "line", yAxisIndex: 1, symbol: "none", data: s.map((p) => [p.r, p.acquisition]),
        lineStyle: { color: COLORS.ai, width: 1.2 }, itemStyle: { color: COLORS.ai }, areaStyle: { color: COLORS.aiSoft } },
    ],
  };
}

function tornadoOption(bars: TornadoBar[], base: number, fmt: (v: number) => string, unit: string): EChartOption {
  const names = bars.map((b) => b.name);
  return {
    grid: { left: 170, right: 40, top: 30, bottom: 30 },
    legend: { ...baseLegend, data: ["input −20%", "input +20%"] },
    tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps: { dataIndex: number }[]) => {
        const b = bars[ps[0].dataIndex];
        return `${b.name}<br/>${b.lowLabel}: <b>${fmt(b.low)}</b><br/>${b.highLabel}: <b>${fmt(b.high)}</b><br/>base: ${fmt(base)} ${unit}`;
      } },
    xAxis: { ...baseAxis(), type: "value", name: `change (${unit})`, nameLocation: "middle", nameGap: 24,
      axisLabel: { color: COLORS.faint, formatter: (v: number) => `${v > 0 ? "+" : ""}${fmt(v)}` } },
    yAxis: { ...baseAxis({ splitLine: { show: false } }), type: "category", data: names, inverse: true, axisLabel: { color: COLORS.muted, fontSize: 11 } },
    series: [
      { name: "input −20%", type: "bar", barWidth: 12, barGap: "-100%", data: bars.map((b) => b.low - base), itemStyle: { color: "#38bdf8", borderRadius: 3 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: COLORS.text, opacity: 0.5 }, label: { show: false }, data: [{ xAxis: 0 }] } },
      { name: "input +20%", type: "bar", barWidth: 12, data: bars.map((b) => b.high - base), itemStyle: { color: COLORS.baseline, borderRadius: 3 } },
    ],
  };
}

function curveOption(points: { target: number; reorderPoint: number | null; annualCost: number | null }[]): EChartOption {
  return {
    grid: { ...baseGrid, top: 40, left: 64, right: 60 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmtInt(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: points.map((p) => fmtPct(p.target, 0)), name: "service target", nameLocation: "middle", nameGap: 24 },
    yAxis: [
      { ...baseAxis(), type: "value", name: "annual cost", scale: true },
      { ...baseAxis({ splitLine: { show: false } }), type: "value", name: "reorder point", scale: true, position: "right" },
    ],
    series: [
      { name: "Minimum annual cost", type: "line", data: points.map((p) => p.annualCost ?? "-"), symbolSize: 8, lineStyle: { color: COLORS.opt, width: 2 }, itemStyle: { color: COLORS.opt } },
      { name: "Optimal reorder point", type: "line", yAxisIndex: 1, data: points.map((p) => p.reorderPoint ?? "-"), symbolSize: 6, lineStyle: { color: COLORS.ai, type: "dashed" }, itemStyle: { color: COLORS.ai } },
    ],
  };
}

export default function Optimization() {
  const { run, start, settings, key } = useOptimization(false);
  const { patchOptSettings, setServiceLevel, skuId, observedUntil } = useAppStore();
  const [show3d, setShow3d] = useState(false);
  const canWebgl = useMemo(() => webglAvailable(), []);
  const [wantCurve, setWantCurve] = useState(false);
  const [wantGrid, setWantGrid] = useState(false);
  const result = run?.result ?? null;
  const points = run?.status === "done" && result ? result.points : run?.progress ?? [];
  const running = run?.status === "running";
  const req = settings ? { skuId, origin: observedUntil, settings, seed: 42 } : null;

  const sens = useWorkerQuery(result?.best && key ? `sens|${key}` : null,
    () => optimizeWorker().sensitivity(req!, result!.best!.r, result!.best!.q), 0);
  const curve = useWorkerQuery(wantCurve && key ? `curve|${key}` : null,
    () => optimizeWorker().serviceCurve(req!, [0.85, 0.9, 0.95, 0.97, 0.99]), 0);
  const grid = useWorkerQuery(wantGrid && key ? `grid|${key}` : null, () => optimizeWorker().validateWithGrid(req!), 0);

  const conv = useMemo(() => convergenceOption(points, run?.budget ?? settings?.evaluations ?? 45, result?.randomSearch.bestSoFar ?? null,
    result?.formulaPolicy.annualCost ?? null), [points, run?.budget, settings?.evaluations, result]);
  const surf = useMemo(() => (result ? surfaceOption(result, result.points) : null), [result]);
  const slice = useMemo(() => (result ? sliceOption(result) : null), [result]);
  const costTornado = useMemo(() => (sens.data ? tornadoOption(sens.data.cost, sens.data.base.annualCost, fmtInt, "per year") : null), [sens.data]);
  const ropTornado = useMemo(() => (result ? tornadoOption(result.formulaTornado.bars, result.formulaTornado.base, fmtInt, "units") : null), [result]);
  const curveChart = useMemo(() => (curve.data ? curveOption(curve.data) : null), [curve.data]);

  if (!settings) return <Skeleton height={500} />;
  const s = settings;
  const is2d = s.mode === "rq";
  const best = result?.best;
  const f = result?.formulaPolicy;

  return (
    <>
      <PageHeader eyebrow="Step 3 · Real-time optimisation" title="Bayesian Optimisation & Sensitivity">
        Instead of sweeping parameters by hand, a Gaussian-process model learns how cost and service respond to the reorder point (and order
        quantity) from a few dozen full simulations, and picks each next experiment where it expects the biggest improvement that still meets your constraints.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[310px_1fr]">
        <Panel index={0} title="Objective & constraints" subtitle="Minimise expected annual cost (holding + ordering + lost sales)." className="self-start">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-300">Plan demand from</p>
              <Segmented label="Demand basis" value={s.demandBasis} onChange={(v) => patchOptSettings({ demandBasis: v })} size="xs"
                options={[{ value: "ai", label: "AI forecast + errors" }, { value: "baseline", label: "Static history" }]} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-300">Decide</p>
              <Segmented label="Decision variables" value={s.mode} onChange={(v) => patchOptSettings({ mode: v })} size="xs"
                options={[{ value: "rq", label: "Reorder point + order qty" }, { value: "r", label: "Reorder point only" }]} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-300">Service constraint</p>
              <Segmented label="Service metric" value={s.serviceMetric} onChange={(v) => patchOptSettings({ serviceMetric: v })} size="xs"
                options={[{ value: "cycleServiceLevel", label: "Cycle service" }, { value: "fillRate", label: "Fill rate" }]} />
              <Slider label="at least" value={s.serviceTarget} min={0.8} max={0.995} step={0.005} format={(v) => fmtPct(v, 1)}
                onChange={(v) => (s.serviceMetric === "cycleServiceLevel" ? setServiceLevel(v) : patchOptSettings({ serviceTarget: v }))} />
            </div>
            <div className="space-y-2 rounded-xl border border-line p-3">
              <Toggle checked={s.budget !== null} onChange={(on) => patchOptSettings({ budget: on ? 20_000 : null })} label="Inventory budget (avg stock value)" />
              {s.budget !== null && <NumberField label="Max average inventory value" value={s.budget} step={1000} min={0} onChange={(v) => patchOptSettings({ budget: v })} />}
              <Toggle checked={s.capacity !== null} onChange={(on) => patchOptSettings({ capacity: on ? 1000 : null })} label="Storage capacity" />
              {s.capacity !== null && <NumberField label="Max units on hand" value={s.capacity} step={50} min={0} suffix="units" onChange={(v) => patchOptSettings({ capacity: v })} />}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Min order (MOQ)" value={s.minOrder ?? Number.NaN} min={0} step={10} suffix="units"
                onChange={(v) => patchOptSettings({ minOrder: Number.isFinite(v) && v > 0 ? v : null })} />
              <NumberField label="Max order" value={s.maxOrder ?? Number.NaN} min={0} step={50} suffix="units"
                onChange={(v) => patchOptSettings({ maxOrder: Number.isFinite(v) && v > 0 ? v : null })} />
            </div>
            <details className="rounded-xl border border-line p-3 text-xs text-slate-400">
              <summary className="cursor-pointer font-medium text-slate-300">Cost assumptions</summary>
              <div className="mt-3 space-y-4">
                <Slider label="Holding cost (% of price / year)" value={s.costs.holdingRatePerYear} min={0.05} max={0.6} step={0.01} format={(v) => fmtPct(v, 0)}
                  onChange={(v) => patchOptSettings({ costs: { ...s.costs, holdingRatePerYear: v } })} />
                <Slider label="Order cost (per order)" value={s.costs.orderCost} min={5} max={300} step={5} format={(v) => fmtInt(v)}
                  onChange={(v) => patchOptSettings({ costs: { ...s.costs, orderCost: v } })} />
                <Slider label="Lost margin per unit short (% of price)" value={s.costs.marginRate} min={0.02} max={1} step={0.01} format={(v) => fmtPct(v, 0)}
                  onChange={(v) => patchOptSettings({ costs: { ...s.costs, marginRate: v } })} />
              </div>
            </details>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-300">Simulation budget</p>
              <Segmented label="Evaluations" value={String(s.evaluations)} onChange={(v) => patchOptSettings({ evaluations: Number(v) })} size="xs"
                options={[{ value: "25", label: "25" }, { value: "45", label: "45 (default)" }, { value: "60", label: "60" }]} />
            </div>
            <Button onClick={start} disabled={running || run?.status === "done"} icon={running ? <Sparkles className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}>
              {running ? `Optimising… ${run?.progress.length ?? 0}/${run?.budget}` : run?.status === "done" ? "Optimised for these settings" : "Run Bayesian optimisation"}
            </Button>
            {run?.status === "error" && <ErrorNote message={run.error ?? "Optimisation failed"} />}
          </div>
        </Panel>

        <div className="grid min-w-0 gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi index={0} label="Recommended reorder point" tone="opt" value={best?.r} format={fmtInt}
              hint={f ? `slide formula: ${fmtInt(f.r)} units` : "run the optimiser"} />
            <Kpi index={1} label="Recommended order quantity" tone="opt" value={best?.q} format={fmtInt}
              hint={result ? `EOQ: ${fmtInt(result.eoq)} units` : undefined} />
            <Kpi index={2} label="Expected annual cost" tone="safe" value={best?.annualCost} format={fmtInt}
              hint={best && f ? `${fmtSignedPct(best.annualCost / f.annualCost - 1)} vs formula + EOQ (${fmtInt(f.annualCost)})` : undefined} />
            <Kpi index={3} label={s.serviceMetric === "fillRate" ? "Fill rate" : "Cycle service"} tone="ai" value={best?.service} format={(v) => fmtPct(v, 1)}
              hint={f ? `formula policy: ${fmtPct(f.service, 1)} · target ${fmtPct(s.serviceTarget, 1)}` : undefined} />
          </div>

          <Panel index={1} busy={running} title="Convergence: Bayesian optimisation vs random search"
            subtitle="Each simulation is a full year of daily inventory under one candidate policy (8 demand scenarios). Lower is better; only policies that meet every constraint count.">
            {points.length ? <EChart option={conv} height={280} ariaLabel="Best cost found per simulation, Bayesian optimisation against random search" />
              : <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">Press “Run Bayesian optimisation” to watch it search.</div>}
            {result && best && f && (
              <Insight>
                In {result.points.length} simulations the optimiser found a policy that costs <b className="text-safe">{fmtInt(best.annualCost)}</b> a year —
                {" "}{fmtSignedPct(best.annualCost / f.annualCost - 1)} against ordering at the slide formula's reorder point with the EOQ. It reorders at
                {" "}<b className="text-opt">{fmtInt(best.r)} units</b> instead of {fmtInt(f.r)}: the formula only covers demand during the lead time, while the simulation
                also prices in that stock is usually already below the reorder point when the daily review triggers an order, and that each lost sale costs
                {" "}{fmtPct(s.costs.marginRate, 0)} of the price. {result.randomSearch.bestSoFar.at(-1) != null && <>Random search with the same budget stopped at
                {" "}{fmtInt(result.randomSearch.bestSoFar.at(-1)!)}.</>}
              </Insight>
            )}
          </Panel>
        </div>
      </div>

      {result && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Panel index={2} title={is2d ? "The optimiser's map of the decision space" : "Cost along the reorder point"}
            subtitle={is2d ? "Colour: cost predicted by the Gaussian process. Faded: likely to break a constraint. White dots: the simulations actually run." : "Gaussian-process prediction with ±2σ uncertainty, and the acquisition function that chose each next simulation."}
            actions={is2d && canWebgl ? <Segmented label="View" value={show3d ? "3d" : "2d"} onChange={(v) => setShow3d(v === "3d")} size="xs"
              options={[{ value: "2d", label: <span className="inline-flex items-center gap-1"><Grid3x3 className="h-3 w-3" />Map</span> },
                { value: "3d", label: <span className="inline-flex items-center gap-1"><Box className="h-3 w-3" />3D (WebGL)</span> }]} />
              : is2d ? <span className="text-[11px] text-slate-500">3D view needs WebGL (not available in this browser)</span> : undefined}>
            {is2d ? (show3d && canWebgl
              ? <ErrorBoundary resetKey={key ?? ""} fallback={(err) => (
                  <div>
                    <p role="status" className="mb-2 text-xs text-baseline">The 3D view could not start ({err.message}); showing the map instead.</p>
                    {surf && <EChart option={surf} height={380} ariaLabel="Surrogate cost map over reorder point and order quantity" />}
                  </div>
                )}>
                  <Suspense fallback={<Skeleton height={380} />}><Surface3D grid={result.surrogate} best={best ? { r: best.r, q: best.q, cost: best.annualCost } : null} /></Suspense>
                </ErrorBoundary>
              : surf && <EChart option={surf} height={380} ariaLabel="Surrogate cost map over reorder point and order quantity" />)
              : slice && <EChart option={slice} height={380} ariaLabel="Gaussian-process cost prediction along the reorder point" />}
          </Panel>
          {is2d && (
            <Panel index={3} title="Slice at the recommended order quantity" subtitle="Why it stopped where it did: predicted cost (±2σ) along the reorder point, and where the acquisition still saw value.">
              {slice && <EChart option={slice} height={380} ariaLabel="Gaussian-process cost prediction along the reorder point" />}
            </Panel>
          )}

          <Panel index={4} busy={sens.loading} title="How sensitive is the recommendation?"
            subtitle="The recommended policy re-simulated with each input 20% lower or higher (others unchanged). Bars show the change in annual cost.">
            {costTornado ? <EChart option={costTornado} height={290} ariaLabel="Tornado chart of annual cost sensitivity" /> : <Skeleton height={290} />}
            {sens.data && (
              <Insight>
                The biggest risk to this plan is <b className="text-white">{sens.data.cost[0].name.toLowerCase()}</b>: being 20% off moves annual cost between
                {" "}{fmtInt(Math.min(sens.data.cost[0].low, sens.data.cost[0].high))} and {fmtInt(Math.max(sens.data.cost[0].low, sens.data.cost[0].high))}.
                Inputs at the bottom barely matter, so effort is best spent improving the estimate at the top.
              </Insight>
            )}
          </Panel>
          <Panel index={5} title="Slide formula: what moves the reorder point" subtitle="Each formula input ±20% (service level ±2 points), change in the reorder point in units.">
            {ropTornado && <EChart option={ropTornado} height={290} ariaLabel="Tornado chart of the formula's reorder point" />}
            <Note>Base reorder point {fmtInt(result.formulaTornado.base)} units (Z = {fmt2(result.formula.z)}, L = {fmt2(result.formula.leadTime)} days, σ_L = {fmt2(result.formula.sigmaL)} days).</Note>
          </Panel>

          <Panel index={6} busy={curve.loading} title="Price of service" subtitle="Optimal policy for each service target. Later targets reuse earlier simulations, so the whole curve costs about 60 simulations."
            actions={!wantCurve ? <Button variant="ghost" onClick={() => setWantCurve(true)} icon={<LineChart className="h-4 w-4" />}>Compute curve</Button> : undefined}>
            {curveChart ? <EChart option={curveChart} height={260} ariaLabel="Minimum cost and optimal reorder point by service target" />
              : wantCurve ? <Skeleton height={260} /> : <p className="py-10 text-center text-sm text-slate-500">Shows how much each extra point of service costs.</p>}
            {curve.data && <Note>At default costs lost sales are expensive, so the cheapest policy already exceeds most targets and the curve is flat until the target binds.
              Lower the lost-margin assumption to see the trade-off appear.</Note>}
          </Panel>
          <Panel index={7} busy={grid.loading} title="Check against a manual sweep"
            subtitle={`The exhaustive alternative: ${is2d ? "a 30 × 30 grid (900 simulations)" : "60 reorder points"} evaluated one by one.`}
            actions={!wantGrid ? <Button variant="ghost" onClick={() => setWantGrid(true)} icon={<Grid3x3 className="h-4 w-4" />}>Run grid search</Button> : undefined}>
            {grid.data && best ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-opt/30 bg-opt/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-opt">Bayesian optimisation</p>
                  <p className="mt-1 text-xl font-semibold text-white">{fmtInt(best.annualCost)}</p>
                  <p className="text-xs text-slate-400">{result.points.length} simulations</p>
                </div>
                <div className="rounded-xl border border-line bg-ink-800/50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">Grid search</p>
                  <p className="mt-1 text-xl font-semibold text-white">{grid.data.best ? fmtInt(grid.data.best.annualCost) : "—"}</p>
                  <p className="text-xs text-slate-400">{fmtInt(grid.data.evaluations)} simulations</p>
                </div>
                {grid.data.best && (
                  <p className="col-span-2 text-sm text-slate-300">
                    Bayesian optimisation is within <b className="text-white">{fmtSignedPct(best.annualCost / grid.data.best.annualCost - 1)}</b> of the
                    sweep's best using <b className="text-white">{fmtPct(result.points.length / grid.data.evaluations, 0)}</b> of the simulations.
                    (The grid itself is coarse: neighbouring grid points typically differ by 1–2%.)
                  </p>
                )}
              </div>
            ) : wantGrid ? <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><BusyDot label="running 900 simulations" /></div>
              : <p className="py-10 text-center text-sm text-slate-500">Optional: verify the optimiser against brute force.</p>}
          </Panel>
        </div>
      )}
    </>
  );
}

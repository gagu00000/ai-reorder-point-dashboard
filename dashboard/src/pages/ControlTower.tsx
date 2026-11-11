/** Control Tower — the whole pipeline for one SKU on a single screen, with a plain-language briefing. */
import { ArrowRight, Boxes, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { EChart, baseAxis, baseTooltip, type EChartOption } from "../components/charts/EChart";
import { Insight, Skeleton } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { BusyDot, Panel, PageHeader } from "../components/ui/Panel";
import { COLORS, POLICY_STYLE } from "../app/theme";
import type { ForecastResponse } from "../engine/forecastService";
import type { SimulationResponse } from "../engine/inventoryService";
import { NoUnseenDays } from "../components/data/NoUnseenDays";
import { useCatalog, useForecast, useOptimization, useSafetyStock, useSimulation, useUnseenDays } from "../hooks/useEngine";
import { fmtDate, fmtInt, fmtPct, fmtSignedPct } from "../lib/format";
import { useAppStore } from "../state/store";

function sparkOption(d: ForecastResponse): EChartOption {
  const o = d.origin - d.historyStart;
  const f = d.forecasts.ridge ?? [];
  const band = d.bands.ridge;
  const fut = (arr: number[] | undefined) => d.dates.map((_, i) => (i > o && arr ? arr[i - o - 1] : i === o ? d.actual[o] : "-"));
  const lo = fut(band?.lower80);
  const hi = fut(band?.upper80);
  return {
    grid: { left: 36, right: 8, top: 10, bottom: 22 },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmtInt(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: d.dates, boundaryGap: false,
      axisLabel: { color: COLORS.faint, fontSize: 10, interval: 20, formatter: (v: string) => fmtDate(v, { day: "numeric", month: "short" }) } },
    yAxis: { ...baseAxis(), type: "value", min: 0, splitNumber: 3 },
    series: [
      { name: "80% low", type: "line", stack: "b", data: lo, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "80% band", type: "line", stack: "b", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: COLORS.aiSoft }, tooltip: { show: false },
        data: hi.map((v, i) => (v === "-" ? "-" : (v as number) - (lo[i] as number))) },
      { name: "Actual", type: "line", data: d.actual.map((v) => v ?? "-"), symbol: "none", lineStyle: { color: COLORS.actual, width: 1.2 }, itemStyle: { color: COLORS.actual } },
      { name: "AI forecast", type: "line", data: fut(f), symbol: "none", lineStyle: { color: COLORS.ai, width: 2.2 }, itemStyle: { color: COLORS.ai } },
    ],
  };
}

function policyCostOption(sim: SimulationResponse): EChartOption {
  const ps = sim.policies;
  return {
    grid: { left: 150, right: 64, top: 6, bottom: 20 },
    tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: { dataIndex: number }[]) => {
      const m = ps[p[0].dataIndex].metrics;
      return `${POLICY_STYLE[ps[p[0].dataIndex].key].label}<br/>total cost <b>${fmtInt(m.totalCost)}</b><br/>fill rate ${fmtPct(m.fillRate)} · stockout days ${fmtPct(m.stockoutDayRate)}`;
    } },
    xAxis: { ...baseAxis(), type: "value", axisLabel: { show: false } },
    yAxis: { ...baseAxis({ splitLine: { show: false } }), type: "category", inverse: true, data: ps.map((p) => POLICY_STYLE[p.key].label), axisLabel: { color: COLORS.muted, fontSize: 11 } },
    series: [{
      type: "bar", barWidth: 16,
      data: ps.map((p) => ({ value: p.metrics.totalCost, itemStyle: { color: POLICY_STYLE[p.key].color, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: COLORS.muted, fontSize: 11, formatter: (p: { value: number }) => fmtInt(p.value) },
    }],
  };
}

function stockOption(sim: SimulationResponse): EChartOption {
  const run = sim.policies.find((p) => p.key === "optimized") ?? sim.policies.find((p) => p.key === "ai")!;
  const color = POLICY_STYLE[run.key].color;
  return {
    grid: { left: 40, right: 8, top: 10, bottom: 22 },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmtInt(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: sim.dates,
      axisLabel: { color: COLORS.faint, fontSize: 10, interval: 14, formatter: (v: string) => fmtDate(v, { day: "numeric", month: "short" }) } },
    yAxis: { ...baseAxis(), type: "value", min: 0, splitNumber: 3 },
    series: [
      { name: "Stock on hand", type: "line", step: "start", data: run.onHand, symbol: "none", lineStyle: { color, width: 2 }, itemStyle: { color }, areaStyle: { color, opacity: 0.1 } },
      { name: "Reorder point", type: "line", step: "start", data: run.reorderPoint ?? [], symbol: "none", lineStyle: { color: COLORS.text, type: "dashed", width: 1, opacity: 0.6 }, itemStyle: { color: COLORS.text } },
      { name: "Lost sales", type: "scatter", symbolSize: 7, itemStyle: { color: COLORS.risk }, data: run.lost.map((l) => (l > 0.5 ? 0 : "-")) },
    ],
  };
}

const STEPS = [
  { to: "/forecasting", icon: TrendingUp, n: "1", title: "Forecast demand", color: "text-ai" },
  { to: "/safety-stock", icon: ShieldCheck, n: "2", title: "Size the buffer", color: "text-safe" },
  { to: "/optimization", icon: Sparkles, n: "3", title: "Optimise the reorder point", color: "text-opt" },
  { to: "/simulation", icon: Boxes, n: "✓", title: "Prove it on unseen days", color: "text-slate-200" },
] as const;

export default function ControlTower() {
  const skuId = useAppStore((s) => s.skuId);
  const catalog = useCatalog().data;
  const forecast = useForecast(60);
  const safety = useSafetyStock();
  const opt = useOptimization(true);
  const best = opt.run?.result?.best ?? null;
  const formula = opt.run?.result?.formulaPolicy ?? null;
  const ready = opt.run?.status === "done" || opt.run?.status === "error";
  const sim = useSimulation(best ? { reorderPoint: best.r, orderQuantity: best.q } : null, ready);
  const unseen = useUnseenDays();

  const spark = useMemo(() => (forecast.data ? sparkOption(forecast.data) : null), [forecast.data]);
  const costs = useMemo(() => (sim.data ? policyCostOption(sim.data) : null), [sim.data]);
  const stock = useMemo(() => (sim.data ? stockOption(sim.data) : null), [sim.data]);

  const sku = catalog?.skus.find((s) => s.id === skuId);
  const f = forecast.data?.forecasts.ridge;
  const next = f ? f.reduce((a, b) => a + b, 0) / f.length : Number.NaN;
  const base = sim.data?.policies.find((p) => p.key === "baseline");
  const optimized = sim.data?.policies.find((p) => p.key === "optimized");
  const asis = sim.data?.policies.find((p) => p.key === "asis");
  const saving = base && optimized ? optimized.metrics.totalCost / base.metrics.totalCost - 1 : Number.NaN;
  const holdout = catalog?.models.backtest.holdout.leaderboard.h1;

  const stepValues = [
    holdout ? `${fmtPct(holdout.Ridge.WAPE)} error vs ${fmtPct(holdout["Static mean (baseline)"].WAPE)} for a static average` : "…",
    safety.data ? `σ_D ${fmtInt(safety.data.historicalSd)} → ${fmtInt(safety.data.forecastErrorSd)} units/day; Monte Carlo safety stock ${fmtInt(safety.data.ai.monteCarlo.safetyStock)}` : "…",
    best ? `reorder at ${fmtInt(best.r)}, order ${fmtInt(best.q)} units` : opt.run?.status === "running" ? `searching… ${opt.run.progress.length}/${opt.run.budget}` : "…",
    optimized && base ? `${fmtSignedPct(saving)} cost vs the baseline calculator` : "…",
  ];

  return (
    <>
      <PageHeader eyebrow="Control Tower" title={sku ? `${sku.id} · ${sku.category}, ${sku.region} region` : "Reorder point control tower"}>
        The baseline reorder-point calculator uses a static average and the slide's formula. The AI-enhanced version forecasts demand, sizes the
        buffer with Monte Carlo, and lets Bayesian optimisation choose the reorder point and order quantity — then everything is replayed on days
        the planner never saw.
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi index={0} label="Demand, next 14 days" tone="ai" value={next} format={(v) => `${fmtInt(v)}/day`}
          hint={sku ? `history average ${fmtInt(sku.meanDemand)}/day` : undefined} />
        <Kpi index={1} label="Recommended reorder point" tone="opt" value={best?.r} format={(v) => `${fmtInt(v)} units`}
          hint={formula ? `slide formula says ${fmtInt(formula.r)}` : opt.run?.status === "running" ? <BusyDot label="optimising" /> : undefined} />
        <Kpi index={2} label="Recommended order quantity" tone="opt" value={best?.q} format={(v) => `${fmtInt(v)} units`}
          hint={opt.run?.result ? `EOQ ${fmtInt(opt.run.result.eoq)}` : undefined} />
        <Kpi index={3} label="Cost on unseen days" tone={saving > 0 ? "risk" : "safe"} value={Number.isFinite(saving) ? saving : null} format={(v) => fmtSignedPct(v)}
          hint="vs the baseline calculator, same demand" />
        <Kpi index={4} label="Stockout days" tone="risk" value={optimized?.metrics.stockoutDayRate} format={(v) => fmtPct(v)}
          hint={asis ? `as-is ordering: ${fmtPct(asis.metrics.stockoutDayRate)}` : undefined} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <Link key={s.to} to={s.to} className="glass group relative rounded-2xl p-4 transition hover:border-line-strong">
            <div className="flex items-center justify-between">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border border-line bg-ink-950/60 text-xs font-bold ${s.color}`}>{s.n}</span>
              <s.icon className={`h-4 w-4 ${s.color}`} aria-hidden />
            </div>
            <p className="mt-3 text-sm font-semibold text-white">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{stepValues[i]}</p>
            <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-300" aria-hidden />
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel index={1} busy={forecast.loading} title="Demand outlook" subtitle="Last 60 days and the 14-day AI forecast with its 80% band.">
          {spark ? <EChart option={spark} height={200} ariaLabel="Recent demand and the AI forecast" /> : <Skeleton height={200} />}
        </Panel>
        <Panel index={2} busy={sim.loading || opt.run?.status === "running"} title="Cost on the unseen days" subtitle="Holding + ordering + lost sales, same actual demand for every policy.">
          {unseen === 0 ? <NoUnseenDays compact /> : costs ? <EChart option={costs} height={200} ariaLabel="Total cost by policy over the replay period" /> : <Skeleton height={200} />}
        </Panel>
        <Panel index={3} busy={sim.loading} title="Recommended policy in action" subtitle="Simulated stock vs the reorder point; red dots are days with lost sales.">
          {unseen === 0 ? <NoUnseenDays compact /> : stock ? <EChart option={stock} height={200} ariaLabel="Stock on hand under the recommended policy" /> : <Skeleton height={200} />}
        </Panel>
      </div>

      {sim.data && best && formula && base && optimized && asis && safety.data && (
        <Panel index={4} className="mt-4" title="Briefing for the operations manager">
          <Insight title="Recommendation">
            Reorder <b className="text-white">{sku?.id}</b> when stock on hand plus stock on order falls to <b className="text-opt">{fmtInt(best.r)} units</b>,
            and order <b className="text-opt">{fmtInt(best.q)} units</b> each time. The textbook calculator would reorder at {fmtInt(formula.r)}; it
            under-protects because it ignores that stock is already below the trigger when the daily review places the order, and that demand during a
            long delivery is skewed upwards. On the {sim.data.dates.length} days after the planning date this policy kept stockouts to
            {" "}{fmtPct(optimized.metrics.stockoutDayRate)} of days (as-is ordering: {fmtPct(asis.metrics.stockoutDayRate)}) and cost
            {" "}{fmtSignedPct(saving)} against the baseline calculator.
            {saving > 0 && <> For this product the extra protection was not needed in this particular period — it held
              {" "}{fmtInt(optimized.metrics.avgOnHand - base.metrics.avgOnHand)} more units on average while the baseline happened to run short
              {" "}{fmtPct(base.metrics.stockoutDayRate)} of days. Across all 100 products the optimised policy was cheaper for 96 (see the holdout report).</>}
            {" "}Watch the inputs at the top of the sensitivity chart on the Optimisation page — if they change, re-run the optimiser.
          </Insight>
        </Panel>
      )}
    </>
  );
}

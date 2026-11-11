/** Inventory simulation: replay the unseen days under each policy and compare service and cost. */
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EChart, baseAxis, baseGrid, baseLegend, baseTooltip, type EChartOption } from "../components/charts/EChart";
import { Button, ErrorNote, Insight, Note, Segmented, Skeleton } from "../components/ui/Controls";
import { Panel, PageHeader } from "../components/ui/Panel";
import { COLORS, POLICY_STYLE } from "../app/theme";
import type { PolicyRun, SimulationResponse } from "../engine/inventoryService";
import { NoUnseenDays } from "../components/data/NoUnseenDays";
import { useOptimization, useSimulation, useUnseenDays } from "../hooks/useEngine";
import { fmtDate, fmtInt, fmtPct, fmtSignedPct } from "../lib/format";
import { useAppStore } from "../state/store";

type PolicyKey = PolicyRun["key"];

function trajectoryOption(sim: SimulationResponse, focus: PolicyKey, upTo: number): EChartOption {
  const run = sim.policies.find((p) => p.key === focus)!;
  const asIs = sim.policies.find((p) => p.key === "asis")!;
  const color = POLICY_STYLE[focus].color;
  const cut = <T,>(arr: T[]) => arr.map((v, i) => (i <= upTo ? v : "-"));
  const epidemicStart = sim.epidemic.findIndex((e) => e === 1);
  const epidemicEnd = sim.epidemic.lastIndexOf(1);
  return {
    grid: { ...baseGrid, top: 44, right: 56 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmtInt(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: sim.dates, boundaryGap: true,
      axisLabel: { color: COLORS.faint, fontSize: 11, formatter: (v: string) => fmtDate(v, { day: "numeric", month: "short" }) } },
    yAxis: [
      { ...baseAxis(), type: "value", name: "units on hand", min: 0 },
      { ...baseAxis({ splitLine: { show: false } }), type: "value", name: "demand", min: 0, position: "right" },
    ],
    series: [
      { name: "Daily demand", type: "bar", yAxisIndex: 1, data: cut(sim.demand), itemStyle: { color: "rgba(148,163,184,0.16)" }, barWidth: "60%",
        markArea: epidemicStart >= 0 ? { silent: true, itemStyle: { color: COLORS.riskSoft },
          label: { show: true, color: COLORS.risk, fontSize: 10, position: "insideTop", formatter: "epidemic" },
          data: [[{ xAxis: sim.dates[epidemicStart] }, { xAxis: sim.dates[epidemicEnd] }]] } : undefined },
      ...(focus !== "asis" ? [{ name: "As-is stock (recorded)", type: "line", step: "start", data: cut(asIs.onHand), symbol: "none",
        lineStyle: { color: COLORS.actual, width: 1, type: "dotted", opacity: 0.7 }, itemStyle: { color: COLORS.actual } }] : []),
      { name: `${POLICY_STYLE[focus].label} — stock`, type: "line", step: "start", data: cut(run.onHand), symbol: "none",
        lineStyle: { color, width: 2.2 }, itemStyle: { color }, areaStyle: { color, opacity: 0.08 } },
      ...(run.reorderPoint ? [{ name: "Reorder point", type: "line", step: "start", data: cut(run.reorderPoint), symbol: "none",
        lineStyle: { color: COLORS.text, width: 1.2, type: "dashed", opacity: 0.6 }, itemStyle: { color: COLORS.text } }] : []),
      { name: "Order placed", type: "scatter", symbol: "diamond", symbolSize: 9, itemStyle: { color: COLORS.opt },
        data: run.ordersPlaced.map((q, i) => (q > 0 && i <= upTo ? run.onHand[i] : "-")),
        tooltip: { valueFormatter: () => "order placed" } },
      { name: "Stockout (demand lost)", type: "scatter", symbol: "circle", symbolSize: 8, itemStyle: { color: COLORS.risk },
        data: run.lost.map((l, i) => (l > 0.5 && i <= upTo ? 0 : "-")) },
    ],
  };
}

function costOption(sim: SimulationResponse): EChartOption {
  const ps = sim.policies;
  const labels = ps.map((p) => POLICY_STYLE[p.key].label);
  const part = (name: string, get: (p: PolicyRun) => number, color: string) => ({
    name, type: "bar", stack: "c", barWidth: 22, data: ps.map(get), itemStyle: { color },
  });
  return {
    grid: { left: 160, right: 70, top: 34, bottom: 24 },
    legend: { ...baseLegend, left: 0 },
    tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => fmtInt(v as number) },
    xAxis: { ...baseAxis(), type: "value", name: "cost over the 60 days" , nameLocation: "middle", nameGap: 22 },
    yAxis: { ...baseAxis({ splitLine: { show: false } }), type: "category", data: labels, inverse: true, axisLabel: { color: COLORS.muted, fontSize: 11 } },
    series: [
      part("Holding", (p) => p.metrics.holdingCost, "#38bdf8"),
      part("Ordering", (p) => p.metrics.orderingCost, COLORS.opt),
      { ...part("Lost sales (shortage)", (p) => p.metrics.shortageCost, COLORS.risk),
        label: { show: true, position: "right", color: COLORS.muted, fontSize: 11,
          formatter: (p: { dataIndex: number }) => fmtInt(ps[p.dataIndex].metrics.totalCost) } },
    ],
  };
}

export default function Simulation() {
  const unseen = useUnseenDays();
  if (unseen === 0) {
    return (
      <>
        <PageHeader eyebrow="Proof on unseen days" title="Inventory Simulation" />
        <Panel><NoUnseenDays /></Panel>
      </>
    );
  }
  return <SimulationView />;
}

function SimulationView() {
  const opt = useOptimization(true);
  const optimized = opt.run?.result?.best ? { reorderPoint: opt.run.result.best.r, orderQuantity: opt.run.result.best.q } : null;
  const ready = opt.run?.status === "done" || opt.run?.status === "error";
  const { data, loading, error } = useSimulation(optimized, ready);
  const skuId = useAppStore((s) => s.skuId);
  const [focus, setFocus] = useState<PolicyKey>("optimized");
  const [day, setDay] = useState(Number.POSITIVE_INFINITY);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const n = data?.dates.length ?? 0;
  const upTo = Math.min(day, n - 1);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setDay((d) => {
        const next = (Number.isFinite(d) ? d : -1) + 1;
        if (next >= n - 1) setPlaying(false);
        return Math.min(next, n - 1);
      });
    }, 120);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, n]);

  const focusKey: PolicyKey = data?.policies.some((p) => p.key === focus) ? focus : "ai";
  const traj = useMemo(() => (data ? trajectoryOption(data, focusKey, upTo) : null), [data, focusKey, upTo]);
  const cost = useMemo(() => (data ? costOption(data) : null), [data]);
  const base = data?.policies.find((p) => p.key === "baseline");
  const best = data?.policies.find((p) => p.key === "optimized");
  const asis = data?.policies.find((p) => p.key === "asis");

  return (
    <>
      <PageHeader eyebrow="Proof on unseen days" title="Inventory Simulation">
        Each policy is replayed day by day over the {n || 60} days after the planning date, using the demand that actually happened. Lead times are
        random (30 repetitions with identical random draws for every policy, so differences come from the policy alone). Unmet demand is lost.
      </PageHeader>

      <div className="grid gap-4">
        <Panel index={0} busy={loading || opt.run?.status === "running"} pulseKey={data ? `${data.skuId}|${data.from}` : undefined}
          title={`Stock on hand vs reorder point · ${skuId}`}
          subtitle="Stock path of one representative repetition. Diamonds: orders placed; red dots: days with lost sales; dotted grey: what the business actually held."
          actions={<>
            <Segmented label="Policy shown" value={focusKey} onChange={(v) => { setFocus(v); }}
              options={(data?.policies ?? []).map((p) => ({ value: p.key, label: POLICY_STYLE[p.key].label.replace(" (historical)", "") }))} size="xs" />
            <Button variant="ghost" onClick={() => { if (!Number.isFinite(day) || day >= n - 1) setDay(0); setPlaying((p) => !p); }}
              icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}>{playing ? "Pause" : "Replay"}</Button>
            <Button variant="ghost" onClick={() => { setPlaying(false); setDay(Number.POSITIVE_INFINITY); }} icon={<RotateCcw className="h-4 w-4" />}>All</Button>
          </>}>
          {error && <ErrorNote message={error} />}
          {traj ? <EChart option={traj} height={360} ariaLabel="Simulated stock on hand against the reorder point over the replay period" /> : <Skeleton height={360} />}
          {data && Number.isFinite(day) && <p className="mt-1 text-xs text-slate-500">Day {upTo + 1} of {n} · {fmtDate(data.dates[upTo])}</p>}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
          <Panel index={1} title="Scorecard over the replay period" subtitle="Averages over 30 lead-time repetitions. Cycle service = share of order cycles without a stockout.">
            {!data ? <Skeleton height={220} /> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 font-medium">Policy</th>
                      <th className="py-2 text-right font-medium">Order qty</th>
                      <th className="py-2 text-right font-medium">Fill rate</th>
                      <th className="py-2 text-right font-medium">Cycle service</th>
                      <th className="py-2 text-right font-medium">Stockout days</th>
                      <th className="py-2 text-right font-medium">Avg stock</th>
                      <th className="py-2 text-right font-medium">Total cost</th>
                      <th className="py-2 text-right font-medium">vs baseline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.policies.map((p) => (
                      <tr key={p.key} className={`border-b border-line/60 ${p.key === "optimized" ? "bg-opt/[0.07]" : ""}`}>
                        <td className="py-2"><span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: POLICY_STYLE[p.key].color }} />{POLICY_STYLE[p.key].label}</span></td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{p.orderQuantity ? fmtInt(p.orderQuantity) : "varies"}</td>
                        <td className="tabular py-2 text-right font-mono">{fmtPct(p.metrics.fillRate)}</td>
                        <td className="tabular py-2 text-right font-mono">{fmtPct(p.metrics.cycleServiceLevel)}</td>
                        <td className="tabular py-2 text-right font-mono">{fmtPct(p.metrics.stockoutDayRate)}</td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{fmtInt(p.metrics.avgOnHand)}</td>
                        <td className="tabular py-2 text-right font-mono">{fmtInt(p.metrics.totalCost)}</td>
                        <td className={`tabular py-2 text-right font-mono ${base && p.metrics.totalCost < base.metrics.totalCost ? "text-safe" : "text-slate-500"}`}>
                          {p.key === "baseline" || !base ? "—" : fmtSignedPct(p.metrics.totalCost / base.metrics.totalCost - 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && base && best && asis && (
              <Insight>
                Over these {n} days the Bayesian-optimised policy lost {fmtPct(1 - best.metrics.fillRate)} of demand, against
                {" "}{fmtPct(1 - base.metrics.fillRate)} for the baseline calculator and {fmtPct(1 - asis.metrics.fillRate)} for the business's own ordering.
                It holds more stock ({fmtInt(best.metrics.avgOnHand)} vs {fmtInt(base.metrics.avgOnHand)} units on average) because each lost sale
                costs far more than keeping a unit for a few days — net, total cost is {fmtSignedPct(best.metrics.totalCost / base.metrics.totalCost - 1)} vs the baseline.
                {best.metrics.totalCost > base.metrics.totalCost && <> Here that insurance was not needed in this particular period, so it cost more;
                  across all 100 products the optimised policy was cheaper for 96. One period is one draw of luck — judge policies over many products or periods.</>}
              </Insight>
            )}
            <Note>As-is lost sales are counted only on days the recorded stock ran out (the dataset's demand and sales columns do not reconcile exactly on other days). Its cycle service cannot be measured without knowing its reorder rule.</Note>
          </Panel>
          <Panel index={2} title="Where the money goes" subtitle="Holding + ordering + lost-sales cost over the replay period.">
            {cost ? <EChart option={cost} height={260} ariaLabel="Cost breakdown by policy" /> : <Skeleton height={260} />}
            <Note>Priced with the cost settings on the Optimisation page (default: holding 25% of unit price per year, 50 per order,
              lost sale = 40% of unit price as lost margin). Unit price = the SKU's median recorded price.</Note>
          </Panel>
        </div>
      </div>
    </>
  );
}

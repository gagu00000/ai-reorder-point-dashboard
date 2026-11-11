/** Step 2 — Dynamic safety stock: the slide's formula, worked through, then stress-tested by Monte Carlo. */
import { useMemo, useState } from "react";
import { EChart, baseAxis, baseGrid, baseLegend, baseTooltip, type EChartOption } from "../components/charts/EChart";
import { ErrorNote, Insight, Note, Segmented, Skeleton, Slider } from "../components/ui/Controls";
import { PageGuide } from "../components/help/PageGuide";
import { Term } from "../components/help/Term";
import { Kpi } from "../components/ui/Kpi";
import { Panel, PageHeader } from "../components/ui/Panel";
import { COLORS } from "../app/theme";
import type { DesignView, SafetyStockResponse } from "../engine/inventoryService";
import { useSafetyStock } from "../hooks/useEngine";
import { fmt1, fmt2, fmtInt, fmtPct } from "../lib/format";
import { useAppStore } from "../state/store";

type Basis = "ai" | "baseline";

function FormulaCard({ d }: { d: SafetyStockResponse }) {
  const cols: { key: Basis; label: string; color: string; v: DesignView }[] = [
    { key: "baseline", label: "Baseline calculator", color: COLORS.baseline, v: d.baseline },
    { key: "ai", label: "AI-enhanced", color: COLORS.ai, v: d.ai },
  ];
  const rows: { label: string; unit: string; get: (v: DesignView) => string; strong?: boolean; note?: string }[] = [
    { label: "Z  (service-level factor)", unit: "", get: (v) => fmt2(v.formula.z), note: `Φ⁻¹(${fmtPct(d.baseline.formula.serviceLevel, 1)})` },
    { label: "D̄  (average demand)", unit: "units/day", get: (v) => fmt1(v.formula.dBar), note: "history mean vs forecast over the lead time" },
    { label: "σ_D  (demand std. dev.)", unit: "units/day", get: (v) => fmt1(v.formula.sigmaD), note: "raw history vs forecast errors" },
    { label: "L  (lead time)", unit: "days", get: (v) => fmt2(v.formula.leadTime) },
    { label: "σ_L  (lead-time variability)", unit: "days", get: (v) => fmt2(v.formula.sigmaL) },
    { label: "σ_D² · L", unit: "units²", get: (v) => fmtInt(v.formula.demandTerm) },
    { label: "D̄² · σ_L²", unit: "units²", get: (v) => fmtInt(v.formula.leadTimeTerm) },
    { label: "√( σ_D²·L + D̄²·σ_L² )", unit: "units", get: (v) => fmt1(v.formula.sigmaDdlt) },
    { label: "Safety stock = Z · √(…)", unit: "units", get: (v) => fmt1(v.formula.safetyStock), strong: true },
    { label: "Reorder point = D̄·L + SS", unit: "units", get: (v) => fmt1(v.formula.reorderPoint), strong: true },
  ];
  return (
    <div>
      <div className="mb-4 rounded-xl border border-line bg-ink-950/50 px-4 py-3 text-center font-mono text-[15px] text-slate-100 sm:text-lg">
        Safety Stock = Z · √( σ<sub>D</sub>² · L + D̄² · σ<sub>L</sub>² )
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="py-2 font-medium">Term</th>
              {cols.map((c) => <th key={c.key} className="py-2 text-right font-medium" style={{ color: c.color }}>{c.label}</th>)}
              <th className="py-2 pl-3 text-right font-medium">Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={`border-b border-line/50 ${r.strong ? "bg-ink-800/40" : ""}`}>
                <td className="py-1.5 pr-2">
                  <span className={`font-mono text-[13px] ${r.strong ? "font-semibold text-white" : "text-slate-300"}`}>{r.label}</span>
                  {r.note && <span className="block text-[11px] text-slate-500">{r.note}</span>}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`tabular py-1.5 text-right font-mono ${r.strong ? "font-semibold text-white" : "text-slate-300"}`}>{r.get(c.v)}</td>
                ))}
                <td className="py-1.5 pl-3 text-right text-xs text-slate-500">{r.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function decompositionOption(d: SafetyStockResponse): EChartOption {
  const cats = ["Baseline calculator", "AI-enhanced"];
  const views = [d.baseline, d.ai];
  return {
    grid: { left: 130, right: 24, top: 30, bottom: 26 },
    legend: { ...baseLegend, left: 0 },
    tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => `${fmtInt(v as number)} units²` },
    xAxis: { ...baseAxis(), type: "value", name: "variance of lead-time demand (units²)", nameLocation: "middle", nameGap: 22 },
    yAxis: { ...baseAxis({ splitLine: { show: false } }), type: "category", data: cats, axisLabel: { color: COLORS.muted } },
    series: [
      { name: "Demand uncertainty  σ_D²·L", type: "bar", stack: "v", barWidth: 18, data: views.map((v) => v.formula.demandTerm), itemStyle: { color: "#38bdf8" } },
      { name: "Lead-time uncertainty  D̄²·σ_L²", type: "bar", stack: "v", data: views.map((v) => v.formula.leadTimeTerm), itemStyle: { color: COLORS.opt, borderRadius: [0, 4, 4, 0] } },
    ],
  };
}

function leadTimeOption(d: SafetyStockResponse): EChartOption {
  const lt = d.leadTime;
  return {
    grid: { ...baseGrid, top: 34 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(3) : "") },
    xAxis: { ...baseAxis(), type: "value", name: "days", min: 0, max: Math.max(6, Math.ceil(lt.mean + 4 * lt.sd)) },
    yAxis: { ...baseAxis(), type: "value", name: "probability / density" },
    series: [
      { name: `Store ${lt.store} observed lead times`, type: "bar", barWidth: 18, itemStyle: { color: "rgba(148,163,184,0.35)", borderRadius: [3, 3, 0, 0] },
        data: lt.storePool.values.map((v, i) => [v, lt.storePool.probs[i]]) },
      ...(lt.kind === "gamma" ? [{ name: `Gamma model (L ${fmt2(lt.mean)}, σ_L ${fmt2(lt.sd)})`, type: "line", smooth: true, symbol: "none",
        lineStyle: { color: COLORS.opt, width: 2 }, itemStyle: { color: COLORS.opt }, areaStyle: { color: COLORS.optSoft },
        data: lt.density.map((p) => [p.x, p.y]) }] : []),
    ],
  };
}

function histogramOption(v: DesignView, color: string): EChartOption {
  const formulaRop = v.formula.reorderPoint;
  const mcRop = v.monteCarlo.reorderPoint;
  const mid = v.histogram.map((b) => (b.x0 + b.x1) / 2);
  // Normal approximation implied by the formula (same mean and sd)
  const mu = v.formula.expectedDdlt, s = v.formula.sigmaDdlt;
  const normal = mid.map((x) => [x, s > 0 ? Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)) : 0]);
  return {
    grid: { ...baseGrid, top: 40 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (val: unknown) => (typeof val === "number" ? val.toExponential(2) : "") },
    xAxis: { ...baseAxis(), type: "value", name: "units demanded during one lead time", nameLocation: "middle", nameGap: 24, scale: true },
    yAxis: { ...baseAxis(), type: "value", name: "density", axisLabel: { show: false } },
    series: [
      { name: "Monte Carlo simulation", type: "bar", barWidth: "100%", barGap: "-100%", large: true,
        data: v.histogram.map((b, i) => ({ value: [mid[i], b.density], itemStyle: { color: mid[i] > mcRop ? COLORS.risk : color, opacity: mid[i] > mcRop ? 0.85 : 0.55 } })),
        markLine: {
          symbol: "none", silent: true, label: { color: COLORS.text, fontSize: 10, formatter: "{b}" },
          data: [
            { name: `Formula ROP ${fmtInt(formulaRop)}`, xAxis: formulaRop, lineStyle: { color: COLORS.baseline, type: "dashed", width: 1.5 }, label: { position: "insideEndTop" } },
            { name: `Monte Carlo ROP ${fmtInt(mcRop)}`, xAxis: mcRop, lineStyle: { color: COLORS.safe, width: 2 }, label: { position: "insideEndBottom" } },
          ],
        } },
      { name: "Normal curve the formula assumes", type: "line", smooth: true, symbol: "none", data: normal, lineStyle: { color: COLORS.text, type: "dashed", width: 1.2, opacity: 0.7 }, itemStyle: { color: COLORS.text } },
    ],
  };
}

export default function SafetyStock() {
  const { serviceLevel, setServiceLevel, leadTime, setLeadTime, mcTrials, setMcTrials, skuId } = useAppStore();
  const { data, loading, error } = useSafetyStock();
  const [basis, setBasis] = useState<Basis>("ai");
  const view = data ? data[basis] : null;
  const hist = useMemo(() => (view ? histogramOption(view, basis === "ai" ? COLORS.ai : COLORS.baseline) : null), [view, basis]);
  const decomposition = useMemo(() => (data ? decompositionOption(data) : null), [data]);
  const ltChart = useMemo(() => (data ? leadTimeOption(data) : null), [data]);

  const L = leadTime.mean ?? data?.leadTime.dataMean ?? 2;
  const sdL = leadTime.sd ?? data?.leadTime.dataSd ?? 1;
  const gap = view ? view.monteCarlo.safetyStock - view.formula.safetyStock : Number.NaN;

  return (
    <>
      <PageHeader eyebrow="Step 2 · Adaptive decision-making" title="Dynamic Safety Stock & Monte Carlo">
        The slide's formula sizes the buffer from demand variability <i>and</i> lead-time uncertainty. The AI version feeds it the forecast
        (D̄) and the forecast's own errors (σ_D). Monte Carlo then simulates thousands of lead-time scenarios to check the formula's Normal assumption.
      </PageHeader>
      <PageGuide page="safety" />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Panel index={0} title="Inputs" subtitle="Shared across the dashboard." className="lg:row-span-2 self-start">
          <div className="space-y-5">
            <Slider label="Target cycle service level" value={serviceLevel} min={0.8} max={0.995} step={0.005}
              format={(v) => fmtPct(v, 1)} onChange={setServiceLevel}
              hint="Probability of not running out between placing an order and receiving it." />
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-300">Lead-time model</p>
              <Segmented label="Lead-time model" value={leadTime.model} onChange={(m) => setLeadTime({ model: m })}
                options={[{ value: "gamma", label: "Gamma (SKU L, store σ_L)" }, { value: "empirical", label: "Store's observed pool" }]} size="xs" />
            </div>
            {leadTime.model === "gamma" && (
              <>
                <Slider label="Lead time L" value={L} min={0.5} max={10} step={0.25} format={(v) => `${fmt2(v)} days`}
                  onChange={(v) => setLeadTime({ mean: v })}
                  hint={data ? `From the inventory ledger: ${fmt2(data.leadTime.dataMean)} days for this SKU.` : undefined} />
                <Slider label="Lead-time variability σ_L" value={sdL} min={0} max={4} step={0.05} format={(v) => `${fmt2(v)} days`}
                  onChange={(v) => setLeadTime({ sd: v })}
                  hint={data ? `Store ${data.leadTime.store} supplier lanes: ${fmt2(data.leadTime.dataSd)} days (documented assumption).` : undefined} />
                {(leadTime.mean !== null || leadTime.sd !== null) && (
                  <button type="button" className="text-xs text-ai hover:underline" onClick={() => setLeadTime({ mean: null, sd: null })}>
                    Reset to data values
                  </button>
                )}
              </>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-300">Monte Carlo trials</p>
              <Segmented label="Monte Carlo trials" value={String(mcTrials)} onChange={(v) => setMcTrials(Number(v))}
                options={[{ value: "5000", label: "5k" }, { value: "20000", label: "20k" }, { value: "50000", label: "50k" }]} size="xs" />
            </div>
          </div>
        </Panel>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi index={0} label={<Term id="safetyStock">Formula safety stock</Term>} tone="baseline" value={view?.formula.safetyStock} format={fmtInt}
            hint={`${basis === "ai" ? "AI-enhanced" : "Baseline"} inputs, units`} />
          <Kpi index={1} label={<Term id="monteCarlo">Monte Carlo safety stock</Term>} tone="safe" value={view?.monteCarlo.safetyStock} format={fmtInt}
            hint={view ? `${gap >= 0 ? "+" : "−"}${fmtInt(Math.abs(gap))} units vs formula` : undefined} />
          <Kpi index={2} label={<Term id="ddlt">Stockout risk at formula ROP</Term>} tone="risk" value={view?.monteCarlo.formulaStockoutProbability} format={(v) => fmtPct(v, 1)}
            hint={`Target: ${fmtPct(1 - serviceLevel, 1)} per cycle`} />
          <Kpi index={3} label={<Term id="sigmaL">Lead-time share of risk</Term>} tone="opt" value={view?.formula.leadTimeShare} format={(v) => fmtPct(v, 0)}
            hint="Share of the variance caused by uncertain lead times" />
        </div>

        <Panel index={1} busy={loading} pulseKey={data ? `${data.skuId}|${data.origin}` : undefined} title={`Demand during lead time · ${skuId}`}
          subtitle={view ? `${fmtInt(view.monteCarlo.trials)} simulated lead times. Red bars: scenarios that run out even at the Monte Carlo reorder point. Skewness ${fmt2(view.monteCarlo.skewness)} (a Normal curve has 0).` : undefined}
          actions={<Segmented label="Design" value={basis} onChange={setBasis}
            options={[{ value: "ai", label: "AI-enhanced" }, { value: "baseline", label: "Baseline" }]} />}>
          {error && <ErrorNote message={error} />}
          {hist ? <EChart option={hist} height={320} ariaLabel="Monte Carlo distribution of demand during lead time with reorder points" /> : <Skeleton height={320} />}
          {view && (
            <Insight>
              The formula assumes demand during the lead time follows the dashed Normal curve and sets the reorder point at
              {" "}<b className="text-baseline">{fmtInt(view.formula.reorderPoint)} units</b>. The simulation shows the real distribution is
              {view.monteCarlo.skewness > 0.3 ? " skewed to the right — occasional long deliveries create a fat tail —" : " close to symmetric"}, so that
              reorder point runs out in <b className="text-risk">{fmtPct(view.monteCarlo.formulaStockoutProbability, 1)}</b> of cycles instead of the
              {" "}{fmtPct(1 - serviceLevel, 1)} you asked for. Ordering at <b className="text-safe">{fmtInt(view.monteCarlo.reorderPoint)} units</b> restores
              the target: {gap >= 0 ? `${fmtInt(gap)} extra units` : `${fmtInt(-gap)} fewer units`} of safety stock.
            </Insight>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel index={2} title="The slide's formula, worked through" subtitle="Every term with today's numbers. Units: demand in units/day, lead time in days.">
          {data ? <FormulaCard d={data} /> : <Skeleton height={380} />}
          {data && (
            <Insight>
              Forecasting shrinks demand uncertainty from σ_D = {fmt1(data.historicalSd)} (raw history) to {fmt1(data.forecastErrorSd)} units/day
              (what the forecast still gets wrong), because promotions, epidemics and weather are no longer "surprises". The lead-time term is
              unaffected by forecasting — for this SKU it is {fmtPct(data.ai.formula.leadTimeShare, 0)} of the risk, so supplier reliability matters as much as demand.
            </Insight>
          )}
        </Panel>
        <div className="grid gap-4">
          <Panel index={3} title="Where the risk comes from" subtitle="Variance of demand during the lead time, split into its two sources.">
            {decomposition ? <EChart option={decomposition} height={170} ariaLabel="Variance decomposition into demand and lead-time uncertainty" /> : <Skeleton height={170} />}
          </Panel>
          <Panel index={4} title="Lead-time distribution"
            subtitle="Bars: lead times recovered from the store's inventory ledger (99.8% of orders matched to receipts). Curve: the model used in the simulation.">
            {ltChart ? <EChart option={ltChart} height={220} ariaLabel="Observed and modelled supplier lead times" /> : <Skeleton height={220} />}
            <Note>Each SKU has a fixed lead time in this dataset, so σ_L is taken from its store's supplier lanes. This is a stated assumption; use the slider to test other values.</Note>
          </Panel>
        </div>
      </div>
    </>
  );
}

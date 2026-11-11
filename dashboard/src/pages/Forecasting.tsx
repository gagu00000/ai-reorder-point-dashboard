/** Step 1 — Demand forecasting: models, uncertainty bands, drivers, and measured accuracy. */
import { useMemo, useState } from "react";
import { EChart, baseAxis, baseGrid, baseLegend, baseTooltip, type EChartOption } from "../components/charts/EChart";
import { AddDataPanel } from "../components/data/AddDataPanel";
import { LiveAccuracy } from "../components/data/LiveAccuracy";
import { Chip, ErrorNote, Insight, Note, Segmented, Skeleton, Toggle } from "../components/ui/Controls";
import { Panel, PageHeader } from "../components/ui/Panel";
import { MODEL_CONFIG_NAME, type ForecastResponse, type ModelKey } from "../engine/forecastService";
import { COLORS, MODEL_STYLE } from "../app/theme";
import { useCatalog, useForecast } from "../hooks/useEngine";
import { fmt1, fmtDate, fmtInt, fmtPct, fmtSignedPct } from "../lib/format";
import { useAppStore } from "../state/store";

const ORDER: ModelKey[] = ["ridge", "lstm", "ensemble", "ets", "baseline"];

function spans(flags: number[], dates: string[]): [string, string][] {
  const out: [string, string][] = [];
  let start = -1;
  flags.forEach((f, i) => {
    if (f && start < 0) start = i;
    if ((!f || i === flags.length - 1) && start >= 0) {
      out.push([dates[start], dates[f ? i : i - 1]]);
      start = -1;
    }
  });
  return out;
}

function forecastOption(d: ForecastResponse, shown: Record<ModelKey, boolean>, bandModel: ModelKey, reveal: boolean): EChartOption {
  const n = d.dates.length;
  const o = d.origin - d.historyStart; // index of the origin in the window
  const future = (vals: number[] | undefined, withOrigin: boolean) =>
    Array.from({ length: n }, (_, i) => (i > o && vals ? vals[i - o - 1] : i === o && withOrigin ? d.actual[o] : "-"));
  const series: Record<string, unknown>[] = [];
  const band = d.bands[bandModel];
  if (band && shown[bandModel]) {
    const lo95 = future(band.lower95, false), hi95 = future(band.upper95, false);
    const lo80 = future(band.lower80, false), hi80 = future(band.upper80, false);
    const diff = (a: unknown[], b: unknown[]) => a.map((v, i) => (v === "-" ? "-" : (v as number) - (b[i] as number)));
    const style = { lineStyle: { opacity: 0 }, symbol: "none", silent: true, tooltip: { show: false } };
    series.push({ name: "95% band", type: "line", stack: "b95", data: lo95, ...style });
    series.push({ name: "95% band", type: "line", stack: "b95", data: diff(hi95, lo95), areaStyle: { color: "rgba(34,211,238,0.08)" }, ...style });
    series.push({ name: "80% band", type: "line", stack: "b80", data: lo80, ...style });
    series.push({ name: "80% band", type: "line", stack: "b80", data: diff(hi80, lo80), areaStyle: { color: "rgba(34,211,238,0.16)" }, ...style });
  }
  series.push({
    name: "Actual demand", type: "line", data: d.actual.map((v) => v ?? "-"), symbol: "none",
    lineStyle: { color: COLORS.actual, width: 1.4 }, itemStyle: { color: COLORS.actual },
    markArea: { silent: true, itemStyle: { color: COLORS.riskSoft }, data: spans(d.epidemic, d.dates).map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) },
    markLine: {
      silent: true, symbol: "none", lineStyle: { color: "rgba(226,232,240,0.35)", type: "dashed" },
      label: { formatter: "Forecast origin", color: COLORS.muted, fontSize: 10, position: "insideEndTop" },
      data: [{ xAxis: d.dates[o] }],
    },
  });
  if (reveal) {
    series.push({
      name: "Recorded outcome (unseen)", type: "line", data: d.futureActual.map((v) => v ?? "-"),
      symbol: "circle", symbolSize: 5, lineStyle: { color: COLORS.actual, width: 1, type: "dotted" }, itemStyle: { color: COLORS.actual },
    });
  }
  for (const k of ORDER) {
    if (!shown[k] || !d.forecasts[k]) continue;
    const st = MODEL_STYLE[k];
    series.push({
      name: st.label, type: "line", data: future(d.forecasts[k], true), symbol: "none", smooth: false,
      lineStyle: { color: st.color, width: k === "ridge" ? 2.4 : 1.6, type: st.dash }, itemStyle: { color: st.color }, z: k === "ridge" ? 5 : 4,
    });
  }
  series.push({
    name: "Promotion day", type: "scatter", symbol: "triangle", symbolSize: 6, itemStyle: { color: "rgba(52,211,153,0.7)" },
    data: d.promotion.map((p) => (p ? 0 : "-")), tooltip: { show: false },
  });
  return {
    grid: { ...baseGrid, top: 44 },
    legend: { ...baseLegend, data: series.map((s) => s.name as string).filter((v, i, a) => !v.includes("band") && a.indexOf(v) === i) },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmt1(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: d.dates, boundaryGap: false,
      axisLabel: { color: COLORS.faint, fontSize: 11, formatter: (v: string) => fmtDate(v, { day: "numeric", month: "short" }) } },
    yAxis: { ...baseAxis(), type: "value", name: "units/day", min: 0 },
    dataZoom: [{ type: "inside", start: 0, end: 100, zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false }],
    series,
  };
}

function driverOption(d: ForecastResponse): EChartOption {
  const rows = [...d.drivers].sort((a, b) => a.relative - b.relative);
  return {
    grid: { left: 150, right: 60, top: 8, bottom: 24 },
    tooltip: { ...baseTooltip, trigger: "item", formatter: (p: { dataIndex: number }) => {
      const r = rows[p.dataIndex];
      return `${r.label}<br/><b>${fmtSignedPct(r.relative)}</b> (${r.unitsPerDay >= 0 ? "+" : "−"}${fmt1(Math.abs(r.unitsPerDay))} units/day)`;
    } },
    xAxis: { ...baseAxis(), type: "value", axisLabel: { color: COLORS.faint, formatter: (v: number) => fmtSignedPct(v, 0) } },
    yAxis: { ...baseAxis({ splitLine: { show: false } }), type: "category", data: rows.map((r) => r.label), axisLabel: { color: COLORS.muted, fontSize: 11 } },
    series: [{
      type: "bar", barWidth: 14, data: rows.map((r) => ({
        value: r.relative,
        itemStyle: { color: r.relative >= 0 ? COLORS.ai : COLORS.risk, borderRadius: r.relative >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
      })),
      label: { show: true, position: "right", color: COLORS.muted, fontSize: 11, formatter: (p: { value: number }) => fmtSignedPct(p.value, 0) },
    }],
  };
}

function lossOption(loss: number[], val: number[], best: number): EChartOption {
  return {
    grid: { left: 44, right: 12, top: 30, bottom: 30 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(4) : "") },
    xAxis: { ...baseAxis(), type: "category", data: loss.map((_, i) => i + 1), name: "epoch", nameLocation: "middle", nameGap: 22 },
    yAxis: { ...baseAxis(), type: "value", scale: true },
    series: [
      { name: "training loss", type: "line", data: loss, symbol: "none", lineStyle: { color: COLORS.faint } , itemStyle: { color: COLORS.faint } },
      { name: "early-stopping loss", type: "line", data: val, symbol: "circle", symbolSize: 4, lineStyle: { color: MODEL_STYLE.lstm.color }, itemStyle: { color: MODEL_STYLE.lstm.color },
        markPoint: { symbol: "pin", symbolSize: 34, itemStyle: { color: COLORS.opt }, label: { fontSize: 9, formatter: "best" }, data: [{ coord: [best - 1, val[best - 1]] }] } },
    ],
  };
}

export default function Forecasting() {
  const [historyDays, setHistoryDays] = useState("120");
  const [shown, setShown] = useState<Record<ModelKey, boolean>>({ ridge: true, lstm: true, ensemble: false, ets: false, baseline: true });
  const [bandModel, setBandModel] = useState<ModelKey>("ridge");
  const [reveal, setReveal] = useState(true);
  const [boardSet, setBoardSet] = useState<"holdout" | "validation">("holdout");
  const [horizon, setHorizon] = useState<"h1" | "h7" | "h14">("h1");
  const { data, loading, error } = useForecast(Number(historyDays));
  const catalog = useCatalog().data;
  const skuId = useAppStore((s) => s.skuId);

  const option = useMemo(() => (data ? forecastOption(data, shown, bandModel, reveal) : null), [data, shown, bandModel, reveal]);
  const drivers = useMemo(() => (data ? driverOption(data) : null), [data]);
  const loss = useMemo(() => (catalog ? lossOption(catalog.models.lstm.loss, catalog.models.lstm.valLoss, catalog.models.lstm.bestEpoch) : null), [catalog]);

  const board = catalog?.models.backtest[boardSet].leaderboard[horizon];
  const baselineWape = board?.["Static mean (baseline)"]?.WAPE ?? Number.NaN;
  const rows = board ? Object.entries(board).sort((a, b) => a[1].WAPE - b[1].WAPE) : [];

  const nextAvg = data?.forecasts.ridge ? data.forecasts.ridge.reduce((a, b) => a + b, 0) / data.forecasts.ridge.length : Number.NaN;
  const promo = data?.drivers.find((x) => x.feature === "promotion");
  const epi = data?.drivers.find((x) => x.feature === "epidemic");
  const holdout = catalog?.models.backtest.holdout.leaderboard.h1;

  return (
    <>
      <PageHeader eyebrow="Step 1 · Predictive intelligence" title="Demand Forecasting">
        Time-series (exponential smoothing), regression (ridge) and deep-learning (LSTM) models forecast the next 14 days
        from history, seasonality, promotions, weather and epidemic periods. Price columns are excluded: the audit showed they are
        computed from same-day demand and would leak the answer.
      </PageHeader>

      <div className="mb-4">
        <AddDataPanel index={0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-3" index={0} busy={loading} pulseKey={data ? `${data.skuId}|${data.origin}` : undefined}
          title={`14-day forecast · ${skuId}`}
          subtitle={`Shaded red: epidemic periods (the future assumes today's status persists). Green triangles: promotion days. Bands: conformal intervals from past forecast errors${data ? `, scaled ×${data.bandScale.toFixed(2)} to this product's errors over the last 90 days` : ""}.`}
          actions={<>
            <Segmented label="History window" value={historyDays} onChange={setHistoryDays}
              options={[{ value: "60", label: "60 d" }, { value: "120", label: "120 d" }, { value: "365", label: "1 y" }]} />
            <Toggle checked={reveal} onChange={setReveal} label="Show unseen outcome" />
          </>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {ORDER.map((k) => (
              <Chip key={k} active={shown[k]} color={MODEL_STYLE[k].color} onClick={() => setShown((s) => ({ ...s, [k]: !s[k] }))}>
                {MODEL_STYLE[k].label}
              </Chip>
            ))}
            <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              Bands for
              <select value={bandModel} onChange={(e) => setBandModel(e.target.value as ModelKey)}
                className="rounded-md border border-line bg-ink-950/70 px-2 py-1 text-xs text-slate-200" aria-label="Model for prediction bands">
                {ORDER.map((k) => <option key={k} value={k} className="bg-ink-900">{MODEL_STYLE[k].label}</option>)}
              </select>
            </span>
          </div>
          {error && <ErrorNote message={error} />}
          {option ? <EChart option={option} height={380} ariaLabel="Demand history, forecasts and prediction bands" /> : <Skeleton height={380} />}
          {data && (
            <Insight>
              For <b className="text-white">{data.skuId}</b> the AI forecast expects about <b className="text-ai">{fmtInt(nextAvg)} units/day</b> over
              the next two weeks, {nextAvg >= data.averageDemand ? "above" : "below"} the long-run average of {fmtInt(data.averageDemand)}.
              {promo && epi && <> For this product a promotion adds about <b className="text-white">{fmtSignedPct(promo.relative, 0)}</b> and an
              epidemic period changes demand by <b className="text-white">{fmtSignedPct(epi.relative, 0)}</b>, so planned promotions should raise the reorder point
              and an epidemic should lower it.</>}
              {holdout && <> Across all 100 products on unseen data, the ridge model cut next-day error from
              {" "}{fmtPct(holdout["Static mean (baseline)"].WAPE)} to {fmtPct(holdout.Ridge.WAPE)} (WAPE) — the static average a classic calculator uses
              is the least accurate input you could give it.</>}
            </Insight>
          )}
        </Panel>

        <div className="xl:col-span-3">
          <LiveAccuracy index={1} />
        </div>

        <Panel className="xl:col-span-2" index={1}
          title="Model leaderboard (all 100 SKUs, offline backtests)"
          subtitle="Rolling-origin backtests from the notebook: models refit at each origin, forecasts scored on days they had not seen. WAPE = total absolute error ÷ total demand."
          actions={<>
            <Segmented label="Evaluation set" value={boardSet} onChange={setBoardSet}
              options={[{ value: "holdout", label: "Holdout" }, { value: "validation", label: "Validation" }]} />
            <Segmented label="Horizon" value={horizon} onChange={setHorizon}
              options={[{ value: "h1", label: "1 day" }, { value: "h7", label: "≤ 7 days" }, { value: "h14", label: "≤ 14 days" }]} />
          </>}>
          {rows.length === 0 ? <Skeleton height={240} /> : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 font-medium">Model</th>
                    <th className="py-2 text-right font-medium">WAPE</th>
                    <th className="py-2 text-right font-medium">MAE</th>
                    <th className="py-2 text-right font-medium">RMSE</th>
                    <th className="py-2 text-right font-medium">MASE</th>
                    <th className="py-2 text-right font-medium">Bias</th>
                    <th className="py-2 text-right font-medium">vs baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([name, m], i) => {
                    const key = (Object.keys(MODEL_CONFIG_NAME) as ModelKey[]).find((k) => MODEL_CONFIG_NAME[k] === name);
                    const color = key ? MODEL_STYLE[key].color : COLORS.muted;
                    return (
                      <tr key={name} className={`border-b border-line/60 ${i === 0 ? "bg-ai/[0.06]" : ""}`}>
                        <td className="py-2"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{name}</span></td>
                        <td className="tabular py-2 text-right font-mono">{fmtPct(m.WAPE)}</td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{fmt1(m.MAE)}</td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{fmt1(m.RMSE)}</td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{m.MASE.toFixed(3)}</td>
                        <td className="tabular py-2 text-right font-mono text-slate-400">{fmtSignedPct(m.Bias)}</td>
                        <td className={`tabular py-2 text-right font-mono ${m.WAPE < baselineWape ? "text-safe" : "text-slate-500"}`}>
                          {name === "Static mean (baseline)" ? "—" : fmtSignedPct(m.WAPE / baselineWape - 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Note>MASE below 1 beats yesterday's demand as a forecast. Bias above zero means over-forecasting. Holdout = 2 Dec 2023 – 30 Jan 2024,
            never used for tuning; it contains the December peak and the epidemic that starts on 27 December. Significance (Diebold–Mariano test,
            next-day squared error, validation, notebook 02): ridge beats the ensemble (DM = −4.88, p &lt; 0.001) and the static mean (DM = −13.5, p &lt; 0.001).</Note>
        </Panel>

        <Panel index={2} title="What drives demand for this SKU" subtitle="Ridge regression effects, holding everything else fixed (fitted on data up to the planning date).">
          {drivers ? <EChart option={drivers} height={210} ariaLabel="Effect of each demand driver" /> : <Skeleton height={210} />}
          <Note>Day-of-week and price are not drivers: the audit found no weekday pattern, and price is generated from demand (leakage).</Note>
        </Panel>

        <Panel className="xl:col-span-3" index={3} title="How the LSTM was trained"
          subtitle={catalog ? `One global network for all 100 SKUs, trained offline on data through ${fmtDate(catalog.dates[catalog.models.lstm.trainedThroughIdx])}; early stopping on the last 60 training days. Its weights are loaded into TensorFlow.js in a background worker.` : undefined}>
          <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
            {loss ? <EChart option={loss} height={200} ariaLabel="LSTM training and early-stopping loss by epoch" /> : <Skeleton height={200} />}
            <div className="space-y-2 text-[13px] leading-relaxed text-slate-400">
              <p><b className="text-slate-200">Input:</b> the last 28 days of demand (scaled by each SKU's average) plus promotion, epidemic, weather and
                seasonality, and the same drivers for the 14 days ahead.</p>
              <p><b className="text-slate-200">Output:</b> 14 daily forecasts at once. The network stopped improving after
                {" "}{catalog?.models.lstm.bestEpoch ?? "–"} epochs — the per-SKU signal is noisy, so a larger model would mostly memorise noise.</p>
              <p><b className="text-slate-200">Result:</b> close to ridge regression (holdout WAPE {holdout ? fmtPct(holdout.LSTM.WAPE) : "–"} vs
                {" "}{holdout ? fmtPct(holdout.Ridge.WAPE) : "–"}), which is why the planner uses ridge, with the LSTM available for comparison and the ensemble.</p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * "Continuously update forecasts as new data arrives, improving accuracy and responsiveness":
 * out-of-sample next-day error of every model on each arriving day, and a log of what changed.
 */
import { AlertTriangle, BrainCircuit, CalendarPlus, FileUp, History, RotateCcw, SkipForward } from "lucide-react";
import { useMemo } from "react";
import { COLORS, MODEL_STYLE } from "../../app/theme";
import type { DayScore, ModelKey } from "../../engine/forecastService";
import { fmtDate, fmtPct } from "../../lib/format";
import { useAppStore, type LogEntry } from "../../state/store";
import { EChart, baseAxis, baseGrid, baseLegend, baseTooltip, type EChartOption } from "../charts/EChart";
import { Insight } from "../ui/Controls";
import { Panel } from "../ui/Panel";

const ORDER: ModelKey[] = ["ridge", "lstm", "ensemble", "ets", "baseline"];
const ICON: Record<LogEntry["kind"], typeof History> = {
  stream: SkipForward, manual: CalendarPlus, csv: FileUp, finetune: BrainCircuit, reset: RotateCcw, restore: History, error: AlertTriangle,
};

function cumulative(scores: DayScore[], k: ModelKey): (number | string)[] {
  let e = 0, y = 0;
  return scores.map((s) => {
    const m = s.models[k];
    if (!m) return "-";
    e += m.absError;
    y += m.actual;
    return y > 0 ? e / y : "-";
  });
}

function accuracyOption(scores: DayScore[]): EChartOption {
  const dates = scores.map((s) => s.date);
  return {
    grid: { ...baseGrid, top: 44, right: 16 },
    legend: { ...baseLegend },
    tooltip: { ...baseTooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? fmtPct(v) : "—") },
    xAxis: { ...baseAxis(), type: "category", data: dates, axisLabel: { color: COLORS.faint, fontSize: 11, formatter: (v: string) => fmtDate(v, { day: "numeric", month: "short" }) } },
    yAxis: { ...baseAxis(), type: "value", name: "WAPE (next day)", axisLabel: { color: COLORS.faint, formatter: (v: number) => fmtPct(v, 0) }, min: 0 },
    series: [
      { name: "Ridge — that day", type: "bar", barWidth: "55%", itemStyle: { color: "rgba(34,211,238,0.18)" },
        data: scores.map((s) => (s.models.ridge ? s.models.ridge.absError / s.models.ridge.actual : "-")) },
      ...ORDER.filter((k) => scores.some((s) => s.models[k])).map((k) => ({
        name: `${MODEL_STYLE[k].label} — running`, type: "line", symbol: "none", data: cumulative(scores, k),
        lineStyle: { color: MODEL_STYLE[k].color, width: k === "ridge" ? 2.4 : 1.5, type: MODEL_STYLE[k].dash }, itemStyle: { color: MODEL_STYLE[k].color },
      })),
    ],
  };
}

function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function LiveAccuracy({ index = 0 }: { index?: number }) {
  const { scores, log, lstm } = useAppStore();
  const option = useMemo(() => (scores.length ? accuracyOption(scores) : null), [scores]);
  const total = (k: ModelKey) => {
    const e = scores.reduce((a, s) => a + (s.models[k]?.absError ?? 0), 0);
    const y = scores.reduce((a, s) => a + (s.models[k]?.actual ?? 0), 0);
    return y > 0 ? e / y : Number.NaN;
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
      <Panel index={index} title="Accuracy as new data arrives"
        subtitle="Each arriving day is forecast by every model from the data before it — for all 100 products — and scored before the models learn from it.">
        {option ? <EChart option={option} height={280} ariaLabel="Next-day forecast error per model on each arriving day" />
          : <p className="flex h-[200px] items-center justify-center px-6 text-center text-sm text-slate-500">
              No new data yet. Stream a recorded day, enter one, or upload a CSV above — each model's accuracy on it appears here.
            </p>}
        {scores.length > 0 && (
          <Insight>
            Over the {scores.length} day{scores.length === 1 ? "" : "s"} added so far, the ridge model's next-day error is
            {" "}<b className="text-ai">{fmtPct(total("ridge"))}</b> against <b className="text-baseline">{fmtPct(total("baseline"))}</b> for the static average.
            {lstm.available && <> The LSTM ({fmtPct(total("lstm"))}) has been fine-tuned {lstm.version} time{lstm.version === 1 ? "" : "s"} on the new days.</>}
            {" "}Watch the bars: a sudden jump (e.g. when an epidemic starts) is the forecast being surprised; the running lines show how quickly each model recovers.
          </Insight>
        )}
      </Panel>
      <Panel index={index + 1} title="Update log"
        subtitle={lstm.available ? `LSTM v${lstm.version} on ${lstm.backend}${lstm.tuning ? " · fine-tuning…" : ""}` : "LSTM unavailable in this browser — the other models still update."}>
        {log.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Nothing yet.</p> : (
          <ol className="scrollbar-thin max-h-[330px] space-y-2 overflow-y-auto pr-1" aria-label="Update log">
            {log.map((e) => {
              const Icon = ICON[e.kind];
              return (
                <li key={`${e.at}-${e.message}`} className="flex gap-3 rounded-lg border border-line/70 bg-ink-950/40 p-2.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${e.kind === "finetune" ? "text-opt" : e.kind === "reset" || e.kind === "error" ? "text-risk" : "text-ai"}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[12.5px] leading-relaxed text-slate-300">{e.message}</p>
                    <p className="text-[11px] text-slate-500">{ago(e.at)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}

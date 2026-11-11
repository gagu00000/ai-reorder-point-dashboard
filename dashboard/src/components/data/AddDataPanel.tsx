/**
 * "Keep the possibility of adding new data": reveal recorded days, enter a day by hand, or append a CSV.
 * Every path goes through the same timeline: score the models on the new day(s), then move the
 * planning date forward so every forecast, buffer and plan recomputes.
 */
import { CalendarPlus, Download, FastForward, FileUp, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { forecastWorker } from "../../engine/client";
import { useCatalog } from "../../hooks/useEngine";
import { csvTemplate, CSV_COLUMNS, MAX_CSV_BYTES } from "../../lib/data/csvImport";
import { WEATHER_CODES, type WeatherCode } from "../../lib/data/types";
import type { UserRow, ValidationResult } from "../../lib/data/userData";
import { fmtDate, fmtInt } from "../../lib/format";
import { useAppStore } from "../../state/store";
import { advance, resetTimeline, startStreaming, stopStreaming } from "../../state/timeline";
import { Button, NumberField, Segmented, Toggle } from "../ui/Controls";
import { BusyDot, Panel } from "../ui/Panel";

type Tab = "stream" | "enter" | "csv";

function Messages({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-baseline/30 bg-baseline/10 p-3 text-xs text-baseline">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

function StreamTab({ unseen, nextDate, lastRecorded }: { unseen: number; nextDate: string | null; lastRecorded: number }) {
  const { busy, streaming, observedUntil } = useAppStore();
  const disabled = Boolean(busy) || unseen <= 0;
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-slate-400">
        Reveal the recorded days that the planner has not seen yet, as if they were arriving live. Each day is first used to
        score every model's forecast for it, then learnt from.
        {unseen > 0 && nextDate ? <> Next: <b className="text-slate-200">{fmtDate(nextDate)}</b> · {unseen} unseen day{unseen === 1 ? "" : "s"} left.</> : " All recorded days have been revealed."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void advance({ source: "stream" })} disabled={disabled || streaming} icon={<SkipForward className="h-4 w-4" />}>Next day</Button>
        <Button variant="ghost" onClick={() => void advance({ source: "stream", lastDay: Math.min(lastRecorded, observedUntil + 7) })}
          disabled={disabled || streaming} icon={<FastForward className="h-4 w-4" />}>Next 7 days</Button>
        <Button variant="ghost" onClick={() => (streaming ? stopStreaming() : startStreaming())} disabled={unseen <= 0 && !streaming}
          icon={streaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}>{streaming ? "Pause" : "Auto-stream"}</Button>
      </div>
    </div>
  );
}

function EnterTab({ nextDay, nextDate, beyondData }: { nextDay: number; nextDate: string | null; beyondData: boolean }) {
  const { skuId, busy, observedUntil, streaming } = useAppStore();
  const [form, setForm] = useState<{ demand: number; promotion: boolean; weather: WeatherCode; epidemic: boolean; unitsSold: number; inventory: number; unitsOrdered: number } | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);

  useEffect(() => {
    let live = true;
    setResult(null);
    forecastWorker().recordedDay(skuId, nextDay).then((r) => {
      if (!live) return;
      setForm(r ? { demand: r.demand, promotion: r.promotion === 1, weather: r.weather, epidemic: r.epidemic === 1, unitsSold: r.unitsSold, inventory: r.inventory, unitsOrdered: r.unitsOrdered }
        : { demand: 0, promotion: false, weather: "Cloudy", epidemic: false, unitsSold: Number.NaN, inventory: Number.NaN, unitsOrdered: Number.NaN });
    });
    return () => { live = false; };
  }, [skuId, nextDay]);

  if (beyondData) {
    return (
      <p className="text-[13px] leading-relaxed text-slate-400">
        {nextDate ? fmtDate(nextDate) : "The next day"} is after the recorded data. A single-product entry would leave the other 99 products with
        no demand that day, and values are never invented — use <b className="text-slate-200">Upload CSV</b> with a row for every product instead.
      </p>
    );
  }
  if (!form || !nextDate) return <p className="text-sm text-slate-500">Loading the recorded values…</p>;

  const submit = async () => {
    const row: UserRow = {
      date: nextDate, skuId, demand: form.demand, promotion: form.promotion ? 1 : 0, weather: form.weather, epidemic: form.epidemic ? 1 : 0,
      ...(Number.isFinite(form.unitsSold) ? { unitsSold: form.unitsSold } : {}),
      ...(Number.isFinite(form.inventory) ? { inventory: form.inventory } : {}),
      ...(Number.isFinite(form.unitsOrdered) ? { unitsOrdered: form.unitsOrdered } : {}),
    };
    const v = await forecastWorker().validateRows([row], observedUntil);
    setResult(v);
    if (!v.errors.length && v.lastDay !== null) await advance({ rows: v.rows, lastDay: v.lastDay, source: "manual" });
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-slate-400">
        Enter what actually happened on <b className="text-slate-200">{fmtDate(nextDate)}</b> for <b className="text-slate-200">{skuId}</b>. The form starts
        from the recorded values; anything you change replaces them. The other products use their recorded values for that day.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField label="Demand (units)" value={form.demand} min={0} step={1} onChange={(v) => setForm({ ...form, demand: v })} />
        <div className="space-y-1">
          <label htmlFor="weather-input" className="text-xs font-medium text-slate-300">Weather (store-wide)</label>
          <select id="weather-input" value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value as WeatherCode })}
            className="w-full rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 text-sm text-slate-100">
            {WEATHER_CODES.map((w) => <option key={w} value={w} className="bg-ink-900">{w}</option>)}
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Toggle checked={form.promotion} onChange={(v) => setForm({ ...form, promotion: v })} label="Promotion running" />
          <Toggle checked={form.epidemic} onChange={(v) => setForm({ ...form, epidemic: v })} label="Epidemic (all products)" />
        </div>
        <div className="flex items-end">
          <Button onClick={() => void submit()} disabled={Boolean(busy) || streaming} icon={<CalendarPlus className="h-4 w-4" />}>Add this day</Button>
        </div>
      </div>
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">Optional: stock ledger for that day</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <NumberField label="Units sold" value={form.unitsSold} min={0} onChange={(v) => setForm({ ...form, unitsSold: v })} />
          <NumberField label="Opening inventory" value={form.inventory} min={0} onChange={(v) => setForm({ ...form, inventory: v })} />
          <NumberField label="Units ordered" value={form.unitsOrdered} min={0} onChange={(v) => setForm({ ...form, unitsOrdered: v })} />
        </div>
      </details>
      {result && <Messages errors={result.errors} warnings={result.warnings} />}
    </div>
  );
}

type Preview = Awaited<ReturnType<ReturnType<typeof forecastWorker>["previewCsv"]>>;

function CsvTab({ nextDate }: { nextDate: string | null }) {
  const { skuId, busy, observedUntil, streaming } = useAppStore();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // A preview is only valid for the planning date it was checked against.
  useEffect(() => {
    setPreview(null);
    setFileName(null);
    if (input.current) input.current.value = "";
  }, [observedUntil]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    if (file.size > MAX_CSV_BYTES) {
      setTooBig(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_CSV_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setTooBig(null);
    setPreview(await forecastWorker().previewCsv(await file.text(), observedUntil));
  };

  const template = () => {
    if (!nextDate) return;
    const blob = new Blob([csvTemplate({ date: nextDate, skuId, demand: 100, promotion: 0, weather: "Cloudy", epidemic: 0 })], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "new-demand-data-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const v = preview?.validation;
  const ok = v && !v.errors.length && v.lastDay !== null;
  const days = v?.rows.length ? new Set(v.rows.map((r) => r.date)) : null;

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-slate-400">
        Columns as in the Kaggle file — required: <span className="font-mono text-[12px] text-slate-300">{CSV_COLUMNS.required.join(", ")}</span>;
        optional: <span className="font-mono text-[12px] text-slate-300">{CSV_COLUMNS.optional.join(", ")}</span>. Rows must start on
        {" "}{nextDate ? fmtDate(nextDate) : "the next day"} and cover consecutive days. The file is read in your browser and never uploaded anywhere.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="csv-input" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="ghost" onClick={() => input.current?.click()} icon={<FileUp className="h-4 w-4" />}>Choose CSV…</Button>
        <Button variant="ghost" onClick={template} icon={<Download className="h-4 w-4" />}>Template</Button>
        {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
      </div>
      {tooBig && <Messages errors={[tooBig]} warnings={[]} />}
      {preview && (
        <>
          <Messages errors={[...preview.errors, ...(v?.errors ?? [])]} warnings={[...preview.warnings, ...(v?.warnings ?? [])]} />
          {ok && days && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-safe/30 bg-safe/10 p-3 text-sm text-slate-200">
              <span>{fmtInt(v.rows.length)} rows · {days.size} day{days.size === 1 ? "" : "s"} · {new Set(v.rows.map((r) => r.skuId)).size} products — ready to append.</span>
              <Button onClick={() => void advance({ rows: v.rows, lastDay: v.lastDay!, source: "csv" }).then((r) => { if (r.ok) { setPreview(null); setFileName(null); } })}
                disabled={Boolean(busy) || streaming} icon={<FileUp className="h-4 w-4" />}>Append</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AddDataPanel({ index = 0 }: { index?: number }) {
  const [tab, setTab] = useState<Tab>("stream");
  const [confirmReset, setConfirmReset] = useState(false);
  const { observedUntil, busy, streaming, lstm, dataError } = useAppStore();
  const catalog = useCatalog().data;
  const lastRecorded = catalog ? catalog.dates.length - 1 : observedUntil;
  const nextDay = observedUntil + 1;
  const nextDate = catalog ? (nextDay < catalog.dates.length ? catalog.dates[nextDay] : nextDateAfter(catalog.dates[catalog.dates.length - 1], nextDay - catalog.dates.length + 1)) : null;
  const unseen = lastRecorded - observedUntil;

  return (
    <Panel index={index} title="Add new data" busy={Boolean(busy) || streaming || lstm.tuning}
      subtitle={busy ?? (lstm.tuning ? "Fine-tuning the LSTM on the latest days in the background…" : "Models are scored on each new day before they learn from it; all views refresh afterwards. Saved in this browser only.")}
      actions={<>
        <Segmented label="How to add data" value={tab} onChange={setTab} size="xs"
          options={[{ value: "stream", label: "Stream recorded days" }, { value: "enter", label: "Enter a day" }, { value: "csv", label: "Upload CSV" }]} />
        {confirmReset ? (
          <span className="flex items-center gap-2 text-xs text-slate-400">
            Forget all added data?
            <Button variant="ghost" onClick={() => { setConfirmReset(false); void resetTimeline(); }} icon={<RotateCcw className="h-4 w-4" />}>Reset</Button>
            <button type="button" className="text-slate-500 hover:text-slate-300" onClick={() => setConfirmReset(false)}>Cancel</button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={Boolean(busy)} icon={<RotateCcw className="h-4 w-4" />}>Reset</Button>
        )}
      </>}>
      {tab === "stream" && <StreamTab unseen={unseen} nextDate={nextDate} lastRecorded={lastRecorded} />}
      {tab === "enter" && <EnterTab nextDay={nextDay} nextDate={nextDate} beyondData={nextDay > lastRecorded} />}
      {tab === "csv" && <CsvTab nextDate={nextDate} />}
      {busy && <div className="mt-3"><BusyDot label={busy} /></div>}
      {dataError && !busy && <p role="alert" className="mt-3 rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">{dataError}</p>}
    </Panel>
  );
}

function nextDateAfter(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

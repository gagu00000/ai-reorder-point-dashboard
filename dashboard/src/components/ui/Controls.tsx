import { Info, Lightbulb } from "lucide-react";
import { useId, type ReactNode } from "react";

export function Slider({ label, value, min, max, step, format, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">{label}</label>
        <span className="tabular font-mono text-xs text-ai">{format(value)}</span>
      </div>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm", label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "xs"; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-ink-950/60 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors ${size === "xs" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"} ${
              active ? "bg-ink-700 text-white shadow-inner" : "text-slate-400 hover:text-slate-200"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "border-line-strong bg-ink-700/80 text-slate-100" : "border-line bg-transparent text-slate-500 hover:text-slate-300"}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: active ? color : "transparent", boxShadow: `inset 0 0 0 1.5px ${color}` }} />
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-ai/80" : "bg-ink-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
      {label}
    </label>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, suffix, disabled }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-300">{label}</label>
      <div className="flex items-center rounded-lg border border-line bg-ink-950/60 focus-within:border-ai/50">
        <input id={id} type="number" value={Number.isFinite(value) ? value : ""} step={step} min={min} disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value))}
          className="tabular w-full bg-transparent px-2.5 py-1.5 font-mono text-sm text-slate-100 outline-none disabled:text-slate-600" />
        {suffix && <span className="pr-2.5 text-xs text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-line bg-ink-950/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-ai/50">
        {options.map((o) => <option key={o.value} value={o.value} className="bg-ink-900">{o.label}</option>)}
      </select>
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, icon }: {
  children: ReactNode; onClick: () => void; variant?: "primary" | "ghost"; disabled?: boolean; icon?: ReactNode;
}) {
  const style = variant === "primary"
    ? "bg-gradient-to-r from-ai/90 to-opt/90 text-ink-950 hover:brightness-110 shadow-[0_0_24px_-6px_rgb(34_211_238/0.6)]"
    : "border border-line bg-ink-800/60 text-slate-200 hover:border-line-strong";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}>
      {icon}
      {children}
    </button>
  );
}

/** Plain-language interpretation for an operations manager. */
export function Insight({ children, title = "What this means" }: { children: ReactNode; title?: string }) {
  return (
    <div className="mt-4 flex gap-3 rounded-xl border border-ai/15 bg-ai/[0.05] p-3.5">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-ai" aria-hidden />
      <div className="text-[13px] leading-relaxed text-slate-300">
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-ai/90">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex gap-2 text-[11px] leading-relaxed text-slate-500">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Skeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-ink-800/40" style={{ height }} aria-busy="true" aria-label="Loading">
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded-lg border border-risk/30 bg-risk/10 p-3 text-sm text-risk">{message}</p>;
}

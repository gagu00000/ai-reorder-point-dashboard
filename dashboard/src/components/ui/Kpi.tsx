import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Number that tweens to its new value — a cue that something was recomputed. */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce || !Number.isFinite(value) || !Number.isFinite(from.current)) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span className="tabular">{format(shown)}</span>;
}

type Tone = "ai" | "baseline" | "risk" | "safe" | "opt" | "neutral";
const TONE: Record<Tone, string> = {
  ai: "text-ai", baseline: "text-baseline", risk: "text-risk", safe: "text-safe", opt: "text-opt", neutral: "text-slate-100",
};
const BAR: Record<Tone, string> = {
  ai: "bg-ai", baseline: "bg-baseline", risk: "bg-risk", safe: "bg-safe", opt: "bg-opt", neutral: "bg-slate-500",
};

interface KpiProps {
  label: string;
  value: number | null | undefined;
  format: (v: number) => string;
  tone?: Tone;
  hint?: ReactNode;
  icon?: ReactNode;
  index?: number;
}

export function Kpi({ label, value, format, tone = "neutral", hint, icon, index = 0 }: KpiProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduce ? 0 : index * 0.05 }}
      className="glass relative overflow-hidden rounded-2xl p-4"
    >
      <span className={`absolute inset-x-0 top-0 h-px ${BAR[tone]} opacity-60`} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        {icon && <span className={`${TONE[tone]} opacity-80`}>{icon}</span>}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${TONE[tone]}`}>
        {value == null || !Number.isFinite(value) ? <span className="text-slate-600">—</span> : <AnimatedNumber value={value} format={format} />}
      </p>
      {hint && <div className="mt-1 text-xs leading-snug text-slate-400">{hint}</div>}
    </motion.div>
  );
}

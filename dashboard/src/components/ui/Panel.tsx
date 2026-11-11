import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Stagger index for the entrance animation. */
  index?: number;
  /** Show a subtle "computing" indicator in the header. */
  busy?: boolean;
  /** When this value changes (new data recomputed the panel), the panel glows briefly. */
  pulseKey?: string | number;
}

/** Glass panel with an optional header; fades up on entrance (respects reduced motion). */
export function Panel({ title, subtitle, actions, children, className = "", index = 0, busy = false, pulseKey }: PanelProps) {
  const reduce = useReducedMotion();
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (pulseKey === undefined) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [pulseKey, reduce]);
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduce ? 0 : Math.min(index, 8) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={`glass relative min-w-0 rounded-2xl p-4 sm:p-5 ${className}`}
      // Inline so it wins over the glass utility's own shadow.
      style={{
        transition: "box-shadow 0.7s ease",
        ...(flash ? { boxShadow: "0 0 0 1px rgb(34 211 238 / 0.45), 0 0 32px -8px rgb(34 211 238 / 0.5)" } : {}),
      }}
    >
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-100">
                {title}
                {busy && <BusyDot />}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function BusyDot({ label = "computing" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ai/30 bg-ai/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ai">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
      {label}
    </span>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ai/80">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">{title}</h1>
      {children && <div className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-400">{children}</div>}
    </div>
  );
}

/**
 * The Guide: what this dashboard is, how it maps to the exercise, a five-minute walkthrough,
 * how to read the data and dates, and the glossary. Opens as a side panel from the header.
 */
import { BookOpenText, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { GLOSSARY, SLIDE_MAP, WALKTHROUGH } from "../../content/guide";
import { useHelpStore } from "./helpStore";

function H({ children }: { children: string }) {
  return <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-ai first:mt-0">{children}</h3>;
}

export function GuideButton() {
  const setOpen = useHelpStore((s) => s.setOpen);
  return (
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ai/40 bg-ai/10 px-2.5 py-1.5 text-xs font-semibold text-ai hover:bg-ai/20">
      <BookOpenText className="h-3.5 w-3.5" aria-hidden /> Guide
    </button>
  );
}

export function GuidePanel() {
  const { open, setOpen } = useHelpStore();
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={() => setOpen(false)}
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />
          <motion.aside role="dialog" aria-modal="true" aria-labelledby="guide-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line bg-ink-900 shadow-2xl"
            initial={reduce ? false : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.25 }}>
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 id="guide-title" className="flex items-center gap-2 text-base font-semibold text-white">
                <BookOpenText className="h-4 w-4 text-ai" aria-hidden /> Guide to this dashboard
              </h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close guide"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-800 hover:text-white"><X className="h-5 w-5" /></button>
            </header>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5 text-[13.5px] leading-relaxed text-slate-300">
              <H>What this is</H>
              <p>
                An answer to the exercise <i>“AI Applications in Reorder Point &amp; Inventory Management”</i>. A classic reorder-point
                calculator is enhanced in three steps: <b className="text-slate-100">(1)</b> machine-learning demand forecasts that update as
                new data arrives, <b className="text-slate-100">(2)</b> safety stock from the slide's formula checked by Monte Carlo simulation, and
                <b className="text-slate-100"> (3)</b> Bayesian optimisation to choose the reorder point under constraints. Each step has its own page;
                the overview brings them together and every result is compared with the classic calculator.
              </p>

              <H>The data and the planning date</H>
              <p>
                A public Kaggle retail dataset: 100 products (5 stores × 20 products), daily demand from 1 Jan 2022 to 30 Jan 2024, with
                promotions, weather and epidemic periods. Planning starts <b className="text-slate-100">as of 1 Dec 2023</b> (the date shown at the top; it moves forward when you add data).
                The 60 days after it are kept unseen: policies are tested on them honestly, and you can reveal them one by one as “new data”.
                Use the store and product selectors at the top to look at any product.
              </p>
              <p className="mt-2">
                Everything is calculated live in your browser — nothing is pre-drawn. The first load takes a few seconds. Anything you add is
                kept only in this browser, and “Reset” (on the Demand Forecasting page) restores the original data.
              </p>

              <H>Suggested 5-minute walkthrough</H>
              <ol className="space-y-2">
                {WALKTHROUGH.map((w, i) => (
                  <li key={w.to} className="flex gap-3 rounded-xl border border-line bg-ink-950/40 p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ai/15 text-xs font-bold text-ai">{i + 1}</span>
                    <div>
                      <Link to={w.to} onClick={() => setOpen(false)} className="font-semibold text-slate-100 hover:text-ai">{w.title} →</Link>
                      <p className="mt-0.5 text-[12.5px] text-slate-400">{w.text}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <H>Where each part of the exercise is answered</H>
              <ul className="space-y-1.5">
                {SLIDE_MAP.map((m) => (
                  <li key={m.requirement} className="rounded-lg border border-line/70 p-2.5">
                    <p className="text-slate-200">{m.requirement}</p>
                    <Link to={m.to} onClick={() => setOpen(false)} className="text-xs font-medium text-ai hover:underline">{m.where} →</Link>
                  </li>
                ))}
              </ul>

              <H>Reading the colours</H>
              <ul className="grid grid-cols-2 gap-2 text-[12.5px]">
                {[
                  ["#22d3ee", "AI forecast / AI-enhanced"], ["#f59e0b", "Baseline calculator / slide formula"],
                  ["#a78bfa", "Bayesian-optimised"], ["#94a3b8", "Actual data / as-is"],
                  ["#f43f5e", "Stockouts, risk, epidemic periods"], ["#34d399", "Service level, safe zone"],
                ].map(([c, t]) => (
                  <li key={t} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />{t}</li>
                ))}
              </ul>

              <H>Glossary</H>
              <dl className="space-y-2.5">
                {Object.values(GLOSSARY).map((g) => (
                  <div key={g.term}>
                    <dt className="font-semibold text-slate-100">{g.term}</dt>
                    <dd className="text-[12.5px] text-slate-400">{g.definition}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-xs text-slate-500">Dotted-underlined words anywhere on the dashboard show their definition when you hover or tap them.</p>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

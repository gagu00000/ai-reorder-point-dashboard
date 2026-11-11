/** First-visit "Start here" card on the overview (dismissible; never blocks the page). */
import { BookOpenText, X } from "lucide-react";
import { useState } from "react";
import { readFlag, useHelpStore, writeFlag } from "./helpStore";

const KEY = "rop-welcome-dismissed";

export function WelcomeCard() {
  const [hidden, setHidden] = useState(() => readFlag(KEY) === "1");
  const openGuide = useHelpStore((s) => s.setOpen);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    writeFlag(KEY, "1");
  };
  return (
    <section aria-label="Start here" className="relative mb-5 overflow-hidden rounded-2xl border border-ai/30 bg-gradient-to-r from-ai/[0.12] via-opt/[0.08] to-transparent p-5">
      <button type="button" onClick={dismiss} aria-label="Dismiss the start-here card"
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-ink-800 hover:text-white"><X className="h-4 w-4" /></button>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ai">Start here</p>
      <p className="mt-1 max-w-3xl pr-6 text-[15px] leading-relaxed text-slate-100">
        This dashboard upgrades a classic reorder-point calculator in the three steps of the exercise — <b>forecast demand</b>,
        <b> size the safety stock with Monte Carlo</b>, and <b>optimise the reorder point with Bayesian optimisation</b> — and proves the result on
        60 days of data the planner never saw.
      </p>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-slate-300">
        This page summarises everything for one product (change it at the top). The numbered cards below open each step. Every page starts with a
        short “How to read this page”, and dotted-underlined terms explain themselves when you hover or tap them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => openGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-ai/90 to-opt/90 px-3.5 py-2 text-sm font-semibold text-ink-950 hover:brightness-110">
          <BookOpenText className="h-4 w-4" aria-hidden /> Open the 5-minute walkthrough
        </button>
        <button type="button" onClick={dismiss} className="rounded-lg border border-line px-3.5 py-2 text-sm text-slate-300 hover:border-line-strong">Got it</button>
      </div>
    </section>
  );
}

/** "How to read this page": the question the page answers, what is on screen, and what to try. */
import { ChevronDown, Compass, Eye, MousePointerClick } from "lucide-react";
import { useState } from "react";
import { PAGE_GUIDES, type PageKey } from "../../content/guide";
import { readFlag, useHelpStore, writeFlag } from "./helpStore";

export function PageGuide({ page }: { page: PageKey }) {
  const g = PAGE_GUIDES[page];
  const key = `rop-guide-${page}`;
  const [open, setOpen] = useState(() => readFlag(key) !== "closed");
  const openGuide = useHelpStore((s) => s.setOpen);
  const toggle = () => {
    setOpen(!open);
    writeFlag(key, open ? "closed" : "open");
  };

  return (
    <section aria-label="How to read this page" className="mb-5 rounded-2xl border border-ai/20 bg-ai/[0.04]">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ai">
          <Compass className="h-4 w-4" aria-hidden /> How to read this page
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-ai/10 px-4 pb-4 pt-3 lg:grid-cols-[1.1fr_1.6fr_1.2fr]">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">The question it answers</p>
            <p className="text-[13px] leading-relaxed text-slate-200">{g.question}</p>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><Eye className="h-3.5 w-3.5" aria-hidden />What you are looking at</p>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-300">
              {g.look.map((t) => <li key={t} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ai" aria-hidden />{t}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><MousePointerClick className="h-3.5 w-3.5" aria-hidden />Try this</p>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-300">
              {g.tryThis.map((t) => <li key={t} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-opt" aria-hidden />{t}</li>)}
            </ul>
            <button type="button" onClick={() => openGuide(true)} className="mt-3 text-xs font-medium text-ai hover:underline">
              Full guide, walkthrough and glossary →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

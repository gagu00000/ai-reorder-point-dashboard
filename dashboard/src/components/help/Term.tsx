/**
 * A technical term with its plain-language definition on hover, keyboard focus or tap.
 * The popover is fixed-positioned and clamped to the viewport, so it never causes sideways scrolling.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryKey } from "../../content/guide";

export function Term({ id, children }: { id: GlossaryKey; children?: ReactNode }) {
  const entry = GLOSSARY[id];
  const tipId = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const above = r.bottom > window.innerHeight - 170;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, width, above });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-describedby={pos ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // A tap fires focus and click together, so click only opens; blur, scroll or Esc close it.
        onClick={show}
        // Look exactly like the surrounding text (Tailwind's reset would otherwise restyle the button).
        className="inline cursor-help border-b border-dotted border-slate-500/70 bg-transparent p-0 text-left [color:inherit] [font:inherit] [letter-spacing:inherit] [text-transform:inherit] hover:border-ai"
      >
        {children ?? entry.term}
      </button>
      {pos && createPortal(
        <div
          role="tooltip"
          id={tipId}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, transform: pos.above ? "translateY(-100%)" : undefined }}
          className="pointer-events-none z-[60] rounded-xl border border-line-strong bg-ink-900 p-3 text-left normal-case tracking-normal shadow-2xl shadow-black/60"
        >
          <p className="text-xs font-semibold text-ai">{entry.term}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{entry.definition}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

import { BookOpen, Boxes, CalendarClock, Gauge, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Skeleton } from "../components/ui/Controls";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { useCatalog } from "../hooks/useEngine";
import { fmtDate } from "../lib/format";
import { useAppStore } from "../state/store";

export const NAV = [
  { to: "/", label: "Control Tower", short: "Overview", icon: Gauge },
  { to: "/forecasting", label: "Demand Forecasting", short: "Forecast", icon: TrendingUp },
  { to: "/safety-stock", label: "Safety Stock & Monte Carlo", short: "Safety", icon: ShieldCheck },
  { to: "/simulation", label: "Inventory Simulation", short: "Simulate", icon: Boxes },
  { to: "/optimization", label: "Optimisation & Sensitivity", short: "Optimise", icon: Sparkles },
  { to: "/method", label: "Method & Assumptions", short: "Method", icon: BookOpen },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#111a2e" stroke="rgba(148,163,184,.2)" />
        <rect x="6" y="18" width="5" height="8" rx="1" fill="#22d3ee" />
        <rect x="13.5" y="12" width="5" height="14" rx="1" fill="#22d3ee" opacity=".7" />
        <rect x="21" y="7" width="5" height="19" rx="1" fill="#a78bfa" />
        <path d="M5 15.5h22" stroke="#f43f5e" strokeWidth="1.6" strokeDasharray="2.5 2" />
      </svg>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">Reorder Point</p>
        <p className="text-[11px] text-slate-400">AI Control Tower</p>
      </div>
    </div>
  );
}

function SkuPicker() {
  const { data } = useCatalog();
  const { skuId, setSku } = useAppStore();
  const [store, product] = skuId.split("-");
  if (!data) return <div className="h-9 w-64 animate-pulse rounded-lg bg-ink-800" />;
  const stores = [...new Set(data.skus.map((s) => s.store))];
  const products = data.skus.filter((s) => s.store === store);
  const current = data.skus.find((s) => s.id === skuId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="store-select">Store</label>
      <select id="store-select" value={store} onChange={(e) => setSku(`${e.target.value}-${product}`)}
        className="rounded-lg border border-line bg-ink-950/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-ai/50">
        {stores.map((s) => {
          const region = data.skus.find((x) => x.store === s)?.region;
          return <option key={s} value={s} className="bg-ink-900">{s} · {region}</option>;
        })}
      </select>
      <label className="sr-only" htmlFor="product-select">Product</label>
      <select id="product-select" value={product} onChange={(e) => setSku(`${store}-${e.target.value}`)}
        className="rounded-lg border border-line bg-ink-950/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-ai/50">
        {products.map((s) => <option key={s.id} value={s.product} className="bg-ink-900">{s.product} · {s.category}</option>)}
      </select>
      {current && (
        <span className="hidden text-xs text-slate-500 lg:inline">≈ {Math.round(current.meanDemand)} units/day</span>
      )}
    </div>
  );
}

function PlanningBadge() {
  const { data } = useCatalog();
  const { observedUntil, busy, streaming } = useAppStore();
  if (!data) return null;
  const unseen = data.dates.length - 1 - observedUntil;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-950/50 px-2.5 py-1.5 text-xs text-slate-300"
      title="The planner only uses data up to this date. Later days are kept unseen for honest evaluation." aria-live="polite">
      <CalendarClock className="h-3.5 w-3.5 text-ai" aria-hidden />
      <span>Planning as of <b className="font-semibold text-white" data-testid="planning-date">{fmtDate(data.dates[observedUntil])}</b></span>
      {busy || streaming
        ? <span className="flex items-center gap-1 text-ai"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />{streaming ? "streaming" : "updating"}</span>
        : unseen > 0 && <span className="hidden text-slate-500 sm:inline">· {unseen} unseen days</span>}
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const reduce = useReducedMotion();
  return (
    <div className="bg-blueprint min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-ink-950/70 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2"><Brand /></div>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? "bg-ink-700/70 text-white shadow-[inset_2px_0_0_var(--color-ai)]" : "text-slate-400 hover:bg-ink-800/60 hover:text-slate-200"}`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-line bg-ink-900/60 p-3 text-[11px] leading-relaxed text-slate-500">
          AI in Operations · Session II exercise. All computation runs in your browser; no data leaves this device.
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-ink-900/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="lg:hidden"><Brand /></div>
            <SkuPicker />
            <PlanningBadge />
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname}
              initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}>
              <ErrorBoundary resetKey={location.pathname}>
                <Suspense fallback={<Skeleton height={420} />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-ink-950/90 backdrop-blur-xl lg:hidden" aria-label="Main">
        {NAV.map(({ to, short, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[10px] ${isActive ? "text-ai" : "text-slate-500"}`}>
            <Icon className="h-5 w-5" aria-hidden />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

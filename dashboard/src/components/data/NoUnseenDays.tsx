import { Link } from "react-router";

/** Shown where a replay needs recorded days after the planning date and none are left. */
export function NoUnseenDays({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "h-[200px] px-4" : "py-14"}`}>
      <p className="text-sm font-medium text-slate-200">Every recorded day has been revealed</p>
      <p className="max-w-md text-xs leading-relaxed text-slate-500">
        The replay tests policies on days the planner has not seen, and none are left. The forecasts, safety stock and optimiser still use all
        the data you have added. To replay again, reset the timeline on the{" "}
        <Link to="/forecasting" className="text-ai hover:underline">Demand Forecasting</Link> page.
      </p>
    </div>
  );
}

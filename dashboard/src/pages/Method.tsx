/** Method & assumptions: data audit, modelling choices, metric definitions, traceability to the slide, limitations. */
import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "../components/ui/Controls";
import { Panel, PageHeader } from "../components/ui/Panel";
import { useCatalog } from "../hooks/useEngine";
import { fmt2, fmtDate, fmtInt, fmtPct } from "../lib/format";

const TRACE: [string, string, string][] = [
  ["Objective: enhance the reorder-point calculator and sensitivity analysis", "Baseline calculator vs AI-enhanced policy compared on unseen days", "Control Tower, Simulation"],
  ["Predictive intelligence", "Forecast-driven D̄ and forecast-error σ_D feed the formula", "Forecasting, Safety Stock"],
  ["Adaptive decision-making", "Reorder point recomputed daily from the latest forecast (AI + Monte Carlo policy)", "Simulation"],
  ["Real-time optimisation", "Bayesian optimisation runs in the browser in seconds and re-runs on any change", "Optimisation"],
  ["1 · ML models: time series, regression, LSTM", "Exponential smoothing, ridge regression, global LSTM (+ ensemble, naive benchmarks)", "Forecasting"],
  ["1 · Historical data, seasonality, promotions, external factors", "Lags, yearly seasonality, promotion, weather, epidemic; driver-effects chart; leaky price excluded", "Forecasting, Method"],
  ["1 · Keep the possibility of adding new data", "Enter a day, append a CSV, or stream recorded days; saved in this browser; reset any time", "Forecasting → Add new data"],
  ["1 · Continuously update forecasts as new data arrives", "Each new day is scored out-of-sample, then ETS and ridge refit, bands rescale to recent errors, the LSTM fine-tunes in a worker, and every plan recomputes", "Forecasting → Accuracy as new data arrives"],
  ["2 · Probabilistic models: demand variability", "σ_D from forecast errors; bootstrap of real errors in simulation", "Safety Stock"],
  ["2 · Probabilistic models: lead-time uncertainty", "Lead times recovered from the ledger; Gamma model with L and σ_L; store pool option", "Safety Stock"],
  ["2 · Monte Carlo for risk scenarios and buffers", "Demand-during-lead-time simulation, stockout tail, Monte Carlo safety stock; inventory replay", "Safety Stock, Simulation"],
  ["2 · Formula SS = Z·√(σ_D²·L + D̄²·σ_L²)", "Implemented exactly; every term shown with live numbers; unit-tested against hand calculations", "Safety Stock"],
  ["3 · Bayesian optimisation instead of manual sweeps", "Gaussian process + constrained expected improvement; convergence vs random search; grid check", "Optimisation"],
  ["3 · Optimal reorder points under constraints", "Service (cycle or fill rate), budget, storage capacity, min/max order", "Optimisation"],
  ["3 · Sensitivity analysis", "Surrogate cost map (2-D and WebGL 3-D), tornado charts, price-of-service curve", "Optimisation"],
  ["Note: no sharing of data with peers", "All computation in the browser; private repository; raw files never committed", "Deployment, this page"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ai/90">{title}</h3>
      <div className="space-y-2 text-[13px] leading-relaxed text-slate-300">{children}</div>
    </div>
  );
}

export default function Method() {
  const { data } = useCatalog();
  if (!data) return <Skeleton height={500} />;
  const lt = data.leadTimes;
  const val = data.models.backtest.validation.leaderboard.h14;
  const hold = data.models.backtest.holdout.leaderboard.h1;
  const split = data.meta.split;

  return (
    <>
      <PageHeader eyebrow="How it works" title="Method & Assumptions">
        Everything shown in this dashboard is computed from the data below, with the assumptions listed here. Nothing is hard-coded except
        cost defaults, which you can change on the Optimisation page.
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel index={0} title="Data">
          <div className="space-y-5">
            <Section title="Source">
              <p>{data.meta.source} (<a className="text-ai hover:underline" href={data.meta.sourceUrl} target="_blank" rel="noreferrer">Kaggle</a>, {data.meta.license}).
                {" "}{fmtInt(data.skus.length)} store–product series × {fmtInt(data.meta.nDays)} days, {fmtDate(data.meta.startDate)} – {fmtDate(data.meta.endDate)}.
                No missing values, duplicates or calendar gaps.</p>
              <p>Time-ordered split — training to {fmtDate(split.trainEnd)}, validation to {fmtDate(split.valEnd)}, and a <b>holdout</b> from
                {" "}{fmtDate(split.holdoutStart)} that no model or setting was tuned on. The planner works "as of" the end of validation.</p>
            </Section>
            <Section title="What the audit found">
              <ul className="list-inside list-disc space-y-1 marker:text-slate-600">
                <li><b>Target leakage:</b> {data.meta.excludedColumns.leakage.join(" and ")} are generated from the same day's demand (within-SKU
                  correlation 0.80; adding price doubles R² and implies higher prices raise demand). Both are excluded from every model.</li>
                <li><b>Redundant:</b> {data.meta.excludedColumns.redundantFeature.join(", ")} is fully determined by the promotion flag.</li>
                <li><b>Censored sales:</b> Units Sold is capped by stock on 11% of days, so models forecast the <i>Demand</i> column.</li>
                <li><b>Drivers:</b> epidemic −44%, promotion +30%, sunny +10% / rainy and snowy −10%, summer +5–7%; no weekday pattern.</li>
              </ul>
            </Section>
            <Section title="Lead times from the inventory ledger">
              <p>Each order was matched to the first later overnight receipt of the same quantity
                ({fmtInt(lt.matchedOrders)} of {fmtInt(lt.totalOrders)} orders, {fmtPct(lt.matchedOrders / lt.totalOrders)}). Lead times are 1–4 days
                (mean {fmt2(lt.overall.mean)}, sd {fmt2(lt.overall.sd)}), constant within each SKU.</p>
              <div className="grid grid-cols-5 gap-2 pt-1">
                {Object.entries(lt.stores).map(([s, d]) => (
                  <div key={s} className="rounded-lg border border-line bg-ink-950/50 p-2 text-center">
                    <p className="text-[11px] text-slate-500">{s}</p>
                    <p className="tabular font-mono text-sm text-slate-100">{fmt2(d.mean)}</p>
                    <p className="tabular font-mono text-[11px] text-slate-500">σ {fmt2(d.sd)}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </Panel>

        <Panel index={1} title="Assumptions register">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[480px] text-sm">
              <tbody className="[&_td]:border-b [&_td]:border-line/60 [&_td]:py-2 [&_td]:align-top">
                <tr><td className="pr-3 font-medium text-slate-200">σ_L per SKU</td><td className="text-slate-400">Store's pooled lead-time sd (SKU lead times are constant in the data, which would switch off half of the formula). Adjustable.</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Lead-time shape</td><td className="text-slate-400">Gamma with the SKU's mean and store's sd (positive, right-skewed); simulated deliveries rounded to whole days without changing the mean.</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Future drivers</td><td className="text-slate-400">Promotions are planned (known); weather uses recorded values as a stand-in for a short-range forecast; epidemic status persists from the last observed day.</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Inventory policy</td><td className="text-slate-400">Daily continuous review (s, Q): order when stock on hand + on order ≤ s; unmet demand is lost (as in the data).</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Costs</td><td className="text-slate-400">Holding {fmtPct(data.costDefaults.holdingRatePerYear, 0)} of unit price per year; {fmtInt(data.costDefaults.orderCost)} per order; lost sale = {fmtPct(data.costDefaults.marginRate, 0)} of unit price. Unit price = SKU's median recorded price (cost use only).</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Service level</td><td className="text-slate-400">The slide's Z is a <i>cycle</i> service level: probability of no stockout while an order is outstanding. Fill rate (share of demand served) is offered as an alternative constraint.</td></tr>
                <tr><td className="pr-3 font-medium text-slate-200">Optimisation horizon</td><td className="text-slate-400">Each candidate policy is simulated for 365 days × 8 demand scenarios (forecast + bootstrapped forecast errors), common random numbers.</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel index={2} title="Models and how they were checked">
          <div className="space-y-5">
            <Section title="Forecasting">
              <p>Ridge regression (α = {data.models.ridgeAlpha}, chosen on validation) on lags, rolling means, yearly seasonality, promotion, weather and epidemic;
                exponential smoothing (SES or damped Holt by AIC); a global LSTM trained offline and run in TensorFlow.js; an inverse-error ensemble.
                Validation WAPE over 14 days: ridge {fmtPct(val.Ridge.WAPE)}, LSTM {fmtPct(val.LSTM.WAPE)}, static mean {fmtPct(val["Static mean (baseline)"].WAPE)}.
                Holdout, next day: ridge {fmtPct(hold.Ridge.WAPE)} vs {fmtPct(hold["Static mean (baseline)"].WAPE)}.</p>
            </Section>
            <Section title="Verification">
              <ul className="space-y-1">
                {[
                  "Browser models reproduce the Python notebook's leaderboard to within 10⁻⁶ (ridge, LSTM, baselines).",
                  "Slide formula reproduces the hand calculation (S001-P0001: SS 169.95, ROP 355.58).",
                  "Monte Carlo reproduces the formula's variance σ_D²·L + D̄²·σ_L² to within 1%.",
                  "Gaussian process matches scikit-learn; Bayesian optimisation solves the Branin benchmark.",
                  "Bayesian optimisation matches a 900-point grid search with 5% of the simulations.",
                ].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safe" aria-hidden />{t}</li>
                ))}
              </ul>
            </Section>
            <Section title="Metric definitions">
              <p><b>WAPE</b> = Σ|forecast − actual| ÷ Σ actual. <b>MASE</b> = mean absolute error ÷ in-sample error of "yesterday's demand" (&lt; 1 beats it).
                {" "}<b>Bias</b> = Σ(forecast − actual) ÷ Σ actual. <b>Fill rate</b> = demand served ÷ demand. <b>Cycle service</b> = share of order cycles without a stockout.</p>
            </Section>
          </div>
        </Panel>

        <Panel index={3} title="Honest limitations">
          <ul className="list-inside list-disc space-y-2 text-[13px] leading-relaxed text-slate-300 marker:text-slate-600">
            <li>The dataset is synthetic; per-SKU daily noise is high, so realistic forecast error is about 25–30% WAPE, not single digits.</li>
            <li>The LSTM's starting weights are trained offline; in the browser it is fine-tuned on new data rather than retrained from scratch.</li>
            <li>No formula-based policy reaches a 95% cycle service on the holdout: in a daily-review system, stock is on average about a third of the
              safety stock below the reorder point when an order is placed. Bayesian optimisation prices this in.</li>
            <li>Optimised policies were planned before the holdout's December peak and epidemic. They realised 90–93% cycle service against 99% planned —
              re-optimising as data arrives is the remedy.</li>
            <li>Data you add in this browser stays in this browser; there is no shared database by design.</li>
          </ul>
        </Panel>

        <Panel index={4} className="xl:col-span-2" title="Traceability to the exercise" subtitle="Every requirement on the slide and the feature that delivers it.">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">Slide requirement</th><th className="py-2 pr-3 font-medium">Delivered by</th><th className="py-2 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {TRACE.map(([req, feat, where]) => (
                  <tr key={req} className="border-b border-line/60 align-top">
                    <td className="py-2 pr-3 text-slate-200">{req}</td><td className="py-2 pr-3 text-slate-400">{feat}</td><td className="py-2 text-slate-400">{where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

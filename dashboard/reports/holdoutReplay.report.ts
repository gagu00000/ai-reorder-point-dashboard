/**
 * Reproducible holdout report — `npm run report:holdout` (≈ 2–3 minutes).
 *
 * Replays the 60 unseen holdout days (2023-12-02 → 2024-01-30) for all 100 SKUs under every
 * reorder-point policy of the project, with common random numbers for lead times, and writes
 * docs/results/holdout_replay.{json,md}. Every number in docs/VERIFICATION.md (Parts 2–3) comes from here.
 *
 * Policies (target cycle service 95%):
 *   As-is                     the dataset's own historical ordering
 *   Baseline formula          slide formula on static history, Q = EOQ
 *   Baseline + MC             Monte Carlo quantile on static history, Q = EOQ
 *   AI formula (adaptive)     slide formula on the daily ridge forecast + forecast errors, Q = EOQ
 *   AI + MC (adaptive)        Monte Carlo quantile on the daily forecast, Q = EOQ
 *   BO on baseline demand     Bayesian-optimised (r, Q) planned on static history
 *   BO on AI demand           Bayesian-optimised (r, Q) planned on the forecast at the origin
 *   AI adaptive + BO (full)   daily AI + MC reorder point plus BO's safety margin, Q = BO's Q
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { buildExog } from "../src/lib/data/features";
import type { CostsFile } from "../src/lib/data/types";
import { ridgeForecast } from "../src/lib/forecasting/ridge";
import { asIsMetrics } from "../src/lib/inventory/asIs";
import { economicOrderQuantity, skuCostParams } from "../src/lib/inventory/cost";
import { demeaned } from "../src/lib/inventory/demandModel";
import { gammaLeadTime } from "../src/lib/inventory/leadTimeModel";
import {
  adaptiveReorderPoints, baselineDesign, forecastDesign, forecastResiduals, withMonteCarlo,
} from "../src/lib/inventory/policies";
import type { PolicyMetrics } from "../src/lib/inventory/policySim";
import { replayPolicies } from "../src/lib/inventory/replay";
import { bayesianOptimisation } from "../src/lib/optimization/bayesOpt";
import { buildInventoryProblem, inventoryObjective, type ProblemSpec } from "../src/lib/optimization/inventoryProblem";
import { loadDataset, loadLeadTimes, loadModelConfig, readData } from "../tests/helpers";

const SERVICE_TARGET = 0.95;
const BO_BUDGET = 45;
const REPLICATIONS = 30;
const MC_TRIALS = 4000;

const POLICIES = [
  "Baseline formula", "Baseline + MC", "AI formula (adaptive)", "AI + MC (adaptive)",
  "BO on baseline demand", "BO on AI demand", "AI adaptive + BO (full)",
] as const;

interface SkuResult {
  sku: string;
  eoq: number;
  formulaReorderPoint: number;
  bo: { baseline: { r: number; q: number; plannedCsl: number }; ai: { r: number; q: number; plannedCsl: number } };
  metrics: Record<string, PolicyMetrics>;
}

interface Summary {
  policy: string;
  cycleServiceLevel: number | null;
  fillRate: number;
  stockoutDayRate: number;
  avgOnHandUnits: number;
  holdingCost: number;
  orderingCost: number;
  shortageCost: number;
  totalCost: number;
}

function summarise(policy: string, runs: PolicyMetrics[]): Summary {
  const sum = (f: (m: PolicyMetrics) => number) => runs.reduce((a, m) => a + f(m), 0);
  const cycles = sum((m) => m.completedCycles);
  return {
    policy,
    cycleServiceLevel: cycles > 0 ? 1 - sum((m) => m.stockoutCycles) / cycles : null,
    fillRate: 1 - sum((m) => m.lost) / sum((m) => m.totalDemand),
    stockoutDayRate: sum((m) => m.stockoutDayRate) / runs.length,
    avgOnHandUnits: sum((m) => m.avgOnHand),
    holdingCost: sum((m) => m.holdingCost),
    orderingCost: sum((m) => m.orderingCost),
    shortageCost: sum((m) => m.shortageCost),
    totalCost: sum((m) => m.totalCost),
  };
}

it("holdout replay report", () => {
  const started = performance.now();
  const ds = loadDataset();
  const lt = loadLeadTimes();
  const config = loadModelConfig();
  const costsFile = readData<CostsFile>("costs.json");
  const origin = ds.split.valEndIdx;
  const from = origin + 1;
  const to = ds.dates.length;
  const H = config.horizon;
  const results: SkuResult[] = [];

  ds.skus.forEach((sku, i) => {
    const ltMoments = { mean: lt.skus[sku.id].L, sd: lt.stores[sku.store].sd };
    const leadTime = gammaLeadTime(ltMoments.mean, ltMoments.sd);
    const costs = skuCostParams(costsFile, sku.id);
    const cache = new Map<number, Float64Array>();
    const forecastAt = (o: number) => {
      if (!cache.has(o)) cache.set(o, ridgeForecast(sku.demand, buildExog(ds, i, o, H), o, H, config.ridge.alpha));
      return cache.get(o)!;
    };
    const valOrigins = Array.from({ length: origin - 7 - ds.split.trainEndIdx + 1 }, (_, k) => ds.split.trainEndIdx + k);
    const residuals = forecastResiduals(sku.demand, valOrigins, 7, forecastAt);

    const base = baselineDesign(sku.demand, origin, leadTime, SERVICE_TARGET);
    const baseMc = withMonteCarlo(base, 20_000, 100 + i);
    const eoq = economicOrderQuantity(base.formula.dBar, costs.orderCost, costs.holdingPerUnitDay);
    const shared = { fromDay: from, toDay: to, forecastAt, residuals, leadTime, serviceLevel: SERVICE_TARGET, seed: 500 + i };
    const aiFormula = adaptiveReorderPoints({ ...shared, monteCarloTrials: null });
    const aiMc = adaptiveReorderPoints({ ...shared, monteCarloTrials: MC_TRIALS });

    const common = {
      leadTime: ltMoments, costs,
      service: { metric: "cycleServiceLevel" as const, target: SERVICE_TARGET },
      orderQtyLimits: { min: costsFile.skus[sku.id].orderQty.min, max: Number.POSITIVE_INFINITY },
      horizonDays: 365, paths: 8, seed: 42 + i,
    };
    const history = Float64Array.from({ length: origin + 1 }, (_, k) => sku.demand[k]);
    const specBaseline: ProblemSpec = { ...common, demand: { kind: "bootstrap", meanPath: [base.formula.dBar], residuals: demeaned(history) } };
    const specAi: ProblemSpec = { ...common, demand: { kind: "bootstrap", meanPath: forecastAt(origin), residuals } };
    const optimise = (spec: ProblemSpec) => {
      const problem = buildInventoryProblem(spec);
      const best = bayesianOptimisation({ bounds: problem.bounds, evaluate: inventoryObjective(problem), budget: BO_BUDGET, seed: 1 }).best;
      if (!best) throw new Error(`no feasible policy found for ${sku.id}`);
      return best;
    };
    const boBaseline = optimise(specBaseline);
    const boAi = optimise(specAi);
    // Full AI policy: follow the daily Monte Carlo reorder point, keeping BO's margin above it.
    const mcAtOrigin = withMonteCarlo(forecastDesign(forecastAt(origin), residuals, leadTime, SERVICE_TARGET), MC_TRIALS, 500 + from).reorderPoint;
    const margin = boAi.x[0] - mcAtOrigin;

    const replay = replayPolicies({
      demand: sku.demand.subarray(from, to),
      initialOnHand: sku.inventory[from],
      orderQuantity: eoq,
      leadTime, costs, replications: REPLICATIONS, seed: 9000 + 100 * i,
      policies: [
        { label: POLICIES[0], reorderPoint: base.reorderPoint },
        { label: POLICIES[1], reorderPoint: baseMc.reorderPoint },
        { label: POLICIES[2], reorderPoint: aiFormula },
        { label: POLICIES[3], reorderPoint: aiMc },
        { label: POLICIES[4], reorderPoint: boBaseline.x[0], orderQuantity: boBaseline.x[1] },
        { label: POLICIES[5], reorderPoint: boAi.x[0], orderQuantity: boAi.x[1] },
        { label: POLICIES[6], reorderPoint: aiMc.map((v) => v + margin), orderQuantity: boAi.x[1] },
      ],
    });

    results.push({
      sku: sku.id,
      eoq,
      formulaReorderPoint: base.reorderPoint,
      bo: {
        baseline: { r: boBaseline.x[0], q: boBaseline.x[1], plannedCsl: boBaseline.meta!.cycleServiceLevel },
        ai: { r: boAi.x[0], q: boAi.x[1], plannedCsl: boAi.meta!.cycleServiceLevel },
      },
      metrics: {
        "As-is": asIsMetrics(sku, from, to, costs),
        ...Object.fromEntries(replay.map((r) => [r.label, r.metrics])),
      },
    });
  });

  const summary = ["As-is", ...POLICIES].map((p) => summarise(p, results.map((r) => r.metrics[p])));
  const seconds = (performance.now() - started) / 1000;

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "holdout_replay.json"), JSON.stringify({
    generatedWith: "npm run report:holdout",
    settings: { serviceTarget: SERVICE_TARGET, boBudget: BO_BUDGET, replications: REPLICATIONS, monteCarloTrials: MC_TRIALS,
      holdout: [ds.dates[from], ds.dates[to - 1]], skus: results.length },
    runtimeSeconds: Math.round(seconds),
    summary,
    skus: results,
  }, null, 1));

  const pct = (v: number | null) => (v === null ? "n/a" : `${(100 * v).toFixed(1)}%`);
  const num = (v: number) => Math.round(v).toLocaleString("en-US");
  const baselineCost = summary.find((s) => s.policy === "Baseline formula")!.totalCost;
  const lines = [
    "| Policy | Cycle service | Fill rate | Stockout days | Avg on-hand (units, all SKUs) | Holding | Ordering | Shortage | Total cost | vs baseline |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summary.map((s) => `| ${s.policy} | ${pct(s.cycleServiceLevel)} | ${pct(s.fillRate)} | ${pct(s.stockoutDayRate)} | ${num(s.avgOnHandUnits)} | ${num(s.holdingCost)} | ${num(s.orderingCost)} | ${num(s.shortageCost)} | ${num(s.totalCost)} | ${s.policy === "Baseline formula" ? "—" : `${s.totalCost < baselineCost ? "−" : "+"}${pct(Math.abs(s.totalCost / baselineCost - 1))}`} |`),
  ];
  writeFileSync(resolve(outDir, "holdout_replay.md"), [
    "# Holdout replay — 100 SKUs × 60 unseen days",
    "",
    `Generated by \`npm run report:holdout\` (${Math.round(seconds)} s). Target cycle service ${pct(SERVICE_TARGET)}, ` +
      `${REPLICATIONS} common-random-number lead-time replications, BO budget ${BO_BUDGET} simulations per policy.`,
    "",
    ...lines,
    "",
  ].join("\n"));
}, 1_800_000);

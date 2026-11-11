/**
 * Daily simulation of a continuous-review (s, Q) reorder-point policy with stochastic lead times
 * and lost sales (unmet demand is lost, as in the dataset where sales never exceed stock).
 *
 * Each day t:
 *   1. deliveries due on day t arrive (start of day — matches the dataset's opening "Inventory Level");
 *   2. review: if inventory position (on hand + on order) ≤ s, order the smallest multiple of Q that
 *      lifts the position above s; it arrives after a lead time drawn from the lead-time model
 *      (rounded to whole days, mean-preserving);
 *   3. the day's demand is served from stock; the remainder is lost.
 *
 * Because orders are placed before the day's demand and arrive at the start of day t+L, an order is
 * exposed to exactly L days of demand — the "demand during lead time" the reorder point covers.
 * A replenishment cycle has a stockout if any demand is lost between an order and its arrival.
 */
import { Rng } from "../stats/prng";
import type { CostParams } from "./cost";
import { leadTimeSampler, stochasticRoundDays, type LeadTimeModel } from "./leadTimeModel";

export interface PolicySimOptions {
  demand: ArrayLike<number>;
  /** Reorder point s: a constant, or one value per day for an adaptive policy. */
  reorderPoint: number | ArrayLike<number>;
  orderQuantity: number;
  leadTime: LeadTimeModel;
  initialOnHand: number;
  costs: CostParams;
  seed: number;
  /** Keep the day-by-day trace (for charts). */
  record?: boolean;
}

export interface PolicyMetrics {
  days: number;
  totalDemand: number;
  sales: number;
  lost: number;
  /** Share of demand served from stock. */
  fillRate: number;
  stockoutDays: number;
  stockoutDayRate: number;
  orders: number;
  completedCycles: number;
  stockoutCycles: number;
  /** Share of completed replenishment cycles without a stockout (null if none completed). */
  cycleServiceLevel: number | null;
  avgOnHand: number;
  maxOnHand: number;
  holdingCost: number;
  orderingCost: number;
  shortageCost: number;
  totalCost: number;
  /** totalCost scaled to one year. */
  annualCost: number;
}

export interface PolicyTrace {
  onHandStart: Float64Array;   // after deliveries, before demand
  onHandEnd: Float64Array;
  position: Float64Array;      // on hand + on order at review
  reorderPoint: Float64Array;
  orderQty: Float64Array;      // placed that day
  orderLeadTime: Int16Array;   // days, -1 if no order
  receipts: Float64Array;      // arrived that day
  lost: Float64Array;
}

export interface PolicySimResult extends PolicyMetrics {
  trace?: PolicyTrace;
}

export function simulatePolicy(o: PolicySimOptions): PolicySimResult {
  const n = o.demand.length;
  if (n === 0) throw new Error("policy simulation needs at least one day of demand");
  if (!(o.orderQuantity > 0)) throw new Error("order quantity must be positive");
  const rng = new Rng(o.seed);
  const drawLeadTime = leadTimeSampler(o.leadTime, rng);
  const sAt = typeof o.reorderPoint === "number"
    ? (() => { const s = o.reorderPoint as number; return () => s; })()
    : (t: number) => (o.reorderPoint as ArrayLike<number>)[t];

  const arrivals = new Float64Array(n);
  const trace: PolicyTrace | undefined = o.record ? {
    onHandStart: new Float64Array(n), onHandEnd: new Float64Array(n), position: new Float64Array(n),
    reorderPoint: new Float64Array(n), orderQty: new Float64Array(n), orderLeadTime: new Int16Array(n).fill(-1),
    receipts: new Float64Array(n), lost: new Float64Array(n),
  } : undefined;

  // Outstanding orders for cycle-service accounting.
  const outstanding: { arrival: number; qty: number; stockout: boolean }[] = [];
  let onHand = o.initialOnHand;
  let onOrder = 0;
  let totalDemand = 0, sales = 0, lost = 0, stockoutDays = 0, orders = 0;
  let completedCycles = 0, stockoutCycles = 0, holdingUnits = 0, maxOnHand = 0;

  for (let t = 0; t < n; t++) {
    // 1. deliveries
    const received = arrivals[t];
    if (received > 0) {
      onHand += received;
      onOrder -= received;
    }
    for (let i = outstanding.length - 1; i >= 0; i--) {
      if (outstanding[i].arrival === t) {
        completedCycles++;
        if (outstanding[i].stockout) stockoutCycles++;
        outstanding.splice(i, 1);
      }
    }

    // 2. review
    const s = sAt(t);
    const position = onHand + onOrder;
    let placed = 0;
    let lead = -1;
    if (position <= s) {
      const multiples = Math.floor((s - position) / o.orderQuantity) + 1;
      placed = multiples * o.orderQuantity;
      lead = stochasticRoundDays(drawLeadTime(), rng);
      orders++;
      if (lead === 0) {
        onHand += placed; // same-day delivery before demand
        completedCycles++;
      } else {
        onOrder += placed;
        if (t + lead < n) arrivals[t + lead] += placed;
        outstanding.push({ arrival: t + lead, qty: placed, stockout: false });
      }
    }
    const startStock = onHand;

    // 3. demand
    const d = o.demand[t];
    const served = Math.min(onHand, d);
    const short = d - served;
    onHand -= served;
    totalDemand += d;
    sales += served;
    lost += short;
    if (short > 1e-9) {
      stockoutDays++;
      for (const ord of outstanding) ord.stockout = true;
    }
    holdingUnits += startStock;
    maxOnHand = Math.max(maxOnHand, startStock);

    if (trace) {
      trace.onHandStart[t] = startStock;
      trace.onHandEnd[t] = onHand;
      trace.position[t] = position;
      trace.reorderPoint[t] = s;
      trace.orderQty[t] = placed;
      trace.orderLeadTime[t] = lead;
      trace.receipts[t] = received;
      trace.lost[t] = short;
    }
  }

  const holdingCost = holdingUnits * o.costs.holdingPerUnitDay;
  const orderingCost = orders * o.costs.orderCost;
  const shortageCost = lost * o.costs.shortagePerUnit;
  const totalCost = holdingCost + orderingCost + shortageCost;
  return {
    days: n,
    totalDemand,
    sales,
    lost,
    fillRate: totalDemand > 0 ? sales / totalDemand : 1,
    stockoutDays,
    stockoutDayRate: stockoutDays / n,
    orders,
    completedCycles,
    stockoutCycles,
    cycleServiceLevel: completedCycles > 0 ? 1 - stockoutCycles / completedCycles : null,
    avgOnHand: holdingUnits / n,
    maxOnHand,
    holdingCost,
    orderingCost,
    shortageCost,
    totalCost,
    annualCost: (totalCost * o.costs.daysPerYear) / n,
    trace,
  };
}

/**
 * Average metrics over `replications` lead-time scenarios (seeds seed, seed+1, …).
 * Using the same seed for two policies gives common random numbers.
 */
export function simulatePolicyReplications(o: PolicySimOptions, replications: number): PolicyMetrics {
  const runs = Array.from({ length: replications }, (_, r) => simulatePolicy({ ...o, seed: o.seed + r, record: false }));
  return averageMetrics(runs);
}

export function averageMetrics(runs: PolicyMetrics[]): PolicyMetrics {
  if (runs.length === 0) throw new Error("no simulation runs to average");
  const avg = (f: (m: PolicyMetrics) => number) => runs.reduce((a, m) => a + f(m), 0) / runs.length;
  const cycles = runs.reduce((a, m) => a + m.completedCycles, 0);
  const stockoutCycles = runs.reduce((a, m) => a + m.stockoutCycles, 0);
  return {
    days: runs[0].days,
    totalDemand: avg((m) => m.totalDemand),
    sales: avg((m) => m.sales),
    lost: avg((m) => m.lost),
    fillRate: avg((m) => m.sales) / avg((m) => m.totalDemand),
    stockoutDays: avg((m) => m.stockoutDays),
    stockoutDayRate: avg((m) => m.stockoutDayRate),
    orders: avg((m) => m.orders),
    completedCycles: cycles / runs.length,
    stockoutCycles: stockoutCycles / runs.length,
    cycleServiceLevel: cycles > 0 ? 1 - stockoutCycles / cycles : null,
    avgOnHand: avg((m) => m.avgOnHand),
    maxOnHand: Math.max(...runs.map((m) => m.maxOnHand)),
    holdingCost: avg((m) => m.holdingCost),
    orderingCost: avg((m) => m.orderingCost),
    shortageCost: avg((m) => m.shortageCost),
    totalCost: avg((m) => m.totalCost),
    annualCost: avg((m) => m.annualCost),
  };
}

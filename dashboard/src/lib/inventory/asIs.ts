/**
 * Performance of the *historical* (as-is) ordering behaviour recorded in the dataset, measured on
 * the same cost basis as the simulated policies.
 *
 * A stockout day is a day where sales used up all opening stock (Units Sold ≥ Inventory Level).
 * Lost demand is counted only on those days (Demand − Units Sold), because the dataset's Demand and
 * Units Sold do not reconcile exactly on ordinary days (a documented synthetic-data artefact).
 */
import type { SkuSeries } from "../data/types";
import type { CostParams } from "./cost";
import type { PolicyMetrics } from "./policySim";

export function asIsMetrics(sku: SkuSeries, from: number, to: number, costs: CostParams): PolicyMetrics {
  if (!(to > from)) throw new Error("as-is window must contain at least one day");
  const n = to - from;
  let totalDemand = 0, lost = 0, stockoutDays = 0, orders = 0, holdingUnits = 0, maxOnHand = 0;
  for (let t = from; t < to; t++) {
    totalDemand += sku.demand[t];
    holdingUnits += sku.inventory[t];
    maxOnHand = Math.max(maxOnHand, sku.inventory[t]);
    if (sku.unitsOrdered[t] > 0) orders++;
    if (sku.unitsSold[t] >= sku.inventory[t]) {
      stockoutDays++;
      lost += Math.max(0, sku.demand[t] - sku.unitsSold[t]);
    }
  }
  const holdingCost = holdingUnits * costs.holdingPerUnitDay;
  const orderingCost = orders * costs.orderCost;
  const shortageCost = lost * costs.shortagePerUnit;
  const totalCost = holdingCost + orderingCost + shortageCost;
  return {
    days: n,
    totalDemand,
    sales: totalDemand - lost,
    lost,
    fillRate: 1 - lost / totalDemand,
    stockoutDays,
    stockoutDayRate: stockoutDays / n,
    orders,
    // Cycle service is not identifiable from the ledger without knowing the as-is reorder rule,
    // so no cycles are reported (aggregations then skip the as-is policy for this measure).
    completedCycles: 0,
    stockoutCycles: 0,
    cycleServiceLevel: null,
    avgOnHand: holdingUnits / n,
    maxOnHand,
    holdingCost,
    orderingCost,
    shortageCost,
    totalCost,
    annualCost: (totalCost * costs.daysPerYear) / n,
  };
}

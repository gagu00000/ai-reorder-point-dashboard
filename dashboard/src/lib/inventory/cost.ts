/**
 * Inventory cost model. Defaults come from `costs.json` (assumptions, adjustable in the UI):
 *   holding  = holdingRatePerYear × unit price, per unit per year (converted to per day)
 *   ordering = fixed cost per purchase order
 *   shortage = marginRate × unit price, per unit of lost demand (lost sales)
 * The unit price is the SKU's median recorded price — used here only as a cost parameter,
 * never as a forecasting feature.
 */
import type { CostsFile } from "../data/types";

export interface CostSettings {
  holdingRatePerYear: number;
  orderCost: number;
  marginRate: number;
  daysPerYear: number;
}

export interface CostParams {
  unitPrice: number;
  holdingPerUnitDay: number;
  orderCost: number;
  shortagePerUnit: number;
  daysPerYear: number;
}

export function costParams(unitPrice: number, s: CostSettings): CostParams {
  if (!(unitPrice > 0)) throw new Error("unit price must be positive");
  return {
    unitPrice,
    holdingPerUnitDay: (s.holdingRatePerYear * unitPrice) / s.daysPerYear,
    orderCost: s.orderCost,
    shortagePerUnit: s.marginRate * unitPrice,
    daysPerYear: s.daysPerYear,
  };
}

export function skuCostParams(costs: CostsFile, skuId: string, overrides: Partial<CostSettings> = {}): CostParams {
  const sku = costs.skus[skuId];
  if (!sku) throw new Error(`No cost data for SKU ${skuId}`);
  return costParams(sku.medianPrice, { ...costs.defaults, ...overrides });
}

/** Economic order quantity √(2·D·S / h) with D in units/day and h per unit-day (result in units). */
export function economicOrderQuantity(dailyDemand: number, orderCost: number, holdingPerUnitDay: number): number {
  if (!(dailyDemand > 0 && orderCost > 0 && holdingPerUnitDay > 0)) throw new Error("EOQ inputs must be positive");
  return Math.sqrt((2 * dailyDemand * orderCost) / holdingPerUnitDay);
}

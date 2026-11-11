/**
 * The slide's dynamic safety-stock formula, implemented exactly as written:
 *
 *   Safety Stock = Z · √( σ_D² · L + D̄² · σ_L² )        Reorder point = D̄ · L + Safety Stock
 *
 *   Z   service-level factor, Φ⁻¹(cycle service level)
 *   σ_D demand standard deviation            (units/day)
 *   L   lead time                            (days)
 *   σ_L lead-time variability (std. dev.)    (days)
 *   D̄   average demand                       (units/day)
 *
 * With demand in units/day and lead time in days both terms under the root are in units²,
 * so safety stock and the reorder point are in units.
 */
import { normalCdf, normalPpf } from "../stats/normal";

export interface SafetyStockInputs {
  /** Target cycle service level: probability of no stockout during a replenishment lead time. */
  serviceLevel: number;
  dBar: number;
  sigmaD: number;
  leadTime: number;
  sigmaL: number;
}

export interface SafetyStockResult extends SafetyStockInputs {
  z: number;
  /** σ_D² · L — variance of lead-time demand caused by day-to-day demand uncertainty (units²). */
  demandTerm: number;
  /** D̄² · σ_L² — variance caused by uncertain lead time (units²). */
  leadTimeTerm: number;
  /** √(demandTerm + leadTimeTerm): std. dev. of demand during lead time (units). */
  sigmaDdlt: number;
  /** Share of that variance due to lead-time uncertainty (0–1). */
  leadTimeShare: number;
  /** D̄ · L: expected demand during lead time (units). */
  expectedDdlt: number;
  safetyStock: number;
  reorderPoint: number;
}

export function validateSafetyStockInputs(p: SafetyStockInputs): void {
  if (!(p.serviceLevel > 0 && p.serviceLevel < 1)) throw new Error("service level must be strictly between 0 and 1");
  for (const [name, v] of [["D̄", p.dBar], ["σ_D", p.sigmaD], ["L", p.leadTime], ["σ_L", p.sigmaL]] as const) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be a non-negative number`);
  }
}

export function computeSafetyStock(inputs: SafetyStockInputs): SafetyStockResult {
  validateSafetyStockInputs(inputs);
  const { serviceLevel, dBar, sigmaD, leadTime, sigmaL } = inputs;
  const z = normalPpf(serviceLevel);
  const demandTerm = sigmaD ** 2 * leadTime;
  const leadTimeTerm = dBar ** 2 * sigmaL ** 2;
  const variance = demandTerm + leadTimeTerm;
  const sigmaDdlt = Math.sqrt(variance);
  const safetyStock = z * sigmaDdlt;
  const expectedDdlt = dBar * leadTime;
  return {
    ...inputs,
    z,
    demandTerm,
    leadTimeTerm,
    sigmaDdlt,
    leadTimeShare: variance > 0 ? leadTimeTerm / variance : 0,
    expectedDdlt,
    safetyStock,
    reorderPoint: expectedDdlt + safetyStock,
  };
}

/** Cycle service level the Normal approximation implies for a given reorder point. */
export function impliedServiceLevel(reorderPoint: number, expectedDdlt: number, sigmaDdlt: number): number {
  if (sigmaDdlt === 0) return reorderPoint >= expectedDdlt ? 1 : 0;
  return normalCdf((reorderPoint - expectedDdlt) / sigmaDdlt);
}

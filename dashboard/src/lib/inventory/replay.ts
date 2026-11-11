/**
 * Replay a period of *actual* demand under several reorder-point policies with common random
 * numbers: every policy faces the same demand and the same lead-time draws, so differences in
 * service and cost come from the reorder points alone.
 */
import type { CostParams } from "./cost";
import type { LeadTimeModel } from "./leadTimeModel";
import { simulatePolicy, simulatePolicyReplications, type PolicyMetrics, type PolicyTrace } from "./policySim";

export interface ReplayPolicy {
  label: string;
  /** Constant reorder point, or one value per replayed day. */
  reorderPoint: number | ArrayLike<number>;
  /** Order quantity for this policy; defaults to the shared `orderQuantity`. */
  orderQuantity?: number;
}

export interface ReplayOptions {
  demand: ArrayLike<number>;   // actual demand for the replayed days
  initialOnHand: number;
  orderQuantity: number;
  leadTime: LeadTimeModel;
  costs: CostParams;
  policies: ReplayPolicy[];
  replications: number;
  seed: number;
}

export interface ReplayResult {
  label: string;
  metrics: PolicyMetrics;
  /** Day-by-day trace of the first replication (for charts). */
  trace: PolicyTrace;
}

export function replayPolicies(o: ReplayOptions): ReplayResult[] {
  return o.policies.map((p) => {
    const base = {
      demand: o.demand, reorderPoint: p.reorderPoint, orderQuantity: p.orderQuantity ?? o.orderQuantity, leadTime: o.leadTime,
      initialOnHand: o.initialOnHand, costs: o.costs, seed: o.seed,
    };
    return {
      label: p.label,
      metrics: simulatePolicyReplications(base, o.replications),
      trace: simulatePolicy({ ...base, record: true }).trace!,
    };
  });
}

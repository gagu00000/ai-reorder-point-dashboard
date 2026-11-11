/**
 * Recover supplier lead times from a SKU's inventory ledger (mirror of `extract_lead_times`).
 *
 * The ledger closes as inventory[t+1] = inventory[t] − sold[t] + receipt[t]. Each order placed on
 * day t is matched to the first unused overnight receipt of exactly the same quantity on or after
 * day t; an order received overnight after day t+k is available on day t+k+1 → lead time k+1 days.
 */
export interface LeadTimeMatch {
  orderDay: number;
  leadTime: number; // days
  quantity: number;
}

export function extractLeadTimes(
  inventory: ArrayLike<number>, unitsSold: ArrayLike<number>, unitsOrdered: ArrayLike<number>, maxLag = 30,
): { matches: LeadTimeMatch[]; unmatched: number } {
  const n = inventory.length;
  const receipts = new Float64Array(n).fill(Number.NaN);
  for (let t = 0; t < n - 1; t++) receipts[t] = inventory[t + 1] - (inventory[t] - unitsSold[t]);
  const used = new Uint8Array(n);
  const matches: LeadTimeMatch[] = [];
  let unmatched = 0;
  for (let t = 0; t < n; t++) {
    const q = unitsOrdered[t];
    if (!(q > 0)) continue;
    let hit = -1;
    for (let k = 0; k <= maxLag; k++) {
      const j = t + k;
      if (j >= n - 1) break;
      if (!used[j] && Math.abs(receipts[j] - q) < 0.5) { hit = k; break; }
    }
    if (hit < 0) {
      unmatched++;
    } else {
      used[t + hit] = 1;
      matches.push({ orderDay: t, leadTime: hit + 1, quantity: q });
    }
  }
  return { matches, unmatched };
}

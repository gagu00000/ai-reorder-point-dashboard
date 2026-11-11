/**
 * Data added by the user (single-day entry, CSV append, or recorded days revealed by streaming are
 * NOT stored here — streaming only moves the "as of" date). User rows override recorded values for
 * days inside the recorded period and extend the timeline beyond it.
 *
 * Rules (enforced by `validateUserRows`):
 *  - new rows start the day after the current "as of" date and cover consecutive days (no gaps);
 *  - one row per product and day;
 *  - a day beyond the end of the recorded data must have a row for every product (otherwise the
 *    other products would have no demand that day, and values are never invented);
 *  - weather is shared by a store and the epidemic flag by everyone, so rows for the same day must agree.
 */
import { addDays, parseIsoDate, toIsoDate } from "./calendar";
import { WEATHER_CODES, type Dataset, type WeatherCode } from "./types";

export interface UserRow {
  date: string;           // ISO yyyy-mm-dd
  skuId: string;          // "S001-P0001"
  demand: number;         // units/day
  promotion: 0 | 1;
  weather: WeatherCode;
  epidemic: 0 | 1;
  unitsSold?: number;
  inventory?: number;
  unitsOrdered?: number;
  discount?: number;
}

export interface ValidationResult {
  rows: UserRow[];        // normalised, sorted by date then SKU
  errors: string[];
  warnings: string[];
  /** Day index of the last added day (the new "as of" date) when valid. */
  lastDay: number | null;
}

const MS_PER_DAY = 86_400_000;

export function dayIndex(dataset: Dataset, iso: string): number {
  return Math.round((parseIsoDate(iso).getTime() - parseIsoDate(dataset.dates[0]).getTime()) / MS_PER_DAY);
}

export function validateUserRows(dataset: Dataset, observedUntil: number, rows: UserRow[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const skuIds = new Set(dataset.skus.map((s) => s.id));
  const storeOf = new Map(dataset.skus.map((s) => [s.id, s.storeIndex]));
  const seen = new Set<string>();
  const valid: UserRow[] = [];

  rows.forEach((r, i) => {
    const where = `Row ${i + 1}`;
    // Round-trip check: Date.UTC silently rolls invalid dates (2023-13-40) into real ones.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || toIsoDate(parseIsoDate(r.date)) !== r.date) {
      errors.push(`${where}: date "${r.date}" is not a valid YYYY-MM-DD date`);
      return;
    }
    if (!skuIds.has(r.skuId)) { errors.push(`${where}: unknown product ${r.skuId}`); return; }
    if (!Number.isFinite(r.demand) || r.demand < 0) { errors.push(`${where}: demand must be a number ≥ 0`); return; }
    if (r.promotion !== 0 && r.promotion !== 1) { errors.push(`${where}: promotion must be 0 or 1`); return; }
    if (r.epidemic !== 0 && r.epidemic !== 1) { errors.push(`${where}: epidemic must be 0 or 1`); return; }
    if (!WEATHER_CODES.includes(r.weather)) { errors.push(`${where}: weather must be one of ${WEATHER_CODES.join(", ")}`); return; }
    for (const k of ["unitsSold", "inventory", "unitsOrdered", "discount"] as const) {
      const v = r[k];
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) { errors.push(`${where}: ${k} must be a number ≥ 0`); return; }
    }
    const key = `${r.date}|${r.skuId}`;
    if (seen.has(key)) { errors.push(`${where}: duplicate row for ${r.skuId} on ${r.date}`); return; }
    seen.add(key);
    valid.push(r);
  });
  if (errors.length || valid.length === 0) {
    if (valid.length === 0 && errors.length === 0) errors.push("No rows to add");
    return { rows: [], errors, warnings, lastDay: null };
  }

  valid.sort((a, b) => (a.date === b.date ? a.skuId.localeCompare(b.skuId) : a.date.localeCompare(b.date)));
  const days = [...new Set(valid.map((r) => dayIndex(dataset, r.date)))].sort((a, b) => a - b);
  const expectedFirst = observedUntil + 1;
  if (days[0] !== expectedFirst) {
    errors.push(`Data must start on ${dateAt(dataset, expectedFirst)} (the day after the current planning date); found ${dateAt(dataset, days[0])}`);
  }
  days.forEach((d, i) => {
    if (i > 0 && d !== days[i - 1] + 1) errors.push(`Days must be consecutive: nothing for ${dateAt(dataset, days[i - 1] + 1)}`);
  });

  const lastRecorded = dataset.dates.length - 1;
  for (const d of days) {
    const dayRows = valid.filter((r) => dayIndex(dataset, r.date) === d);
    if (d > lastRecorded && dayRows.length !== skuIds.size) {
      errors.push(`${dateAt(dataset, d)} is after the recorded data, so it needs a row for every product (${dayRows.length} of ${skuIds.size} given)`);
    }
    const epidemics = new Set(dayRows.map((r) => r.epidemic));
    if (epidemics.size > 1) errors.push(`${dateAt(dataset, d)}: rows disagree on the epidemic flag (it applies to all products)`);
    const weatherByStore = new Map<number, Set<string>>();
    for (const r of dayRows) {
      const s = storeOf.get(r.skuId)!;
      if (!weatherByStore.has(s)) weatherByStore.set(s, new Set());
      weatherByStore.get(s)!.add(r.weather);
    }
    for (const [s, set] of weatherByStore) {
      if (set.size > 1) errors.push(`${dateAt(dataset, d)}: rows for store ${dataset.stores[s].id} disagree on the weather (it is shared by the store)`);
    }
    if (d <= lastRecorded) {
      const r0 = dayRows[0];
      if (r0.epidemic !== dataset.epidemic[d]) {
        warnings.push(`${dateAt(dataset, d)}: epidemic set to ${r0.epidemic ? "yes" : "no"} — this changes it for every product that day`);
      }
      for (const r of dayRows) {
        const s = storeOf.get(r.skuId)!;
        if (WEATHER_CODES[dataset.stores[s].weather[d]] !== r.weather) {
          warnings.push(`${dateAt(dataset, d)}: weather for store ${dataset.stores[s].id} set to ${r.weather} — this applies to all its products`);
          break;
        }
      }
    }
  }
  if (errors.length) return { rows: [], errors: dedupe(errors), warnings, lastDay: null };
  return { rows: valid, errors: [], warnings: dedupe(warnings), lastDay: days[days.length - 1] };
}

function dateAt(dataset: Dataset, d: number): string {
  return d < dataset.dates.length ? dataset.dates[d] : addDays(dataset.dates[dataset.dates.length - 1], d - dataset.dates.length + 1);
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)].slice(0, 12);
}

function grow(src: Float64Array, n: number, fill: number): Float64Array {
  const out = new Float64Array(n).fill(fill);
  out.set(src.subarray(0, Math.min(src.length, n)));
  return out;
}

/**
 * Recorded dataset with user rows applied (later rows win). Returns a new dataset; the input is not modified.
 * Extension days get inventory/orders 0 and units sold = demand unless the row says otherwise.
 */
export function applyUserRows(base: Dataset, rows: UserRow[]): Dataset {
  if (rows.length === 0) return base;
  const maxDay = rows.reduce((m, r) => Math.max(m, dayIndex(base, r.date)), base.dates.length - 1);
  const n = maxDay + 1;
  const dates = base.dates.slice();
  while (dates.length < n) dates.push(addDays(dates[dates.length - 1], 1));
  const epidemic = grow(base.epidemic, n, 0);
  const stores = base.stores.map((s) => {
    const weather = new Int8Array(n);
    weather.set(s.weather);
    return { ...s, weather };
  });
  const skus = base.skus.map((s) => ({
    ...s,
    demand: grow(s.demand, n, Number.NaN),
    unitsSold: grow(s.unitsSold, n, Number.NaN),
    inventory: grow(s.inventory, n, 0),
    unitsOrdered: grow(s.unitsOrdered, n, 0),
    promotion: grow(s.promotion, n, 0),
    discount: grow(s.discount, n, 0),
  }));
  const index = new Map(skus.map((s, i) => [s.id, i]));
  for (const r of rows) {
    const d = dayIndex(base, r.date);
    const sku = skus[index.get(r.skuId)!];
    sku.demand[d] = r.demand;
    sku.promotion[d] = r.promotion;
    if (r.discount !== undefined) sku.discount[d] = r.discount;
    if (r.inventory !== undefined) sku.inventory[d] = r.inventory;
    if (r.unitsOrdered !== undefined) sku.unitsOrdered[d] = r.unitsOrdered;
    sku.unitsSold[d] = r.unitsSold ?? (d >= base.dates.length ? r.demand : sku.unitsSold[d]);
    epidemic[d] = r.epidemic;
    stores[sku.storeIndex].weather[d] = WEATHER_CODES.indexOf(r.weather);
  }
  return { ...base, dates, epidemic, stores, skus };
}

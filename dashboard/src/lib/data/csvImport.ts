/**
 * CSV append. Accepts the same column names as the Kaggle file (extra columns are ignored), so rows
 * can be pasted straight from the source format. Price columns are dropped with a warning: they are
 * generated from same-day demand and would leak the target.
 */
import Papa from "papaparse";
import { WEATHER_CODES, type WeatherCode } from "./types";
import type { UserRow } from "./userData";

export const CSV_COLUMNS = {
  required: ["Date", "Store ID", "Product ID", "Demand", "Promotion", "Weather Condition", "Epidemic"],
  optional: ["Units Sold", "Inventory Level", "Units Ordered", "Discount"],
  ignoredLeaky: ["Price", "Competitor Pricing"],
} as const;

export interface CsvParseResult {
  rows: UserRow[];
  errors: string[];
  warnings: string[];
}

const MAX_ROWS = 20_000;

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

function flag(v: string | undefined): 0 | 1 | null {
  const t = (v ?? "").trim().toLowerCase();
  if (["1", "true", "yes"].includes(t)) return 1;
  if (["0", "false", "no"].includes(t)) return 0;
  return null;
}

function normaliseDate(v: string): string {
  const t = v.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : t;
}

export function parseCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.errors.length) errors.push(...parsed.errors.slice(0, 5).map((e) => `Line ${(e.row ?? 0) + 2}: ${e.message}`));
  const header = parsed.meta.fields ?? [];
  const missing = CSV_COLUMNS.required.filter((c) => !header.includes(c));
  if (missing.length) {
    errors.push(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    return { rows: [], errors, warnings };
  }
  const leaky = CSV_COLUMNS.ignoredLeaky.filter((c) => header.includes(c));
  if (leaky.length) warnings.push(`${leaky.join(" and ")} ignored: price is generated from same-day demand in this dataset (leakage)`);
  if (parsed.data.length > MAX_ROWS) {
    errors.push(`Too many rows (${parsed.data.length}); the limit is ${MAX_ROWS}`);
    return { rows: [], errors, warnings };
  }

  const rows: UserRow[] = [];
  parsed.data.forEach((rec, i) => {
    const line = `Line ${i + 2}`;
    const promotion = flag(rec.Promotion);
    const epidemic = flag(rec.Epidemic);
    const weather = (rec["Weather Condition"] ?? "").trim();
    const demand = num(rec.Demand);
    const problems: string[] = [];
    if (promotion === null) problems.push("Promotion must be 0 or 1");
    if (epidemic === null) problems.push("Epidemic must be 0 or 1");
    if (!WEATHER_CODES.includes(weather as WeatherCode)) problems.push(`Weather must be one of ${WEATHER_CODES.join(", ")}`);
    if (demand === undefined || Number.isNaN(demand)) problems.push("Demand must be a number");
    const optional = {
      unitsSold: num(rec["Units Sold"]),
      inventory: num(rec["Inventory Level"]),
      unitsOrdered: num(rec["Units Ordered"]),
      discount: num(rec.Discount),
    };
    for (const [k, v] of Object.entries(optional)) if (Number.isNaN(v)) problems.push(`${k} must be a number`);
    if (problems.length) {
      errors.push(`${line}: ${problems.join("; ")}`);
      return;
    }
    rows.push({
      date: normaliseDate(rec.Date ?? ""),
      skuId: `${(rec["Store ID"] ?? "").trim()}-${(rec["Product ID"] ?? "").trim()}`,
      demand: demand!,
      promotion: promotion!,
      weather: weather as WeatherCode,
      epidemic: epidemic!,
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
    });
  });
  return { rows, errors: errors.slice(0, 12), warnings };
}

/** A header plus one example row, for the "download template" link. */
export function csvTemplate(example: UserRow): string {
  const [store, product] = example.skuId.split("-");
  const header = [...CSV_COLUMNS.required, ...CSV_COLUMNS.optional].join(",");
  const row = [example.date, store, product, example.demand, example.promotion, example.weather, example.epidemic, "", "", "", ""].join(",");
  return `${header}\n${row}\n`;
}

/** Display formatting. Costs are in the dataset's currency units (not specified by the source). */
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const two = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (v: number) => (Number.isFinite(v) ? int.format(v) : "—");
export const fmt1 = (v: number) => (Number.isFinite(v) ? one.format(v) : "—");
export const fmt2 = (v: number) => (Number.isFinite(v) ? two.format(v) : "—");
export const fmtCompact = (v: number) => (Number.isFinite(v) ? compact.format(v) : "—");
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`;
export const fmtSignedPct = (v: number, digits = 1) =>
  Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%` : "—";
export const fmtSigned = (v: number, digits = 0) =>
  Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}` : "—";

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

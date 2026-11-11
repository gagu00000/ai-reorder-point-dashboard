/** Calendar helpers. All dates are ISO `YYYY-MM-DD` strings interpreted in UTC. */

const MS_PER_DAY = 86_400_000;

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * MS_PER_DAY));
}

/** Day of year, 1-based (1 Jan = 1), matching pandas `dayofyear`. */
export function dayOfYear(iso: string): number {
  const date = parseIsoDate(iso);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.round((date.getTime() - start) / MS_PER_DAY) + 1;
}

/** Yearly Fourier terms, two harmonics: [sin1, cos1, sin2, cos2]. */
export function fourierTerms(iso: string): [number, number, number, number] {
  const angle = (2 * Math.PI * (dayOfYear(iso) - 1)) / 365.25;
  return [Math.sin(angle), Math.cos(angle), Math.sin(2 * angle), Math.cos(2 * angle)];
}

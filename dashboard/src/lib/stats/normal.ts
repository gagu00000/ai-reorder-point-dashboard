/** Standard Normal distribution: CDF and quantile (inverse CDF, used for the service-level factor Z). */

/** Φ(x) via the complementary error function (W. J. Cody's rational approximation, |error| < 1e-14). */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Φ⁻¹(p): Acklam's rational approximation refined by one Halley step,
 * accurate to ~1e-15 on (0, 1).
 */
export function normalPpf(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`normalPpf requires 0 < p < 1, got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Complementary error function (Cody 1969 rational Chebyshev approximations). */
export function erfc(x: number): number {
  const ax = Math.abs(x);
  let result: number;
  if (ax < 0.5) {
    const t = x * x;
    const top = (((0.185777706184603153 * t + 3.16112374387056560) * t + 113.864154151050156) * t + 377.485237685302021) * t + 3209.37758913846947;
    const bot = (((t + 23.6012909523441209) * t + 244.024637934444173) * t + 1282.61652607737228) * t + 2844.23683343917062;
    return 1 - (x * top) / bot;
  } else if (ax < 4) {
    const top = ((((((((2.15311535474403846e-8 * ax + 5.64188496988670089e-1) * ax + 8.88314979438837594) * ax + 66.1191906371416295) * ax + 298.635138197400131) * ax + 881.952221241769090) * ax + 1712.04761263407058) * ax + 2051.07837782607147) * ax + 1230.33935479799725);
    const bot = (((((((ax + 15.7449261107098347) * ax + 117.693950891312499) * ax + 537.181101862009858) * ax + 1621.38957456669019) * ax + 3290.79923573345963) * ax + 4362.61909014324716) * ax + 3439.36767414372164) * ax + 1230.33935480374942;
    result = Math.exp(-ax * ax) * (top / bot);
  } else {
    const z = 1 / (ax * ax);
    const top = ((((1.63153871373020978e-2 * z + 3.05326634961232344e-1) * z + 3.60344899949804439e-1) * z + 1.25781726111229246e-1) * z + 1.60837851487422766e-2) * z + 6.58749161529837803e-4;
    const bot = ((((z + 2.56852019228982242) * z + 1.87295284992346725) * z + 5.27905102951428412e-1) * z + 6.05183413124413191e-2) * z + 2.33520497626869185e-3;
    result = (Math.exp(-ax * ax) / ax) * (1 / Math.sqrt(Math.PI) - (z * top) / bot);
  }
  return x < 0 ? 2 - result : result;
}

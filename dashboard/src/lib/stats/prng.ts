/**
 * Seeded pseudo-random numbers for reproducible simulations.
 *
 * xoshiro128** (Blackman & Vigna) seeded through splitmix32. Seeding every policy simulation with
 * the same value gives *common random numbers*: baseline and AI policies face identical demand and
 * lead-time draws, so differences between them are caused by the policy, not by noise.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    let x = seed >>> 0;
    const splitmix = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = splitmix();
    this.s1 = splitmix();
    this.s2 = splitmix();
    this.s3 = splitmix();
  }

  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform on [0, 1) with 53 bits of precision. */
  uniform(): number {
    const hi = this.nextUint32() >>> 5;  // 27 bits
    const lo = this.nextUint32() >>> 6;  // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.uniform() * n);
  }

  /** Standard Normal (Marsaglia polar method). */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u: number, v: number, s: number;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareNormal = v * m;
    return u * m;
  }

  /** Gamma(shape k, scale θ) via Marsaglia–Tsang (with the k < 1 boost). Mean kθ, variance kθ². */
  gamma(shape: number, scale: number): number {
    if (shape <= 0 || scale <= 0) throw new Error("gamma needs positive shape and scale");
    if (shape < 1) {
      const u = this.uniform();
      return this.gamma(shape + 1, scale) * Math.pow(u === 0 ? Number.MIN_VALUE : u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniform();
      if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  /** Index drawn from a discrete distribution given its cumulative probabilities. */
  discrete(cumulative: ArrayLike<number>): number {
    const u = this.uniform() * cumulative[cumulative.length - 1];
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u < cumulative[mid]) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

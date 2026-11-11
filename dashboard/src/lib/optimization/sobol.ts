/**
 * Sobol low-discrepancy sequence (Gray-code construction, Joe & Kuo direction numbers) for up to
 * 6 dimensions. Used for the space-filling initial design of Bayesian optimisation and for the
 * candidate set on which the acquisition function is maximised. The all-zero first point is skipped.
 */
const BITS = 32;
// [degree s, polynomial coefficient a, initial direction numbers m_1..m_s] for dimensions 2..6
const JOE_KUO: [number, number, number[]][] = [
  [1, 0, [1]],
  [2, 1, [1, 3]],
  [3, 1, [1, 3, 1]],
  [3, 2, [1, 1, 1]],
  [4, 1, [1, 1, 3, 3]],
];
export const SOBOL_MAX_DIM = JOE_KUO.length + 1;

function directionNumbers(dim: number): Uint32Array[] {
  const v: Uint32Array[] = [];
  const first = new Uint32Array(BITS);
  for (let k = 0; k < BITS; k++) first[k] = (1 << (BITS - 1 - k)) >>> 0;
  v.push(first);
  for (let j = 1; j < dim; j++) {
    const [s, a, m] = JOE_KUO[j - 1];
    const vj = new Uint32Array(BITS);
    for (let k = 0; k < s; k++) vj[k] = (m[k] << (BITS - 1 - k)) >>> 0;
    for (let k = s; k < BITS; k++) {
      let x = (vj[k - s] ^ (vj[k - s] >>> s)) >>> 0;
      for (let i = 1; i < s; i++) if ((a >>> (s - 1 - i)) & 1) x = (x ^ vj[k - i]) >>> 0;
      vj[k] = x;
    }
    v.push(vj);
  }
  return v;
}

export class Sobol {
  private readonly v: Uint32Array[];
  private readonly state: Uint32Array;
  private index = 0;

  constructor(readonly dim: number) {
    if (dim < 1 || dim > SOBOL_MAX_DIM) throw new Error(`Sobol supports 1..${SOBOL_MAX_DIM} dimensions`);
    this.v = directionNumbers(dim);
    this.state = new Uint32Array(dim);
  }

  /** Next point in [0, 1)^dim. */
  next(): number[] {
    // index of the lowest zero bit of the current counter (Gray-code update)
    let c = 0;
    let i = this.index;
    while (i & 1) { i >>>= 1; c++; }
    this.index++;
    const out = new Array<number>(this.dim);
    for (let j = 0; j < this.dim; j++) {
      this.state[j] = (this.state[j] ^ this.v[j][c]) >>> 0;
      out[j] = this.state[j] / 4294967296;
    }
    return out;
  }

  take(n: number): number[][] {
    return Array.from({ length: n }, () => this.next());
  }
}

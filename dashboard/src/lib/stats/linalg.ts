/**
 * Solve A x = b for a symmetric positive-definite matrix A (row-major, n x n) by Cholesky
 * decomposition. Used for ridge regression and, later, Gaussian-process posteriors.
 */
export function choleskyDecompose(a: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (s <= 0) throw new Error("matrix is not positive definite");
        l[i * n + i] = Math.sqrt(s);
      } else {
        l[i * n + j] = s / l[j * n + j];
      }
    }
  }
  return l;
}

/** Solve L L^T x = b given the lower-triangular Cholesky factor L. */
export function choleskySolveFactor(l: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
    y[i] = s / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k];
    x[i] = s / l[i * n + i];
  }
  return x;
}

export function choleskySolve(a: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  return choleskySolveFactor(choleskyDecompose(a, n), n, b);
}

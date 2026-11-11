/**
 * CSP-safe replacement for claygl's `new Function(...)` size expressions.
 *
 * echarts-gl's post-processing graph sizes its render targets with strings such as
 * `expr([width * dpr / 4, height * dpr / 4])`, which claygl compiles with `new Function` — blocked by
 * a Content-Security-Policy without 'unsafe-eval'. This evaluator supports exactly that grammar:
 * a term, or `[term, term]`, where a term is operands (width, height, dpr, numbers) joined by * or /,
 * evaluated left to right (same precedence, as in JavaScript). Anything else is rejected.
 *
 * It must stay self-contained: the build injects its source text into claygl (see vite.config.ts).
 */
export function compileSizeExpression(source: string): (width: number, height: number, dpr?: number) => number | number[] {
  const text = source.trim();
  const isArray = text.startsWith("[") && text.endsWith("]");
  const parts = isArray ? text.slice(1, -1).split(",") : [text];

  function operand(token: string, width: number, height: number, dpr: number | undefined): number {
    if (token === "width") return width;
    if (token === "height") return height;
    if (token === "dpr") return dpr as number;
    return Number(token);
  }

  function compileTerm(term: string) {
    const tokens = term.trim().split(/\s*([*/])\s*/);
    if (tokens.length % 2 === 0) return null;
    for (let i = 0; i < tokens.length; i++) {
      const valid = i % 2 === 1 ? tokens[i] === "*" || tokens[i] === "/" : /^(width|height|dpr|\d+(\.\d+)?)$/.test(tokens[i]);
      if (!valid) return null;
    }
    return (width: number, height: number, dpr: number | undefined) => {
      let acc = operand(tokens[0], width, height, dpr);
      for (let i = 1; i < tokens.length; i += 2) {
        const b = operand(tokens[i + 1], width, height, dpr);
        acc = tokens[i] === "*" ? acc * b : acc / b;
      }
      return acc;
    };
  }

  const terms = parts.map(compileTerm);
  if (parts.length === 0 || terms.some((t) => t === null)) throw new Error("Invalid expression.");
  return (width, height, dpr) => {
    const values = terms.map((t) => t!(width, height, dpr));
    return isArray ? values : values[0];
  };
}

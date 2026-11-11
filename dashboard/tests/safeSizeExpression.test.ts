/** The CSP-safe evaluator must give exactly what claygl's `new Function` gave for every expression echarts-gl uses. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileSizeExpression } from "../src/build/safeSizeExpression";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith(".js") ? [p] : [];
  });
}

const libDir = resolve(__dirname, "../node_modules/echarts-gl/lib");
const used = [...new Set(filesUnder(libDir).flatMap((f) => [...readFileSync(f, "utf-8").matchAll(/expr\((.*?)\)['"]/g)].map((m) => m[1])))];

describe("CSP-safe size expressions", () => {
  it("finds the expressions echarts-gl ships", () => {
    expect(used.length).toBeGreaterThan(10);
  });

  it("matches JavaScript evaluation for every one of them", () => {
    for (const src of used) {
      const reference = new Function("width", "height", "dpr", `return ${src}`) as (w: number, h: number, d: number) => unknown;
      for (const [w, h, d] of [[1, 1, 1], [1280, 720, 2], [333, 777, 1.5]]) {
        expect(compileSizeExpression(src)(w, h, d), src).toEqual(reference(w, h, d));
      }
    }
  });

  it("rejects anything that is not plain size arithmetic", () => {
    for (const bad of ["alert(1)", "width + height", "window.x", "[width, fetch('x')]", "width * * 2", "", "constructor"]) {
      expect(() => compileSizeExpression(bad), bad).toThrow("Invalid expression.");
    }
  });
});

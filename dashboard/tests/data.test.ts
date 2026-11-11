import { describe, expect, it } from "vitest";
import { addDays, dayOfYear } from "../src/lib/data/calendar";
import { skuIndexById } from "../src/lib/data/dataset";
import { buildExog } from "../src/lib/data/features";
import { extractLeadTimes } from "../src/lib/data/leadTime";
import { N_EXOG } from "../src/lib/data/types";
import { loadDataset, loadLeadTimes, loadSeriesFile, maxAbsDiff, readFixture } from "./helpers";

describe("dataset", () => {
  const ds = loadDataset();

  it("has 100 SKUs × 760 days and the documented split", () => {
    expect(ds.skus).toHaveLength(100);
    expect(ds.dates).toHaveLength(760);
    expect(ds.dates[0]).toBe("2022-01-01");
    expect(ds.dates[759]).toBe("2024-01-30");
    expect(ds.split.trainEndIdx).toBe(609);
    expect(ds.split.valEndIdx).toBe(699);
    expect(ds.split.holdoutStartIdx).toBe(700);
  });

  it("leakage guard: no price or competitor-price field is shipped to the browser", () => {
    const file = loadSeriesFile();
    for (const sku of file.skus) {
      for (const key of Object.keys(sku)) expect(key.toLowerCase()).not.toMatch(/price|competitor/);
    }
    expect(file.meta.excludedColumns.leakage).toEqual(["Price", "Competitor Pricing"]);
  });

  it("calendar helpers match pandas", () => {
    expect(dayOfYear("2022-01-01")).toBe(1);
    expect(dayOfYear("2024-12-31")).toBe(366);
    expect(addDays("2024-01-30", 2)).toBe("2024-02-01");
  });
});

describe("exogenous features", () => {
  const ds = loadDataset();

  it("epidemic is held at the origin's value after the origin (persistence, no look-ahead)", () => {
    // 2023-12-26 is the last day before the Dec-2023 epidemic starts.
    const origin = ds.dates.indexOf("2023-12-26");
    expect(ds.epidemic[origin]).toBe(0);
    expect(ds.epidemic[origin + 1]).toBe(1);
    const exog = buildExog(ds, 0, origin, 14);
    for (let t = origin + 1; t <= origin + 14; t++) expect(exog[t * N_EXOG + 1]).toBe(0);
    expect(exog[origin * N_EXOG + 1]).toBe(0);
  });

  it("scenario inputs override future promotion and epidemic", () => {
    const origin = 699;
    const exog = buildExog(ds, 0, origin, 3, { promotion: [1, 1, 0], epidemic: [1, 1, 1] });
    expect([1, 2, 3].map((h) => exog[(origin + h) * N_EXOG])).toEqual([1, 1, 0]);
    expect([1, 2, 3].map((h) => exog[(origin + h) * N_EXOG + 1])).toEqual([1, 1, 1]);
  });

  it("extends past the last observed day with dated Fourier terms", () => {
    const origin = 759;
    const exog = buildExog(ds, 0, origin, 5);
    expect(exog.length).toBe((origin + 6) * N_EXOG);
    expect(Number.isFinite(exog[(origin + 5) * N_EXOG + 8])).toBe(true);
  });

  it("matches the Python encoder features used by the LSTM", () => {
    const fx = readFixture<{ sku: string; origin: number; encoder: number[]; future: number[] }[]>("lstm.json");
    for (const c of fx) {
      const idx = skuIndexById(ds, c.sku);
      const exog = buildExog(ds, idx, c.origin, 14);
      const fut = exog.subarray((c.origin + 1) * N_EXOG, (c.origin + 15) * N_EXOG);
      expect(maxAbsDiff(fut, c.future)).toBeLessThan(1e-6);
    }
  });
});

describe("lead-time extraction", () => {
  const ds = loadDataset();

  it("matches the Python matcher on S002-P0005", () => {
    const fx = readFixture<{ sku: string; nMatched: number; unmatched: number; first: number[][]; meanL: number }>("leadtime.json");
    const s = ds.skus[skuIndexById(ds, fx.sku)];
    const { matches, unmatched } = extractLeadTimes(s.inventory, s.unitsSold, s.unitsOrdered);
    expect(matches).toHaveLength(fx.nMatched);
    expect(unmatched).toBe(fx.unmatched);
    expect(matches.slice(0, 25).map((m) => [m.orderDay, m.leadTime, m.quantity])).toEqual(fx.first);
  });

  it("reproduces the 99.8% match rate across all SKUs", () => {
    const lt = loadLeadTimes();
    let matched = 0;
    let total = 0;
    for (const s of ds.skus) {
      const r = extractLeadTimes(s.inventory, s.unitsSold, s.unitsOrdered);
      matched += r.matches.length;
      total += r.matches.length + r.unmatched;
    }
    expect(matched).toBe(lt.matchedOrders);
    expect(total).toBe(lt.totalOrders);
    expect(matched / total).toBeGreaterThan(0.997);
  });
});

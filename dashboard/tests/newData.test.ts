/** Adding new data: validation rules, applying rows, CSV import, out-of-sample day scoring, adaptive bands. */
import { describe, expect, it } from "vitest";
import { forecastSku, scoreDay } from "../src/engine/forecastService";
import { withUserRows, type AppData } from "../src/engine/appData";
import { parseCsv, csvTemplate } from "../src/lib/data/csvImport";
import { buildDataset } from "../src/lib/data/dataset";
import type { CostsFile, SeriesFile } from "../src/lib/data/types";
import { applyUserRows, validateUserRows, type UserRow } from "../src/lib/data/userData";
import { loadDataset, loadLeadTimes, loadModelConfig, readData } from "./helpers";

const ds = loadDataset();
const ORIGIN = 699; // planning starts here
const next = ds.dates[ORIGIN + 1]; // 2023-12-02
const row = (over: Partial<UserRow> = {}): UserRow => ({
  date: next, skuId: "S001-P0001", demand: 150, promotion: 1, weather: "Sunny", epidemic: 0, ...over,
});
const allSkuRows = (date: string): UserRow[] => ds.skus.map((s) => ({ date, skuId: s.id, demand: 90, promotion: 0, weather: "Cloudy", epidemic: 0 }));

describe("validating new rows", () => {
  it("accepts one product's next day and reports the new planning day", () => {
    const store = ds.skus[0].storeIndex;
    const v = validateUserRows(ds, ORIGIN, [row({ weather: ["Cloudy", "Rainy", "Snowy", "Sunny"][ds.stores[store].weather[ORIGIN + 1]] as UserRow["weather"], epidemic: ds.epidemic[ORIGIN + 1] as 0 | 1 })]);
    expect(v.errors).toEqual([]);
    expect(v.lastDay).toBe(ORIGIN + 1);
  });

  it("rejects rows that do not start the day after the planning date", () => {
    const v = validateUserRows(ds, ORIGIN, [row({ date: ds.dates[ORIGIN + 3] })]);
    expect(v.errors.join(" ")).toMatch(/must start on 2023-12-02/);
  });

  it("rejects gaps, duplicates, unknown products and bad values", () => {
    expect(validateUserRows(ds, ORIGIN, [row(), row({ date: ds.dates[ORIGIN + 3] })]).errors.join(" ")).toMatch(/consecutive/);
    expect(validateUserRows(ds, ORIGIN, [row(), row()]).errors.join(" ")).toMatch(/duplicate/);
    expect(validateUserRows(ds, ORIGIN, [row({ skuId: "S009-P0001" })]).errors.join(" ")).toMatch(/unknown product/);
    expect(validateUserRows(ds, ORIGIN, [row({ demand: -5 })]).errors.join(" ")).toMatch(/demand/);
    expect(validateUserRows(ds, ORIGIN, [row({ date: "2023-13-40" })]).errors.join(" ")).toMatch(/not a valid/);
  });

  it("warns when a row changes a store-wide or global driver", () => {
    const v = validateUserRows(ds, ORIGIN, [row({ epidemic: ds.epidemic[ORIGIN + 1] ? 0 : 1 })]);
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(" ")).toMatch(/epidemic/i);
  });

  it("requires every product on days after the recorded data, and consistent shared drivers", () => {
    const last = ds.dates.length - 1;
    const after = "2024-01-31";
    expect(validateUserRows(ds, last, [row({ date: after })]).errors.join(" ")).toMatch(/every product/);
    expect(validateUserRows(ds, last, allSkuRows(after)).errors).toEqual([]);
    const clash = allSkuRows(after);
    clash[0] = { ...clash[0], epidemic: 1 };
    expect(validateUserRows(ds, last, clash).errors.join(" ")).toMatch(/disagree on the epidemic/);
  });
});

describe("applying rows", () => {
  it("overrides one product's recorded day without touching the others or the input", () => {
    const before = ds.skus[1].demand[ORIGIN + 1];
    const out = applyUserRows(ds, [row({ demand: 4321 })]);
    expect(out.skus[0].demand[ORIGIN + 1]).toBe(4321);
    expect(out.skus[0].promotion[ORIGIN + 1]).toBe(1);
    expect(out.skus[1].demand[ORIGIN + 1]).toBe(before);
    expect(ds.skus[0].demand[ORIGIN + 1]).not.toBe(4321);
    expect(out.dates).toHaveLength(ds.dates.length);
  });

  it("extends the timeline when every product has a new day", () => {
    const out = applyUserRows(ds, allSkuRows("2024-01-31"));
    expect(out.dates).toHaveLength(ds.dates.length + 1);
    expect(out.dates.at(-1)).toBe("2024-01-31");
    expect(out.skus.every((s) => s.demand[ds.dates.length] === 90)).toBe(true);
    expect(out.skus[0].unitsSold[ds.dates.length]).toBe(90);
  });
});

describe("CSV import", () => {
  it("parses the Kaggle column layout, ignoring price with a warning", () => {
    const csv = [
      "Date,Store ID,Product ID,Category,Region,Inventory Level,Units Sold,Units Ordered,Price,Discount,Weather Condition,Promotion,Competitor Pricing,Seasonality,Epidemic,Demand",
      `${next},S001,P0001,Electronics,North,200,95,0,72.5,5,Sunny,1,80.1,Winter,0,120`,
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/Price and Competitor Pricing ignored/);
    expect(r.rows[0]).toMatchObject({ date: next, skuId: "S001-P0001", demand: 120, promotion: 1, weather: "Sunny", epidemic: 0, inventory: 200, unitsSold: 95, discount: 5 });
    expect(Object.keys(r.rows[0])).not.toContain("price");
  });

  it("reports missing columns and bad values with line numbers", () => {
    expect(parseCsv("Date,Store ID\n2023-12-02,S001").errors.join(" ")).toMatch(/Missing columns/);
    const bad = parseCsv(`Date,Store ID,Product ID,Demand,Promotion,Weather Condition,Epidemic\n${next},S001,P0001,abc,2,Foggy,0`);
    expect(bad.errors[0]).toMatch(/Line 2/);
    expect(bad.errors[0]).toMatch(/Promotion/);
    expect(bad.errors[0]).toMatch(/Weather/);
    expect(bad.errors[0]).toMatch(/Demand/);
  });

  it("accepts files saved with a UTF-8 byte-order mark (Excel)", () => {
    const r = parseCsv(`﻿Date,Store ID,Product ID,Demand,Promotion,Weather Condition,Epidemic\r\n${next},S001,P0001,120,0,Snowy,0\r\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ date: next, skuId: "S001-P0001", demand: 120 });
  });

  it("the downloadable template parses back to a valid row", () => {
    const r = parseCsv(csvTemplate(row()));
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ skuId: "S001-P0001", demand: 150 });
  });
});

describe("models update as data arrives", () => {
  const series = readData<SeriesFile>("series.json");
  const base: AppData = { dataset: buildDataset(series), meta: series.meta, leadTimes: loadLeadTimes(), costs: readData<CostsFile>("costs.json"), config: loadModelConfig() };

  it("scores each model on the arriving day using only earlier data", async () => {
    const s = await scoreDay(base, ORIGIN + 1, null);
    expect(s.date).toBe(next);
    expect(s.skus).toBe(100);
    for (const k of ["baseline", "ets", "ridge", "ensemble"] as const) {
      expect(s.models[k]!.actual).toBe(ds.skus.reduce((a, x) => a + x.demand[ORIGIN + 1], 0));
      expect(s.models[k]!.absError).toBeGreaterThan(0);
    }
    // the score must not change if the arriving day's own value were different from what the model saw before it
    const altered = withUserRows(base, [row({ demand: 5000 })]);
    const s2 = await scoreDay(altered, ORIGIN + 1, null);
    expect(s2.models.ridge!.actual - s.models.ridge!.actual).toBeCloseTo(5000 - ds.skus[0].demand[ORIGIN + 1], 6);
  });

  it("forecasts move with new data, and bands rescale to the product's recent errors", async () => {
    const before = await forecastSku(base, { skuId: "S001-P0001", origin: ORIGIN, historyDays: 30 }, null);
    const shocked = withUserRows(base, [row({ demand: 900, promotion: 0 })]);
    const after = await forecastSku(shocked, { skuId: "S001-P0001", origin: ORIGIN + 1, historyDays: 30 }, null);
    expect(after.origin).toBe(ORIGIN + 1);
    expect(after.forecasts.ridge![0]).toBeGreaterThan(before.forecasts.ridge![0]);
    expect(before.bandScale).toBeGreaterThan(0.5);
    expect(before.bandScale).toBeLessThan(2.5);
  });
});

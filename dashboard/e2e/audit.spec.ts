/** Regression tests for the issues found in the end-to-end audit. */
import { expect, openPage, test } from "./fixtures";

const csv = (rows: string[]) => Buffer.from(["Date,Store ID,Product ID,Demand,Promotion,Weather Condition,Epidemic", ...rows].join("\n"));

test("a CSV preview is discarded when the planning date moves, so it can never be applied out of order", async ({ page }) => {
  await page.goto("/forecasting");
  await page.getByRole("radio", { name: "Upload CSV" }).click();
  await page.locator("#csv-input").setInputFiles({ name: "next.csv", mimeType: "text/csv", buffer: csv(["2023-12-02,S001,P0001,130,1,Snowy,0"]) });
  await expect(page.getByText(/ready to append/)).toBeVisible();

  await page.getByRole("radio", { name: "Stream recorded days" }).click();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");

  await page.getByRole("radio", { name: "Upload CSV" }).click();
  await expect(page.getByText(/ready to append/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Append" })).toHaveCount(0);
});

test("files over the size limit are refused before being read", async ({ page }) => {
  await page.goto("/forecasting");
  await page.getByRole("radio", { name: "Upload CSV" }).click();
  await page.locator("#csv-input").setInputFiles({ name: "huge.csv", mimeType: "text/csv", buffer: Buffer.alloc(6 * 1024 * 1024, "a") });
  await expect(page.getByRole("alert")).toContainText("the limit is 5 MB");
});

test("while auto-streaming, manual entry is locked and the busiest page stays responsive", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: "longtask", buffered: true });
  });
  await page.goto("/forecasting");
  await page.getByRole("button", { name: "Auto-stream" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("radio", { name: "Enter a day" }).click();
  await expect(page.getByRole("button", { name: "Add this day" })).toBeDisabled();

  // The Control Tower recomputes forecasts, Monte Carlo and the replay for every new day.
  await openPage(page, /Control Tower/);
  await page.evaluate(() => { (window as unknown as { __longTasks: number[] }).__longTasks = []; });
  await page.waitForTimeout(8000);
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
  expect(longest, "longest main-thread task while streaming (ms)").toBeLessThan(200);

  await openPage(page, /Demand Forecasting/);
  await page.getByRole("radio", { name: "Stream recorded days" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Auto-stream" })).toBeVisible();
  // After streaming stops, the overview re-optimises once on the latest data.
  await openPage(page, /Control Tower/);
  await expect(page.getByText(/Reorder S001-P0001 when stock on hand/)).toBeVisible();
});

test("without WebGL the 3D view is not offered and the 2D map is shown", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/optimization");
  await page.getByRole("button", { name: "Run Bayesian optimisation" }).click();
  await expect(page.getByText("3D view needs WebGL (not available in this browser)")).toBeVisible();
  await expect(page.getByRole("radio", { name: /3D \(WebGL\)/ })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Surrogate cost map/ })).toBeVisible();
});

test("data saved by an earlier version of the dashboard is cleared, not applied", async ({ page }) => {
  await page.goto("/forecasting");
  await expect(page.getByTestId("planning-date")).toHaveText("1 Dec 2023");
  // Plant a saved timeline from a different deployment (as idb-keyval stores it).
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("keyval", "readwrite");
      tx.objectStore("keyval").put({ stamp: "an-older-build", observedUntil: 720, userRows: [], scores: [], log: [] }, "rop-timeline-v1");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(page.getByRole("list", { name: "Update log" })).toContainText("earlier version of the dashboard and was cleared");
  await expect(page.getByTestId("planning-date")).toHaveText("1 Dec 2023");
});

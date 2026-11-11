/** Every page loads its results from the workers, on desktop and phone widths, with a clean console. */
import { expect, openPage, test } from "./fixtures";

test("all six pages compute and render their results", async ({ page, consoleProblems }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /S001-P0001 · Electronics/ })).toBeVisible();
  // Control Tower waits for forecasting, Monte Carlo, Bayesian optimisation and the replay.
  await expect(page.getByText("Briefing for the operations manager")).toBeVisible();
  await expect(page.getByText(/Reorder S001-P0001 when stock on hand/)).toBeVisible();

  await openPage(page, /Demand Forecasting/);
  await expect(page.getByRole("heading", { name: "Demand Forecasting" })).toBeVisible();
  await expect(page.getByText(/the AI forecast expects about/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "LSTM" })).toBeVisible();

  await openPage(page, /Safety Stock/);
  await expect(page.getByText(/The formula assumes demand during the lead time/)).toBeVisible();
  await expect(page.getByText("Safety stock = Z · √(…)")).toBeVisible();

  await openPage(page, /Inventory Simulation/);
  await expect(page.getByText(/Over these 60 days the Bayesian-optimised policy/)).toBeVisible();

  await openPage(page, /Optimisation/);
  await expect(page.getByText(/simulations the optimiser found a policy/)).toBeVisible();
  await expect(page.getByText("How sensitive is the recommendation?")).toBeVisible();
  await page.getByRole("radio", { name: /3D \(WebGL\)/ }).click();
  await expect(page.getByRole("img", { name: /3D surrogate surface/ })).toBeVisible();

  await openPage(page, /Method/);
  await expect(page.getByText("Traceability to the exercise")).toBeVisible();
  expect(consoleProblems).toEqual([]);
});

test("switching product recomputes everything", async ({ page }) => {
  await page.goto("/forecasting");
  await expect(page.getByText(/For S001-P0001 the AI forecast/)).toBeVisible();
  await page.getByLabel("Store").selectOption("S003");
  await page.getByLabel("Product").selectOption("P0007");
  await expect(page.getByText(/For S003-P0007 the AI forecast/)).toBeVisible();
  await expect(page.getByText("14-day forecast · S003-P0007")).toBeVisible();
});

test("phone width: no horizontal scrolling on any page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/forecasting", "/safety-stock", "/simulation", "/optimization", "/method"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});

test("the interface stays responsive while Bayesian optimisation runs", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: "longtask", buffered: true });
  });
  await page.goto("/optimization");
  await expect(page.getByRole("button", { name: "Run Bayesian optimisation" })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { __longTasks: number[] }).__longTasks = []; });
  await page.getByRole("button", { name: "Run Bayesian optimisation" }).click();
  await expect(page.getByRole("button", { name: "Optimised for these settings" })).toBeVisible();
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
  expect(longest, "longest main-thread task during optimisation (ms)").toBeLessThan(200);
});

/**
 * The site must work under the production security headers from netlify.toml. `vite preview` does not
 * send them, so every response is given the same Content-Security-Policy here; any blocked script,
 * worker, style or fetch shows up as a console error and fails the test (see fixtures.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, openPage, test } from "./fixtures";

const toml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../netlify.toml"), "utf-8");
const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)?.[1];

test("runs the full pipeline under the production Content-Security-Policy", async ({ page, context }) => {
  expect(csp, "CSP found in netlify.toml").toBeTruthy();
  await context.route("**/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp! } });
  });

  await page.goto("/");
  await expect(page.getByText(/Reorder S001-P0001 when stock on hand/)).toBeVisible();
  await openPage(page, /Demand Forecasting/);
  await expect(page.getByText(/the AI forecast expects about/)).toBeVisible();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");
  await openPage(page, /Optimisation/);
  // New data arrived, so the page waits for an explicit run on the new data.
  await page.getByRole("button", { name: "Run Bayesian optimisation" }).click();
  await expect(page.getByText(/simulations the optimiser found a policy/)).toBeVisible();
  await page.getByRole("radio", { name: /3D \(WebGL\)/ }).click();
  await expect(page.getByRole("img", { name: /3D surrogate surface/ })).toBeVisible();
});

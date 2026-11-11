/** First-time-viewer guidance: start-here card, the Guide panel, per-page guides and term definitions. */
import { expect, openPage, test } from "./fixtures";

test("a first-time viewer gets a start-here card, a guide, and a page guide on every page", async ({ page, consoleProblems }) => {
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "Start here" });
  await expect(welcome).toBeVisible();

  // The walkthrough opens the Guide; Esc closes it.
  await welcome.getByRole("button", { name: "Open the 5-minute walkthrough" }).click();
  const guide = page.getByRole("dialog", { name: "Guide to this dashboard" });
  await expect(guide).toBeVisible();
  await expect(guide.getByText("Where each part of the exercise is answered")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();

  // Dismissing the card is remembered.
  await welcome.getByRole("button", { name: "Got it" }).click();
  await expect(welcome).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: /S001-P0001 · Electronics/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Start here" })).toBeHidden();

  // A dotted term explains itself.
  await page.getByRole("button", { name: "Recommended reorder point" }).first().click();
  await expect(page.getByRole("tooltip")).toContainText("The stock level that triggers a new order");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();

  for (const name of [/Demand Forecasting/, /Safety Stock/, /Inventory Simulation/, /Optimisation/, /Method/]) {
    await openPage(page, name);
    await expect(page.getByRole("region", { name: "How to read this page" })).toBeVisible();
  }
  expect(consoleProblems).toEqual([]);
});

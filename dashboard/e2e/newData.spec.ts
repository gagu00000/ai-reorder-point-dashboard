/** Adding new data end to end: stream, enter a day, CSV append, persistence across reloads, reset. */
import { expect, planningDate, test } from "./fixtures";

const updateLog = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Update log" });

test("streaming recorded days scores the models and moves the planning date", async ({ page }) => {
  await page.goto("/forecasting");
  await expect(page.getByTestId("planning-date")).toHaveText("1 Dec 2023");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");
  await expect(updateLog(page)).toContainText("Recorded day revealed: 2023-12-02");
  await expect(page.getByText(/Over the 1 day added so far, the ridge model's next-day error is/)).toBeVisible();

  await page.getByRole("button", { name: "Next 7 days" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("9 Dec 2023");
  await expect(updateLog(page)).toContainText("Recorded days revealed: 2023-12-03 → 2023-12-09");
  // Seven new days trigger LSTM fine-tuning in the worker.
  await expect(updateLog(page)).toContainText(/LSTM fine-tuned on \d+ recent windows/);
});

test("a day entered by hand is used, saved in the browser, and survives a reload", async ({ page }) => {
  await page.goto("/forecasting");
  await page.getByRole("radio", { name: "Enter a day" }).click();
  const demand = page.getByLabel("Demand (units)");
  await expect(demand).not.toHaveValue("");
  await demand.fill("400");
  await page.getByRole("button", { name: "Add this day" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");
  await expect(updateLog(page)).toContainText("Your entry added: 2023-12-02 (1 row of yours)");

  await page.reload();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");
  await expect(updateLog(page)).toContainText("Restored your added data");
});

test("CSV append validates the file before anything changes", async ({ page }) => {
  await page.goto("/forecasting");
  await page.getByRole("radio", { name: "Upload CSV" }).click();
  const input = page.locator("#csv-input");

  // A file that skips a day is rejected and changes nothing.
  await input.setInputFiles({
    name: "gap.csv", mimeType: "text/csv",
    buffer: Buffer.from("Date,Store ID,Product ID,Demand,Promotion,Weather Condition,Epidemic\n2023-12-05,S001,P0001,120,0,Snowy,0\n"),
  });
  await expect(page.getByRole("alert")).toContainText("Data must start on 2023-12-02");
  expect(await planningDate(page)).toBe("1 Dec 2023");

  // Two valid consecutive days for one product (other products use their recorded values).
  await input.setInputFiles({
    name: "ok.csv", mimeType: "text/csv",
    buffer: Buffer.from([
      "Date,Store ID,Product ID,Demand,Promotion,Weather Condition,Epidemic,Price",
      "2023-12-02,S001,P0001,130,1,Snowy,0,70",
      "2023-12-03,S001,P0001,90,0,Snowy,0,65",
    ].join("\n")),
  });
  await expect(page.getByText(/Price ignored/)).toBeVisible();
  await expect(page.getByText(/2 rows · 2 days · 1 products — ready to append/)).toBeVisible();
  await page.getByRole("button", { name: "Append" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("3 Dec 2023");
  await expect(updateLog(page)).toContainText("CSV appended: 2023-12-02 → 2023-12-03 (2 rows of yours)");
});

test("reset forgets added data and returns to the original planning date", async ({ page }) => {
  await page.goto("/forecasting");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByTestId("planning-date")).toHaveText("2 Dec 2023");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Reset" }).click(); // confirm
  await expect(page.getByTestId("planning-date")).toHaveText("1 Dec 2023");
  await expect(updateLog(page)).toContainText("Reset to the original data");
  await page.reload();
  await expect(page.getByTestId("planning-date")).toHaveText("1 Dec 2023");
});

import { test as base, expect, type Page } from "@playwright/test";

/**
 * Every test fails if the page logs a console error or warning, or throws — the dashboard must run
 * clean. Each test starts with empty browser storage (a fresh Playwright context).
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  // `auto`: applies to every test, not only those that ask for the fixture.
  consoleProblems: [async ({ page }, use) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
    await use(problems);
    expect(problems, "console must stay clean").toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function planningDate(page: Page): Promise<string> {
  return (await page.getByTestId("planning-date").textContent()) ?? "";
}

export async function openPage(page: Page, name: RegExp) {
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name }).click();
}

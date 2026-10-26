// Opening a project section from the sidebar, for every browser check (Grant's sidebar, 2026-10-19).
// "Set Objectives" and "Review Objectives" were tabs of one Objectives entry; on the one-page
// Objectives prototype (2026-10-22) they are one page, so either name opens Objectives and waits for
// its heading. Any other name (a string, matched exactly, or a RegExp) is a sidebar entry clicked as
// before. One place to change if the sidebar moves again.
import { expect } from "@playwright/test";

const OBJECTIVE_NAMES = new Set(["Set Objectives", "Review Objectives"]);

export async function openSection(page, name) {
  if (typeof name === "string" && OBJECTIVE_NAMES.has(name)) {
    await page.getByRole("button", { name: /^Objectives$/ }).first().click();
    await expect(page.getByRole("heading", { name: "Objectives", exact: true, level: 2 }).filter({ visible: true }).first()).toBeVisible();
    return;
  }
  await page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name }).first().click();
  // Recommendations and the Insights report open on an overview (2026-10-21); the checks that use
  // this helper work in the review list and the narrative, so their tab is opened when it is shown.
  const label = typeof name === "string" ? name : name.source;
  const tabId = /Recommendations/.test(label) ? "rec-tab-review" : /Insights report/.test(label) ? "report-tab-narrative" : null;
  if (tabId) {
    const tab = page.getByTestId(tabId).filter({ visible: true });
    if (await tab.count()) await tab.first().click();
  }
}

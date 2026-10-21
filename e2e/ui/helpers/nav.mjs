// Opening a project section from the sidebar, for every browser check (Grant's sidebar, 2026-10-19).
// "Set Objectives" and "Review Objectives" are now tabs of one Objectives entry, so either name opens
// Objectives and then its tab; any other name (a string, matched exactly, or a RegExp) is a sidebar
// entry clicked as before. One place to change if the sidebar moves again.
import { expect } from "@playwright/test";

const OBJECTIVE_TABS = { "Set Objectives": "Set objectives", "Review Objectives": "Review objectives" };

export async function openSection(page, name) {
  if (typeof name === "string" && OBJECTIVE_TABS[name]) {
    const tab = page.getByRole("tab", { name: OBJECTIVE_TABS[name], exact: true });
    if (!(await tab.first().isVisible())) await page.getByRole("button", { name: /^Objectives$/ }).first().click();
    await tab.first().click();
    await expect(tab.first()).toHaveAttribute("aria-selected", "true");
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

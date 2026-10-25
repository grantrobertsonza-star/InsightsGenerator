// The Import screen's sources (Grant's Sources layout, 2026-10-20): a list on the left, the selected
// source on the right in tabs. One place for the checks to select a source, open one of its tabs,
// delete it and count the list, so a later change to the layout touches this helper only.
import { expect } from "@playwright/test";

/** Selects a source in the list by its file name (a string, matched exactly, or a RegExp). */
export async function selectSource(page, name) {
  const label = typeof name === "string" ? `Select ${name}` : new RegExp(`^Select ${name.source.replace(/^\^/, "")}`, name.flags);
  const button = page.getByRole("button", { name: label, exact: typeof name === "string" }).first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** Opens a tab of the selected source (Preview, Setup, Variables, Data quality, ...) and returns its panel. */
export async function openSourceTab(page, tab) {
  const button = page.getByRole("tab", { name: tab, exact: true });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(button).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel", { name: tab, exact: true });
}

/** Selects a source and opens one of its tabs. */
export async function openSource(page, name, tab) {
  await selectSource(page, name);
  return tab ? openSourceTab(page, tab) : null;
}

/** The number of sources in the list (filters aside, every row is counted). */
export async function sourceCount(page) {
  return page.getByTestId("source-row").count();
}

/** Removes a source (to the bin) from its row's menu; the caller handles the confirm dialog, as before. */
export async function deleteSource(page, filename) {
  const row = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: `Select ${filename}`, exact: true }) });
  await row.getByLabel(`Actions for ${filename}`).click();
  await row.getByRole("button", { name: "Remove file" }).click();
}

/** Removes the first source in the list (the newest), for checks working on a one-file project. */
export async function deleteFirstSource(page) {
  const row = page.getByTestId("source-row").first();
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Remove file" }).click();
}

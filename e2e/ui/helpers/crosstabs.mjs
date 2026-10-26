// Cross tabs opens straight into the crosstab workspace (Grant's review, 2026-10-20), with the data
// file chosen in its header. One place for the checks to reach the workspace, so a later change to
// how it opens touches this helper only.
import { expect } from "@playwright/test";

/** The visible crosstab workspace on the page (the Cross tabs section must already be open). */
export const crosstabWorkspace = (page) => page.getByTestId("crosstab-workspace").filter({ visible: true });

/**
 * Opens Cross tabs from the sidebar and returns the workspace, ready to build in. With `filename`,
 * that data file is chosen first (the section opens the file used last, or the first it can open).
 */
export async function openCrosstabs(page, filename) {
  await page.getByRole("button", { name: /^Cross tabs/ }).first().click();
  if (filename) {
    const select = page.getByTestId("crosstab-file-select").filter({ visible: true });
    await expect(select).toBeVisible({ timeout: 60_000 });
    const value = await select.locator("option", { hasText: filename }).first().getAttribute("value");
    await select.selectOption(value);
  }
  const workspace = crosstabWorkspace(page);
  await expect(workspace.getByRole("button", { name: /Add table to set/ })).toBeVisible({ timeout: 60_000 });
  return workspace;
}

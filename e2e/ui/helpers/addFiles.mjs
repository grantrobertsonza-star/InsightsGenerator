// The one way the browser checks add files on the Import screen (Grant's two-pane layout,
// 2026-10-19; a dialog from 2026-10-20): open the Add files dialog if it is closed, choose the
// files, give each the type named by `type` (its label in the panel, e.g. "Raw data",
// "Questionnaire or guide"), press Upload, and wait for the dialog to close or show its error. Kept in one place so a later change to the panel touches one helper, not every check.
// `files` is anything Playwright's setInputFiles takes: a path, a list of paths, or
// { name, mimeType, buffer } objects. The page must already show the Import section.
import { expect } from "@playwright/test";

export async function openAddFiles(page) {
  const toggle = page.getByRole("button", { name: "Add files", exact: true });
  await expect(toggle).toBeAttached({ timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = page.getByTestId("add-files");
  await expect(panel).toBeVisible();
  return panel;
}

export async function addFiles(page, files, type) {
  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(files);
  const rows = panel.getByTestId("add-files-row");
  const count = Array.isArray(files) ? files.length : 1;
  await expect(rows).toHaveCount(count);
  for (let i = 0; i < count; i++) await rows.nth(i).getByRole("combobox").selectOption({ label: type });
  await panel.getByRole("button", { name: /^Upload/ }).click();
  // A successful upload closes the dialog (its message then shows under the heading); a refused one
  // keeps it open with its error, which the caller reads.
  await expect.poll(async () => (await page.getByTestId("add-files-error").count()) > 0 || !(await panel.isVisible()), { timeout: 5 * 60_000 }).toBe(true);
}

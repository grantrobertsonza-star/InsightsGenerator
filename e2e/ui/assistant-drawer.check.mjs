// The floating Research assistant (Grant, 2026-10-22: "a floating Research assistant on every page
// ... it must have access to our knowledge base on how the system works"). Real browser against the
// disposable stack; the model is the stack's replay, scripted through model-fixture.json
// ("untargeted" rules, later steps first), so the drawer, the server actions, the tool loop, the help
// index and the saved conversation are real.
//   1. Outside a project (the dashboard): the button opens the drawer; a how-the-app question reads a
//      Knowledge base guide (read_help); the reply ends with the code-written guide line, whose link
//      opens the guide; the unsaved chat is still there on the guide page; Esc closes the drawer and
//      focus returns to the button.
//   2. Inside a project: on Findings the drawer says the question is asked from Findings; a failed
//      load of the conversation is shown with Try again (never an empty chat), and Try again loads
//      it; the message and reply are saved with the project and shown in the Research assistant
//      section, where the floating button is hidden.
//   3. A failed question stays with the project it was asked in (Codex B5-F05), whether the failure
//      arrives while that project is open or after moving to another: it is not shown in the other
//      project, it is there on return with the question kept, and Send again answers it, stored once.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openSection } from "./helpers/nav.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const shot = (suffix) => (process.env.SHOT ? process.env.SHOT.replace(".png", `-drawer-${suffix}.png`) : null);

test.use({ viewport: { width: 1440, height: 900 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("the floating Research assistant answers from the Knowledge base anywhere, and continues the project's conversation inside a project", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `assistant-drawer-${Date.now()}` });
    const origin = new URL(run.url).origin;

    const guideMarker = `GUIDE-${Date.now()}`;
    const projectMarker = `PROJECT-${Date.now()}`;
    writeFileSync(
      fixtureFile,
      JSON.stringify({
        untargeted: [
          { match: projectMarker, text: "From the project drawer: there are no findings yet." },
          { match: "How findings are produced and checked (/knowledge/findings)", text: "Use with caution means the finding is supported but carries a caveat to keep with it." },
          { match: guideMarker, tool: "read_help", input: { ref: "knowledge/findings" } },
        ],
      }),
    );

    // 1. Outside a project.
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const fab = page.getByTestId("assistant-fab");
    await expect(fab).toBeVisible();
    await fab.click();
    const drawer = page.getByTestId("assistant-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("assistant-drawer-scope")).toHaveText("How the app works and research method. This chat is not saved.");
    const box = drawer.getByRole("textbox", { name: "Your question" });
    await expect(box).toBeFocused();
    await box.fill(`${guideMarker} What does use with caution mean?`);
    await box.press("Enter");
    await expect(drawer.getByText("Use with caution means the finding is supported but carries a caveat to keep with it.", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(drawer.getByText(/Guides read for this answer: How findings are produced and checked \(\/knowledge\/findings\)\./)).toBeVisible();
    const s1 = shot("guide");
    if (s1) await page.screenshot({ path: s1 });

    // The guide link opens the guide; the drawer and its unsaved chat stay.
    await drawer.getByRole("link", { name: "/knowledge/findings" }).click();
    await expect(page).toHaveURL(/\/knowledge\/findings$/);
    await expect(page.getByRole("heading", { name: "How findings are produced and checked", level: 1 })).toBeVisible();
    await expect(drawer.getByText(`${guideMarker} What does use with caution mean?`)).toBeVisible();

    // Esc closes it, and focus returns to the button.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(fab).toBeFocused();

    // 2. Inside a project, on Findings. The first read of the conversation fails.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await openSection(page, "Findings");
    let failNextAction = true;
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (failNextAction && req.method() === "POST" && req.headers()["next-action"]) {
        failNextAction = false;
        return route.abort("failed");
      }
      return route.continue();
    });
    await fab.click();
    await expect(drawer.getByTestId("assistant-drawer-scope")).toHaveText("This project's conversation, asked from Findings. Saved with the project.");
    await expect(drawer.getByText(/The conversation could not be loaded/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Send" })).toBeDisabled();
    await drawer.getByRole("button", { name: "Try again" }).click();
    await expect(drawer.getByText(/The conversation could not be loaded/)).toBeHidden();
    await expect(drawer.getByText("Ask about this project's data, evidence or report", { exact: false })).toBeVisible();
    await page.unroute("**/*");

    await box.fill(`${projectMarker} How many findings are there?`);
    await drawer.getByRole("button", { name: "Send" }).click();
    await expect(drawer.getByText("From the project drawer: there are no findings yet.")).toBeVisible({ timeout: 60_000 });
    const saved = (await db.query("select role, content from assistant_messages where run_id=$1 order by created_at", [run.id])).rows;
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[0].content).toBe(`${projectMarker} How many findings are there?`);
    const s2 = shot("project");
    if (s2) await page.screenshot({ path: s2 });
    await page.keyboard.press("Escape");

    // The Research assistant section shows the same conversation, and the floating button is hidden there.
    await openSection(page, "Research assistant");
    await expect(page.getByText("From the project drawer: there are no findings yet.").filter({ visible: true }).first()).toBeVisible();
    await expect(fab).toBeHidden();
    await openSection(page, "Findings");
    await expect(fab).toBeVisible();
  } finally {
    await db.end();
  }
});

test("a failed question stays with the project it was asked in, and Send again answers it once", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const a = await ui.createRun({ name: `drawer-a-${Date.now()}` });
    const b = await ui.createRun({ name: `drawer-b-${Date.now()}` });
    const early = `EARLY-${Date.now()}`;
    const late = `LATE-${Date.now()}`;
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: [{ match: early, text: "Answered on the second try." }, { match: late, text: "The late one is answered." }] }));

    // Sends whose text carries a marker fail: the early one at once, the late one when released.
    let failEarly = true;
    let failLate = true;
    let heldLate = null;
    await page.route("**/*", async (route) => {
      const req = route.request();
      const body = req.method() === "POST" && req.headers()["next-action"] ? (req.postData() ?? "") : "";
      if (failEarly && body.includes(early)) {
        failEarly = false;
        return route.abort("failed");
      }
      if (failLate && body.includes(late)) {
        failLate = false;
        heldLate = route;
        return;
      }
      return route.continue();
    });

    const drawer = page.getByTestId("assistant-drawer");
    const failedBox = drawer.getByTestId("assistant-drawer-failed");
    const box = drawer.getByRole("textbox", { name: "Your question" });
    const switchTo = async (run) => {
      await page.getByLabel("Current project").selectOption(run.id);
      await expect(page).toHaveURL(new RegExp(`/runs/${run.id}`));
      await expect(drawer.getByText(/Loading the conversation/)).toHaveCount(0);
    };

    await page.goto(a.url, { waitUntil: "networkidle" });
    await openSection(page, "Findings");
    await page.getByTestId("assistant-fab").click();

    // The failure arrives while A is open.
    await box.fill(`${early} first question`);
    await box.press("Enter");
    await expect(failedBox).toContainText(`Not answered: \u201c${early} first question\u201d.`);
    await expect(box).toHaveValue(`${early} first question`);
    await switchTo(b);
    await expect(failedBox).toHaveCount(0);
    await expect(box).toHaveValue("");
    await switchTo(a);
    await expect(failedBox).toContainText(`${early} first question`);
    const s1 = shot("failed");
    if (s1) await page.screenshot({ path: s1 });
    await failedBox.getByRole("button", { name: "Send again" }).click();
    await expect(drawer.getByText("Answered on the second try.")).toBeVisible({ timeout: 60_000 });
    await expect(failedBox).toHaveCount(0);
    await expect(box).toHaveValue("");

    // The failure arrives after moving to B.
    await box.fill(`${late} second question`);
    await box.press("Enter");
    await expect.poll(() => heldLate !== null).toBe(true);
    await switchTo(b);
    await heldLate.abort("failed");
    await expect(drawer.getByText("Thinking...")).toHaveCount(0);
    await expect(failedBox).toHaveCount(0);
    await switchTo(a);
    await expect(failedBox).toContainText(`${late} second question`);
    await failedBox.getByRole("button", { name: "Send again" }).click();
    await expect(drawer.getByText("The late one is answered.")).toBeVisible({ timeout: 60_000 });

    // Stored once each: no copy of a failed question was left behind.
    const rows = (await db.query("select role, content from assistant_messages where run_id=$1 order by created_at", [a.id])).rows;
    expect(rows.map((r) => r.content)).toEqual([`${early} first question`, "Answered on the second try.", `${late} second question`, "The late one is answered."]);
    expect((await db.query("select count(*)::int as n from assistant_messages where run_id=$1", [b.id])).rows[0].n).toBe(0);
    await page.unroute("**/*");
  } finally {
    await db.end();
  }
});

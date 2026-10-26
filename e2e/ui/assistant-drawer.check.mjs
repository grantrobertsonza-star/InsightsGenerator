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
//   4. An answer stored by the server whose reply is lost on the way back (Codex B6-F02), while the
//      project is open and after moving to another: on reading the history back the answer is shown
//      and no failure is; nothing is stored twice. A failed model call (the server answered with an
//      error, nothing stored) is "Not answered", and Send again answers it once.
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
    // A compact window in the corner (2026-10-23), so the page stays in view: at most 380 by 560.
    const win = await drawer.boundingBox();
    expect(win.width).toBeLessThanOrEqual(381);
    expect(win.height).toBeLessThanOrEqual(561);
    expect(win.x).toBeGreaterThan(1440 / 2);
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

    // On a phone it spans the width less a 16px gutter, with no sideways scroll.
    await page.setViewportSize({ width: 390, height: 800 });
    await fab.click();
    const phone = await drawer.boundingBox();
    expect(Math.round(phone.x)).toBe(16);
    expect(Math.round(phone.x + phone.width)).toBe(390 - 16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const sPhone = shot("phone");
    if (sPhone) await page.screenshot({ path: sPhone });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });

    // That use is counted for the organisation and shown on the dashboard (migration 0109).
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("assistant-usage-outside-projects")).toContainText(/\d+ model calls, [\d,]+ input tokens \([\d,]+ from cache\), about \$\d+\.\d\d/);

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
    // Said plainly, not in the browser's own words ("Failed to fetch").
    await expect(drawer.getByText(/The connection to the server was lost before an answer came back/)).toBeVisible();
    await expect(drawer.getByText(/Failed to fetch/)).toHaveCount(0);
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
    // Send is not taken while the conversation is still loading; wait for it before typing.
    await expect(page.getByTestId("assistant-drawer").getByText(/Loading the conversation/)).toHaveCount(0);
    await expect(page.getByTestId("assistant-drawer").getByRole("button", { name: "Send" })).toBeVisible();

    // The failure arrives while A is open.
    await box.fill(`${early} first question`);
    await box.press("Enter");
    // The send never reached the server, so the read-back finds nothing and the failure stays.
    await expect(failedBox).toContainText(`No answer arrived: \u201c${early} first question\u201d.`);
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

test("an answer saved but lost on the way back is shown, not reported as unanswered, and nothing is stored twice", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const a = await ui.createRun({ name: `drawer-lost-a-${Date.now()}` });
    const b = await ui.createRun({ name: `drawer-lost-b-${Date.now()}` });
    const lostOpen = `LOSTOPEN-${Date.now()}`;
    const lostAway = `LOSTAWAY-${Date.now()}`;
    const known = `KNOWN-${Date.now()}`;
    const rules = (failKnown) => [
      ...(failKnown ? [{ match: known, status: 400 }] : [{ match: known, text: "The model answered this time." }]),
      { match: lostAway, text: "Saved while you were away." },
      { match: lostOpen, text: "Saved, but the reply was lost." },
    ];
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: rules(true) }));

    // The server runs these sends and stores the answer; the browser then loses the reply.
    let held = null;
    await page.route("**/*", async (route) => {
      const req = route.request();
      const body = req.method() === "POST" && req.headers()["next-action"] ? (req.postData() ?? "") : "";
      if (body.includes(lostOpen) || body.includes(lostAway)) {
        await route.fetch();
        if (body.includes(lostAway)) {
          held = route;
          return;
        }
        return route.abort("failed");
      }
      return route.continue();
    });
    const pairs = async (marker) => (await db.query("select role, content from assistant_messages where run_id=$1 and content like $2 order by created_at", [a.id, `%${marker}%`])).rows.length;

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
    // Send is not taken while the conversation is still loading; wait for it before typing.
    await expect(page.getByTestId("assistant-drawer").getByText(/Loading the conversation/)).toHaveCount(0);
    await expect(page.getByTestId("assistant-drawer").getByRole("button", { name: "Send" })).toBeVisible();

    // Lost while A is open: the read-back finds the stored answer.
    await box.fill(`${lostOpen} question`);
    await box.press("Enter");
    await expect(drawer.getByText("Saved, but the reply was lost.")).toBeVisible({ timeout: 60_000 });
    await expect(failedBox).toHaveCount(0);
    await expect(box).toHaveValue("");
    expect(await pairs(lostOpen)).toBe(1);

    // Lost after moving to B: nothing shows in B; back in A the stored answer shows, no failure.
    await box.fill(`${lostAway} question`);
    await box.press("Enter");
    await expect.poll(() => held !== null, { timeout: 60_000 }).toBe(true);
    await switchTo(b);
    await held.abort("failed");
    await expect(failedBox).toHaveCount(0);
    await switchTo(a);
    await expect(drawer.getByText("Saved while you were away.")).toBeVisible();
    await expect(failedBox).toHaveCount(0);

    // A failed model call: the server said so and stored nothing; Send again answers it once.
    await box.fill(`${known} question`);
    await box.press("Enter");
    await expect(failedBox).toContainText(`Not answered: \u201c${known} question\u201d.`);
    writeFileSync(fixtureFile, JSON.stringify({ untargeted: rules(false) }));
    await failedBox.getByRole("button", { name: "Send again" }).click();
    await expect(drawer.getByText("The model answered this time.")).toBeVisible({ timeout: 60_000 });
    await expect(failedBox).toHaveCount(0);

    const rows = (await db.query("select role, content from assistant_messages where run_id=$1 order by created_at", [a.id])).rows;
    expect(rows.map((r) => r.content)).toEqual([
      `${lostOpen} question`, "Saved, but the reply was lost.",
      `${lostAway} question`, "Saved while you were away.",
      `${known} question`, "The model answered this time.",
    ]);
    await page.unroute("**/*");
  } finally {
    await db.end();
  }
});

test("the assistant opens on the right, can be moved and resized by pointer and keys, keeps inside the window, and is remembered", async ({ page, browser }, testInfo) => {
  test.setTimeout(3 * 60_000);
  page.setDefaultTimeout(30_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `drawer-move-${Date.now()}` });
  const origin = new URL(run.url).origin;
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    try {
      localStorage.removeItem("assistant-window:v2");
    } catch {}
  });
  await page.reload({ waitUntil: "networkidle" });
  const drawer = page.getByTestId("assistant-drawer");
  const box = async () => drawer.boundingBox();

  // Opens on the right, near the top.
  await page.getByTestId("assistant-fab").click();
  const start = await box();
  expect(Math.round(1440 - (start.x + start.width))).toBe(20);
  expect(Math.round(start.y)).toBe(80);
  const s0 = shot("right");
  if (s0) await page.screenshot({ path: s0 });

  // Dragged by its header.
  const header = drawer.getByTestId("assistant-drawer-header");
  const h = await header.boundingBox();
  await page.mouse.move(h.x + 40, h.y + 12);
  await page.mouse.down();
  await page.mouse.move(h.x - 160, h.y + 62, { steps: 4 });
  await page.mouse.move(h.x - 360, h.y + 112, { steps: 4 });
  await page.mouse.up();
  const dragged = await box();
  expect(Math.round(dragged.x - start.x)).toBe(-400);
  expect(Math.round(dragged.y - start.y)).toBe(100);
  const s1 = shot("moved");
  if (s1) await page.screenshot({ path: s1 });

  // The arrow keys on the Move handle move it 24px; it stays inside the window when pushed past an edge.
  const move = drawer.getByTestId("assistant-drawer-move");
  await move.focus();
  await page.keyboard.press("ArrowDown");
  expect(Math.round((await box()).y - dragged.y)).toBe(24);
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowUp");
  expect(Math.round((await box()).y)).toBe(8);
  // Resized by its bottom-left grip: dragging left and down makes it wider and taller, the right
  // edge staying where it is.
  const beforeResize = await box();
  const grip = drawer.getByTestId("assistant-drawer-resize");
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + 8, g.y + 8);
  await page.mouse.down();
  await page.mouse.move(g.x + 8 - 60, g.y + 8 + 30, { steps: 3 });
  await page.mouse.move(g.x + 8 - 120, g.y + 8 + 60, { steps: 3 });
  await page.mouse.up();
  const grown = await box();
  expect(Math.round(grown.width - beforeResize.width)).toBe(120);
  expect(Math.round(grown.height - beforeResize.height)).toBe(60);
  expect(Math.round(grown.x + grown.width)).toBe(Math.round(beforeResize.x + beforeResize.width));
  const s2 = shot("resized");
  if (s2) await page.screenshot({ path: s2 });
  // The arrow keys on the grip resize by 24px; it never goes below the minimum.
  await grip.focus();
  await page.keyboard.press("ArrowLeft");
  expect(Math.round((await box()).width - grown.width)).toBe(24);
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
  expect(Math.round((await box()).width)).toBe(300);
  await page.keyboard.press("ArrowLeft");
  const kept = await box();

  // Remembered after closing and after a reload.
  await page.keyboard.press("Escape");
  await page.getByTestId("assistant-fab").click();
  expect(await box()).toEqual(kept);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("assistant-fab").click();
  expect(await box()).toEqual(kept);

  // A narrower browser window pulls it back inside.
  await page.setViewportSize({ width: 900, height: 700 });
  const narrow = await box();
  expect(narrow.x).toBeGreaterThanOrEqual(8);
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(700 - 8 + 1);

  // Home on the handle, or a double-click on the header, puts it back on the right.
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawer.getByTestId("assistant-drawer-move").focus();
  await page.keyboard.press("Home");
  expect(Math.round(1440 - ((await box()).x + (await box()).width))).toBe(20);
  // Home puts the whole frame back, size included.
  expect(Math.round((await box()).width)).toBe(380);
  expect(Math.round((await box()).height)).toBe(560);
  await page.mouse.move(h.x + 40, h.y + 12);
  await page.mouse.down();
  await page.mouse.move(h.x - 200, h.y + 40, { steps: 3 });
  await page.mouse.up();
  await header.dblclick({ position: { x: 40, y: 12 } });
  expect(Math.round((await box()).y)).toBe(80);

  // The buttons in the header still work: Close closes, it does not start a drag.
  await drawer.getByRole("button", { name: "Close the assistant" }).click();
  await expect(drawer).toBeHidden();

  // On a phone it does not move: full width at the bottom, no Move handle.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTestId("assistant-fab").click();
  const phone = await box();
  expect(Math.round(phone.x)).toBe(16);
  await expect(drawer.getByTestId("assistant-drawer-move")).toHaveCount(0);
  await expect(drawer.getByTestId("assistant-drawer-resize")).toHaveCount(0);

  // Storage blocked: it still opens on the right and moves, for this page view.
  const blocked = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 } });
  try {
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("storage blocked"); } });
    });
    const p = await blocked.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
    await p.getByTestId("assistant-fab").click();
    const d = p.getByTestId("assistant-drawer");
    const b0 = await d.boundingBox();
    expect(Math.round(1440 - (b0.x + b0.width))).toBe(20);
    await d.getByTestId("assistant-drawer-move").focus();
    await p.keyboard.press("ArrowLeft");
    expect(Math.round((await d.boundingBox()).x - b0.x)).toBe(-24);
    expect(errors).toEqual([]);
  } finally {
    await blocked.close();
  }
});

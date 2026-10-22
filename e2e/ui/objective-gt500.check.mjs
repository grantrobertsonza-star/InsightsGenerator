// GT500 repairs (Codex, 2026-10-21), the native repros from the independent review, retained:
//   F01: fill from a proposal, edit the imported objective, fill from the same proposal again (it is
//        not read again, 22 Oct) and Read it again: the edited objective keeps its id and wording
//        and the original does not come back.
//   F02: Read it again answers HTTP 503: the typed text is saved, the form says the fill did not
//        happen once the response has settled, and still says so after a reload; the earlier fill
//        is labelled as the previous one; Try the fill again then re-reads once (a suggestion).
//   F03: two editors opened on the same objective: the second save is refused, its draft stays in
//        the editor, and no second objective appears.
//   R500-02: a Setup editor is open on an objective; in another tab Review deletes it and adds the
//        same wording again (a new record): the old Setup save is refused, its draft stays, and
//        the new record is unchanged.
//   R500-01: after a failed fill, an ordinary save (no document chosen) keeps the failure and its
//        retry on the page, as a reload does; the retry then fills and clears it.
//   R500-R01: the same when the failure itself could not be recorded, through ordinary saves.
//   GT1000-F03: a Review editor is open with a draft; another page edits the objective in Setup;
//        an unrelated action in Review (Unaccept another objective) refreshes the rows. Saving the
//        old draft is a conflict, in the table and in the detail pane; the newer wording stays
//        until the researcher chooses Replace it with mine, and Use the current wording loads it.
// Real browser against the disposable local stack; the model replay is scripted through the
// stack's model-fixture.json. Synthetic data only.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");

test.describe.configure({ mode: "serial" });

async function setUp(page, testInfo, name, proposalText) {
  page.setDefaultTimeout(30_000);
  page.on("dialog", (d) => d.accept());
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `${name}-${Date.now()}` });
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt500-"));
  const file = path.join(dir, "Independent500_Proposal.txt");
  writeFileSync(file, proposalText);
  await ui.upload(run, file, "proposal");
  rmSync(dir, { recursive: true, force: true });
  return run;
}

const db = () => new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
const objectiveForm = (page) => page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });

async function fillFromProposal(page, client, runId) {
  const form = objectiveForm(page);
  const doc = (await client.query("select id from documents where run_id=$1 and source_filename='Independent500_Proposal.txt'", [runId])).rows[0].id;
  await form.locator('select[name="proposalDocumentId"]').selectOption(doc);
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${runId}`));
  await form.getByRole("button", { name: "Save", exact: true }).click();
  // The action's streamed response can stay open after its result has rendered, so the save is
  // taken as settled when the response has started and the button is usable again.
  expect((await response).ok()).toBe(true);
  await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
}

test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("F01: refilling from the same proposal does not bring back an objective edited since", async ({ page }, testInfo) => {
  const marker = `GT500-F01-${Date.now()}`;
  writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: "Measure rural demand for affordable mobile bundles" } }] } }));
  const run = await setUp(page, testInfo, "gt500-f01", `Proposal ${marker}. Objective: measure rural demand for affordable mobile bundles.`);
  const client = db();
  await client.connect();
  try {
    await openSection(page, "Set Objectives");
    await fillFromProposal(page, client, run.id);
    const item = page.locator("li").filter({ has: page.getByText("Measure rural demand for affordable mobile bundles", { exact: true }) }).last();
    await expect(item).toBeVisible({ timeout: 60_000 });
    await expect(item.getByTestId("objective-source")).toHaveText("From the proposal Independent500_Proposal.txt");
    const id = (await client.query("select id from objective_candidates where run_id=$1", [run.id])).rows[0].id;
    await item.getByRole("button", { name: "Edit", exact: true }).click();
    const editing = page.locator("li").filter({ has: page.locator("textarea") });
    await editing.locator("textarea").fill("Measure rural mobile bundle demand by household income");
    await editing.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await client.query("select candidate_text from objective_candidates where id=$1", [id])).rows[0]?.candidate_text).toBe("Measure rural mobile bundle demand by household income");

    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    // The same proposal again is not read (Grant, 2026-10-22); Read it again re-reads it, and the
    // reworded original is still not brought back (F01 lineage).
    await fillFromProposal(page, client, run.id);
    await expect(page.getByTestId("brief-fill-already")).toContainText("Already filled from the proposal Independent500_Proposal.txt");
    const reread = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await page.getByTestId("brief-fill-reread").click();
    expect((await reread).ok()).toBe(true);
    await expect(objectiveForm(page).getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("brief-fill-reread-result")).toContainText("nothing new was found", { timeout: 60_000 });
    await expect(page.getByTestId("brief-last-fill")).toContainText("no new objectives, 1 imported earlier not added again");
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    await expect(page.getByText("Measure rural mobile bundle demand by household income", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Measure rural demand for affordable mobile bundles", { exact: true })).toHaveCount(0);
    expect((await client.query("select id, status from objective_candidates where run_id=$1", [run.id])).rows).toEqual([{ id, status: "accepted" }]);
  } finally {
    await client.end();
  }
});

test("F02: a failed extraction is shown after the response settles and after a reload; retry fills once", async ({ page }, testInfo) => {
  const marker = `GT500-F02-${Date.now()}`;
  const run = await setUp(page, testInfo, "gt500-f02", `Proposal ${marker}.`);
  const client = db();
  await client.connect();
  try {
    await openSection(page, "Set Objectives");
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: "Objective from the first fill" } }] } }));
    await fillFromProposal(page, client, run.id);
    await expect(page.getByTestId("brief-last-fill")).toContainText("Last filled from the proposal Independent500_Proposal.txt");

    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, status: 503 }] } }));
    await objectiveForm(page).locator('textarea[name="businessProblem"]').fill("Manually typed business problem");
    // The same proposal is not read again unless asked (Grant, 2026-10-22): the outage hits Read it again.
    await fillFromProposal(page, client, run.id);
    await expect(page.getByTestId("brief-fill-already")).toBeVisible({ timeout: 60_000 });
    const rereading = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await page.getByTestId("brief-fill-reread").click();
    expect((await rereading).ok()).toBe(true);
    await expect(objectiveForm(page).getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    const failed = page.getByTestId("brief-fill-failed");
    await expect(failed).toContainText("The fill from the proposal Independent500_Proposal.txt did not happen");
    await expect(failed).toContainText("What you typed was saved");
    await expect(page.getByTestId("brief-last-fill")).toContainText("The last successful fill was from the proposal Independent500_Proposal.txt");
    expect((await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe("Manually typed business problem");

    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");
    await expect(objectiveForm(page).locator('textarea[name="businessProblem"]')).toHaveValue("Manually typed business problem");

    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: "Objective from the first fill\nObjective from the retry" } }] } }));
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await page.getByTestId("brief-fill-retry").click();
    expect((await response).ok()).toBe(true);
    await expect(objectiveForm(page).getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("brief-fill-failed")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("brief-last-fill")).toContainText("Last filled from the proposal Independent500_Proposal.txt");
    // The retry re-read: its new line waits on Review as a suggestion, once.
    await expect(page.getByTestId("brief-fill-reread-result")).toContainText("1 new line is waiting on Review objectives");
    const rows = (await client.query("select candidate_text, status from objective_candidates where run_id=$1 order by candidate_text", [run.id])).rows;
    expect(rows).toEqual([{ candidate_text: "Objective from the first fill", status: "accepted" }, { candidate_text: "Objective from the retry", status: "pending" }]);
    expect((await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe("Manually typed business problem");
  } finally {
    await client.end();
  }
});

test("F03: two editors opened on the same objective; the stale one is refused and keeps its draft", async ({ page, context }, testInfo) => {
  const run = await setUp(page, testInfo, "gt500-f03", "Unused proposal text.");
  const client = db();
  await client.connect();
  try {
    await openSection(page, "Set Objectives");
    const form = objectiveForm(page);
    await form.locator('textarea[name="researchObjective"]').fill("Understand rural demand");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("li").filter({ has: page.getByText("Understand rural demand", { exact: true }) }).last()).toBeVisible({ timeout: 60_000 });
    const id = (await client.query("select id from objective_candidates where run_id=$1", [run.id])).rows[0].id;

    const second = await context.newPage();
    second.on("dialog", (d) => d.accept());
    await second.goto(run.url, { waitUntil: "networkidle" });
    await openSection(second, "Set Objectives");
    const editOn = async (p) => {
      await p.locator("li").filter({ has: p.getByText("Understand rural demand", { exact: true }) }).last().getByRole("button", { name: "Edit", exact: true }).click();
      return p.locator("li").filter({ has: p.locator("textarea:not([name])") }).last();
    };
    const editorA = await editOn(page);
    const editorB = await editOn(second);
    await editorA.locator("textarea").fill("Measure rural demand by income");
    await editorA.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await client.query("select candidate_text from objective_candidates where id=$1", [id])).rows[0]?.candidate_text).toBe("Measure rural demand by income");

    await editorB.locator("textarea").fill("Measure rural demand by province");
    await editorB.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editorB.getByRole("alert")).toContainText("changed or removed after you opened it", { timeout: 60_000 });
    await expect(editorB.locator("textarea")).toHaveValue("Measure rural demand by province");
    expect((await client.query("select id, candidate_text from objective_candidates where run_id=$1", [run.id])).rows).toEqual([{ id, candidate_text: "Measure rural demand by income" }]);
    await second.reload({ waitUntil: "networkidle" });
    await openSection(second, "Set Objectives");
    await expect(second.getByText("Measure rural demand by province", { exact: true })).toHaveCount(0);
    await expect(second.getByText("Measure rural demand by income", { exact: true }).first()).toBeVisible();
    await second.close();
  } finally {
    await client.end();
  }
});

test("R500-02: a Setup editor opened before Review deletes and re-adds the same wording is refused", async ({ page, context }, testInfo) => {
  const run = await setUp(page, testInfo, "r500-02", "Unused proposal text.");
  const client = db();
  await client.connect();
  try {
    await openSection(page, "Set Objectives");
    const form = objectiveForm(page);
    await form.locator('textarea[name="researchObjective"]').fill("Objective A");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("li").filter({ has: page.getByText("Objective A", { exact: true }) }).last()).toBeVisible({ timeout: 60_000 });
    const original = (await client.query("select id from objective_candidates where run_id=$1", [run.id])).rows[0].id;

    // Tab 1: the Setup editor opens on Objective A and its draft is typed, not saved.
    await page.locator("li").filter({ has: page.getByText("Objective A", { exact: true }) }).last().getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.locator("li").filter({ has: page.locator("textarea:not([name])") }).last();
    await editor.locator("textarea").fill("Stale wording from the old editor");

    // Tab 2: Review deletes it, then adds the same wording on purpose.
    const second = await context.newPage();
    second.on("dialog", (d) => d.accept());
    await second.goto(run.url, { waitUntil: "networkidle" });
    await openSection(second, "Review Objectives");
    await second.getByRole("button").filter({ hasText: "Objective A" }).first().click();
    await second.getByRole("button", { name: "Delete", exact: true }).first().click();
    await expect.poll(async () => Number((await client.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count)).toBe(0);
    const add = second.locator("form", { hasText: "Add your own objective" });
    await add.locator("textarea").fill("Objective A");
    await add.getByRole("button", { name: "Add objective" }).click();
    await expect.poll(async () => (await client.query("select id from objective_candidates where run_id=$1", [run.id])).rows.length).toBe(1);
    const replacement = (await client.query("select id, candidate_text, status from objective_candidates where run_id=$1", [run.id])).rows[0];
    expect(replacement.id).not.toBe(original);
    const statedBefore = (await client.query("select stated_objectives_text from runs where id=$1", [run.id])).rows[0].stated_objectives_text;

    // Tab 1: the old editor saves. Refused, the draft stays, the new record is unchanged.
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("changed or removed after you opened it", { timeout: 60_000 });
    await expect(editor.locator("textarea")).toHaveValue("Stale wording from the old editor");
    expect((await client.query("select id, candidate_text, status from objective_candidates where run_id=$1", [run.id])).rows).toEqual([replacement]);
    expect((await client.query("select stated_objectives_text from runs where id=$1", [run.id])).rows[0].stated_objectives_text).toBe(statedBefore);

    // After a reload the page shows the new record and none of the stale wording.
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Review Objectives");
    await expect(page.getByText("Stale wording from the old editor", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button").filter({ hasText: "Objective A" }).first()).toBeVisible();
    await second.close();
  } finally {
    await client.end();
  }
});

test("R500-01: an ordinary save keeps an unresolved failed fill and its retry; the retry fills and clears it", async ({ page }, testInfo) => {
  const marker = `R500-01-${Date.now()}`;
  const run = await setUp(page, testInfo, "r500-01", `Proposal ${marker}.`);
  const client = db();
  await client.connect();
  try {
    await openSection(page, "Set Objectives");
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, status: 503 }] } }));
    await fillFromProposal(page, client, run.id);
    await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");

    // An ordinary save: no document chosen, only the business problem changed.
    const form = objectiveForm(page);
    await expect(form.locator('select[name="proposalDocumentId"]')).toHaveValue("");
    await form.locator('textarea[name="businessProblem"]').fill("Changed by hand after the failure");
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await form.getByRole("button", { name: "Save", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe("Changed by hand after the failure");
    await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");
    await expect(page.getByTestId("brief-fill-retry")).toBeVisible();
    expect(Number((await client.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [run.id])).rows[0].count)).toBe(0);

    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");

    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: "Objective from the recovery" } }] } }));
    const retried = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await page.getByTestId("brief-fill-retry").click();
    expect((await retried).ok()).toBe(true);
    await expect(objectiveForm(page).getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("brief-fill-failed")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText("Objective from the recovery", { exact: true }).first()).toBeVisible();
    expect((await client.query("select candidate_text from objective_candidates where run_id=$1", [run.id])).rows.map((r) => r.candidate_text)).toEqual(["Objective from the recovery"]);
    expect((await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe("Changed by hand after the failure");
    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Set Objectives");
    await expect(page.getByTestId("brief-fill-failed")).toHaveCount(0);
  } finally {
    await client.end();
  }
});

test("R500-R01: a failed fill that could not be recorded stays shown through ordinary saves in the open form", async ({ page }, testInfo) => {
  const marker = `R500-R01-${Date.now()}`;
  const run = await setUp(page, testInfo, "r500-r01", `Proposal ${marker}.`);
  const client = db();
  await client.connect();
  // Recording the failure is refused for this run only, as when the failure log cannot be written.
  const fn = `refuse_intake_error_${run.id.replace(/-/g, "")}`;
  await client.query(`create function ${fn}() returns trigger language plpgsql as $$ begin
    if new.event = 'brief_intake_error' and new.run_id = '${run.id}' then raise exception 'synthetic: failure log refused'; end if;
    return new; end $$`);
  await client.query(`create trigger ${fn} before insert on trace for each row execute function ${fn}()`);
  try {
    await openSection(page, "Set Objectives");
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, status: 503 }] } }));
    await fillFromProposal(page, client, run.id);
    await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");
    await expect(page.getByTestId("brief-fill-failed")).toContainText("could not be recorded");
    expect(Number((await client.query("select count(*) from trace where run_id=$1 and event='brief_intake_error'", [run.id])).rows[0].count)).toBe(0);
    await client.query(`drop trigger ${fn} on trace`);

    // Two ordinary saves: no document chosen, only the business problem changed.
    const form = objectiveForm(page);
    for (const text of ["First change by hand", "Second change by hand"]) {
      await expect(form.locator('select[name="proposalDocumentId"]')).toHaveValue("");
      await form.locator('textarea[name="businessProblem"]').fill(text);
      const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
      await form.getByRole("button", { name: "Save", exact: true }).click();
      expect((await response).ok()).toBe(true);
      await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
      await expect.poll(async () => (await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe(text);
      await expect(page.getByTestId("brief-fill-failed")).toContainText("did not happen");
      await expect(page.getByTestId("brief-fill-failed")).toContainText("could not be recorded");
      await expect(page.getByTestId("brief-fill-retry")).toBeVisible();
    }
    expect(Number((await client.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [run.id])).rows[0].count)).toBe(0);

    // A healthy retry fills once and clears it; the typed text stays.
    writeFileSync(fixtureFile, JSON.stringify({ tools: { record_brief_fields: [{ match: marker, input: { business_problem: null, research_objective: "Objective after the unrecorded failure" } }] } }));
    const retried = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/runs/${run.id}`));
    await page.getByTestId("brief-fill-retry").click();
    expect((await retried).ok()).toBe(true);
    await expect(objectiveForm(page).getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("brief-fill-failed")).toHaveCount(0, { timeout: 60_000 });
    expect((await client.query("select candidate_text from objective_candidates where run_id=$1", [run.id])).rows.map((r) => r.candidate_text)).toEqual(["Objective after the unrecorded failure"]);
    expect((await client.query("select business_problem from runs where id=$1", [run.id])).rows[0].business_problem).toBe("Second change by hand");
  } finally {
    await client.query(`drop trigger if exists ${fn} on trace`);
    await client.query(`drop function if exists ${fn}()`);
    await client.end();
  }
});

for (const where of ["table", "detail"]) {
  test(`GT1000-F03 (${where}): a refresh while a Review editor is open does not move its baseline; the old draft is a conflict`, async ({ page, context }, testInfo) => {
    const run = await setUp(page, testInfo, `gt1000-f03-${where}`, "Unused proposal text.");
    const client = db();
    await client.connect();
    try {
      await openSection(page, "Set Objectives");
      const form = objectiveForm(page);
      await form.locator('textarea[name="researchObjective"]').fill("Alpha rural demand\nBravo urban demand");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await client.query("select count(*) from objective_candidates where run_id=$1 and status='accepted'", [run.id])).rows[0].count, { timeout: 60_000 }).toBe("2");
      const alphaId = (await client.query("select id from objective_candidates where run_id=$1 and candidate_text='Alpha rural demand'", [run.id])).rows[0].id;

      await openSection(page, "Review Objectives");
      const rowOf = (text) => page.locator("tbody[data-objective-row]", { hasText: text }).first();
      await expect(rowOf("Alpha rural demand")).toBeVisible({ timeout: 60_000 });
      // The editor on Alpha, in the table row or in the detail pane.
      let editor;
      if (where === "table") {
        await rowOf("Alpha rural demand").getByRole("button", { name: "Edit", exact: true }).click();
        editor = page.locator("tbody[data-objective-row]", { has: page.locator("textarea") }).first();
      } else {
        await rowOf("Alpha rural demand").locator("td").nth(1).click();
        const detail = page.locator("div").filter({ has: page.getByRole("heading", { name: "Objective detail" }) }).last();
        await detail.getByRole("button", { name: "Edit", exact: true }).click();
        editor = detail;
      }
      await editor.locator("textarea").fill("Researcher draft from the older objective");

      // Another page edits Alpha in Setup and saves: the newer wording.
      const second = await context.newPage();
      second.on("dialog", (d) => d.accept());
      await second.goto(run.url, { waitUntil: "networkidle" });
      await openSection(second, "Set Objectives");
      await second.locator("li").filter({ has: second.getByText("Alpha rural demand", { exact: true }) }).last().getByRole("button", { name: "Edit", exact: true }).click();
      const setupEditor = second.locator("li").filter({ has: second.locator("textarea:not([name])") }).last();
      await setupEditor.locator("textarea").fill("Measure rural demand by income");
      await setupEditor.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await client.query("select candidate_text from objective_candidates where id=$1", [alphaId])).rows[0]?.candidate_text).toBe("Measure rural demand by income");
      await second.close();

      // Back in Review. Table: Unaccept Bravo, which refreshes the rows while Alpha's draft is still
      // open (Codex's refreshed-props path). The detail pane shows no other row to act on, so there
      // the save follows the Setup edit directly; both views use the same hook
      // (useObjectiveRowActions), which holds the baseline captured when editing started.
      if (where === "table") {
        const bravo = rowOf("Bravo urban demand");
        await bravo.getByRole("button", { name: "Unaccept", exact: true }).click();
        await expect(bravo.getByRole("button", { name: "Accept", exact: true })).toBeVisible({ timeout: 60_000 });
      }
      await expect(editor.locator("textarea")).toHaveValue("Researcher draft from the older objective");

      // Save: a conflict, the draft kept, the newer wording unchanged.
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText("changed or removed after you opened it", { timeout: 60_000 });
      await expect(editor.locator("textarea")).toHaveValue("Researcher draft from the older objective");
      await expect(editor.getByTestId("objective-edit-conflict-current")).toHaveText("Measure rural demand by income");
      expect((await client.query("select candidate_text from objective_candidates where id=$1", [alphaId])).rows[0].candidate_text).toBe("Measure rural demand by income");

      if (where === "table") {
        // Use the current wording: the draft becomes the newer wording; nothing is saved.
        await editor.getByTestId("objective-edit-use-current").click();
        await expect(editor.locator("textarea")).toHaveValue("Measure rural demand by income");
        await expect(editor.getByTestId("objective-edit-conflict")).toHaveCount(0);
        expect((await client.query("select candidate_text from objective_candidates where id=$1", [alphaId])).rows[0].candidate_text).toBe("Measure rural demand by income");
        await page.locator("tbody[data-objective-row]", { has: page.locator("textarea") }).first().getByRole("button", { name: "Cancel", exact: true }).click();
      } else {
        // Replace it with mine: the explicit choice saves the draft over the newer wording, same id.
        await editor.getByTestId("objective-edit-replace").click();
        await expect.poll(async () => (await client.query("select candidate_text from objective_candidates where id=$1", [alphaId])).rows[0]?.candidate_text, { timeout: 30_000 }).toBe("Researcher draft from the older objective");
      }
      expect(Number((await client.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count)).toBe(2);

      // Cancel then Edit again starts from the current wording.
      await page.reload({ waitUntil: "networkidle" });
      await openSection(page, "Review Objectives");
      const current = (await client.query("select candidate_text from objective_candidates where id=$1", [alphaId])).rows[0].candidate_text;
      await rowOf(current).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.locator("tbody[data-objective-row]", { has: page.locator("textarea") }).first().locator("textarea")).toHaveValue(current);
    } finally {
      await client.end();
    }
  });
}

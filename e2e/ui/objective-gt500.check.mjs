// GT500 repairs (Codex, 2026-10-21), the native repros from the independent review, retained:
//   F01: fill from a proposal, edit the imported objective, fill from the same proposal again:
//        the edited objective keeps its id and wording and the original does not come back.
//   F02: the extraction answers HTTP 503: the typed text is saved, the form says the fill did not
//        happen once the response has settled, and still says so after a reload; the earlier fill
//        is labelled as the previous one; Try the fill again then fills once.
//   F03: two editors opened on the same objective: the second save is refused, its draft stays in
//        the editor, and no second objective appears.
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
    await fillFromProposal(page, client, run.id);
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
    await fillFromProposal(page, client, run.id);
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
    await expect(page.getByText("Objective from the retry", { exact: true }).first()).toBeVisible();
    const texts = (await client.query("select candidate_text from objective_candidates where run_id=$1 ", [run.id])).rows.map((r) => r.candidate_text).sort();
    expect(texts).toEqual(["Objective from the first fill", "Objective from the retry"]);
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

// Application-owned browser adapter for Codex's independent golden-thread smoke specification
// (e2e/golden-thread-smoke.spec.mjs). The spec owns the assertions against the fixture
// references; this file owns HOW each workflow step is driven through the running app's own
// controls, so the spec never needs to know the app's markup.
//
// Rules this adapter keeps:
// - Every action goes through a control a researcher uses (links, buttons, file inputs). No
//   database, API shortcut or application hook writes state. The only non-visual hooks used are
//   data-* attributes added for identity (finding id, insight id, review and support status),
//   so steps after the first find a record by its stable id, never by its position on screen.
// - A step that cannot be completed throws with the reason. Nothing is skipped or defaulted, so
//   a run either drives the whole thread or names where it stopped.
// - Export content is read from the actual downloaded file (the same Download object the spec
//   saves), parsed per sheet, slide or document section. Text and XML inspection only: this
//   does not certify how Office renders the file.
// - Limits are recorded on the test as annotations rather than passed over: see
//   `note(...)` calls below.
import { expect } from "@playwright/test";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Generous because a server action here can run the Python engine (crosstabs) or several
// model calls (synthesis, narrative) before it returns; a replay answers instantly, a real
// model does not.
const STEP_TIMEOUT = 180_000;
// An export is one GET that builds the file. Under `next dev` the first request to an export route
// also compiles it (and its Office library) on demand, which on a slow machine has exceeded
// STEP_TIMEOUT before any byte arrived; that compile time is the environment, not the export. So
// an export gets a longer wait, a failed export is reported at once with its HTTP status (see
// exportFile), and the time taken is recorded on the test.
const EXPORT_TIMEOUT = 600_000;
const SECTION_NAMES = ["Findings", "Insights", "Recommendations", "Insights report", "Import data", "Analytics"];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const decodeXml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const xmlText = (xml) => squash(decodeXml(xml.replace(/<[^>]+>/g, " ")));

// Words the app uses when it shows content whose support has failed, changed or is unknown.
// A restatement of an invalid insight is acceptable only next to one of these.
const QUALIFIER = /no longer valid|no longer current|left out|needs review|may be out of date|excluded from this report/i;

export async function bind({ page, target, testInfo }) {
  const note = (type, description) => testInfo.annotations.push({ type, description });
  const appUrl = new URL(target.appUrl);
  const downloads = new Map(); // kind -> Download, captured in export()
  const state = { humanText: null, finding: null, insight: null };

  async function mountSections(names) {
    for (const name of names) await openSection(name);
  }

  async function openSection(name) {
    if (!SECTION_NAMES.includes(name)) throw new Error(`Adapter does not know section "${name}"`);
    // Section buttons carry a count badge. Its text joins the name with or without a space
    // depending on markup ("Findings 4", "Analytics1"), so the name is matched exactly, followed by
    // an optional count with optional space. "Insights" therefore never matches "Insights report".
    await page
      .getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}(\\s*\\d+)?$`) })
      .first()
      .click();
  }

  const findingCard = (finding) => page.locator(`[data-testid="finding-card"][data-finding-id="${finding.id}"]`);
  const insightCard = (insight) => page.locator(`[data-testid="synthesized-insight-card"][data-insight-id="${insight.id}"]`);

  // Runs a click that triggers a Next.js server action and waits for that action's response.
  // The cards update optimistically, so the visible state alone does not mean the change was
  // stored; reloading before the response arrives can abort the save.
  async function viaServerAction(click) {
    const done = page.waitForResponse(
      (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      { timeout: STEP_TIMEOUT },
    );
    await click();
    const response = await done;
    if (!response.ok()) throw new Error(`The server action answered HTTP ${response.status()}`);
  }

  async function settle() {
    await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT });
  }

  // ----- run and import ---------------------------------------------------------------------

  async function createRun({ name }) {
    await page.goto(appUrl.href, { waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    // The start-point card, not an existing project's card that also names its starting point.
    await page.locator('a[href="/?entry=generate"]').click();
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/, { timeout: STEP_TIMEOUT });
    await settle();
    const id = /\/runs\/([0-9a-f-]{36})/.exec(page.url())[1];
    return { id, name, url: new URL(`/runs/${id}`, appUrl).href };
  }

  async function upload(run, file, kind) {
    const input = { table: "rawTableFiles", report: "reportFiles" }[kind];
    if (!input) throw new Error(`Adapter upload kind must be "table" or "report", got "${kind}"`);
    await openSection("Import data");
    const name = path.basename(file);
    const listed = page.getByRole("heading", { name: /^Your files \(\d+\)$/ });
    const countNow = async () => ((await listed.count()) ? Number(/\((\d+)\)/.exec(await listed.first().innerText())[1]) : 0);
    const before = await countNow();
    const form = page.locator("form", { has: page.locator(`input[name="${input}"]`) });
    await form.locator(`input[name="${input}"]`).setInputFiles(file);
    await form.getByRole("button", { name: "Upload", exact: true }).click();
    // Done when the project lists one more file, under this name. The form's own message is not
    // used: the first upload switches the page to its populated layout, which remounts the form.
    // A rejected upload shows the form's error line instead, which stops the thread here.
    const rejected = page.locator("form > div.border-danger");
    await expect
      .poll(async () => ((await rejected.count()) ? `rejected: ${squash(await rejected.first().innerText())}` : await countNow()), { timeout: STEP_TIMEOUT })
      .toBe(before + 1);
    await expect(page.getByRole("paragraph").filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) }).first()).toBeAttached();
    await settle();
    run.files = [...(run.files ?? []), { kind, name: path.basename(file) }];
  }

  async function selectTableDocument() {
    await openSection("Import data");
    const table = page.getByText(/\.(xlsx|xls|csv|sav)$/i).first();
    await table.click();
  }

  function importQuality() {
    // The data-quality block for the selected table document (a <details> group).
    return page.locator("details", { has: page.locator(":scope > summary", { hasText: /^Data quality$/ }) }).first();
  }

  async function expectReadyOrActionableRecovery() {
    const block = importQuality();
    if (!(await block.isVisible())) await selectTableDocument();
    await expect(block).toBeVisible({ timeout: STEP_TIMEOUT });
    if (!(await block.getAttribute("open"))) await block.locator(":scope > summary").click();
    const ready = block.getByTestId("import-quality-table");
    const recovery = block.getByTestId("import-preview-recovery");
    await expect(ready.or(recovery).first()).toBeVisible({ timeout: STEP_TIMEOUT });
    if (await recovery.isVisible()) {
      // A preview failure is the actionable path: it must say what to do, not be blank.
      await expect(recovery).toHaveText(/\S{10,}/);
      throw new Error(`Import is in its recovery state, so the thread cannot continue: ${squash(await recovery.innerText())}`);
    }
  }

  // ----- crosstab ---------------------------------------------------------------------------

  async function workspace() {
    const dialog = page.getByRole("dialog", { name: "Crosstab workspace" });
    if (!(await dialog.isVisible())) {
      await openSection("Analytics");
      await page.getByRole("button", { name: /^Crosstabs/ }).click();
    }
    await expect(dialog.getByRole("button", { name: /Add table to set/ })).toBeVisible({ timeout: STEP_TIMEOUT });
    return dialog;
  }

  // Finds a variable's row by its exact name. The list hides some variable types until their
  // type is chosen in the "Variable type" filter (string-coded answers without value labels are
  // listed under "Text answers"), so each filter is tried in turn and the one that held the
  // variable is recorded.
  async function pickVariable(dialog, name, axis, on = true) {
    const search = dialog.getByPlaceholder("Search name or label");
    const filter = dialog.getByLabel("Variable type");
    const options = await filter.evaluate((s) => [...s.options].map((o) => o.value));
    for (const value of options) {
      await filter.selectOption(value);
      await search.fill(name);
      const row = dialog.locator(`div.grid:has(> span[title="${name}"])`).first();
      if (await row.isVisible()) {
        // The buttons toggle; aria-pressed says the current state, so a click only ever moves
        // the variable to the wanted state.
        const button = row.getByRole("button", { name: axis, exact: true });
        if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
        await expect(button).toHaveAttribute("aria-pressed", String(on));
        if (value !== "all") note("crosstab-variable-filter", `${name} is listed only under the "${value}" variable type, not under "All types"`);
        await search.fill("");
        await filter.selectOption("all");
        return;
      }
    }
    throw new Error(`Variable "${name}" is not offered in the crosstab workspace under any variable type`);
  }

  async function buildPurchaseCrosstab(run) {
    const dialog = await workspace();
    await pickVariable(dialog, "Gender", "Column");
    await pickVariable(dialog, "Purchase", "Row");
    await dialog.getByRole("button", { name: "Add table to set", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /^Commit \d+ table/ })).toBeVisible({ timeout: STEP_TIMEOUT });
    const table = await resultTableFor(dialog, "Purchase");
    return { run, rowVariable: "Purchase", columnVariable: "Gender", dialog, table };
  }

  // Independent evidence for the thread: a second table from the same file (Recommend by
  // Gender), committed, so synthesis has a second subject the later rejection does not touch.
  // It is the same respondent dataset, so it is not independent corroboration of Purchase.
  async function addIndependentEvidence(run) {
    const dialog = await workspace();
    await pickVariable(dialog, "Purchase", "Row", false);
    await pickVariable(dialog, "Gender", "Column");
    await pickVariable(dialog, "Recommend", "Row");
    await dialog.getByRole("button", { name: "Add table to set", exact: true }).click();
    const commit = dialog.getByRole("button", { name: /^Commit \d+ table/ });
    await expect(commit).toBeVisible({ timeout: STEP_TIMEOUT });
    await commit.click();
    await expect(dialog.getByText(/Committed \d+ table\(s\)\. [1-9]\d* finding\(s\) generated\./)).toBeVisible({ timeout: STEP_TIMEOUT });
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    run.independentEvidence = { rowVariable: "Recommend", columnVariable: "Gender" };
  }

  // A table of one row variable, optionally against one banner variable, built through the
  // workspace's own controls from a fresh workspace (nothing left selected from earlier tables).
  async function buildTable(run, { row, column = null }) {
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    const dialog = await workspace();
    if (column) await pickVariable(dialog, column, "Column");
    await pickVariable(dialog, row, "Row");
    await dialog.getByRole("button", { name: "Add table to set", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /^Commit \d+ table/ })).toBeVisible({ timeout: STEP_TIMEOUT });
    const table = await resultTableFor(dialog, row);
    return { run, rowVariable: row, columnVariable: column, dialog, table };
  }

  // The newest RESULT table whose row questions include `row`, found by the table's own identity
  // attributes (data-testid="crosstab-result-table", data-question-keys), never by position among
  // all tables: a result can contain a nested descriptive-statistics table, which an earlier
  // "last matching table" selector picked instead of the result itself.
  async function resultTableFor(dialog, row, { hasText = null } = {}) {
    const all = dialog.locator('table[data-testid="crosstab-result-table"]');
    let found = -1;
    await expect
      .poll(
        async () => {
          const keys = await all.evaluateAll((els) => els.map((el) => el.getAttribute("data-question-keys")));
          const texts = hasText ? await all.allInnerTexts() : null;
          found = -1;
          keys.forEach((k, i) => {
            let list = [];
            try {
              list = JSON.parse(k ?? "[]");
            } catch {
              list = [];
            }
            if (list.includes(row) && (!hasText || texts[i].includes(hasText))) found = i;
          });
          return found;
        },
        { timeout: STEP_TIMEOUT, message: `no result table for row question ${row}${hasText ? ` showing "${hasText}"` : ""}` },
      )
      .toBeGreaterThanOrEqual(0);
    const table = all.nth(found);
    await expect(table).toBeVisible();
    return table;
  }

  // ---- reading what the app shows ------------------------------------------------------------
  // Every number below is read from a cell the app renders, never recomputed here: a share or
  // count of several codes comes from a subtotal (NET) row the app builds from those codes with its
  // own Group control. Values carry the app's display rounding; each read is annotated with the
  // displayed text so a comparison can use a tolerance that fits it.

  // Rows of the rendered table as { key, label, measure, cells[] }, with the value column chosen:
  // "Total" when there is a banner, else the table's only value column ("All respondents").
  // With a segment ({ variable, rawCode }), the value column is the banner column whose identity
  // attributes (data-col-var, data-raw-code, written by the engine's column output) name exactly
  // that variable and code; a missing or repeated match is refused, never guessed from a label.
  async function tableRows(table, segment = null) {
    const out = await table.table.evaluate((el, seg) => {
      const headerRow = [...el.querySelectorAll(":scope > thead tr")].pop();
      const headerCells = [...headerRow.children];
      const headers = headerCells.map((c) => c.textContent.replace(/\s+/g, " ").trim());
      if (headers[1] !== "Measure") return { error: "the table is not showing its Measure column, so a cell's measure cannot be told apart" };
      let valueAt;
      if (seg) {
        const hits = headerCells
          .map((c, i) => ({ i, v: c.getAttribute("data-col-var"), code: c.getAttribute("data-raw-code") }))
          .filter((h) => h.v === seg.variable && h.code === String(seg.rawCode));
        if (hits.length === 0) {
          const any = headerCells.some((c) => c.hasAttribute("data-raw-code"));
          return {
            error: any
              ? `no banner column for ${seg.variable} code "${seg.rawCode}"`
              : "this table's banner columns carry no code identity (built before engine 2026.10.16-9); rebuild the table",
          };
        }
        if (hits.length > 1) return { error: `${hits.length} banner columns claim ${seg.variable} code "${seg.rawCode}"` };
        valueAt = hits[0].i;
      } else {
        valueAt = headers.findIndex((h) => /^Total(n=[\d,]+)?$/.test(h));
        if (valueAt < 0 && headers.length === 3) valueAt = 2;
        if (valueAt < 0) return { error: `no Total column and more than one value column: ${JSON.stringify(headers)}` };
      }
      const rows = [];
      let cur = null;
      for (const tr of el.querySelectorAll(":scope > tbody > tr")) {
        const tds = [...tr.children];
        if (tds.length === 1) continue; // a question title or a nested statistics block
        const labelled = tds[0]?.hasAttribute("rowspan") || tds[0]?.querySelector('button[aria-label^="Hide "]');
        if (labelled) {
          cur = {
            rawCode: tds[0].getAttribute("data-raw-code"),
            label: tds[0].textContent.replace(/×/g, "").replace(/\s+/g, " ").trim(),
          };
        } else if (tds.length === headers.length) {
          // An unlabelled first cell (Total, Average) starts a row of its own.
          cur = { rawCode: null, label: tds[0].textContent.replace(/\s+/g, " ").trim() };
          rows.push({ ...cur, measure: tds[1]?.textContent.trim(), value: tds[valueAt]?.textContent.trim() ?? null });
          continue;
        }
        const rest = labelled ? tds.slice(1) : tds;
        rows.push({ ...cur, measure: rest[0]?.textContent.trim(), value: rest[valueAt - 1]?.textContent.trim() ?? null });
      }
      // The descriptive-statistics block nested in the table, by its own identity: its "Mean"
      // column, first data row. (Overall tables only; a banner table has no such block.)
      const means = [...el.querySelectorAll('table[data-testid="crosstab-descriptives"]')]
        .map((t) => {
          const head = t.tHead?.rows[t.tHead.rows.length - 1];
          const body = t.tBodies[0]?.rows[0];
          if (!head || !body) return null;
          const at = [...head.cells].findIndex((h) => h.textContent.trim() === "Mean");
          return at >= 0 ? body.cells[at]?.textContent.trim() ?? null : null;
        })
        .filter((v) => v !== null);
      return { rows, means, valueHeader: headers[valueAt] };
    }, segment);
    if (out.error) throw new Error(`readStatistic: ${out.error}`);
    return out;
  }

  const number = (text, what) => {
    const value = Number.parseFloat(String(text).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(value)) throw new Error(`readStatistic: ${what} shows "${text}", not a number`);
    note("statistic-display", `${what}: displayed "${text}"`);
    return value;
  };

  // A subtotal (NET) row over these raw codes, made with the workspace's Group control, then the
  // table re-added. The Group control picks answers by their LABEL (the app saves groups as label
  // text), so the codes are mapped to labels through the table's own rows first, and two codes
  // sharing one label are refused rather than merged.
  async function netOver(table, codes) {
    const { rows } = await tableRows(table);
    const labels = [];
    for (const code of codes) {
      const row = rows.find((r) => r.rawCode === code);
      if (!row) throw new Error(`readStatistic: no answer row with raw code "${code}" for ${table.rowVariable}`);
      if (rows.some((r) => r.rawCode && r.rawCode !== code && r.label === row.label)) {
        throw new Error(`readStatistic: codes share the label "${row.label}"; the app groups by label, so this NET would merge them`);
      }
      labels.push(row.label);
    }
    const name = `Codes ${codes.join("+")}`;
    const dialog = table.dialog;
    // Adding a table clears the selection, so the same row (and banner) is selected again first.
    if (table.columnVariable) await pickVariable(dialog, table.columnVariable, "Column");
    await pickVariable(dialog, table.rowVariable, "Row");
    await dialog.locator(`[data-row-key="${table.rowVariable}"]`).getByRole("button", { name: "Group", exact: true }).click();
    const group = page.getByRole("dialog", { name: "Group categories" });
    await expect(group.getByRole("checkbox").first()).toBeVisible({ timeout: STEP_TIMEOUT });
    // Each checkbox is named by its answer label followed by its count ("Very easy n=10").
    for (const label of labels) {
      await group.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(label)}(\\s+n=[\\d,]+)?$`) }).check();
    }
    await group.getByPlaceholder("Group name, e.g. Top 2 box").fill(name);
    await group.getByRole("button", { name: "Add group", exact: true }).click();
    await group.getByRole("button", { name: /^Save \d+ groups?$/ }).click();
    await dialog.getByRole("button", { name: "Add table to set", exact: true }).click();
    const withNet = await resultTableFor(dialog, table.rowVariable, { hasText: `NET: ${name}` });
    return { ...table, table: withNet, netLabel: `NET: ${name}` };
  }

  // statistic: selection_percentage | favourable_percent (share of the given raw codes, "% within
  // column"), category_count ("n"), mean (the app's mean of the answer codes, or its Average for a
  // numeric variable). rawCode or rawCodes as in Codex's fixture interface.
  // segment ({ variable, rawCode }): the same statistic within one subgroup, read from that
  // subgroup's banner column, found by its code (see tableRows). The table must have been built
  // with the segment's variable as its banner (buildTable's `column`); otherwise it is refused, so
  // a segment request is never answered with the overall value. A segment mean is read from the
  // banner table's Average row, as the app shows it there.
  async function readStatistic(table, { variable, rawCode, rawCodes, statistic, segment = null }) {
    if (variable !== table.rowVariable) throw new Error(`Table rows are ${table.rowVariable}, not ${variable}`);
    if (segment) {
      if (!segment.variable || segment.rawCode === undefined || segment.rawCode === null) {
        throw new Error("readStatistic: a segment needs { variable, rawCode }");
      }
      if (segment.variable !== table.columnVariable) {
        throw new Error(
          `readStatistic: segment ${segment.variable} is not this table's banner (${table.columnVariable ?? "none"}); build the table with column: "${segment.variable}"`,
        );
      }
    }
    const codes = (rawCodes ?? (rawCode === undefined ? [] : [rawCode])).map(String);
    const what = `${statistic} of ${variable}${codes.length ? ` codes ${codes.join(",")}` : ""}`;
    const where = segment ? ` in ${segment.variable}=${segment.rawCode}` : "";
    if (statistic === "mean") {
      const { rows, means } = await tableRows(table, segment);
      const average = rows.find((r) => r.label === "Average");
      if (!segment && means.length === 1) return number(means[0], what);
      if (segment) {
        if (!average) throw new Error(`readStatistic: the table shows no Average row for ${variable}${where}`);
        return number(average.value, what + where);
      }
      if (average) return number(average.value, what);
      throw new Error(`readStatistic: the table shows no single mean for ${variable}`);
    }
    const measure = { selection_percentage: "% within column", favourable_percent: "% within column", category_count: "n" }[statistic];
    if (!measure) throw new Error(`Adapter cannot read statistic "${statistic}"`);
    if (codes.length === 0) throw new Error(`readStatistic: ${statistic} needs raw codes`);
    let source = table;
    let pick = (r) => r.rawCode === codes[0];
    if (codes.length > 1) {
      source = await netOver(table, codes);
      pick = (r) => r.label === source.netLabel;
    }
    const { rows } = await tableRows(source, segment);
    const row = rows.find((r) => pick(r) && r.measure === measure);
    if (!row) throw new Error(`readStatistic: no "${measure}" cell for ${what}${where}`);
    return number(row.value, what + where);
  }

  // Commits the table, then accepts the finding that states the overall distribution of the
  // row variable (the finding the spec's reference statistic describes). Identity from then on
  // is the finding's id. A committed table's findings are already stored as accepted (committing
  // is the researcher's acceptance in the crosstab workspace); the explicit Accept click records
  // a per-finding review on top, and leaves the status as it was.
  async function postAndAcceptFinding(table) {
    const dialog = table.dialog;
    await dialog.getByRole("button", { name: /^Commit \d+ table/ }).click();
    await expect(dialog.getByText(/Committed \d+ table\(s\)\. [1-9]\d* finding\(s\) generated\./)).toBeVisible({ timeout: STEP_TIMEOUT });
    await page.keyboard.press("Escape");
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: /^(Close|Done)$/ }).first().click();
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Findings");
    const card = page.getByTestId("finding-card").filter({ hasText: new RegExp(`On ${escapeRegExp(table.rowVariable)}, the most common answer`) });
    await expect(card).toHaveCount(1, { timeout: STEP_TIMEOUT });
    const finding = { id: await card.getAttribute("data-finding-id"), text: null };
    finding.text = squash(await findingCard(finding).locator("text=/the most common answer/").first().innerText());
    await viaServerAction(() => findingCard(finding).getByRole("button", { name: "Accept", exact: true }).click());
    await expect(findingCard(finding)).toHaveAttribute("data-review-status", "accepted", { timeout: STEP_TIMEOUT });
    // Confirm the stored state, not the optimistic one.
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Findings");
    await expect(findingCard(finding)).toHaveAttribute("data-review-status", "accepted");
    state.finding = finding;
    return finding;
  }

  async function saveResearcherNote(finding, text) {
    await openSection("Findings");
    const card = findingCard(finding);
    await card.getByRole("button", { name: "+ Add note", exact: true }).click();
    await card.getByRole("textbox").fill(text);
    await viaServerAction(() => card.getByRole("button", { name: "Save", exact: true }).click());
    // The note shows at once; only a reload proves it was stored.
    await expect(findingResearcherNote(finding)).toContainText(text);
    await page.waitForLoadState("networkidle");
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Findings");
    await expect(findingResearcherNote(finding)).toContainText(text, { timeout: STEP_TIMEOUT });
    state.humanText = text;
  }

  // ----- insight and narrative ----------------------------------------------------------------

  // Pre-insights are written after the commit returns (verification runs in the background), so
  // synthesis is retried until an accepted insight citing the finding exists, up to a bound.
  // Which insight depends on the finding is read from its own data-source-finding-ids.
  async function generateOrLoadInsight(run, finding) {
    await openSection("Insights");
    const citing = page.locator(
      `[data-testid="synthesized-insight-card"][data-review-status="accepted"][data-source-finding-ids~="${finding.id}"]`,
    );
    const wanted = run.independentEvidence ? 2 : 1;
    const accepted = page.locator('[data-testid="synthesized-insight-card"][data-review-status="accepted"]');
    for (let attempt = 0; attempt < 12 && ((await citing.count()) === 0 || (await accepted.count()) < wanted); attempt++) {
      await page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ }).click();
      await expect(page.getByRole("button", { name: /^(Run synthesis|Re-run synthesis)$/ })).toBeEnabled({ timeout: STEP_TIMEOUT });
      await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
      await openSection("Insights");
      if ((await citing.count()) === 0) await page.waitForTimeout(5_000);
    }
    const n = await citing.count();
    if (n !== 1) throw new Error(`Expected exactly one accepted synthesized insight citing finding ${finding.id}; found ${n}`);
    const insight = { id: await citing.getAttribute("data-insight-id") };
    insight.headline = squash(await insightCard(insight).locator("text=/^\\[/").first().innerText());
    state.insight = insight;
    return insight;
  }

  // A recommendation the researcher writes on an accepted insight that does NOT cite `independentOf`
  // (so rejecting that finding leaves it eligible). Returns its id for later checks.
  async function addEligibleHumanRecommendation(run, { independentOf, text }) {
    await openSection("Insights");
    const independent = page
      .locator('[data-testid="synthesized-insight-card"][data-review-status="accepted"]')
      .and(page.locator(`:not([data-source-finding-ids~="${independentOf.id}"])`));
    await expect(independent).toHaveCount(1, { timeout: STEP_TIMEOUT });
    const insightId = await independent.getAttribute("data-insight-id");
    await openSection("Recommendations");
    const form = page.getByRole("form", { name: "Add your own recommendation" });
    await form.getByLabel("Insight this recommendation is for").selectOption(insightId);
    await form.getByLabel("Action", { exact: true }).fill(text);
    await form.getByLabel("Owner role", { exact: true }).fill("Customer advocacy lead");
    await form.getByLabel("Timeline", { exact: true }).fill("Next quarter");
    await form.getByLabel("Why this owner, and feasibility", { exact: true }).fill("Owns the advocacy programme.");
    await form.getByLabel("Metric", { exact: true }).fill("Likelihood to recommend by group, next wave");
    await form.getByLabel("Assumptions and risks", { exact: true }).fill("Assumes the next wave repeats the measure.");
    await form.getByLabel("Alternatives considered", { exact: true }).fill("Waiting for another wave.");
    await form.getByRole("button", { name: "Add recommendation", exact: true }).click();
    const card = page
      .locator(`[data-testid="recommendation-card"][data-insight-id="${insightId}"][data-source="researcher_authored"]`)
      .filter({ hasText: text });
    await expect(card).toHaveCount(1, { timeout: STEP_TIMEOUT });
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Recommendations");
    await expect(card).toHaveCount(1);
    const recommendation = { id: await card.getAttribute("data-recommendation-id"), insightId, text };
    state.humanRecommendation = recommendation;
    return recommendation;
  }

  function recommendationText(recommendation) {
    return page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${recommendation.id}"]`);
  }

  async function prepareAcceptedNarrative(run, insight) {
    await openSection("Insights");
    await expect(insightCard(insight)).toHaveAttribute("data-review-status", "accepted");
    await openSection("Insights report");
    await page.getByRole("button", { name: /^(Generate Insights Report|Regenerate report content)$/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate report content", exact: true })).toBeVisible({ timeout: STEP_TIMEOUT });
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Insights report");
    await expect(page.getByText(/^Generated \d/)).toBeVisible();
    // Before the rejection every cited insight is current, so no support line is shown.
    await expect(narrativeSupportBanner()).toHaveCount(0);
  }

  async function rejectFinding(finding) {
    await openSection("Findings");
    await viaServerAction(() => findingCard(finding).getByRole("button", { name: "Reject", exact: true }).click());
    await expect(findingCard(finding)).toHaveAttribute("data-review-status", "rejected", { timeout: STEP_TIMEOUT });
    await page.reload({ waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await openSection("Findings");
    await expect(findingCard(finding)).toHaveAttribute("data-review-status", "rejected");
    await mountSections(["Insights", "Recommendations", "Insights report"]);
  }

  // A run section is mounted on its first visit after a page load and then kept (hidden) while
  // another is shown (RunShell). The locator-returning operations below are synchronous, so the
  // steps before them mount every section they read from.
  function insightSupportWarning(insight) {
    return insightCard(insight).getByTestId("support-status");
  }

  function narrativeSupportBanner() {
    return page.getByTestId("narrative-support-status");
  }

  // Recounts the banner's sentence from the insight cards' own support badges.
  async function assertBannerStatusCountsTruthful() {
    const banner = narrativeSupportBanner();
    await expect(banner).toHaveCount(1);
    const ids = (await banner.getAttribute("data-cited-insight-ids")).split(" ").filter(Boolean);
    expect(new Set(ids).size, "banner lists distinct insights").toBe(ids.length);
    const counts = { invalid: 0, stale: 0, unknown: 0, current: 0 };
    for (const id of ids) {
      const card = page.locator(`[data-testid="synthesized-insight-card"][data-insight-id="${id}"]`);
      // A cited insight with no card any more is counted as no longer valid (see the banner's rule).
      if ((await card.count()) === 0) {
        counts.invalid += 1;
        continue;
      }
      const badge = card.getByTestId("support-status");
      counts[(await badge.count()) ? await badge.getAttribute("data-support-status") : "current"] += 1;
    }
    const sentence = squash(await banner.innerText());
    expect(sentence).toContain(`Of the ${ids.length} ${ids.length === 1 ? "insight" : "insights"} this narrative uses`);
    const phrase = {
      invalid: (n) => `${n} ${n === 1 ? "is" : "are"} no longer valid`,
      stale: (n) => `${n} ${n === 1 ? "has" : "have"} changed since`,
      unknown: (n) => `${n} could not be checked`,
      current: (n) => `${n} ${n === 1 ? "is" : "are"} current`,
    };
    const absent = {
      invalid: /\d+ (is|are) no longer valid/,
      stale: /\d+ (has|have) changed since/,
      unknown: /\d+ could not be checked/,
      current: /\d+ (is|are) current/,
    };
    for (const [status, n] of Object.entries(counts)) {
      if (n > 0) expect(sentence, `banner states ${status} count`).toContain(phrase[status](n));
      else expect(sentence, `banner does not claim any ${status}`).not.toMatch(absent[status]);
    }
  }

  // ----- exports ------------------------------------------------------------------------------

  // Clicks the export link and waits for its download. The wait ends early, with the reason,
  // when the export route answers with an error status (an error page arrives instead of a file,
  // so no download would ever come); otherwise it waits up to EXPORT_TIMEOUT for the file.
  async function exportFile(run, kind) {
    let link;
    if (kind === "findings-xlsx") {
      // The review register: every finding with its review status, so a rejection is disclosed
      // on its own row rather than the row silently disappearing.
      await openSection("Findings");
      link = page.locator(`a[href="/api/runs/${run.id}/findings/export?scope=all"]`);
    } else if (kind === "narrative-docx") {
      await openSection("Insights report");
      link = page.getByRole("link", { name: "Export report (.docx)", exact: true });
    } else if (kind === "narrative-pptx") {
      await openSection("Insights report");
      link = page.getByRole("link", { name: "Export deck (.pptx)", exact: true });
    } else {
      throw new Error(`Adapter cannot export "${kind}"`);
    }
    await expect(link).toBeVisible({ timeout: STEP_TIMEOUT });
    const target = new URL(await link.getAttribute("href"), appUrl);
    const started = Date.now();
    let onResponse;
    const failed = new Promise((_, reject) => {
      onResponse = (r) => {
        const u = new URL(r.url());
        if (u.pathname === target.pathname && r.status() >= 400) {
          r.text()
            .catch(() => "")
            .then((body) => reject(new Error(`${kind} export answered HTTP ${r.status()} for ${u.pathname}: ${squash(body).slice(0, 300)}`)));
        }
      };
      page.on("response", onResponse);
    });
    try {
      const download = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT });
      await link.click();
      const d = await Promise.race([download, failed]);
      downloads.set(kind, d);
      note("export-timing", `${kind}: download began ${((Date.now() - started) / 1000).toFixed(1)}s after the click`);
    } finally {
      page.off("response", onResponse);
      failed.catch(() => {});
    }
  }

  async function exportZip(kind) {
    const d = downloads.get(kind);
    if (!d) throw new Error(`No download captured for ${kind}`);
    return JSZip.loadAsync(await fs.readFile(await d.path()));
  }

  async function findingsRows() {
    const d = downloads.get("findings-xlsx");
    const book = XLSX.read(await fs.readFile(await d.path()), { type: "buffer" });
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "" });
  }

  // Slides as { label, text }: label is the footer's section name, which the deck writes on
  // every content slide.
  async function slides() {
    const zip = await exportZip("narrative-pptx");
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
    return Promise.all(names.map(async (n) => ({ name: n, text: xmlText(await zip.files[n].async("string")) })));
  }

  // Document sections as { heading, text }, split at Word heading paragraphs.
  async function sections() {
    const zip = await exportZip("narrative-docx");
    const xml = await zip.files["word/document.xml"].async("string");
    const out = [{ heading: "(start)", text: "" }];
    for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const text = xmlText(p);
      if (!text) continue;
      if (/<w:pStyle w:val="Heading\d"/.test(p)) out.push({ heading: text, text: "" });
      else out.at(-1).text += ` ${text}`;
    }
    return out;
  }

  // The eligible-content checks below are soft: a failure is recorded and fails the test, but the
  // thread continues, so one run reports every export that leaks invalid content, plus the
  // reload checks after them, instead of stopping at the first. Every slide or report section that
  // still shows the invalid insight's wording, the narrative's saved framing included, must carry
  // a qualification in that same slide or section.

  async function assertInvalidSupportExcludedAndDisclosed({ finding, kind }) {
    const insight = state.insight;
    if (kind === "findings-xlsx") {
      const row = (await findingsRows()).find((r) => squash(r.Finding) === finding.text);
      expect(row, "rejected finding is listed in the review register").toBeTruthy();
      expect(row.Status, "its rejection is disclosed").toBe("Rejected");
      expect(String(row.Source)).toMatch(/golden-survey-documented\.xlsx/);
      return;
    }
    const headline = insight.headline.replace(/…$/, "");
    if (kind === "narrative-pptx") {
      const deck = await slides();
      const disclosure = deck.find((s) => /Evidence status/i.test(s.text) && s.text.includes(headline));
      expect(disclosure, "deck has an evidence-status slide naming the left-out insight").toBeTruthy();
      expect(disclosure.text).toMatch(/Support no longer valid/);
      expect(disclosure.text).toMatch(/was rejected/);
      const unqualified = deck.filter((s) => s.text.includes(headline) && !QUALIFIER.test(s.text));
      expect.soft(
        unqualified.map((s) => `${s.name}: ${s.text.slice(0, 160)}`),
        "no slide presents the invalid insight as eligible content",
      ).toEqual([]);
      return;
    }
    if (kind === "narrative-docx") {
      const doc = await sections();
      const disclosure = doc.find((s) => /^Excluded from this report/i.test(s.heading));
      expect(disclosure, "report has an exclusion section").toBeTruthy();
      expect(disclosure.text).toContain(headline);
      expect(disclosure.text).toMatch(/Support no longer valid.*was rejected/);
      const unqualified = doc.filter((s) => s.text.includes(headline) && !QUALIFIER.test(`${s.heading} ${s.text}`));
      expect.soft(
        unqualified.map((s) => `${s.heading}: ${s.text.slice(0, 160)}`),
        "no report section presents the invalid insight as eligible content",
      ).toEqual([]);
      return;
    }
    throw new Error(`Adapter has no exclusion rule for ${kind}`);
  }

  async function assertEligibleHumanTextPreserved({ kind, text }) {
    const human = state.humanText;
    if (kind === "findings-xlsx") {
      const row = (await findingsRows()).find((r) => squash(r.Finding) === state.finding.text);
      // Rejection changes eligibility, not the stored human wording.
      expect(row.Note, "researcher note preserved on the rejected finding's row").toBe(human);
      return;
    }
    // The note sits on a finding that is then rejected, so it is not eligible narrative content.
    expect(text, `${kind} does not present the rejected finding's note as content`).not.toContain(human);
    const rec = state.humanRecommendation;
    if (!rec) {
      note("not-exercised", `${kind}: no eligible human-authored narrative content exists in this thread, so preservation of eligible human wording in narrative exports is not exercised`);
      return;
    }
    // The researcher's own recommendation rests on an insight the rejection did not touch: its
    // wording is exported exactly, and not as a left-out item.
    expect(text, `${kind} keeps the researcher's recommendation wording`).toContain(rec.text);
    expect(text, `${kind} does not list the eligible recommendation as left out`).not.toContain(`Recommendation left out: ${rec.text}`);
    expect(text).not.toContain(`Recommendation: ${rec.text} (its insight`);
  }

  // ----- reload -------------------------------------------------------------------------------

  async function openRun(run) {
    await page.goto(run.url, { waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    await mountSections(["Insights", "Recommendations", "Insights report", "Findings"]);
  }

  function findingResearcherNote(finding) {
    return findingCard(finding).getByRole("button", { name: /^Note:/ });
  }

  async function expectFindingReviewState(finding, status) {
    await expect(findingCard(finding)).toHaveAttribute("data-review-status", status);
    const pressed = { accepted: "Accept", rejected: "Reject" }[status];
    if (pressed) await expect(findingCard(finding).getByRole("button", { name: pressed, exact: true })).toHaveAttribute("aria-pressed", "true");
  }

  return {
    createRun,
    upload,
    importQuality,
    expectReadyOrActionableRecovery,
    buildPurchaseCrosstab,
    buildTable,
    addIndependentEvidence,
    addEligibleHumanRecommendation,
    recommendationText,
    readStatistic,
    postAndAcceptFinding,
    saveResearcherNote,
    generateOrLoadInsight,
    prepareAcceptedNarrative,
    rejectFinding,
    insightSupportWarning,
    narrativeSupportBanner,
    assertBannerStatusCountsTruthful,
    export: exportFile,
    assertInvalidSupportExcludedAndDisclosed,
    assertEligibleHumanTextPreserved,
    openRun,
    findingResearcherNote,
    expectFindingReviewState,
  };
}

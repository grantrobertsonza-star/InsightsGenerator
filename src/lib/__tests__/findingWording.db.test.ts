// FND-001 probe B: researcher wording edits on report findings, against a REAL PostgreSQL
// (disposable database from every migration) through the app's own db.ts, calling the ACTUAL
// server actions, support loader and report re-read. Mocked boundaries only: Next's
// revalidatePath and after() (after() callbacks are captured, not run), the verification chain
// that after() would start (it calls the model), the model client and storage for the re-read.
//   - edit: identity, review state, note, theme and links kept; extracted wording, grounding and
//     duplicate group captured once; old verdicts, claim checks and own contradictions removed and
//     traced; edit provenance recorded (review provenance untouched); re-check queued
//   - probe B lifecycle: the dependent synthesized insight reads "changed since drafted" (wording)
//     through the real FND-001 loader, and the findings spreadsheet shows both wordings
//   - refusals that write nothing: conflict, calculated finding, coded finding, empty text, wrong
//     run / missing finding
//   - revert restores wording, grounding and duplicate group exactly
//   - re-read: an edited finding is kept and the original claim is not added back as a duplicate
//   - re-check: success leaves no "pending" mark; a failed re-check keeps it, with an error
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const TENANT = "00000000-0000-4000-8000-0000000000b7";
const hooks = vi.hoisted(() => ({
  afterCalls: 0,
  verifyCalls: 0,
  verifyWrites: null as null | ((runId: string) => Promise<void>),
  storageText: "",
  extraction: [] as Record<string, unknown>[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: vi.fn(() => {
    hooks.afterCalls++;
  }),
}));
vi.mock("../verifyAfterGenerate", () => ({
  verifyAfterGenerate: vi.fn(async (_t: string, runId: string) => {
    hooks.verifyCalls++;
    if (hooks.verifyWrites) await hooks.verifyWrites(runId);
  }),
}));
vi.mock("@/lib/analysisPlan", async () => await import("../analysisPlan"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async () => ({ data: { arrayBuffer: async () => Buffer.from(hooks.storageText) }, error: null })),
        upload: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "tool_use",
        usage: {},
        content: [{ type: "tool_use", id: "tu", name: "record_findings", input: { findings: hooks.extraction } }],
      })),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("finding wording edits (real database)", () => {
  let db: DisposableDb;
  let run = "";
  let otherRun = "";
  let report = "";
  const ids: Record<string, string> = {};
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;
  const finding = async (id: string) =>
    (
      await q<Record<string, unknown>>(
        `select id, finding_text, status, researcher_note, theme, finding_kind, grounded_by_finding_id, duplicate_group_id,
                original_extraction, human_edited_fields, human_reviewed_at, human_review_action
           from findings where id = $1`,
        [id],
      )
    )[0];
  const count = async (sql: string, p: unknown[]) => Number((await q<{ n: string }>(sql, p))[0].n);

  const QUOTE = "Satisfaction stands at 72 percent among recent customers.";
  const EXTRACTED = "Satisfaction is 72% among recent customers.";

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await q(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name) values ($1, 'Wording') returning id`, [TENANT]);
    otherRun = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    report = await one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', 'report.txt', 'report.txt') returning id`,
      [TENANT, run],
    );
    const data = await one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type) values ($1, $2, 'table', 'survey.xlsx', 'survey.xlsx', 'raw') returning id`,
      [TENANT, run],
    );
    const table = await one(`insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type) values ($1, $2, $3, 0, 'raw') returning id`, [
      TENANT,
      run,
      data,
    ]);
    ids.computed = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id, source_document_id) values ($1, $2, 'generated', 'Satisfaction is 72% (base 300).', 'accepted', $3, $4) returning id`,
      [TENANT, run, table, data],
    );
    ids.coded = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'coded', 'Customers praise speed.', 'accepted') returning id`, [
      TENANT,
      run,
    ]);
    ids.other = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id) values ($1, $2, 'stated', 'Loyalty is high.', 'accepted', $3) returning id`,
      [TENANT, run, report],
    );
    ids.stated = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, finding_kind, status, theme, researcher_note, source_document_id,
                             source_quote, source_page, grounded_by_finding_id, duplicate_group_id, human_reviewed_at, human_review_action)
       values ($1, $2, 'stated', $3, 'fact', 'accepted', 'Satisfaction', 'Check against Q2', $4, $5, null, $6, gen_random_uuid(), now(), 'accept') returning id`,
      [TENANT, run, EXTRACTED, report, QUOTE, ids.computed],
    );
    const verdict = (f: string, tier: string) =>
      q(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care)
         values ($1, $2, $3, 'r', '{}', 'single_pass', 'single_source', '{}')`,
        [TENANT, f, tier],
      );
    await verdict(ids.stated, "robust");
    await verdict(ids.computed, "robust");
    await q(
      `insert into claim_table_checks (tenant_id, run_id, finding_id, document_id, dataset_name, tier, check_kind, stance, summary)
       values ($1, $2, $3, $4, 'survey.xlsx', 'a', 'stated_figure', 'supports', 's')`,
      [TENANT, run, ids.stated, data],
    );
    await q(
      `insert into finding_contradictions (tenant_id, run_id, original_finding_id, contradicting_finding_id, rationale, detected_by) values ($1, $2, $3, $4, 'r', 'chain_trace')`,
      [TENANT, run, ids.stated, ids.other],
    );
    ids.pre = await one(
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`,
      [TENANT, run, ids.stated],
    );
    ids.si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status)
       values ($1, $2, 'Satisfaction is strong', 'o', 't', 'i', 1, 1, 'accepted') returning id`,
      [TENANT, run],
    );
    await q(
      `insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot)
       values ($1, $2, $3, finding_support_parts($4))`,
      [TENANT, ids.si, ids.pre, ids.stated],
    );
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });
  beforeEach(() => {
    hooks.afterCalls = 0;
    hooks.verifyCalls = 0;
    hooks.verifyWrites = null;
  });

  it("refusals write nothing: calculated, coded, empty, wrong run, missing finding, conflict", async () => {
    const { editFindingWording } = await import("../findingActions");
    const before = await finding(ids.stated);
    const computedBefore = await finding(ids.computed);
    expect(await editFindingWording(run, ids.computed, "Satisfaction is 72% (base 300).", "Satisfaction is 80%.")).toMatchObject({
      ok: false,
      reason: "not_editable",
      error: expect.stringMatching(/Calculated findings come from the data/),
    });
    expect(await editFindingWording(run, ids.coded, "Customers praise speed.", "x")).toMatchObject({ ok: false, reason: "not_editable" });
    expect(await editFindingWording(run, ids.stated, EXTRACTED, "   ")).toMatchObject({ ok: false, reason: "empty" });
    expect(await editFindingWording(otherRun, ids.stated, EXTRACTED, "New")).toMatchObject({ ok: false, reason: "missing" });
    expect(await editFindingWording(run, "00000000-0000-4000-8000-00000000dead", EXTRACTED, "New")).toMatchObject({ ok: false, reason: "missing" });
    expect(await editFindingWording(run, ids.stated, "A stale starting text", "New")).toMatchObject({
      ok: false,
      reason: "conflict",
      currentText: EXTRACTED,
    });
    expect(await finding(ids.stated)).toEqual(before);
    expect(await finding(ids.computed)).toEqual(computedBefore);
    expect(await count(`select count(*) n from verdicts where finding_id = $1`, [ids.stated])).toBe(1);
    expect(hooks.afterCalls).toBe(0);
  });

  it("edit keeps identity and human work, captures the original once, never keeps the old verdict, and queues a re-check", async () => {
    const { editFindingWording } = await import("../findingActions");
    const reviewedAt = (await finding(ids.stated)).human_reviewed_at;
    expect(await editFindingWording(run, ids.stated, EXTRACTED, "Satisfaction is 70% among recent customers.")).toEqual({ ok: true, changed: true });
    const after1 = await finding(ids.stated);
    expect(after1).toMatchObject({
      id: ids.stated,
      finding_text: "Satisfaction is 70% among recent customers.",
      status: "accepted",
      researcher_note: "Check against Q2",
      theme: "Satisfaction",
      finding_kind: "fact",
      grounded_by_finding_id: null,
      duplicate_group_id: null,
      human_review_action: "accept",
    });
    expect(after1.human_reviewed_at).toEqual(reviewedAt); // editing is not reviewing
    expect(after1.human_edited_fields).toContain("finding_text");
    expect(after1.original_extraction).toMatchObject({ finding_text: EXTRACTED, grounded_by_finding_id: ids.computed });
    expect((after1.original_extraction as { duplicate_group_id: string | null }).duplicate_group_id).not.toBeNull();
    expect(await count(`select count(*) n from verdicts where finding_id = $1`, [ids.stated])).toBe(0);
    expect(await count(`select count(*) n from claim_table_checks where finding_id = $1`, [ids.stated])).toBe(0);
    expect(await count(`select count(*) n from finding_contradictions where original_finding_id = $1`, [ids.stated])).toBe(0);
    expect(await count(`select count(*) n from insights where id = $1 and finding_id = $2`, [ids.pre, ids.stated])).toBe(1);
    expect(await count(`select count(*) n from synthesized_insight_sources where pre_insight_id = $1`, [ids.pre])).toBe(1);
    const trace = await q<{ detail: { previous_text: string; removed_verdicts: { verdict_tier: string }[] } }>(
      `select detail from trace where event = 'finding_wording_edited' and run_id = $1`,
      [run],
    );
    expect(trace).toHaveLength(1);
    expect(trace[0].detail).toMatchObject({ previous_text: EXTRACTED, removed_verdicts: [{ verdict_tier: "robust" }] });
    expect(hooks.afterCalls).toBe(1);

    // A second edit keeps the FIRST original.
    expect(await editFindingWording(run, ids.stated, "Satisfaction is 70% among recent customers.", "Satisfaction is 71% among recent customers.")).toMatchObject({ ok: true });
    expect((await finding(ids.stated)).original_extraction).toMatchObject({ finding_text: EXTRACTED });
    // Unchanged text: no write, no re-check queued.
    hooks.afterCalls = 0;
    expect(await editFindingWording(run, ids.stated, "Satisfaction is 71% among recent customers.", "Satisfaction is 71% among recent customers.")).toEqual({ ok: true, changed: false });
    expect(hooks.afterCalls).toBe(0);
  });

  it("probe B lifecycle: the dependent insight reads changed since drafted, and the spreadsheet shows both wordings", async () => {
    const { loadInsightSupportOrUnchecked } = await import("../supportStatus");
    const support = await loadInsightSupportOrUnchecked(TENANT, run, [ids.si]);
    const s = support.statusOf(ids.si);
    expect(s.status).toBe("stale");
    expect(s.reasons.map((r) => r.kind)).toContain("wording");

    const { GET } = await import("../../app/api/runs/[id]/findings/export/route");
    const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows.find((r) => r.Finding === "Satisfaction is 71% among recent customers.")).toMatchObject({
      "Edited by researcher": "Yes",
      "Original wording": EXTRACTED,
    });
    expect(rows.find((r) => r.Finding === "Loyalty is high.")).toMatchObject({ "Edited by researcher": "No", "Original wording": "" });
  });

  it("the screen state: edited findings with their original and pending re-check; a re-check that writes a verdict clears pending", async () => {
    const { loadWordingEdits } = await import("../findingWording");
    const read = async () => {
      const client = await db.pool.connect();
      try {
        return await loadWordingEdits(client, run);
      } finally {
        client.release();
      }
    };
    expect(await read()).toEqual({ available: true, edits: { [ids.stated]: { originalText: EXTRACTED, recheckPending: true } } });

    const { recheckFindingWording } = await import("../findingActions");
    expect(await recheckFindingWording(run, ids.stated)).toMatchObject({ ok: false, error: expect.stringMatching(/not re-checked/) });
    hooks.verifyWrites = async () => {
      await q(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care)
         values ($1, $2, 'use_with_caution', 'rechecked', '{}', 'single_pass', 'single_source', '{}')`,
        [TENANT, ids.stated],
      );
    };
    expect(await recheckFindingWording(run, ids.stated)).toEqual({ ok: true });
    expect((await read()).edits[ids.stated]).toEqual({ originalText: EXTRACTED, recheckPending: false });
  });

  it("a re-read keeps the edited finding and does not add the original claim back as a duplicate", async () => {
    hooks.storageText = `Annual customer report. ${QUOTE} Other content follows here for the reader.`;
    hooks.extraction = [{ finding_text: EXTRACTED, finding_kind: "fact", theme: "Satisfaction", data_type: "quantitative", source_quote: QUOTE }];
    const { extractFindingsFromDocument } = await import("../extractFindings");
    await extractFindingsFromDocument(TENANT, run, report);
    const texts = (await q<{ id: string; finding_text: string }>(`select id, finding_text from findings where source_document_id = $1 and run_id = $2`, [report, run])).map(
      (r) => r.finding_text,
    );
    expect(texts).toContain("Satisfaction is 71% among recent customers.");
    expect(texts).not.toContain(EXTRACTED);
    expect((await finding(ids.stated)).finding_text).toBe("Satisfaction is 71% among recent customers.");
  });

  it("revert restores the extracted wording, grounding and duplicate group exactly, and re-checks", async () => {
    const before = await finding(ids.stated);
    const original = before.original_extraction as { finding_text: string; grounded_by_finding_id: string; duplicate_group_id: string };
    const { revertFindingWording } = await import("../findingActions");
    expect(await revertFindingWording(run, ids.stated, "stale text")).toMatchObject({ ok: false, reason: "conflict" });
    expect(await revertFindingWording(run, ids.stated, before.finding_text as string)).toEqual({ ok: true, changed: true });
    const after = await finding(ids.stated);
    expect(after).toMatchObject({
      finding_text: original.finding_text,
      grounded_by_finding_id: original.grounded_by_finding_id,
      duplicate_group_id: original.duplicate_group_id,
      original_extraction: null,
      researcher_note: "Check against Q2",
      status: "accepted",
    });
    expect(after.human_edited_fields).not.toContain("finding_text");
    expect(await count(`select count(*) n from verdicts where finding_id = $1`, [ids.stated])).toBe(0); // judged the edited text
    expect(hooks.afterCalls).toBe(1);
    expect(await revertFindingWording(run, ids.stated, original.finding_text)).toMatchObject({ ok: false, reason: "not_edited" });
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("finding wording edits (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});

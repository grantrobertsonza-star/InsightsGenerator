// Batch 64 follow-up, Codex EC10K-F02: the findings reading and the coding stages checked a cut-off or
// missing answer but took a refused or other-stop answer, or another tool's block, as a result. They now
// use the same finished-result rule (modelToolResult.ts). Real disposable PostgreSQL, the ACTUAL
// extractFindingsFromDocument, reapplyCodebook/runStabilityCheck (codebook application) and
// searchNegativeCases; only the model, storage text and Next's hooks are controlled. For each: the answer
// is refused visibly, the previous result stays, and the next finished answer recovers.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
type Fault = null | { stop?: string; name?: string };
const hooks = vi.hoisted(() => ({ storageText: "", fault: null as Fault, findings: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ download: vi.fn(async () => ({ data: { arrayBuffer: async () => Buffer.from(hooks.storageText) }, error: null })) }) } },
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "claude-test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string }; messages: { content: unknown }[] }) => {
        const name = req.tool_choice?.name ?? "";
        let input: unknown;
        if (name === "record_findings") input = { findings: hooks.findings };
        else if (name === "record_decisions") {
          const parts = req.messages[0].content as { text: string }[];
          const units = [...parts[0].text.matchAll(/^\s+(\d+\.\d+) /gm)].map((m) => m[1]);
          input = { decisions: units.map((id) => ({ id, account_type: "personal", stance: "affirmed", why: "test", status: "clear", meets: true })) };
        } else if (name === "record_negative_cases") input = { cases: [] };
        else if (name === "record_summaries") input = { summaries: [] };
        else throw new Error(`unexpected tool ${name}`);
        const f = hooks.fault;
        return { stop_reason: f?.stop ?? "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu", name: f?.name ?? name, input }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

const FAULTS = [
  ["refused", { stop: "refusal" }],
  ["an end_turn stop", { stop: "end_turn" }],
  ["another tool's block", { name: "record_something_else" }],
] as const;

describe.skipIf(!TEST_DATABASE_URL)("findings reading and coding refuse unfinished results (EC10K-F02 follow-up)", () => {
  let db: DisposableDb;
  const T = randomUUID();
  let run = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p).then((r) => r.rows);
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = T;
    delete process.env.CODING_APPLY_MODEL;
    await q("insert into tenants(id,name) values($1,'Unfinished coding')", [T]);
    run = (await q("insert into runs(tenant_id,project_name,entry_point) values($1,'U','generate') returning id", [T]))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db?.drop();
  });

  const OLD_Q = "Satisfaction rose to 72 percent among members this year.";
  const NEW_Q = "Renewals fell to 61 percent after the price change.";
  for (const [label, fault] of FAULTS) {
    it(`findings reading (${label}): refused, the previous finding stays, a finished answer replaces it`, async () => {
      hooks.storageText = `Annual member survey report. ${OLD_Q} ${NEW_Q} The rest of this report describes the method and lists the tables.`;
      const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report',$3,$3) returning id", [T, run, `r-${randomUUID()}.txt`]))[0].id;
      const prior = (await q("insert into findings(tenant_id,run_id,origin,finding_text,finding_kind,status,theme,source_document_id,source_quote) values($1,$2,'stated','Satisfaction is 72%.','fact','accepted','Satisfaction',$3,$4) returning id", [T, run, doc, OLD_Q]))[0].id;
      hooks.findings = [{ finding_text: "Renewals fell to 61%.", finding_kind: "fact", theme: "Retention", data_type: "quantitative", source_quote: NEW_Q }];
      hooks.fault = fault;
      const { extractFindingsFromDocument } = await import("../extractFindings");
      await expect(extractFindingsFromDocument(T, run, doc)).rejects.toThrow(/could not be used \(The findings reading .*nothing from it was used.*\) Nothing was replaced/);
      expect((await q("select id from findings where source_document_id=$1 and status <> 'rejected'", [doc])).map((r) => r.id)).toEqual([prior]);
      hooks.fault = null;
      await extractFindingsFromDocument(T, run, doc);
      expect((await q("select finding_text from findings where source_document_id=$1 and status <> 'rejected'", [doc])).map((r) => r.finding_text)).toEqual(["Renewals fell to 61%."]);
    });
  }

  /** A transcript coded once by the model through reapplyCodebook (which keeps the original). */
  async function coded() {
    const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.txt',$3) returning id", [T, run, `${T}/${randomUUID()}.txt`]))[0].id as string;
    const v1 = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [T, run, doc]))[0].id as string;
    await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,0,'Waiting','Waiting definition')", [T, v1]);
    await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,0,'Mod','moderator','How was the service?')", [T, run, doc]);
    for (let i = 1; i <= 3; i++) await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,$4,'P','participant',$5)", [T, run, doc, i, `I waited ${i} hours for help.`]);
    const codes = await q("select id, name, definition from coding_codes where codebook_id = $1 order by position", [v1]);
    hooks.fault = null;
    const { reapplyCodebook } = await import("../extractThemes");
    await reapplyCodebook(T, run, doc, codes.map((c) => ({ id: c.id, name: c.name, definition: c.definition, inclusion: "", exclusion: "" })));
    const book = (await q("select id from coding_codebooks where document_id = $1 and version = 2", [doc]))[0].id as string;
    return { doc, book };
  }

  for (const [label, fault] of FAULTS) {
    it(`codebook application in a stability pass (${label}): the pass is left out and traced, nothing saved, a finished pass recovers`, async () => {
      const f = await coded();
      const { runStabilityCheck } = await import("../codingAnalysis");
      hooks.fault = fault;
      await expect(runStabilityCheck(T, run, f.doc, f.book, 1)).rejects.toThrow(/No pass came back complete.*previous result is unchanged/);
      expect(await q("select 1 from coding_stability_checks where codebook_id=$1", [f.book])).toEqual([]);
      const traced = await q("select detail->>'reason' as reason from trace where run_id=$1 and event='coding_apply_batch_failed' and detail->>'document_id'=$2", [run, f.doc]);
      expect(traced.length).toBeGreaterThan(0);
      expect(traced.every((t) => ["refusal", "other_stop", "no_tool_use"].includes(t.reason))).toBe(true);
      hooks.fault = null;
      expect(await runStabilityCheck(T, run, f.doc, f.book, 1)).toContain("1 complete pass compared");
    });

    it(`negative case search (${label}): every batch failed and traced, nothing changed, a finished search recovers`, async () => {
      const f = await coded();
      const { searchNegativeCases } = await import("../codingAnalysis");
      hooks.fault = fault;
      await expect(searchNegativeCases(T, run, f.doc, f.book)).rejects.toThrow(/The search failed on every batch\. Nothing was changed\./);
      expect((await q("select 1 from trace where run_id=$1 and event='negative_case_batch_failed' and detail->>'document_id'=$2", [run, f.doc])).length).toBeGreaterThan(0);
      hooks.fault = null;
      expect(await searchNegativeCases(T, run, f.doc, f.book)).toMatchObject({ failedBatches: 0 });
    });
  }
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64 (findings and coding)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});

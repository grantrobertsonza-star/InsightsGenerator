// The Research assistant as the project's expert (Grant, 2026-10-22). Runs the actual
// askResearchAssistant loop and its tools (researchAssistantTools.ts, the SemanticTabs plan checks,
// sampleSize.ts) against a real disposable PostgreSQL (the run, its documents, the stored messages).
// Controlled boundaries: the model (a scripted sequence of tool calls and texts, every request
// recorded), the dictionary read, the table build and read-back (the engine is covered by its own
// tests), the survey-design set-up. Checks:
//   - a data question: list_data_files, find_variables, build_table; the table is built with source
//     "assistant", the file's default weight and its design; the model is handed the table's figures
//     with bases and test marks; the reply carries a code-written line naming the table;
//   - a data file of another project is refused, and nothing is built;
//   - a variable that is not in the file is refused with the reason, and nothing is built;
//   - a failed read of the variables or of the design set-up stops the table (never built as if
//     there were no design); an unweighted request is built without the weight and says so;
//   - a sample size comes from the calculator (385 for 5 points at 95%);
//   - at most four tables per message; at most eight rounds, then a plain stop message;
//   - an empty final answer after a tool round is reported as empty (B6-F01);
//   - a request id answered once returns its stored answer on a second send, and racing sends of
//     one request store one pair (B6-F02, migration 0108 applied by the disposable database);
//   - overlapping sends of one request run the model and tools once (the request claim, B7-F01);
//     a failed first send lets the waiting one run it once; other requests do not wait; a wait
//     past the limit is RequestInProgressError and runs nothing;
//   - prompt caching: the instructions and evidence are one cached system block, the history after it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { CrosstabResult } from "../parseStatsFile";

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string; is_error?: boolean };
const state = vi.hoisted(() => ({
  script: [] as ((req: { messages: { role: string; content: unknown }[] }) => unknown)[],
  requests: [] as { system: unknown; messages: { role: string; content: unknown }[] }[],
  builds: [] as Record<string, unknown>[],
  failNext: false,
  /** Answers every model call when set (concurrent tests, where calls arrive in any order). */
  responder: null as null | ((req: { messages: { role: string; content: unknown }[] }) => unknown),
}));

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", async (orig) => ({ ...(await orig<object>()), logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system: unknown; messages: { role: string; content: unknown }[] }) => {
        state.requests.push(JSON.parse(JSON.stringify(req)));
        const step = state.responder ?? state.script.shift() ?? (() => [{ type: "text", text: "Done." }]);
        const out = (await step(req)) as Block[] | { stop: string; content: Block[] };
        if (!Array.isArray(out)) return { content: out.content, stop_reason: out.stop, usage: { input_tokens: 1, output_tokens: 1 } };
        if (state.failNext) {
          state.failNext = false;
          throw new Error("provider unavailable");
        }
        return { content: out, stop_reason: out.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    },
  },
}));
const v = (name: string, label: string, nDistinct: number) => ({ name, label, numeric: true, nValid: 200, pctValid: 100, nDistinct, labelled: true, weightLike: false });
const DICT = { nCases: 200, variables: [v("sat", "Overall satisfaction", 5), v("segment", "Segment", 3), { ...v("wt", "Weight", 150), weightLike: true }], sets: [] };
const TABLE = {
  version: 2,
  columns: [{ name: "Segment1" }, { name: "Segment2" }],
  provenance: { correction: "fdr", weightVar: "wt" },
  questions: [
    {
      label: "Overall satisfaction",
      rows: [
        { label: "Base", isBase: true, count: [100, 100], total: { count: 200, pct: null }, pct: [null, null], sig: [0, 0] },
        { label: "Satisfied", count: [70, 40], pct: [70, 40], sig: [1, -1], total: { count: 110, pct: 55 } },
      ],
    },
  ],
} as unknown as CrosstabResult;
vi.mock("../crosstabs", async (orig) => {
  const actual = await orig<typeof import("../crosstabs")>();
  return {
    ...actual,
    loadVariableDictionaryWithStatus: vi.fn(async () => ({ ok: true, dictionary: DICT })),
    loadVariableDictionary: vi.fn(async () => DICT),
    loadCategories: vi.fn(async () => ({ variable: "segment", label: "Segment", categories: [] })),
    // Records each build (the side-effect counter) and saves a draft row, with the assistant
    // request it was built for, as the real builder does.
    buildCrosstab: vi.fn(async (t: string, r: string, documentId: string, request: Record<string, unknown>, options?: { assistantRequest?: unknown }) => {
      state.builds.push({ documentId, ...request });
      const { withTenant } = await import("../db");
      const tableId = await withTenant(t, async (client) => {
        const row = await client.query<{ id: string }>(
          `insert into document_tables (tenant_id, run_id, document_id, table_index, label, ingestion_type, crosstab, crosstab_status)
           values ($1, $2, $3, (select coalesce(max(table_index), 999) + 1 from document_tables where document_id = $3), 'Assistant draft', 'aggregated', $4, 'draft') returning id`,
          [t, r, documentId, JSON.stringify({ source: "assistant", ...(options?.assistantRequest ? { assistantRequest: options.assistantRequest } : {}) })],
        );
        return row.rows[0].id;
      });
      return { tableId, questions: 1, skipped: [] };
    }),
    loadCrosstab: vi.fn(async () => ({ label: "Overall satisfaction by Segment (weighted)", result: TABLE })),
  };
});
vi.mock("../dataSetup", () => ({
  loadDataSetupWithStatus: vi.fn(async () => ({ ok: true, setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null } })),
}));

const call = (name: string, input: unknown, id = `t-${Math.random()}`) => ({ type: "tool_use", id, name, input });
const lastResults = (req: { messages: { role: string; content: unknown }[] }) => {
  const m = req.messages[req.messages.length - 1];
  return (Array.isArray(m.content) ? m.content : []) as Block[];
};

describe.skipIf(!TEST_DATABASE_URL)("Research assistant tools (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let other = "";
  let doc = "";
  let foreignDoc = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
    await db.pool.query("insert into tenants(id,name) values($1,'Assistant tools')", [tenant]);
    run = await one("insert into runs(tenant_id,project_name) values($1,'Assistant') returning id", [tenant]);
    other = await one("insert into runs(tenant_id,project_name) values($1,'Other') returning id", [tenant]);
    doc = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','tracker.sav','tracker.sav','raw') returning id", [tenant, run]);
    foreignDoc = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','other.sav','other.sav','raw') returning id", [tenant, other]);
  }, 120000);
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db.drop();
  });
  beforeEach(() => {
    state.script = [];
    state.requests = [];
    state.builds = [];
    state.responder = null;
  });
  const ask = async (text: string) => (await import("../researchAssistant")).askResearchAssistant(tenant, run, text);

  it("answers a data question from a table it built, saved as an assistant draft, and names the table", async () => {
    state.script = [
      () => [call("list_data_files", {})],
      () => [call("find_variables", { data_file_id: doc, query: "satisfaction" })],
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"], filters: [] })],
      () => [{ type: "text", text: "Segment1 is more satisfied: 70% against 40% (marked higher), base 100 each, weighted." }],
    ];
    const r = await ask("Is satisfaction higher in Segment 1?");
    expect(lastResults(state.requests[1])[0].content).toContain(`${doc}: tracker.sav`);
    expect(lastResults(state.requests[2])[0].content).toContain("variable sat: Overall satisfaction");
    const tableResult = lastResults(state.requests[3])[0].content!;
    expect(tableResult).toContain("saved as a draft under Cross tabs, All tables");
    expect(tableResult).toContain("Weighted by wt.");
    expect(tableResult).toContain("Satisfied: 70 (higher) | 40 (lower) | 55");
    expect(tableResult).toContain("Base: 100 | 100 | 200");
    expect(state.builds).toHaveLength(1);
    expect(state.builds[0]).toMatchObject({ documentId: doc, source: "assistant", weightVar: "wt", columnVars: ["segment"] });
    expect(r.reply).toContain("Segment1 is more satisfied");
    expect(r.reply).toContain('Tables built for this answer (drafts under Cross tabs, All tables): "Overall satisfaction by Segment (weighted)" from tracker.sav.');
    const stored = (await db.pool.query("select role, content from assistant_messages where run_id=$1 order by created_at", [run])).rows;
    expect(stored.slice(-2).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[stored.length - 1].content).toBe(r.reply);
    // Prompt caching: the instructions and evidence are one cached system block.
    const system = state.requests[0].system as { text: string; cache_control?: unknown }[];
    expect(Array.isArray(system)).toBe(true);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toContain("=== This project's evidence and report ===");
  });

  it("refuses another project's data file and a variable that is not in the file, building nothing", async () => {
    state.script = [
      () => [call("build_table", { data_file_id: foreignDoc, rows: ["sat"], columns: [] })],
      () => [call("build_table", { data_file_id: doc, rows: ["no_such_var"], columns: ["segment"] })],
      () => [{ type: "text", text: "I could not build that table." }],
    ];
    const r = await ask("Show me satisfaction in the other project");
    const foreign = lastResults(state.requests[1])[0];
    expect(foreign.is_error).toBe(true);
    expect(foreign.content).toContain("is not one of this project's data files");
    const missing = lastResults(state.requests[2])[0];
    expect(missing.is_error).toBe(true);
    expect(missing.content).toContain('Row "no_such_var" is not a variable or set in the file.');
    expect(state.builds).toHaveLength(0);
    expect(r.reply).not.toContain("Tables built for this answer");
  });

  it("a failed read of the variables or of the design set-up stops the table; it is not built as if there were no design", async () => {
    const crosstabs = await import("../crosstabs");
    const dataSetup = await import("../dataSetup");
    vi.mocked(crosstabs.loadVariableDictionaryWithStatus).mockResolvedValueOnce({ ok: false, error: "connection reset" } as never);
    vi.mocked(dataSetup.loadDataSetupWithStatus).mockResolvedValueOnce({ ok: false, error: "timeout" } as never);
    state.script = [
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })],
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"], weighted: false })],
      () => [{ type: "text", text: "The data could not be read just now." }],
    ];
    const r = await ask("Satisfaction by segment");
    const dict = lastResults(state.requests[1])[0];
    expect(dict.is_error).toBe(true);
    expect(dict.content).toContain("The variables of tracker.sav could not be read: connection reset");
    const setup = lastResults(state.requests[2])[0];
    expect(setup.is_error).toBe(true);
    expect(setup.content).toContain("The survey design set-up of tracker.sav could not be read, so no table was built: timeout");
    expect(state.builds).toHaveLength(0);
    expect(r.reply).not.toContain("Tables built for this answer");
  });

  it("an unweighted request is built without the weight, and says so", async () => {
    state.script = [
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"], weighted: false })],
      () => [{ type: "text", text: "Unweighted, Segment1 is higher." }],
    ];
    await ask("Unweighted satisfaction by segment");
    expect(state.builds[0]).toMatchObject({ weightVar: null, source: "assistant" });
    expect(lastResults(state.requests[1])[0].content).toContain("Unweighted.");
  });

  it("answers how-the-app questions from the Knowledge base, links the guide it read, and is told the page it was asked from", async () => {
    state.script = [
      () => [call("search_help", { query: "verdict tiers use with caution" })],
      (req) => {
        const hits = String(lastResults(req)[0].content);
        const ref = hits.split(" | ")[0];
        return [call("read_help", { ref })];
      },
      () => [{ type: "text", text: "Use with caution means the claim is supported with a caveat." }],
    ];
    const { askResearchAssistant } = await import("../researchAssistant");
    const r = await askResearchAssistant(tenant, run, "What does use with caution mean?", { path: `/runs/${run}`, section: "Findings" });
    const search = lastResults(state.requests[1])[0];
    expect(search.is_error).toBeUndefined();
    expect(String(search.content)).toMatch(/^(knowledge|manual)\//);
    const read = lastResults(state.requests[2])[0];
    expect(read.is_error).toBeUndefined();
    expect(r.reply).toMatch(/\n\nGuides read for this answer: .+ \(\/(knowledge|manual)\/[^)]+\)\.$/);
    // The page line is in the uncached part of the system text; the contents are in the cached part.
    const system = state.requests[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].text).toContain("=== Knowledge base and Manual contents (read with read_help) ===");
    expect(system[0].text).toContain("knowledge/research-assistant:");
    expect(system[1].cache_control).toBeUndefined();
    expect(system[1].text).toContain(`The researcher sent this message from the Findings section (/runs/${run}).`);
  });

  // Technical documents (Grant, 2026-10-24): searched and read for questions about how the study was done.
  it("answers how the study was done from this project's technical documents, quoting and naming the passage it read; another project's is not reachable", async () => {
    const TEXT =
      "FinScope SA 2024 technical report.\n\nFieldwork ran from March to June 2024 with 5,600 face-to-face interviews.\n\n" +
      "Sampling. A stratified multi-stage design: enumeration areas were drawn with probability proportional to size within " +
      "strata defined by province, metro status and NLI group, and households were then selected systematically.\n\n" +
      "Weighting. Benchmark weights (BENCHWGT) calibrate the sample to mid-year population estimates by age, gender, race and province.";
    const tech = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'technical','FinScope Technical Report.pdf','tech.pdf',$3) returning id", [tenant, run, TEXT])).rows[0].id as string;
    const foreignTech = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'technical','Other Technical.pdf','other-tech.pdf','Stratified by district and benchmark weighted.') returning id", [tenant, other])).rows[0].id as string;
    try {
      state.script = [
        () => [call("search_technical_documents", { query: "stratified sampling design strata" })],
        (req) => {
          const hits = String(lastResults(req)[0].content);
          return [call("read_technical_document", { ref: hits.split(" | ")[0] }), call("read_technical_document", { ref: `${foreignTech}#1` })];
        },
        () => [{ type: "text", text: "The technical report says the design was stratified by province, metro status and NLI group." }],
      ];
      const r = await ask("How was FinScope sampled?");
      const system = state.requests[0].system as { text: string }[];
      expect(system[0].text).toContain("Technical documents (search and read with search_technical_documents and read_technical_document):\n  - FinScope Technical Report.pdf");
      const search = String(lastResults(state.requests[1])[0].content);
      expect(search).toContain(`${tech}#`);
      expect(search).toContain("FinScope Technical Report.pdf, passage");
      expect(search).not.toContain(foreignTech);
      const [read, foreign] = lastResults(state.requests[2]);
      expect(read.is_error).toBeUndefined();
      expect(String(read.content)).toContain("strata defined by province, metro status and NLI group");
      expect(foreign.is_error).toBe(true);
      expect(String(foreign.content)).toContain("is not a passage of this project's technical documents");
      expect(r.reply).toMatch(/\n\nTechnical documents read for this answer: FinScope Technical Report\.pdf \(passage \d+ of \d+\)\.$/);
      expect(r.reply).not.toContain("Other Technical.pdf");
    } finally {
      await db.pool.query("delete from documents where id = any($1::uuid[])", [[tech, foreignTech]]);
    }
  });

  // Codex B17-F01: two different documents with the same file name were merged by name in the
  // reply's source line, so the second (here the one that contradicts the first) was left out.
  it("two technical documents with the same name stay separate in the reply and the saved message, in either read order; a repeated read is listed once", async () => {
    const insert = (text: string, at: string) =>
      db.pool
        .query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text,uploaded_at) values($1,$2,'technical','Technical report.txt',$3,$4,$5) returning id", [tenant, run, `t-${at}.txt`, text, at])
        .then((x) => x.rows[0].id as string);
    const first = await insert("The sample was unweighted.", "2026-10-24T09:00:00Z");
    // Three paragraphs of about 1,000 characters: too long to share a passage (technicalDocuments.splitPassages).
    const para = (lead: string) => `${lead} ${"The weighting is described in detail. ".repeat(26)}`;
    const second = await insert([para("Benchmark weights were used."), para("They calibrate to mid-year estimates."), para("Trimmed at the 99th percentile.")].join("\n\n"), "2026-10-24T10:15:30Z");
    const FIRST = "Technical report.txt (uploaded 2026-10-24 09:00:00 UTC)";
    const SECOND = "Technical report.txt (uploaded 2026-10-24 10:15:30 UTC)";
    try {
      for (const order of [[first, second], [second, first]]) {
        state.script = [
          () => [call("read_technical_document", { ref: `${order[0]}#1` }), call("read_technical_document", { ref: `${order[1]}#1` }), call("read_technical_document", { ref: `${order[0]}#1` })],
          () => [{ type: "text", text: "The two technical reports disagree on weighting." }],
        ];
        const r = await ask("Was the study weighted?");
        // This ask's two model calls are the last two requests (earlier asks' stay in the list).
        const system = (state.requests.at(-2)!.system as { text: string }[])[0].text;
        expect(system).toContain(`  - ${FIRST}\n  - ${SECOND}`);
        const reads = lastResults(state.requests.at(-1)!).map((x) => String(x.content));
        expect(reads[0].slice(0, (order[0] === first ? FIRST : SECOND).length)).toBe(order[0] === first ? FIRST : SECOND);
        const listed = order[0] === first ? `${FIRST} (passage 1 of 1); ${SECOND} (passage 1 of 3)` : `${SECOND} (passage 1 of 3); ${FIRST} (passage 1 of 1)`;
        const line = `\n\nTechnical documents read for this answer: ${listed}.`;
        expect(r.reply.slice(-line.length)).toBe(line);
        // As saved and read back.
        const saved = (await db.pool.query("select content from assistant_messages where run_id = $1 and role = 'assistant' order by created_at desc limit 1", [run])).rows[0].content as string;
        expect(saved.slice(-line.length)).toBe(line);
      }
      // A different name is listed by its name alone.
      await db.pool.query("update documents set source_filename = 'Weighting note.txt' where id = $1", [second]);
      state.script = [
        () => [call("read_technical_document", { ref: `${first}#1` }), call("read_technical_document", { ref: `${second}#2` })],
        () => [{ type: "text", text: "Answer." }],
      ];
      const r = await ask("Was the study weighted?");
      const plain = "Technical documents read for this answer: Technical report.txt (passage 1 of 1); Weighting note.txt (passage 2 of 3).";
      expect(r.reply.slice(-plain.length)).toBe(plain);
    } finally {
      await db.pool.query("delete from documents where id = any($1::uuid[])", [[first, second]]);
    }
  });

  it("with no technical documents, the tools say so and nothing is listed under the reply", async () => {
    state.script = [
      () => [call("search_technical_documents", { query: "weighting" })],
      () => [{ type: "text", text: "This project has no technical documents." }],
    ];
    const r = await ask("How was it weighted?");
    expect(String((state.requests[0].system as { text: string }[])[0].text)).toContain("This project has no technical documents.");
    expect(String(lastResults(state.requests[1])[0].content)).toContain("This project has no technical documents with readable text");
    expect(r.reply).not.toContain("Technical documents read");
  });

  it("describes a data file's weighting: its weight variables, the default, and the saved or found design", async () => {
    state.script = [
      () => [call("describe_weighting", { data_file_id: doc })],
      () => [{ type: "text", text: "tracker.sav is weighted by wt." }],
    ];
    await ask("Is the tracker weighted?");
    const result = String(lastResults(state.requests.at(-1)!)[0].content);
    expect(result).toContain("Weight variables in tracker.sav: wt (Weight). Tables use wt by default");
    expect(result).toContain("No survey design is set or found");
    expect(result).toContain("Analytics (driver analysis and regression) uses the weight only");

    const { loadDataSetupWithStatus } = await import("../dataSetup");
    vi.mocked(loadDataSetupWithStatus).mockResolvedValueOnce({ ok: true, setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: true, wave: null, design: { mode: "explicit", psu: "segment", strata: null } } } as never);
    state.script = [() => [call("describe_weighting", { data_file_id: doc })], () => [{ type: "text", text: "Clustered by segment." }]];
    await ask("And its design?");
    const explicitResult = String(lastResults(state.requests.at(-1)!)[0].content);
    expect(explicitResult, explicitResult).toContain("Survey design used for standard errors in Cross tabs (chosen by the researcher): cluster segment, stratum none.");

    vi.mocked(loadDataSetupWithStatus).mockResolvedValueOnce({ ok: false, error: "permission denied", setup: null } as never);
    state.script = [() => [call("describe_weighting", { data_file_id: doc })], () => [{ type: "text", text: "Could not read it." }]];
    await ask("And now?");
    expect(String(lastResults(state.requests.at(-1)!)[0].content)).toContain("The saved survey design could not be read: permission denied.");

    state.script = [() => [call("describe_weighting", { data_file_id: foreignDoc })], () => [{ type: "text", text: "Not this project's." }]];
    await ask("And the other one?");
    expect(lastResults(state.requests.at(-1)!)[0].is_error).toBe(true);
  });

  it("an unknown guide ref is an error result, and no guide is listed", async () => {
    state.script = [
      () => [call("read_help", { ref: "knowledge/not-a-guide" })],
      () => [{ type: "text", text: "The guides do not cover that." }],
    ];
    const r = await ask("How does the frobnicator work?");
    const read = lastResults(state.requests[1])[0];
    expect(read.is_error).toBe(true);
    expect(read.content).toContain("is not a Knowledge base or Manual ref");
    expect(r.reply).not.toContain("Guides read");
  });

  it("a reply cut off for length is not published as an answer, and none of its tool calls runs; a healthy reply follows (B5-F03)", async () => {
    const { CUT_OFF_REPLY } = await import("../assistantLoop");
    state.script = [() => ({ stop: "max_tokens", content: [{ type: "text", text: "The recommended sample size is" }, call("revise_narrative", { executive_summary: "Half a" })] })];
    const cut = await ask("What sample size do I need?");
    expect(cut.reply).toBe(CUT_OFF_REPLY);
    expect(cut.revisedFields).toEqual([]);
    expect(state.requests).toHaveLength(1);
    state.script = [() => ({ stop: "max_tokens", content: [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })] })];
    await ask("Satisfaction by segment");
    expect(state.builds).toHaveLength(0);
    state.script = [() => [{ type: "text", text: "You need 385." }]];
    expect((await ask("What sample size do I need?")).reply).toBe("You need 385.");
  });

  it("a table built whose figures cannot be read back still counts towards the cap and is listed (B5-F04)", async () => {
    const crosstabs = await import("../crosstabs");
    vi.mocked(crosstabs.loadCrosstab).mockRejectedValue(new Error("read timed out"));
    try {
      state.script = [
        () => [1, 2, 3, 4, 5, 6].map((i) => call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] }, `r${i}`)),
        () => [{ type: "text", text: "The tables were saved but I could not read them." }],
      ];
      const r = await ask("Build six tables");
      expect(state.builds).toHaveLength(4);
      const results = lastResults(state.requests[1]);
      expect(results.slice(0, 4).every((x) => x.is_error && String(x.content).includes("saved as a draft") && String(x.content).includes("read timed out") && String(x.content).includes("Do not build it again"))).toBe(true);
      expect(results.slice(4).every((x) => x.is_error && /At most 4 tables/.test(String(x.content)))).toBe(true);
      expect(r.reply.match(/\(saved, but its figures could not be read back\)/g)).toHaveLength(4);
    } finally {
      vi.mocked(crosstabs.loadCrosstab).mockReset();
      vi.mocked(crosstabs.loadCrosstab).mockImplementation(async () => ({ label: "Overall satisfaction by Segment (weighted)", result: TABLE }) as never);
    }
    // Healthy recovery: a build that reads back is listed without the note.
    state.builds = [];
    state.script = [() => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })], () => [{ type: "text", text: "Done." }]];
    const ok = await ask("Satisfaction by segment");
    expect(state.builds).toHaveLength(1);
    expect(ok.reply).toContain('"Overall satisfaction by Segment (weighted)" from tracker.sav.');
    expect(ok.reply).not.toContain("could not be read back");
  });

  it("a failed call stores neither the question nor a reply; asking again stores the pair once (B5-F05)", async () => {
    const count = async () => Number((await db.pool.query("select count(*) from assistant_messages where run_id=$1", [run])).rows[0].count);
    const before = await count();
    state.failNext = true;
    state.script = [() => [{ type: "text", text: "never sent" }]];
    await expect(ask("Will this fail?")).rejects.toThrow("provider unavailable");
    expect(await count()).toBe(before);
    state.script = [() => [{ type: "text", text: "It works now." }]];
    await ask("Will this fail?");
    const rows = (await db.pool.query("select role, content from assistant_messages where run_id=$1 order by created_at", [run])).rows;
    expect(rows.length).toBe(before + 2);
    expect(rows.slice(-2)).toEqual([{ role: "user", content: "Will this fail?" }, { role: "assistant", content: "It works now." }]);
  });

  it("an empty final answer after a tool round is reported as empty, not as the earlier round's text (B6-F01)", async () => {
    const { EMPTY_REPLY } = await import("../assistantLoop");
    state.script = [
      () => [{ type: "text", text: "I will calculate that now." }, call("sample_size", { mode: "sample_for_margin", margin_pct: 5 })],
      () => [{ type: "text", text: "" }],
    ];
    expect((await ask("Sample for 5 points?")).reply).toBe(EMPTY_REPLY);
    // A table built before an empty final answer stays listed under it.
    state.script = [() => [{ type: "text", text: "Building it." }, call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })], () => []];
    const withTable = await ask("Satisfaction by segment");
    expect(withTable.reply.startsWith(EMPTY_REPLY)).toBe(true);
    expect(withTable.reply).toContain("Tables built for this answer");
    // Healthy: the final response's text is the answer, not the step before it.
    state.script = [
      () => [{ type: "text", text: "I will calculate that now." }, call("sample_size", { mode: "sample_for_margin", margin_pct: 5 })],
      () => [{ type: "text", text: "You need 385 completed interviews." }],
    ];
    expect((await ask("Sample for 5 points?")).reply).toBe("You need 385 completed interviews.");
  });

  it("a question sent again under its request id after it was stored returns the stored answer, asking the model and storing nothing again (B6-F02)", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const count = async () => Number((await db.pool.query("select count(*) from assistant_messages where run_id=$1", [run])).rows[0].count);
    const before = await count();
    const id = randomUUID();
    state.script = [() => [{ type: "text", text: "First and only answer." }]];
    const first = await askResearchAssistant(tenant, run, "Answered once?", null, id);
    expect(first).toMatchObject({ reply: "First and only answer.", alreadyAnswered: false });
    expect(await count()).toBe(before + 2);
    // The reply was lost on the way to the browser; Send again uses the same id.
    state.requests = [];
    state.script = [() => [{ type: "text", text: "A second answer that must not be stored." }]];
    const again = await askResearchAssistant(tenant, run, "Answered once?", null, id);
    expect(again).toMatchObject({ reply: "First and only answer.", alreadyAnswered: true });
    expect(state.requests).toHaveLength(0);
    expect(await count()).toBe(before + 2);
    const rows = (await db.pool.query("select role, content, request_id from assistant_messages where run_id=$1 and request_id=$2 order by created_at", [run, id])).rows;
    expect(rows).toEqual([{ role: "user", content: "Answered once?", request_id: id }, { role: "assistant", content: "First and only answer.", request_id: id }]);
    // A new question gets a new id and is answered normally.
    state.script = [() => [{ type: "text", text: "A new answer." }]];
    expect((await askResearchAssistant(tenant, run, "Another question", null, randomUUID())).alreadyAnswered).toBe(false);
    expect(await count()).toBe(before + 4);
    await expect(askResearchAssistant(tenant, run, "Bad id", null, "not-a-uuid")).rejects.toThrow("The request id is not valid.");
  });

  it("two sends of one request that race store one pair, and both return its answer", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const id = randomUUID();
    state.script = [() => [{ type: "text", text: "Racing answer one." }], () => [{ type: "text", text: "Racing answer two." }]];
    const [a, b] = await Promise.all([askResearchAssistant(tenant, run, "Race?", null, id), askResearchAssistant(tenant, run, "Race?", null, id)]);
    const rows = (await db.pool.query("select role, content from assistant_messages where run_id=$1 and request_id=$2 order by created_at", [run, id])).rows;
    expect(rows).toHaveLength(2);
    const storedAnswer = rows.find((r) => r.role === "assistant")!.content;
    expect(a.reply).toBe(storedAnswer);
    expect(b.reply).toBe(storedAnswer);
    expect([a.alreadyAnswered, b.alreadyAnswered].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("two overlapping sends of one request run the model and tools once; the second returns the first's stored answer (B7-F01)", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const id = randomUUID();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // The first send's first model round waits at the gate, so the second send arrives while the
    // first is still answering.
    state.script = [
      async () => {
        await gate;
        return [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })];
      },
      () => [{ type: "text", text: "Built once." }],
    ];
    const first = askResearchAssistant(tenant, run, "Overlap?", null, id);
    await new Promise((r) => setTimeout(r, 300));
    const second = askResearchAssistant(tenant, run, "Overlap?", null, id);
    await new Promise((r) => setTimeout(r, 600));
    expect(state.requests).toHaveLength(1); // the second has not reached the model
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(state.builds).toHaveLength(1);
    expect(state.requests).toHaveLength(2); // one execution: the build round and the answer
    expect(a).toMatchObject({ alreadyAnswered: false });
    expect(b).toMatchObject({ reply: a.reply, alreadyAnswered: true });
    expect((await db.pool.query("select count(*)::int as n from assistant_messages where request_id=$1", [id])).rows[0].n).toBe(2);
    // Sequential replay afterwards: the stored answer, no model call, no build.
    state.requests = [];
    expect((await askResearchAssistant(tenant, run, "Overlap?", null, id)).alreadyAnswered).toBe(true);
    expect(state.requests).toHaveLength(0);
    expect(state.builds).toHaveLength(1);
  });

  it("when the first send of a request fails, the waiting send runs it once and stores it; distinct requests do not wait for each other", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const id = randomUUID();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // Model calls in order: the first send (held, then fails), the unrelated request (answered
    // while the first is held), then the waiting second send's build round and answer.
    state.script = [
      async () => {
        await gate;
        throw new Error("provider unavailable");
      },
      () => [{ type: "text", text: "Unrelated answer." }],
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })],
      () => [{ type: "text", text: "Answered by the second send." }],
    ];
    const first = askResearchAssistant(tenant, run, "Recover?", null, id);
    await new Promise((r) => setTimeout(r, 300));
    const second = askResearchAssistant(tenant, run, "Recover?", null, id);
    await new Promise((r) => setTimeout(r, 300));
    // A different request is answered while this one is still claimed.
    const unrelated = await askResearchAssistant(tenant, run, "Unrelated?", null, randomUUID());
    expect(unrelated.reply).toBe("Unrelated answer.");
    expect(state.builds).toHaveLength(0);
    release();
    await expect(first).rejects.toThrow("provider unavailable");
    const b = await second;
    expect(b).toMatchObject({ alreadyAnswered: false });
    expect(b.reply).toContain("Answered by the second send.");
    expect(state.builds).toHaveLength(1);
    expect((await db.pool.query("select role from assistant_messages where request_id=$1 order by created_at", [id])).rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  });

  it("a send that waits past the limit says the question is still being answered, running nothing", async () => {
    const { askResearchAssistant, RequestInProgressError } = await import("../researchAssistant");
    const id = randomUUID();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    state.script = [
      async () => {
        await gate;
        return [{ type: "text", text: "Slow answer." }];
      },
    ];
    process.env.ASSISTANT_REQUEST_WAIT_MS = "500";
    try {
      const first = askResearchAssistant(tenant, run, "Slow?", null, id);
      await new Promise((r) => setTimeout(r, 300));
      await expect(askResearchAssistant(tenant, run, "Slow?", null, id)).rejects.toBeInstanceOf(RequestInProgressError);
      expect(state.requests).toHaveLength(1);
      release();
      expect((await first).reply).toBe("Slow answer.");
    } finally {
      delete process.env.ASSISTANT_REQUEST_WAIT_MS;
    }
  });

  it("a send that built a table and then failed leaves a draft that the retry of that question reuses, not builds again", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const id = randomUUID();
    const drafts = async () => Number((await db.pool.query("select count(*) from document_tables where crosstab->'assistantRequest'->>'id' = $1", [id])).rows[0].count);
    state.script = [
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })],
      async () => {
        throw new Error("provider unavailable");
      },
    ];
    await expect(askResearchAssistant(tenant, run, "Reuse?", null, id)).rejects.toThrow("provider unavailable");
    expect(state.builds).toHaveLength(1);
    expect(await drafts()).toBe(1);
    // Send again: the same table request finds the draft; a different one is still built.
    state.script = [
      () => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })],
      (req) => {
        expect(String(lastResults(req)[0].content)).toContain("built for this question by an earlier attempt and is reused");
        return [call("build_table", { data_file_id: doc, rows: ["segment"], columns: [] })];
      },
      () => [{ type: "text", text: "Answered with the reused table." }],
    ];
    const r = await askResearchAssistant(tenant, run, "Reuse?", null, id);
    expect(r.reply).toContain("Answered with the reused table.");
    expect(state.builds).toHaveLength(2);
    expect(await drafts()).toBe(2);
    // Another question with the same table request builds its own.
    state.script = [() => [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })], () => [{ type: "text", text: "Own table." }]];
    await askResearchAssistant(tenant, run, "Another question", null, randomUUID());
    expect(state.builds).toHaveLength(3);
  });

  it("a report revision is applied only with its stored answer: a failed store leaves the report unchanged, and the retry applies it once", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    await db.pool.query(
      "insert into deck_narratives (tenant_id, run_id, situation, complication, question, governing_thought, executive_summary) values ($1,$2,'S','C','Q','G','Original summary') on conflict (run_id) do update set executive_summary = 'Original summary'",
      [tenant, run],
    );
    const summary = async () => (await db.pool.query("select executive_summary from deck_narratives where run_id=$1", [run])).rows[0].executive_summary;
    const id = randomUUID();
    // The answer's store fails (a check that refuses this reply), after the revision was made.
    await db.pool.query("alter table assistant_messages add constraint block_reply check (content <> 'Shortened.')");
    try {
      state.script = [() => [{ type: "text", text: "Shortened." }, call("revise_narrative", { executive_summary: "Revised summary" })]];
      await expect(askResearchAssistant(tenant, run, "Shorten the summary", null, id)).rejects.toThrow(/block_reply/);
      expect(await summary()).toBe("Original summary");
      expect(Number((await db.pool.query("select count(*) from assistant_messages where request_id=$1", [id])).rows[0].count)).toBe(0);
    } finally {
      await db.pool.query("alter table assistant_messages drop constraint block_reply");
    }
    state.script = [() => [{ type: "text", text: "Shortened." }, call("revise_narrative", { executive_summary: "Revised summary" })]];
    const ok = await askResearchAssistant(tenant, run, "Shorten the summary", null, id);
    expect(ok).toMatchObject({ reply: "Shortened.", revisedFields: ["executive_summary"], alreadyAnswered: false });
    expect(await summary()).toBe("Revised summary");
    // A replay returns the stored answer and does not revise again.
    await db.pool.query("update deck_narratives set executive_summary = 'Edited by hand' where run_id=$1", [run]);
    expect((await askResearchAssistant(tenant, run, "Shorten the summary", null, id)).alreadyAnswered).toBe(true);
    expect(await summary()).toBe("Edited by hand");
  });

  it("ten distinct questions at once all finish: claims come from their own pool, so the work always gets a connection, and other database work goes on (B8-F01)", async () => {
    const { askResearchAssistant } = await import("../researchAssistant");
    const { pool, claimPool, withTenant } = await import("../db");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // Each question builds one table, then answers; the first round of each waits at the gate.
    state.responder = async (req) => {
      const last = req.messages[req.messages.length - 1];
      if (typeof last.content === "string") {
        await gate;
        return [call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] })];
      }
      return [{ type: "text", text: `Answered: ${String(req.messages[0].content)}` }];
    };
    const questions = Array.from({ length: 10 }, (_, i) => `Capacity question ${i}`);
    const sends = questions.map((q) => askResearchAssistant(tenant, run, q, null, randomUUID()));
    await new Promise((r) => setTimeout(r, 800));
    // At most the claim pool's size are answering; the rest wait for a claim, holding nothing.
    expect(state.requests.length).toBeLessThanOrEqual(claimPool.options.max);
    expect(state.requests.length).toBeGreaterThan(0);
    // Ordinary database work is not blocked while every claim is held.
    const started = Date.now();
    const n = await withTenant(tenant, async (c) => (await c.query("select count(*)::int as n from runs")).rows[0].n);
    expect(n).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(pool.waitingCount).toBe(0);
    release();
    const results = await Promise.all(sends);
    expect(results.map((r) => r.reply.split("\n")[0])).toEqual(questions.map((q) => `Answered: ${q}`));
    expect(state.builds).toHaveLength(10);
    expect(state.requests).toHaveLength(20);
  }, 60000);

  it("a question that cannot get a claim before the wait runs out is refused as busy, running nothing; asked again later it is answered", async () => {
    const { askResearchAssistant, AssistantBusyError } = await import("../researchAssistant");
    const { claimPool } = await import("../db");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    state.responder = async (req) => {
      if (String(req.messages[0].content).startsWith("Holding")) await gate;
      return [{ type: "text", text: `Answered: ${String(req.messages[0].content)}` }];
    };
    const holders = Array.from({ length: claimPool.options.max }, (_, i) => askResearchAssistant(tenant, run, `Holding ${i}`, null, randomUUID()));
    await new Promise((r) => setTimeout(r, 500));
    const calls = state.requests.length;
    process.env.ASSISTANT_REQUEST_WAIT_MS = "2500";
    const id = randomUUID();
    try {
      await expect(askResearchAssistant(tenant, run, "Busy?", null, id)).rejects.toBeInstanceOf(AssistantBusyError);
      expect(state.requests.length).toBe(calls);
      expect(Number((await db.pool.query("select count(*) from assistant_messages where request_id=$1", [id])).rows[0].count)).toBe(0);
    } finally {
      delete process.env.ASSISTANT_REQUEST_WAIT_MS;
    }
    release();
    await Promise.all(holders);
    expect((await askResearchAssistant(tenant, run, "Busy?", null, id)).reply).toBe("Answered: Busy?");
  }, 60000);

  it("sends without a request id, and the assistant outside a project, are held to the same capacity (RR-F08)", async () => {
    const { askResearchAssistant, AssistantBusyError } = await import("../researchAssistant");
    const { askGeneralAssistant } = await import("../generalAssistant");
    const { claimPool } = await import("../db");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    state.responder = async (req) => {
      if (String(req.messages.at(-1)?.content ?? "").startsWith("Unkeyed")) await gate;
      return [{ type: "text", text: `Answered: ${String(req.messages.at(-1)?.content)}` }];
    };
    const callsBefore = state.requests.length;
    const storedBefore = Number((await db.pool.query("select count(*) from assistant_messages where run_id=$1", [run])).rows[0].count);
    // Ten sends with no id at once: no more than the claim pool's size reach the model while held.
    const held = Array.from({ length: 10 }, (_, i) => askResearchAssistant(tenant, run, `Unkeyed ${i}`, null, null));
    await new Promise((r) => setTimeout(r, 1000));
    expect(state.requests.length - callsBefore).toBe(claimPool.options.max);
    process.env.ASSISTANT_REQUEST_WAIT_MS = "2500";
    try {
      // With every slot held, a further send without an id, and one outside a project, are refused as
      // busy, asking the model and storing nothing.
      const calls = state.requests.length;
      await expect(askResearchAssistant(tenant, run, "Extra unkeyed", null, null)).rejects.toBeInstanceOf(AssistantBusyError);
      await expect(askGeneralAssistant(tenant, "Extra general", [], null)).rejects.toBeInstanceOf(AssistantBusyError);
      expect(state.requests.length).toBe(calls);
    } finally {
      delete process.env.ASSISTANT_REQUEST_WAIT_MS;
    }
    release();
    const results = await Promise.all(held);
    expect(results.map((r) => r.reply.split("\n")[0]).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `Answered: Unkeyed ${i}`).sort());
    expect(state.requests.length - callsBefore).toBe(10);
    expect(Number((await db.pool.query("select count(*) from assistant_messages where run_id=$1", [run])).rows[0].count)).toBe(storedBefore + 20);
    // Afterwards both answer again, and a keyed send is unchanged.
    expect((await askGeneralAssistant(tenant, "General again", [], null)).reply.split("\n")[0]).toBe("Answered: General again");
    expect((await askResearchAssistant(tenant, run, "Keyed again", null, randomUUID())).reply.split("\n")[0]).toBe("Answered: Keyed again");
  }, 90000);

  it("gives sample sizes from the calculator", async () => {
    state.script = [
      () => [call("sample_size", { mode: "sample_for_margin", margin_pct: 5 }), call("sample_size", { mode: "margin_for_sample", sample_size: 1000 })],
      () => [{ type: "text", text: "You need 385 completed interviews." }],
    ];
    await ask("What sample do I need for a 5% margin of error nationally?");
    const [size, margin] = lastResults(state.requests[1]);
    expect(size.content).toContain("Completed interviews needed: 385.");
    expect(size.content).toContain("each subgroup reported separately needs its own size");
    expect(margin.content).toContain("plus or minus 3.1 percentage points");
    expect(state.builds).toHaveLength(0);
  });

  it("builds at most four tables for one message, and stops after eight rounds", async () => {
    state.script = [
      () => [1, 2, 3, 4, 5].map((i) => call("build_table", { data_file_id: doc, rows: ["sat"], columns: ["segment"] }, `b${i}`)),
      () => [{ type: "text", text: "Here are four tables." }],
    ];
    await ask("Build lots of tables");
    expect(state.builds).toHaveLength(4);
    const fifth = lastResults(state.requests[1])[4];
    expect(fifth.is_error).toBe(true);
    expect(fifth.content).toMatch(/At most 4 tables/);

    state.builds = [];
    state.script = Array.from({ length: 10 }, () => () => [call("list_data_files", {})]);
    const r = await ask("Keep going");
    expect(state.requests.filter((q) => q.messages[0].content === "Keep going")).toHaveLength(8);
    expect(r.reply).toContain("I stopped after 8 steps without a final answer.");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("Research assistant tools (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});

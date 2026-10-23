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
}));

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", async (orig) => ({ ...(await orig<object>()), logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system: unknown; messages: { role: string; content: unknown }[] }) => {
        state.requests.push(JSON.parse(JSON.stringify(req)));
        const step = state.script.shift() ?? (() => [{ type: "text", text: "Done." }]);
        const out = step(req) as Block[] | { stop: string; content: Block[] };
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
    buildCrosstab: vi.fn(async (_t: string, _r: string, documentId: string, request: Record<string, unknown>) => {
      state.builds.push({ documentId, ...request });
      return { tableId: randomUUID(), questions: 1, skipped: [] };
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
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    state.script = [];
    state.requests = [];
    state.builds = [];
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

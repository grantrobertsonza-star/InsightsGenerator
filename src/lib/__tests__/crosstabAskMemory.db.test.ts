// SemanticTabs memory (Grant, 2026-10-22: "switch the rows and columns of the table just produced"
// got a placeholder table because each request was read on its own). The newest tables built from
// the data file are read from the database with their saved requests and listed before the request;
// the panel's earlier requests go with them; a plan that starts from a listed table names it
// (basedOn), checked against the list. Objectives' evidence questions pass no memory and are read on
// their own, as before. A failed read of the tables is said in the plan, never treated as none.
//
// Real disposable PostgreSQL for the table read (evidence tables, other files and tables without a
// saved request left out; newest first). Mocked: the model (scripted submit_plan calls, every
// request recorded), the usage log, and the dictionary and category reads of the data file.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const state = vi.hoisted(() => ({
  submits: [] as Record<string, unknown>[],
  requests: [] as { messages: { role: string; content: unknown }[] }[],
}));

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { role: string; content: unknown }[] }) => {
        state.requests.push({ messages: JSON.parse(JSON.stringify(req.messages)) });
        const input = state.submits.shift() ?? {};
        return { content: [{ type: "tool_use", id: `call-${state.requests.length}`, name: "submit_plan", input }], usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../crosstabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crosstabs")>();
  const variable = (name: string, label: string, nDistinct: number, labelled = true) => ({ name, label, numeric: true, nValid: 10, pctValid: 100, nDistinct, labelled, weightLike: false });
  return {
    ...actual,
    loadVariableDictionary: vi.fn(async () => ({
      variables: [variable("sat", "Overall satisfaction", 5), variable("gender", "Gender", 2), variable("region", "Region", 4), variable("age", "Age", 60, false)],
      sets: [],
    })),
    loadCategories: vi.fn(async (_t: string, _r: string, _d: string, name: string) => ({ variable: name, label: name, categories: [] })),
  };
});

const firstMessage = (i = 0) => String(state.requests[i]?.messages[0]?.content ?? "");
const REQUEST = "switch the rows and columns of the table just produced";

describe.skipIf(!TEST_DATABASE_URL)("SemanticTabs memory (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let doc = "";
  let other = "";
  let older = "";
  let newest = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
    await db.pool.query("insert into tenants(id,name) values($1,'Ask memory')", [tenant]);
    run = await one("insert into runs(tenant_id,project_name) values($1,'Ask memory') returning id", [tenant]);
    doc = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.sav','survey.sav','raw') returning id", [tenant, run]);
    other = await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','wave2.sav','wave2.sav','raw') returning id", [tenant, run]);
    const table = (document: string, index: number, label: string, status: string, request: unknown) =>
      one(
        "insert into document_tables(tenant_id,run_id,document_id,table_index,label,ingestion_type,crosstab,crosstab_status) values($1,$2,$3,$4,$5,'aggregated',$6,$7) returning id",
        [tenant, run, document, index, label, JSON.stringify({ version: 2, ...(request ? { savedRequest: request } : {}) }), status],
      );
    const req = (rows: string[], cols: string[], filters: unknown[] = []) => ({ columnVars: cols, rowItems: rows.map((r) => ({ key: r, label: r, vars: [r] })), weightVar: null, filters, source: "ask" });
    older = await table(doc, 100, "Satisfaction by gender", "draft", req(["sat"], ["gender"]));
    newest = await table(doc, 101, "Region by gender, aged 18 to 30", "draft", {
      ...req(["region"], ["gender"], [{ variable: "age", op: "between", min: 18, max: 30 }]),
      rowItems: [{ key: "region", label: "Region", vars: ["region"] }, { key: "nets-1", label: "Nets", vars: [], kind: "nets", nets: [] }],
    });
    // Left out of the memory: an Objectives evidence table (even newer), a table with no saved
    // request (built before requests were kept), and a table of another data file.
    await table(doc, 102, "Evidence table for an objective", "evidence", req(["sat"], ["region"]));
    await table(doc, 103, "Built before requests were kept", "committed", null);
    await table(other, 100, "Wave two table", "draft", req(["sat"], ["region"]));
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    state.submits = [];
    state.requests = [];
  });

  it("lists this file's newest tables first, and a transpose of the newest starts from it", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    state.submits = [{ summary: "x", rows: ["gender"], columns: ["region"], filters: [{ variable: "age", op: "between", min: 18, max: 30 }], unclear: [], based_on_table: newest }];
    const plan = await planCrosstabFromText(tenant, run, doc, REQUEST, { earlier: [] });

    const context = firstMessage();
    expect(context.indexOf(`table ${newest} (the newest, the one just produced)`)).toBeGreaterThanOrEqual(0);
    expect(context.indexOf(newest)).toBeLessThan(context.indexOf(older));
    expect(context).toContain("rows: region (Region) (plus nets, not carried over)");
    expect(context).toContain("columns: gender (Gender)");
    expect(context).toContain("filters: age between 18 and 30");
    expect(context).not.toMatch(/Evidence table|Built before requests|Wave two/);
    expect(context.trim().endsWith(`Request: ${REQUEST}`)).toBe(true);

    expect(plan.basedOn).toEqual({ id: newest, label: "Region by gender, aged 18 to 30" });
    expect(plan.rows.map((r) => r.key)).toEqual(["gender"]);
    expect(plan.columns.map((c) => c.name)).toEqual(["region"]);
    expect(plan.filters).toEqual([{ variable: "age", op: "between", min: 18, max: 30 }]);
    expect(plan.unclear.some((u) => u.startsWith('Starts from the earlier table "Region by gender, aged 18 to 30"'))).toBe(true);
  });

  it("refuses a based_on_table that was not listed, and the corrected plan goes through", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    const evidenceId = (await db.pool.query("select id from document_tables where document_id=$1 and table_index=102", [doc])).rows[0].id;
    state.submits = [
      { summary: "x", rows: ["region"], columns: ["sat"], filters: [], unclear: [], based_on_table: evidenceId },
      { summary: "x", rows: ["gender"], columns: ["sat"], filters: [], unclear: [], based_on_table: older },
    ];
    const plan = await planCrosstabFromText(tenant, run, doc, "transpose the satisfaction table", { earlier: [] });
    expect(state.requests).toHaveLength(2);
    expect(JSON.stringify(state.requests[1].messages)).toContain(`based_on_table \\"${evidenceId}\\" is not one of the listed tables`);
    expect(plan.basedOn).toEqual({ id: older, label: "Satisfaction by gender" });
  });

  it("sends the panel's earlier requests, the last three, oldest first; a plan that refers to none has no basedOn", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    state.submits = [{ summary: "x", rows: ["sat"], columns: ["region"], filters: [], unclear: [] }];
    const earlier = ["first", "second", "third", "fourth"].map((r) => ({ request: `${r} request`, summary: `${r} summary` }));
    const plan = await planCrosstabFromText(tenant, run, doc, "satisfaction by region", { earlier });
    const context = firstMessage();
    expect(context).not.toContain("first request");
    expect(context).toContain('- "second request" -> second summary');
    expect(context.indexOf("second request")).toBeLessThan(context.indexOf("fourth request"));
    expect(plan.basedOn).toBeNull();
    expect(plan.unclear.some((u) => u.startsWith("Starts from"))).toBe(false);
  });

  it("without memory (Objectives' evidence questions) the request is read on its own", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    state.submits = [{ summary: "x", rows: ["sat"], columns: [], filters: [], unclear: [] }];
    await planCrosstabFromText(tenant, run, doc, "overall satisfaction");
    expect(firstMessage()).toBe("Request: overall satisfaction");
  });

  it("a file with no tables says so; a failed read of the tables is said in the plan, and nothing can be based on a table", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    const fresh = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','new.sav','new.sav','raw') returning id", [tenant, run])).rows[0].id;
    state.submits = [{ summary: "x", rows: ["sat"], columns: [], filters: [], unclear: [] }];
    await planCrosstabFromText(tenant, run, fresh, REQUEST, { earlier: [] });
    expect(firstMessage()).toContain("No tables have been built from this data file yet.");

    state.requests = [];
    await db.pool.query("alter table document_tables rename to document_tables_away");
    try {
      state.submits = [
        { summary: "x", rows: ["gender"], columns: ["region"], filters: [], unclear: [], based_on_table: newest },
        { summary: "x", rows: ["gender"], columns: ["region"], filters: [], unclear: [] },
      ];
      const plan = await planCrosstabFromText(tenant, run, doc, REQUEST, { earlier: [] });
      expect(firstMessage()).toContain("could not be read just now");
      expect(firstMessage()).not.toContain("No tables have been built");
      expect(JSON.stringify(state.requests[1].messages)).toContain("is not one of the listed tables");
      expect(plan.basedOn).toBeNull();
      expect(plan.unclear.some((u) => u.includes("could not be read just now") && u.includes("the table just produced"))).toBe(true);
    } finally {
      await db.pool.query("alter table document_tables_away rename to document_tables");
    }
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("SemanticTabs memory (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});

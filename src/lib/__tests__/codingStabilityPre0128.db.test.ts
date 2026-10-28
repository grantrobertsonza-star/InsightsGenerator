// Batch 61: before migration 0128 is applied the app keeps working. The codebook is applied and saved
// (no original is kept), the coding view loads with the stability check shown as needing the migration,
// and the check and settling by majority refuse with that reason instead of using the edited coding.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

type Mode = "ok" | "omit_one" | "omit_all" | "fail";
const fake = vi.hoisted(() => ({
  // code number -> unit ids ("turn.unit") that meet it
  key: new Map<number, Set<string>>(),
  plan: [] as Mode[],
  calls: 0,
  callsPerPass: 2,
  onCall: null as null | (() => Promise<void>),
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "claude-test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string }; messages: { content: unknown }[] }) => {
        const usage = { input_tokens: 1, output_tokens: 1 };
        if (req.tool_choice?.name !== "record_decisions")
          return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", name: "x", input: { summaries: [] } }] };
        const mode = fake.plan[Math.floor(fake.calls / fake.callsPerPass)] ?? "ok";
        fake.calls += 1;
        if (fake.onCall) {
          const f = fake.onCall;
          fake.onCall = null;
          await f();
        }
        const parts = req.messages[0].content as { text: string }[];
        const code = Number(/^Code (\d+):/.exec(parts[1].text)?.[1]);
        const units = [...parts[0].text.matchAll(/^\s+(\d+\.\d+) /gm)].map((m) => m[1]);
        if (mode === "fail") return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "no" }] };
        const shown = mode === "omit_all" ? [] : mode === "omit_one" ? units.slice(1) : units;
        const decisions = shown.map((id) => ({
          id,
          account_type: "personal",
          stance: "affirmed",
          why: "test",
          status: "clear",
          meets: fake.key.get(code)?.has(id) ?? false,
        }));
        return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", name: "record_decisions", input: { decisions } }] };
      }),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 60000 });

const ROLE = "ie_stability_b61_test";

describe.skipIf(!TEST_DATABASE_URL)("batch 61 stability before migration 0128 (real database, restricted role)", () => {
  let db: DisposableDb;
  const T = randomUUID();
  let run = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p).then((r) => r.rows);

  beforeAll(async () => {
    db = await createDisposableDb("0128");
    await q("insert into tenants(id,name) values($1,'Pre')", [T]);
    run = (await q("insert into runs(tenant_id,project_name) values($1,'P') returning id", [T]))[0].id;
    await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login password 'ie_test_only' nobypassrls; end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
    await q(`grant execute on all functions in schema public to ${ROLE}`);
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    process.env.DATABASE_URL = u.toString();
    delete process.env.CODING_APPLY_MODEL;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("coding saves, the view loads, and the check and majority refuse naming migration 0128", async () => {
    expect(await q("select to_regclass('public.coding_model_baselines') as t")).toEqual([{ t: null }]);
    const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.txt',$3) returning id", [T, run, `${T}/x.txt`]))[0].id as string;
    const v1 = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [T, run, doc]))[0].id as string;
    await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,0,'Waiting','Waits'),($1,$2,1,'Payment','Pays')", [T, v1]);
    await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,0,'P','participant','I waited two hours.')", [T, run, doc]);
    fake.key = new Map([[1, new Set(["0.1"])]]);
    fake.plan = [];
    fake.calls = 0;
    const codes = await q("select id, name, definition from coding_codes where codebook_id = $1 order by position", [v1]);
    const { reapplyCodebook } = await import("../extractThemes");
    await reapplyCodebook(T, run, doc, codes.map((c) => ({ id: c.id, name: c.name, definition: c.definition, inclusion: "", exclusion: "" })));
    const book = (await q("select id from coding_codebooks where document_id = $1 and version = 2", [doc]))[0].id as string;
    expect(await q("select count(*)::int as n from coding_assignments a join coding_codes c on c.id = a.code_id where c.codebook_id = $1", [book])).toEqual([{ n: 1 }]);
    const { getCodingAnalysis, runStabilityCheck, applyMajorityCoding } = await import("../codingAnalysis");
    const v = (await getCodingAnalysis(T, run)).get(doc)!;
    expect(v.codes).toHaveLength(2);
    expect(v.stabilityBaseline.state).toEqual({ state: "migration_missing" });
    expect(v.stabilityBaseline.refusal).toMatch(/migration 0128/);
    await expect(runStabilityCheck(T, run, doc, book, 1)).rejects.toThrow(/migration 0128/);
    expect(fake.calls).toBe(2);
    await expect(applyMajorityCoding(T, run, doc, book)).rejects.toThrow(/migration 0128/);

    // Removing the transcript to the bin and restoring it work before 0128 too: the bin moves the tables this
    // database has, and the baselines table is not one of them yet.
    const bin = await import("../documentBin");
    const removed = await bin.removeDocumentToBin(T, run, doc, null);
    expect(await q("select count(*)::int as n from documents where id = $1 and run_id = $2", [doc, run])).toEqual([{ n: 0 }]);
    await bin.restoreDocumentFromBin(T, run, removed.removalId);
    expect(await q("select count(*)::int as n from coding_segments where document_id = $1 and run_id = $2", [doc, run])).toEqual([{ n: 1 }]);
  });
});

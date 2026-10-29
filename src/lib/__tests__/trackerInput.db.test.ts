// D2 (Grant, 29 October 2026): automatic dashboards read their roles from what was imported. Grant's
// synthetic BMW car tracker (fixtures/tracker-packs/bmw_car: wave 1 as CSV, the pack's metadata.json as the
// codebook) goes through the actual readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks and
// loadRoleInput, with the local engine and a real database (storage is an in-memory stand-in; the model is
// stubbed and must never be called), and the recogniser must find the roles written down independently in
// claude/tracker-packs-role-spec-2026-10-28.md, section 3.1:
//   - the codebook keeps each variable's question number, type and set (migration 0131);
//   - the brand list is codes 1 to 10 with Other (96) and None (98) set aside, BMW is code 8;
//   - each funnel stage has all ten brands by code; 12 buying situations and 10 attributes are brand grids;
//   - the file's weight is the dashboards' default weight;
// and the boundary: the pack's Master_Codebook.csv alone gives question numbers but no answer labels, so no
// brand list is found and none is guessed.
// Skipped, with the reason, without a test database or python3 + pandas/openpyxl.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
const pack = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", name));
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("tracker roles from an imported pack (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function stored(kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  async function linked(codebookName: string, codebookBytes: Buffer) {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored("instrument", codebookName, codebookBytes, "codebook");
    const data = await stored("table", "Car_Brand_Tracker_Wave_1.csv", pack("wave1_first60.csv"));
    const read = await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    return { codebook, data, read };
  }

  it("metadata.json as the codebook: question fields stored, and the pack's roles found from the import", async () => {
    const { codebook, data, read } = await linked("metadata.json", pack("metadata.json"));
    expect(read).toMatchObject({ count: 494, complete: true });
    expect(read.questionMetaNotStored).toBeUndefined();
    const meta = await q("select code, question_meta from instrument_items where document_id = $1 and code = any($2) order by code", [codebook, ["consider_b08", "topmind", "weight"]]);
    expect(meta).toEqual([
      { code: "consider_b08", question_meta: { questionId: "F1", questionType: "multiple_response", mrSet: "consider" } },
      { code: "topmind", question_meta: { questionId: "A1", questionType: "categorical", mrSet: null } },
      { code: "weight", question_meta: { questionId: "SYS", questionType: "continuous", mrSet: null } },
    ]);

    const { loadRoleInput } = await import("../trackerInput");
    const { recogniseTracker } = await import("../trackerRoles");
    const input = await loadRoleInput(tenant, run, data);
    expect(input.weightVar).toBe("weight");
    expect(input.withCodebookQuestion).toBeGreaterThan(400);
    const r = recogniseTracker(input.variables);
    expect(r.type).toBe("brand");
    expect(r.frame?.brands).toEqual(BRANDS.map((label, i) => ({ code: String(i + 1), label })));
    expect(r.frame?.nonBrandCodes.map((c) => c.code)).toEqual(["96", "98"]);
    const stage = (group: string) => r.measures.find((m) => m.group === group)?.stage;
    expect([stage("unaided"), stage("aware"), stage("consider"), stage("shortlist"), stage("owner"), stage("bought12")]).toEqual(["unaided_awareness", "awareness", "consideration", "shortlist", "usage", "acquisition"]);
    for (const m of r.measures) expect(m.byBrand.map((b) => b.code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(r.measures.find((m) => m.group === "consider")?.byBrand.find((b) => b.code === "8")?.variable).toBe("consider_b08");
    expect(r.grids.find((g) => g.kind === "moments")?.items).toHaveLength(12);
    expect(r.grids.find((g) => g.kind === "associations")?.items).toHaveLength(10);
    const { anthropic } = await import("../anthropic");
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it("the pack's Master_Codebook.csv alone: question numbers kept, no answer labels, so no brand list is guessed", async () => {
    await q("delete from instrument_links where run_id = $1", [run]);
    const { codebook, data, read } = await linked("Master_Codebook.csv", pack("Master_Codebook.csv"));
    expect(read).toMatchObject({ count: 494, complete: true });
    const meta = await q("select question_meta, response_options from instrument_items where document_id = $1 and code = 'attr_a01_b01'", [codebook]);
    // The universe column ("aware_b01=1") is a condition, never an answer list.
    expect(meta[0]).toEqual({ question_meta: { questionId: "I1", questionType: "multiple_response", mrSet: "attr_a01" }, response_options: [] });
    const { loadRoleInput } = await import("../trackerInput");
    const { recogniseTracker } = await import("../trackerRoles");
    const r = recogniseTracker((await loadRoleInput(tenant, run, data)).variables);
    expect(r.frame).toBeNull();
    expect(r.type).not.toBe("brand");
  });
});

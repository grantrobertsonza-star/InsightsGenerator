// Export all tables (Grant, 29 October 2026: "we also need to be able to export all tables not just one at a time"):
// the export route with the screen's list of tables, or every table of one data file. Real disposable PostgreSQL and
// the actual engine on the banking pack's two waves; storage is an in-memory stand-in.
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
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("@/lib/crosstabMeanRows", async () => await import("../crosstabMeanRows"));
vi.mock("@/lib/crosstabExact", async () => await import("../crosstabExact"));
vi.mock("@/lib/crosstabSlides", async () => await import("../crosstabSlides"));
vi.mock("@/lib/convertToPdf", async () => await import("../convertToPdf"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
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
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Export all tables (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];
  const ids: string[] = [];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Export all') returning id", [tenant]))[0].id;
    for (const w of [1, 2]) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, readFileSync(path.join(process.cwd(), "fixtures", "csm", `banking_relationship_w${w}_labels.sav`)));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `banking_w${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
      ))[0].id);
    }
    const { addCrosstabAction } = await import("../crosstabActions");
    const add = async (doc: string, row: string, label: string) => {
      const r = await addCrosstabAction(run, doc, { source: "workspace", columnVars: ["segment"], rowItems: [{ key: row, label, vars: [row] }], weightVar: null, correction: "fdr", excludeDk: true, meanRows: false, columnGroups: {} });
      if (!r.ok) throw new Error(r.error);
      ids.push(r.tableId);
    };
    await add(docs[0], "company_csat5", "Satisfaction");
    await add(docs[0], "continue5", "Continue");
    await add(docs[1], "company_csat5", "Satisfaction");
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const get = async (query: string) => {
    const { GET } = await import("../../app/api/runs/[id]/crosstab/export/route");
    return GET(new Request(`http://local/api/runs/${run}/crosstab/export?${query}`), { params: Promise.resolve({ id: run }) });
  };
  const workbook = async (query: string) => {
    const res = await get(query);
    expect(res.status).toBe(200);
    const XLSX = await import("xlsx");
    return XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  };

  it("the tables on screen, in screen order: a Contents sheet naming each sheet, table and data file, then one sheet each", async () => {
    const XLSX = await import("xlsx");
    const wb = await workbook(`tableIds=${[ids[1], ids[0]].join(",")}`);
    expect(wb.SheetNames.length).toBe(3);
    expect(wb.SheetNames[0]).toBe("Contents");
    const contents = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Contents, { header: 1 }) as unknown[][];
    expect(contents.slice(3).map((r) => [r[0], r[3]])).toEqual([[1, "banking_w1.sav"], [2, "banking_w1.sav"]]);
    expect(String(contents[3][2])).toMatch(/^Continue/);
    expect(String(contents[4][2])).toMatch(/^Satisfaction/);
    expect(contents.slice(3).map((r) => r[1])).toEqual(wb.SheetNames.slice(1));
  });

  it("every table of one data file, and only that file's", async () => {
    const wb = await workbook(`documentId=${docs[1]}`);
    expect(wb.SheetNames.length).toBe(1);
    expect(wb.SheetNames[0]).toMatch(/^Satisfaction/);
  });

  it("a table deleted meanwhile, or another project's, is refused with the count, never left out silently", async () => {
    const gone = randomUUID();
    const res = await get(`tableIds=${ids[0]},${gone}`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^1 of the tables to export is no longer saved/);
  });

  it("malformed ids are refused", async () => {
    expect((await get("tableIds=not-a-uuid")).status).toBe(400);
    expect((await get("tableIds=")).status).toBe(400);
    expect((await get("documentId=x")).status).toBe(400);
  });

  it("PowerPoint of all three: one file", async () => {
    const res = await get(`tableIds=${ids.join(",")}&format=pptx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("presentationml");
  });
});

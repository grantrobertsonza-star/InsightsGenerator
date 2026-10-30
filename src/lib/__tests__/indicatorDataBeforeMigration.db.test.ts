// Indicator data before migration 0126 (batch 54), against a real disposable PostgreSQL built from every
// migration up to 0125, with the actual upload action and indicator reads. Its own file, so the
// remembered "tables present" answer of indicatorData.ts starts empty in this process.
//   - adding a file as Indicator data is refused naming the migration: no document row, the stored object
//     removed, no cleanup left pending; other uploads are unchanged;
//   - the view's reads say the feature is not available yet, rather than failing or showing nothing;
//   - once 0126 is applied the same file is added and read, with no restart.
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
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../outputIngest", () => ({ ingestOutputFiles: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>(), removed: [] as string[] }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (key: string, body: Uint8Array) => {
          storage.objects.set(key, new Uint8Array(body));
          return { error: null };
        },
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([storage.objects.get(key)!.slice()]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async (keys: string[]) => {
          for (const k of keys) {
            storage.objects.delete(k);
            storage.removed.push(k);
          }
          return { data: keys.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const DHS = readFileSync(path.join(process.cwd(), "fixtures", "indicator-data", "DHS_SD.csv"));

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("indicator data before migration 0126 (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  async function upload(name: string, bytes: Buffer, field = "indicatorFiles") {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const fd = new FormData();
    fd.append(field, new File([new Uint8Array(bytes)], name, { type: "text/csv" }));
    return uploadDocumentsAction(run, fd);
  }

  beforeAll(async () => {
    db = await createDisposableDb("0126");
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Before 0126') returning id", [tenant]))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("refuses Indicator data naming the migration, keeps nothing, and leaves other uploads unchanged", async () => {
    expect((await q("select to_regclass('public.indicator_reads') as t"))[0]).toEqual({ t: null });
    const r = await upload("DHS_SD.csv", DHS);
    expect(r).toMatchObject({ ok: false, added: [], error: expect.stringContaining("DHS_SD.csv: Indicator data needs the database update 0126_indicator_observations.sql. Nothing was stored") });
    expect(await q("select id from documents where run_id = $1", [run])).toEqual([]);
    expect(storage.objects.size).toBe(0);
    expect(storage.removed.some((k) => k.endsWith("DHS_SD.csv"))).toBe(true);
    expect((await q("select count(*)::int n from trace where run_id = $1 and event = 'document_storage_cleanup_pending'", [run]))[0].n).toBe(0);
    // The same bytes as raw data go in as before.
    expect(await upload("DHS_SD.csv", DHS, "rawTableFiles")).toMatchObject({ ok: true, added: ["DHS_SD.csv"] });
  });

  it("the view says the feature is not available yet", async () => {
    const { indicatorCatalogueAction, readIndicatorFileAgainAction } = await import("../indicatorDataActions");
    const anyDoc = (await q("select id from documents where run_id = $1", [run]))[0].id;
    expect(await indicatorCatalogueAction(run, anyDoc)).toEqual({ ok: true, catalogue: { state: "unavailable", message: expect.stringContaining("0126_indicator_observations.sql") } });
    expect(await readIndicatorFileAgainAction(run, anyDoc)).toMatchObject({ ok: false, unavailable: true, error: expect.stringContaining("not available yet") });
  });

  it("once 0126 is applied the same file is added and read, with no restart", async () => {
    await db.apply(["0126_indicator_observations.sql"]);
    expect(await upload("DHS_SD.csv", DHS)).toMatchObject({ ok: true, added: ["DHS_SD.csv"] });
    const id = (await q("select id from documents where run_id = $1 and kind = 'indicator'", [run]))[0].id;
    const { loadIndicatorCatalogue } = await import("../indicatorData");
    expect(await loadIndicatorCatalogue(tenant, run, id)).toMatchObject({ state: "ready", layout: "sdmx_long" });
  });
});

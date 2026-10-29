// D2, before migration 0132 (tracker_dashboards): the dashboard still shows this wave's suggestion, and saving or
// resetting choices is refused with that reason; nothing is written. See trackerDashboards.db.test.ts.
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
const SAV = readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", "wave1_first20_labels_only.sav"));

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("before migration 0132 (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  let doc = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("drop table tracker_dashboards");
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW tracker') returning id", [tenant]))[0].id;
    const key = `${tenant}/${run}/bmw.sav`;
    storage.objects.set(key, SAV);
    doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'bmw.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("the suggestion shows; saving and resetting are refused with the reason", async () => {
    const { loadTrackerDashboard, saveTrackerChoices, resetTrackerChoices, TRACKER_DASHBOARDS_UNAVAILABLE } = await import("../trackerDashboards");
    const v = await loadTrackerDashboard(tenant, run, doc);
    expect([v.storageAvailable, v.revision, v.recognition.type, v.dashboard.focalBrand?.code]).toEqual([false, null, "brand", "8"]);
    expect(await saveTrackerChoices(tenant, run, doc, null, { focalBrandCode: "8" }, "x")).toEqual({ saved: false, reason: "unavailable", message: TRACKER_DASHBOARDS_UNAVAILABLE });
    expect(await resetTrackerChoices(tenant, run, 1, "x")).toEqual({ saved: false, reason: "unavailable", message: TRACKER_DASHBOARDS_UNAVAILABLE });
  });
});

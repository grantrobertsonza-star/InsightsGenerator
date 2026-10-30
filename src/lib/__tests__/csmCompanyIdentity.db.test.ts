// Codex E1-F01: a CSM company's change against the previous wave is computed only when its code names the same company in
// both waves. Grant's banking pack (fixtures/csm), with wave 1 rewritten so that code 1 is labelled "Different Bank"
// (the data unchanged): FNB's changes (box and mean, every tile) are withheld with the reason, the other banks and all
// customers still equal the references' difference, and once wave 1 names code 1 FNB again, FNB is compared again.
// Real database and the actual engine; storage and the request context are the only stand-ins.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const packFile = (n: string) => readFileSync(path.join(process.cwd(), "fixtures", "csm", n));
type Ref = { wave: number; company: number; variable: string; statistic: string; expected: number; raw_base: number };
const REF: Ref[] = JSON.parse(packFile("reference_relationship_w1_w2.json").toString("utf8")).results;
const ref = (variable: string, statistic: string, wave = 1, company = 0) => REF.find((r) => r.wave === wave && r.company === company && r.variable === variable && r.statistic === statistic)!;


/** Wave 1 with code 1 of the company question relabelled (pyreadstat writes the same data with the new label). */
function relabelledWave1(label: string): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "e1f01-"));
  try {
    const out = path.join(dir, "w1.sav");
    const script = [
      "import sys, pyreadstat",
      "df, m = pyreadstat.read_sav(sys.argv[1])",
      "vl = dict(m.variable_value_labels)",
      "vl['company'] = {**vl['company'], 1.0: sys.argv[3]}",
      "pyreadstat.write_sav(df, sys.argv[2], column_labels=m.column_names_to_labels, variable_value_labels=vl, variable_measure=m.variable_measure)",
    ].join("\n");
    const r = spawnSync(PYTHON, ["-c", script, path.join(process.cwd(), "fixtures", "csm", "banking_relationship_w1_labels.sav"), out, label], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("E1-F01: a reused company code is not compared across waves (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  let wave2 = "";
  const addWave = async (w: 1 | 2, bytes: Buffer) => {
    const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, `banking_w${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: w === 1 ? "2026-02" : "2026-06" })],
    ))[0].id as string;
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Banking CSM') returning id", [tenant]))[0].id;
    await addWave(1, relabelledWave1("Different Bank"));
    wave2 = await addWave(2, packFile("banking_relationship_w2_labels.sav"));
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("code 1 is FNB now and Different Bank before: no change for it on any tile, with the reason; other banks and all customers compared", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, wave2, "csm");
    const code1 = o.csmChanges.filter((c) => c.code === "1");
    expect(code1.length).toBe(4);
    for (const c of code1) {
      expect(c, c.id).toMatchObject({ previous: null, changePp: null, meanChange: null, reason: "Company code 1 was Different Bank in the previous wave, so it is not compared." });
    }
    const stay2 = o.csmChanges.find((c) => c.id === "stay" && c.code === "2")!;
    expect(stay2.changePp).toBeCloseTo(ref("continue5", "t2b", 2, 2).expected - ref("continue5", "t2b", 1, 2).expected, 6);
    const all = o.csmChanges.find((c) => c.id === "satisfaction" && c.code === null)!;
    expect(all.changePp).toBeCloseTo(ref("company_csat5", "t2b", 2).expected - ref("company_csat5", "t2b", 1).expected, 6);
  });

  it("recovery: once wave 1 names code 1 FNB (the corrected file), FNB is compared again and equals the references", async () => {
    await q("delete from documents where run_id = $1 and source_filename = 'banking_w1.sav'", [run]);
    await addWave(1, packFile("banking_relationship_w1_labels.sav"));
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, wave2, "csm");
    const fnb = o.csmChanges.find((c) => c.id === "stay" && c.code === "1")!;
    expect(fnb.reason).toBeUndefined();
    expect(fnb.changePp).toBeCloseTo(ref("continue5", "t2b", 2, 1).expected - ref("continue5", "t2b", 1, 1).expected, 6);
  });
});

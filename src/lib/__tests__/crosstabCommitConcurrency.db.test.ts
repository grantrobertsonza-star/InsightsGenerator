// EF-FND-F05 (batch 62): committing Cross tabs claims each draft once. Through the real buildCrosstab
// (local engine), commitCrosstabs and a real disposable PostgreSQL. A trigger that sleeps on each
// finding insert widens the window two commits used to race through. Storage and the model are the
// mocked boundaries.
//
// Covered: two and three simultaneous commits make one set of findings; an ordinary retry adds
// nothing; several drafts are each committed once; a failure while inserting rolls back the findings
// and the drafts' state, and a retry then commits; another project's commit is refused; and two drafts
// with identical content each get their own findings (identity is the table, not the wording).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "none", anthropic: { messages: { create: vi.fn(async () => { throw new Error("no model call expected"); }) } } }));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (k: string) => (storage.objects.has(k) ? { data: new Blob([new Uint8Array(storage.objects.get(k)!)]), error: null } : { data: null, error: { message: "not found" } }),
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

/** 300 respondents: segment A is more satisfied and uses the service more, so the table has tested differences. */
function savFile(): Buffer {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "commit-race-")), "f.sav");
  const script = String.raw`
import sys, pandas as pd, pyreadstat
n = 300
seg = [1.0 if i % 2 == 0 else 2.0 for i in range(n)]
sat = [float(min(10, (i * 7) % 9 + (3 if seg[i] == 1.0 else 0))) for i in range(n)]
use = [1.0 if (i % 10) < (7 if seg[i] == 1.0 else 3) else 2.0 for i in range(n)]
pyreadstat.write_sav(pd.DataFrame({"seg": seg, "sat": sat, "use": use}), sys.argv[1], column_labels=["Segment", "Satisfaction", "Uses service"],
  variable_value_labels={"seg": {1.0: "A", 2.0: "B"}, "use": {1.0: "Yes", 2.0: "No"}})
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("committing Cross tabs (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let bytes: Buffer;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    bytes = savFile();
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function dataFile() {
    const run = (await q("insert into runs (tenant_id) values ($1) returning id", [tenant]))[0].id as string;
    const key = `${tenant}/${run}/f.sav`;
    storage.objects.set(key, bytes);
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'f.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { run, doc };
  }
  async function draft(run: string, doc: string, rowKey: "sat" | "use" = "sat") {
    const { buildCrosstab } = await import("../crosstabs");
    const built = await buildCrosstab(tenant, run, doc, {
      columnVars: ["seg"],
      rowItems: [{ key: rowKey, label: rowKey === "sat" ? "Satisfaction" : "Uses service", vars: [rowKey] }],
      weightVar: null,
      correction: "none",
    });
    return built.tableId;
  }
  const perTable = (run: string) =>
    q("select source_table_id as t, count(*)::int as n, count(distinct finding_text)::int as d from findings where run_id = $1 group by 1 order by 1", [run]);
  async function withSlowInserts<T>(run: string, body: () => Promise<T>): Promise<T> {
    const fn = "slow_" + randomUUID().replaceAll("-", "");
    await q(`create function ${fn}() returns trigger language plpgsql as $$ begin perform pg_sleep(0.05); return new; end $$`);
    await q(`create trigger ${fn} before insert on findings for each row when (new.run_id = '${run}'::uuid) execute function ${fn}()`);
    try {
      return await body();
    } finally {
      await q(`drop trigger ${fn} on findings; drop function ${fn}()`);
    }
  }

  it("two simultaneous commits make one set of findings; a retry adds nothing", async () => {
    const { run, doc } = await dataFile();
    const t = await draft(run, doc);
    const { commitCrosstabs } = await import("../crosstabs");
    const replies = await withSlowInserts(run, () => Promise.all([commitCrosstabs(tenant, run, doc), commitCrosstabs(tenant, run, doc)]));
    expect(replies.reduce((n, r) => n + r.tables, 0)).toBe(1);
    const counts = await perTable(run);
    expect(counts).toHaveLength(1);
    expect(counts[0].t).toBe(t);
    expect(counts[0].n).toBe(counts[0].d);
    expect(counts[0].n).toBe(replies.reduce((n, r) => n + r.findings, 0));
    expect(await commitCrosstabs(tenant, run, doc)).toEqual({ tables: 0, findings: 0 });
    expect(await perTable(run)).toEqual(counts);
    expect(await q("select crosstab_status from document_tables where id = $1", [t])).toEqual([{ crosstab_status: "committed" }]);
  });

  it("several drafts, three simultaneous commits: each draft committed exactly once", async () => {
    const { run, doc } = await dataFile();
    const ids = [await draft(run, doc, "sat"), await draft(run, doc, "use"), await draft(run, doc, "sat")];
    const { commitCrosstabs } = await import("../crosstabs");
    const replies = await withSlowInserts(run, () => Promise.all([0, 1, 2].map(() => commitCrosstabs(tenant, run, doc))));
    expect(replies.reduce((n, r) => n + r.tables, 0)).toBe(3);
    const counts = await perTable(run);
    expect(counts.map((c) => c.t).sort()).toEqual([...ids].sort());
    for (const c of counts) expect(c.n).toBe(c.d);
    // The first and third drafts have the same content and so the same wording: each keeps its own
    // findings, because identity is the table they were computed from, not the text.
    expect(counts.find((c) => c.t === ids[0])!.n).toBe(counts.find((c) => c.t === ids[2])!.n);
  });

  it("a failure while inserting rolls back findings and draft state; a retry then commits", async () => {
    const { run, doc } = await dataFile();
    const t = await draft(run, doc);
    const { commitCrosstabs } = await import("../crosstabs");
    const fn = "fail_" + randomUUID().replaceAll("-", "");
    await q(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
    await q(`create trigger ${fn} before insert on findings for each row when (new.run_id = '${run}'::uuid) execute function ${fn}()`);
    try {
      await expect(commitCrosstabs(tenant, run, doc)).rejects.toThrow(/injected failure/);
    } finally {
      await q(`drop trigger ${fn} on findings; drop function ${fn}()`);
    }
    expect(await q("select crosstab_status from document_tables where id = $1", [t])).toEqual([{ crosstab_status: "draft" }]);
    expect(await perTable(run)).toHaveLength(0);
    const ok = await commitCrosstabs(tenant, run, doc);
    expect(ok.tables).toBe(1);
    expect(ok.findings).toBeGreaterThan(0);
  });

  it("a commit from another project is refused and commits nothing", async () => {
    const a = await dataFile();
    const b = await dataFile();
    const t = await draft(a.run, a.doc);
    const { commitCrosstabs } = await import("../crosstabs");
    await expect(commitCrosstabs(tenant, b.run, a.doc)).rejects.toThrow(/not in this project/);
    expect(await q("select crosstab_status from document_tables where id = $1", [t])).toEqual([{ crosstab_status: "draft" }]);
    expect(await perTable(a.run)).toHaveLength(0);
  });
});

// "Copy here" in Cross tabs (Grant, 29 October 2026: "i tried to copy a table from one wave to the next and it didnt
// seem to work"): a table built on wave 1 is rebuilt on wave 2 through the actions the screen calls. Real disposable
// PostgreSQL and the actual engine on the banking pack's two waves; storage is an in-memory stand-in.
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

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Copy here: a wave's tables rebuilt on another wave (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Waves') returning id", [tenant]))[0].id;
    for (const [w, date] of [[1, "2026-02"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, readFileSync(path.join(process.cwd(), "fixtures", "csm", `banking_relationship_w${w}_labels.sav`)));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `banking_w${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const count = async (doc: string) => Number((await q("select count(*) as n from document_tables where document_id = $1 and crosstab is not null", [doc]))[0].n);

  it("from a wave with no tables: nothing copied, and the result says the wave has none", async () => {
    const { replicateCrosstabsToWaveAction } = await import("../crosstabActions");
    expect(await replicateCrosstabsToWaveAction(run, docs[0], docs[1])).toEqual({ ok: true, tables: 0, built: 0, alreadyCopied: 0, skipped: [] });
  });

  it("a table added on wave 1 is copied to wave 2 as a draft and listed there; copying again, at once, or back to wave 1 adds nothing", async () => {
    const { addCrosstabAction, replicateCrosstabsToWaveAction, listCrosstabsAction } = await import("../crosstabActions");
    const added = await addCrosstabAction(run, docs[0], {
      source: "workspace",
      columnVars: ["segment"],
      rowItems: [{ key: "company_csat5", label: "Satisfaction", vars: ["company_csat5"] }],
      weightVar: "weight",
      correction: "fdr",
      excludeDk: true,
      meanRows: false,
      columnGroups: {},
    });
    expect(added).toMatchObject({ ok: true });
    expect(await replicateCrosstabsToWaveAction(run, docs[0], docs[1])).toEqual({ ok: true, tables: 1, built: 1, alreadyCopied: 0, skipped: [] });
    const listed = await listCrosstabsAction(run, docs[1]);
    expect(listed.ok && listed.items.map((i) => [i.label, i.status])).toEqual([["Satisfaction by Synthetic demonstration segment (weighted)", "draft"]]);
    // A repeated click, and two at once: still one copy.
    expect(await replicateCrosstabsToWaveAction(run, docs[0], docs[1])).toEqual({ ok: true, tables: 1, built: 0, alreadyCopied: 1, skipped: [] });
    const both = await Promise.all([replicateCrosstabsToWaveAction(run, docs[0], docs[1]), replicateCrosstabsToWaveAction(run, docs[0], docs[1])]);
    expect(both.every((r) => r.ok && r.built === 0)).toBe(true);
    expect(await count(docs[1])).toBe(1);
    // Copying the copy back to wave 1, where its original is: nothing added.
    expect(await replicateCrosstabsToWaveAction(run, docs[1], docs[0])).toEqual({ ok: true, tables: 1, built: 0, alreadyCopied: 1, skipped: [] });
    expect(await count(docs[0])).toBe(1);
  });

  it("two copies started at the same moment from a fresh table save one table", async () => {
    const { addCrosstabAction, replicateCrosstabsToWaveAction } = await import("../crosstabActions");
    await q("delete from document_tables where document_id = $1 and crosstab is not null", [docs[1]]);
    const before = await count(docs[1]);
    const added = await addCrosstabAction(run, docs[0], { source: "workspace", columnVars: [], rowItems: [{ key: "continue5", label: "Continue", vars: ["continue5"] }], weightVar: null, correction: "fdr", excludeDk: true, meanRows: false, columnGroups: {} });
    expect(added).toMatchObject({ ok: true });
    const both = await Promise.all([replicateCrosstabsToWaveAction(run, docs[0], docs[1]), replicateCrosstabsToWaveAction(run, docs[0], docs[1])]);
    expect(both.map((r) => r.ok && r.built + r.alreadyCopied)).toEqual([2, 2]);
    expect(await count(docs[1])).toBe(before + 2);
  });

  it("Edit in Build table: a copy's definition is read back, Update table replaces the draft and keeps it counted as copied; a committed table, or another file's, is never replaced", async () => {
    const { replicateCrosstabsToWaveAction, listCrosstabsAction, loadTableDefinitionAction, replaceDraftCrosstabAction } = await import("../crosstabActions");
    await q("delete from document_tables where document_id = $1 and crosstab is not null", [docs[1]]);
    await replicateCrosstabsToWaveAction(run, docs[0], docs[1]);
    const listed = await listCrosstabsAction(run, docs[1]);
    const copy = listed.ok ? listed.items.find((i) => i.label.startsWith("Satisfaction"))! : null;
    const def = await loadTableDefinitionAction(run, copy!.id);
    expect(def).toMatchObject({ ok: true, definition: { documentId: docs[1], status: "draft", request: { columnVars: ["segment"] } } });
    if (!def.ok || !def.definition.request) throw new Error("no definition");
    // The researcher changes the banner for this wave.
    const edited = { ...def.definition.request, columnVars: ["company"] };
    const r = await replaceDraftCrosstabAction(run, docs[1], copy!.id, edited);
    expect(r).toMatchObject({ ok: true, replaced: true });
    const after = await listCrosstabsAction(run, docs[1]);
    const labels = after.ok ? after.items.map((i) => i.label) : [];
    expect(labels.some((l) => l.startsWith("Satisfaction by Synthetic demonstration segment"))).toBe(false);
    expect(labels.filter((l) => l.startsWith("Satisfaction by")).length).toBe(1);
    // Copy here again: the edited table still stands for its original, so nothing is added.
    const before = await count(docs[1]);
    expect(await replicateCrosstabsToWaveAction(run, docs[0], docs[1])).toMatchObject({ ok: true, built: 0 });
    expect(await count(docs[1])).toBe(before);
    // A committed table is not replaced; another file's table is not replaced from here.
    const replacedId = r.ok ? r.tableId : "";
    await q("update document_tables set crosstab_status = 'committed' where id = $1", [replacedId]);
    expect(await replaceDraftCrosstabAction(run, docs[1], replacedId, edited)).toMatchObject({ ok: false, error: expect.stringContaining("Only a draft") });
    const wave1 = (await q("select id from document_tables where document_id = $1 and crosstab is not null limit 1", [docs[0]]))[0].id;
    expect(await replaceDraftCrosstabAction(run, docs[1], wave1, edited)).toMatchObject({ ok: false, error: expect.stringContaining("another data file") });
    expect(await count(docs[1])).toBe(before);
    // A table of another project cannot be read.
    expect(await loadTableDefinitionAction(run, "00000000-0000-0000-0000-000000000000")).toMatchObject({ ok: false });
  });

  it("copying a wave onto itself is refused with the reason", async () => {
    const { replicateCrosstabsToWaveAction } = await import("../crosstabActions");
    expect(await replicateCrosstabsToWaveAction(run, docs[0], docs[0])).toMatchObject({ ok: false, error: expect.stringContaining("another wave") });
  });
});

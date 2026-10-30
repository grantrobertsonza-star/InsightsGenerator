import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PYTHON } from "./helpers/pythonEngine";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: () => ({ download: async (key: string) => storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "fixture unavailable" } }, remove: async () => ({ data: [], error: null }), upload: async () => ({ data: {}, error: null }) }) } } }));
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });
const folder = path.resolve("fixtures/ua-soft-drinks");
const canonical = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const reference = readFileSync(path.join(folder, "QA_Expected_Metrics.csv"), "utf8").trim().split(/\r?\n/).slice(1).map(line => {
  const [wave, metric, eligible, valid, base, numerator, value, unit] = line.split(",");
  return { wave: Number(wave), metric, eligible: Number(eligible), valid: Number(valid), base: Number(base), numerator: Number(numerator), value: Number(value), unit };
});

describe.skipIf(!TEST_DATABASE_URL)("UA1 real loaders, engine, database and all supplied QA references", () => {
  let db: DisposableDb; const tenant = randomUUID(); let run: string; let book: string; const docs: string[] = [];
  const q = async (text: string, params: unknown[] = []) => (await db.pool.query(text, params)).rows;
  beforeAll(async () => {
    db = await createDisposableDb(); process.env.DATABASE_URL = db.url; process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants(id,name) values($1,'Synthetic UA tenant')", [tenant]);
    run = (await q("insert into runs(tenant_id,project_name) values($1,'Karoo Drinks U&A') returning id", [tenant]))[0].id;
    for (const wave of [1, 2, 3]) {
      const name = `UA_Soft_Drinks_Wave_${wave}_5000.csv`; const key = `${tenant}/${run}/${randomUUID()}/${name}`;
      storage.objects.set(key, readFileSync(path.join(folder, name)));
      docs.push((await q("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path,data_setup) values($1,$2,'table','raw',$3,$4,$5) returning id", [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${wave}`, waveDate: `2026-${String(wave * 3 + 1).padStart(2, "0")}`, waveIncluded: true })]))[0].id);
    }
    const name = "UA_Soft_Drinks_Master_Codebook.xlsx"; const key = `${tenant}/${run}/${name}`;
    storage.objects.set(key, readFileSync(path.join(folder, name)));
    book = (await q("insert into documents(tenant_id,run_id,kind,instrument_type,source_filename,storage_path) values($1,$2,'instrument','codebook',$3,$4) returning id", [tenant, run, name, key]))[0].id;
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const read = await readInstrumentItems(tenant, run, book); expect(read).toBeTruthy(); console.info("UA receipt: relational codebook read");
    expect(Number((await q("select count(*)::int n from instrument_items where document_id=$1", [book]))[0].n)).toBe(600);
    for (const doc of docs) {
      await suggestInstrumentLinks(tenant, run, book, doc);
      const confirmed = await confirmInstrumentLinks(tenant, run, book, 1);
      expect(confirmed.refused).toEqual([]); console.info("UA receipt: matched wave", docs.indexOf(doc) + 1, "confirmed", confirmed.confirmed);
    }
  });
  afterAll(async () => { const { pool } = await import("../db"); await pool.end().catch(() => {}); await db?.drop(); });
  for (const wave of [1, 2, 3]) it(`all 66 wave ${wave} references: eligible, valid, weighted base, numerator and value`, async () => {
    const { loadUaWorkspace } = await import("../uaDashboards");
    const { computeCrosstab } = await import("../crosstabs");
    const view = await loadUaWorkspace(tenant, run, docs[wave - 1]); expect(view.recognition.recognised).toBe(true); expect(view.recognition.analysisWeight).toBe("weight");
    const refs = reference.filter(r => r.wave === wave); expect(refs).toHaveLength(66);
    const plan = refs.map(r => {
      const matches = view.metrics.filter(m => canonical(m.label) === canonical(r.metric));
      expect(matches, r.metric).toHaveLength(1); return matches[0];
    });
    const before = Number((await q("select count(*)::int n from document_tables where run_id=$1", [run]))[0].n);
    const { result } = await computeCrosstab(tenant, run, docs[wave - 1], { columnVars: [], rowItems: [{ key: plan[0].variable, label: plan[0].label, vars: [plan[0].variable] }], weightVar: view.recognition.analysisWeight, correction: "none", excludeDk: false, uaMetrics: plan });
    expect(result.uaMetrics).toHaveLength(66);
    const receipts = refs.map((r, index) => {
      const actual = result.uaMetrics![index];
      expect(actual.eligibleBase.n, r.metric).toBe(r.eligible); expect(actual.validBase.n, r.metric).toBe(r.valid);
      const compare = (got: number | null, expected: number, field: string) => { expect(got, r.metric + " " + field).not.toBeNull(); expect(Math.abs(got! - expected), r.metric + " " + field).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 1e-6)); };
      compare(actual.validBase.w, r.base, "weighted base"); compare(actual.numerator, r.numerator, "numerator");
      compare(r.unit === "hypothetical people" ? actual.numerator : actual.value, r.value, "value");
      return { expected: r, actual };
    });
    expect(Number((await q("select count(*)::int n from document_tables where run_id=$1", [run]))[0].n)).toBe(before);
    mkdirSync("work/ua", { recursive: true }); writeFileSync(`work/ua/qa-db-wave-${wave}.json`, JSON.stringify(receipts, null, 2));
  });
  it("matches independent pandas repertoire and recalled-basket arithmetic outside the supplied QA", async () => {
    const reference = spawnSync(PYTHON, ["scripts/ua_reference_controls.py", path.join(folder, "UA_Soft_Drinks_Wave_1_5000.csv")], { encoding: "utf8", timeout: 180_000, windowsHide: true });
    expect(reference.status, reference.stderr).toBe(0);
    const expected = JSON.parse(reference.stdout) as Record<string, { eligible: number; valid: number; base: number; kish: number; numerator: number; value: number }>;
    const { loadUaWorkspace } = await import("../uaDashboards"); const { computeCrosstab } = await import("../crosstabs");
    const v = await loadUaWorkspace(tenant, run, docs[0]); const plan = Object.keys(expected).map(label => v.metrics.find(m => m.label === label)!);
    expect(plan.every(Boolean)).toBe(true);
    const { result } = await computeCrosstab(tenant, run, docs[0], { columnVars: [], rowItems: [{ key: plan[0].variable, label: plan[0].label, vars: [plan[0].variable] }], weightVar: "weight", uaMetrics: plan });
    for (const [i, spec] of plan.entries()) {
      const a = result.uaMetrics![i], e = expected[spec.label]; expect(a.eligibleBase.n).toBe(e.eligible); expect(a.validBase.n).toBe(e.valid);
      for (const [actual, ref] of [[a.value, e.value], [a.numerator, e.numerator], [a.validBase.w, e.base], [a.validBase.nEff, e.kish]] as const) expect(Math.abs(actual! - ref)).toBeLessThan(1e-7);
    }
    writeFileSync("work/ua/independent-pandas-controls.json", reference.stdout);
  });
  it("retains assigned and eligible split-sample bases separately", async () => {
    const { loadUaWorkspace } = await import("../uaDashboards"); const { computeCrosstab } = await import("../crosstabs");
    const v = await loadUaWorkspace(tenant, run, docs[0]); const m = v.metrics.find(m => /Karoo Fizz good value association/i.test(m.label))!;
    const { result } = await computeCrosstab(tenant, run, docs[0], { columnVars: [], rowItems: [{ key: m.variable, label: m.label, vars: [m.variable] }], weightVar: "weight", uaMetrics: [m] });
    const a = result.uaMetrics![0]; expect(a.assignedBase.n).toBeGreaterThan(a.eligibleBase.n); expect(a.eligibleBase.n).toBe(353); expect(a.validBase.n).toBe(353);
  });
  it("uses revision and scope checks; rejects another project's child even under a bypass-RLS role", async () => {
    const { loadUaWorkspace, saveUaChoices } = await import("../uaDashboards");
    const view = await loadUaWorkspace(tenant, run, docs[0]); const choices = { focalBrand: "1", weighted: true, roleCorrections: {}, lightUserMaximum: 5 };
    const outcomes = await Promise.all([saveUaChoices(tenant, run, docs[0], { scope: view.scope, revision: null }, choices, "A"), saveUaChoices(tenant, run, docs[0], { scope: view.scope, revision: null }, choices, "B")]);
    expect(outcomes.filter(r => r.saved)).toHaveLength(1); expect(outcomes.filter(r => !r.saved && r.conflict)).toHaveLength(1);
    const other = (await q("insert into runs(tenant_id,project_name) values($1,'Other project') returning id", [tenant]))[0].id;
    const old = (await q("select choices,revision from ua_dashboards where run_id=$1", [run]))[0];
    await expect(saveUaChoices(tenant, other, docs[0], { scope: `project:${other}`, revision: null }, choices, "bad")).rejects.toThrow();
    expect((await q("select choices,revision from ua_dashboards where run_id=$1", [run]))[0]).toEqual(old);
  });
  it("refuses a moved scope at an equal revision and saves after reloading, without touching either old scope", async () => {
    const { loadUaWorkspace, saveUaChoices } = await import("../uaDashboards");
    const view = await loadUaWorkspace(tenant, run, docs[0]);
    const before = (await q("select revision,choices from ua_dashboards where run_id=$1", [run]))[0];
    const program = (await q("insert into programs(tenant_id,name) values($1,'UA programme') returning id", [tenant]))[0].id;
    await q("update runs set program_id=$1 where id=$2", [program, run]);
    try {
      const stale = await saveUaChoices(tenant, run, docs[0], { scope: view.scope, revision: view.revision }, view.choices, "stale");
      expect(stale).toMatchObject({ saved: false, conflict: true });
      expect((await q("select revision,choices from ua_dashboards where run_id=$1", [run]))[0]).toEqual(before);
      expect(await q("select id from ua_dashboards where program_id=$1", [program])).toHaveLength(0);
      const fresh = await loadUaWorkspace(tenant, run, docs[0]);
      expect(await saveUaChoices(tenant, run, docs[0], { scope: fresh.scope, revision: fresh.revision }, fresh.choices, "retry")).toMatchObject({ saved: true, revision: 1 });
      await expect(saveUaChoices(randomUUID(), run, docs[0], { scope: fresh.scope, revision: 1 }, fresh.choices, "foreign tenant")).rejects.toThrow();
    } finally { await q("update runs set program_id=null where id=$1", [run]); }
  });
  it("does not substitute a successful empty read after a storage failure, and recovers", async () => {
    const { computeCrosstab } = await import("../crosstabs"); const { loadUaWorkspace } = await import("../uaDashboards"); const view = await loadUaWorkspace(tenant, run, docs[0]); const m = view.metrics[0]; const attempt = () => computeCrosstab(tenant, run, docs[0], { columnVars: [], rowItems: [{ key: m.variable, label: m.label, vars: [m.variable] }], weightVar: "weight", uaMetrics: [m] }); const row = (await q("select storage_path from documents where id=$1", [docs[0]]))[0];
    await q("update documents set storage_path=$1 where id=$2", [`${row.storage_path}.missing-${randomUUID()}`, docs[0]]);
    try { await expect(attempt()).rejects.toThrow(); } finally { await q("update documents set storage_path=$1 where id=$2", [row.storage_path, docs[0]]); }
    expect((await loadUaWorkspace(tenant, run, docs[0])).recognition.recognised).toBe(true);
  });
  it("before migration 0140 the dashboard reads but refuses saving", async () => {
    await q("drop table ua_dashboards");
    try {
      const { loadUaWorkspace, saveUaChoices } = await import("../uaDashboards"); const v = await loadUaWorkspace(tenant, run, docs[0]); expect(v.storageAvailable).toBe(false);
      const saved = await saveUaChoices(tenant, run, docs[0], { scope: v.scope, revision: null }, { focalBrand: "1", weighted: true, roleCorrections: {}, lightUserMaximum: null }, "A"); expect(saved.saved).toBe(false);
    } finally { await db.apply(["0140_ua_dashboards.sql"]); }
  });
});

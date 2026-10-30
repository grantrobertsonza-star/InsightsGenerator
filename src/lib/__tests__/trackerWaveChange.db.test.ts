// R5 waves (Grant, 30 October 2026): wave switching, change against a chosen wave on every page of the brand tracking
// dashboard, and the significance of each change. Three BMW-style waves in one project: the pack's waves 1 and 2 and a
// third made from wave 2 by helpers/make_wave3.py (BMW consideration lifted, brand code 10 renamed Haval to Chery, a
// word of mouth answer added, weights varied), plus an excluded wave. Every change and every test result is compared
// with helpers/wave_change_reference.py (pandas, numpy and scipy over the same files, written from the contract),
// never with the app's own output. Real disposable PostgreSQL and the actual engine; storage is an in-memory stand-in.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat/scipy.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, scipy"], { encoding: "utf8" }).status === 0;
const HELPERS = path.join(process.cwd(), "src", "lib", "__tests__", "helpers");
const pack = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);

type Fig = [number, number, number];
type Ref = { figures: Record<string, Fig>[]; pairs: Record<string, Record<string, [number, number | null, number | null]>> };

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R5 waves: change against a chosen wave and its significance (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];
  let excluded = "";
  let REF: Ref;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "r5waves-"));
    const w3 = path.join(dir, "wave3.sav");
    const made = spawnSync(PYTHON, ["-I", path.join(HELPERS, "make_wave3.py"), w3, pack("wave2_labels_only_compressed.sav")], { encoding: "utf8" });
    if (made.status !== 0) throw new Error(made.stderr);
    const files = [pack("wave1_labels_only_compressed.sav"), pack("wave2_labels_only_compressed.sav"), w3];
    const ref = spawnSync(PYTHON, ["-I", path.join(HELPERS, "wave_change_reference.py"), ...files], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (ref.status !== 0) throw new Error(ref.stderr);
    REF = JSON.parse(ref.stdout);

    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id;
    const add = async (file: string, name: string, setup: object) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, readFileSync(file));
      return (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, ...setup })],
      ))[0].id as string;
    };
    // Uploaded out of fieldwork order: the order is the fieldwork date's (the owner's rule), never upload or label.
    docs[2] = await add(w3, "bmw_wave3.sav", { wave: "Wave 3", waveDate: "2026-10" });
    docs[0] = await add(files[0], "bmw_wave1.sav", { wave: "Wave 1", waveDate: "2026-02" });
    excluded = await add(files[0], "bmw_pilot.sav", { wave: "Pilot", waveDate: "2025-11", waveIncluded: false });
    docs[1] = await add(files[1], "bmw_wave2.sav", { wave: "Wave 2", waveDate: "2026-06" });
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  /** The reference reading of key `k` for wave index `j` against wave index `i`. */
  const pair = (j: number, i: number, k: string) => REF.pairs[`${j}-${i}`][k];
  const expectTest = (test: { status: string; p?: number; z?: number; significant?: boolean } | undefined, ref: [number, number | null, number | null], label: string) => {
    expect(test?.status, label).toBe("tested");
    expect(test?.z, label).toBeCloseTo(ref[1]!, 6);
    expect(test?.p, label).toBeCloseTo(ref[2]!, 8);
    expect(test?.significant, label).toBe(ref[2]! < 0.05);
  };

  it("the wave list: included waves in fieldwork order, the excluded wave left out, the previous included wave compared by default", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[2]);
    expect(o.waves.included.map((w) => w.wave)).toEqual(["Wave 1", "Wave 2", "Wave 3"]);
    expect(o.waves.included.map((w) => w.documentId)).not.toContain(excluded);
    expect(o.waves.excluded.map((w) => w.wave)).toEqual(["Pilot"]);
    expect([o.waves.current, o.waves.orderText]).toEqual([2, "Waves in order of fieldwork date."]);
    expect(o.previous).toMatchObject({ status: "ok", documentId: docs[1], wave: "Wave 2" });
    expect(o.compareWith).toBe("previous");
  });

  it("page 01: every brand's stage change against the previous wave and its test equal the reference; brand code 10 renamed is withheld", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[2]);
    expect(o.compareTest?.line).toBe("Change marked when a two-sample test on effective bases gives p < 0.05; not adjusted for multiple comparisons.");
    expect(o.compareTest?.failed).toBeNull();
    let compared = 0;
    for (const [stage, metric] of [["awareness", "aware"], ["consideration", "consider"]] as const)
      for (let b = 1; b <= 9; b++) {
        const code = String(b);
        const c = o.changes.find((x) => x.stage === stage && x.code === code)!;
        const ref = pair(2, 1, `stage:${metric}:b${String(b).padStart(2, "0")}`);
        expect(c.changePp, `${stage} ${code}`).toBeCloseTo(ref[0], 6);
        expectTest(c.test, ref, `${stage} ${code}`);
        compared += 1;
      }
    expect(compared).toBe(18);
    // The lifted BMW consideration is significant and marked as a rise.
    const bmw = o.changes.find((x) => x.stage === "consideration" && x.code === "8")!;
    expect(bmw.test).toMatchObject({ status: "tested", significant: true, direction: 1, method: "pooled_effective_base" });
    // Code 10 now names Chery: not compared, with the reason, and never tested.
    for (const c of o.changes.filter((x) => x.code === "10")) expect(c).toMatchObject({ changePp: null, reason: "Brand code 10 was Haval in the compared wave, so it is not compared." });
    expect(o.changes.filter((x) => x.code === "10").every((c) => c.test === undefined)).toBe(true);
  });

  it("compare with an earlier wave (wave 1) and with None; a later or excluded wave is refused with the reason", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[2], "brand", { documentId: docs[0] });
    expect(o.previous).toMatchObject({ status: "ok", wave: "Wave 1" });
    const c = o.changes.find((x) => x.stage === "awareness" && x.code === "8")!;
    expect(c.changePp).toBeCloseTo(pair(2, 0, "stage:aware:b08")[0], 6);
    expectTest(c.test, pair(2, 0, "stage:aware:b08"), "W3 vs W1 BMW awareness");
    const none = await loadBrandOverview(tenant, run, docs[2], "brand", "none");
    expect(none.previous).toEqual({ status: "off", reason: "Compare with: None, so no change is shown." });
    expect(none.changes.every((x) => x.changePp === null && x.test === undefined)).toBe(true);
    expect(none.compareTest).toBeNull();
    const later = await loadBrandOverview(tenant, run, docs[1], "brand", { documentId: docs[2] });
    expect(later.previous).toMatchObject({ status: "none", reason: "The wave chosen to compare with is not earlier than this one. Choose an earlier wave." });
    const left = await loadBrandOverview(tenant, run, docs[2], "brand", { documentId: excluded });
    expect(left.previous.status).toBe("none");
    expect((left.previous as { reason: string }).reason).toMatch(/not an included wave/);
  });

  it("page 03: each BMW association change and test equal the reference; the BMW trend across the three waves equals each wave's reference", async () => {
    const { loadBrandAssociationsWithChange } = await import("../trackerPageChanges");
    const a = await loadBrandAssociationsWithChange(tenant, run, docs[2], "previous");
    expect(a.waveChange.compared).toMatchObject({ status: "ok", wave: "Wave 2" });
    for (let x = 1; x <= 10; x++) {
      const attr = `a${String(x).padStart(2, "0")}`;
      const c = a.waveChange.changes![`attr_${attr}_b08|8`];
      const ref = pair(2, 1, `assoc:${attr}:b08`);
      expect(c.changePp, attr).toBeCloseTo(ref[0], 6);
      expectTest(c.test, ref, attr);
    }
    expect(a.waveChange.changes!["attr_a01_b10|10"]).toMatchObject({ changePp: null, reason: "Brand code 10 was Haval in the compared wave, so it is not compared." });
    expect(a.trend?.brand.code).toBe("8");
    expect(a.trend!.waves.map((w) => [w.wave, w.status])).toEqual([["Wave 1", "ok"], ["Wave 2", "ok"], ["Wave 3", "ok"]]);
    a.trend!.waves.forEach((w, i) => {
      for (let x = 1; x <= 10; x++) {
        const attr = `a${String(x).padStart(2, "0")}`;
        expect(w.cells[`attr_${attr}_b08`].share, `${w.wave} ${attr}`).toBeCloseTo(REF.figures[i][`assoc:${attr}:b08`][0], 6);
      }
    });
  });

  it("page 02: category relevance changes and tests equal the reference, and the relevance of each moment in every wave is exposed", async () => {
    const { loadBrandMomentsWithChange } = await import("../trackerPageChanges");
    const m = await loadBrandMomentsWithChange(tenant, run, docs[1], "previous");
    for (let x = 1; x <= 12; x++) {
      const v = `relevant_c${String(x).padStart(2, "0")}`;
      const ref = pair(1, 0, `moment:c${String(x).padStart(2, "0")}`);
      expect(m.waveChange.changes!.relevance[v].changePp, v).toBeCloseTo(ref[0], 6);
      expectTest(m.waveChange.changes!.relevance[v].test, ref, v);
    }
    // Every recall cell shown has a change: the compared wave's cells are read for every moment, not its own top six.
    const shown = m.recall.status === "ok" ? m.recall.rows.flatMap((r) => r.cells.filter((c) => c.variable)) : [];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((c) => m.waveChange.changes!.recall[`${c.variable}|${c.code}`]?.changePp !== null)).toBe(true);
    expect(m.relevanceTrend.map((p) => p.wave)).toEqual(["Wave 1", "Wave 2"]);
    expect(m.relevanceTrend[0].shares.relevant_c01.share).toBeCloseTo(REF.figures[0]["moment:c01"][0], 6);
  });

  it("page 04: recall changes and tests equal the reference; word of mouth with a changed answer list is withheld, and compared when the list is the same", async () => {
    const { loadBrandAdvertisingWithChange } = await import("../trackerPageChanges");
    const w3 = await loadBrandAdvertisingWithChange(tenant, run, docs[2], "previous");
    for (let b = 1; b <= 9; b++) {
      const ref = pair(2, 1, `recall:b${String(b).padStart(2, "0")}`);
      expect(w3.waveChange.changes!.recall[String(b)].changePp, `recall ${b}`).toBeCloseTo(ref[0], 6);
      expectTest(w3.waveChange.changes!.recall[String(b)].test, ref, `recall ${b}`);
    }
    const wom = Object.values(w3.waveChange.changes!.wom);
    expect(wom.length).toBeGreaterThan(0);
    expect(wom.every((c) => c.changePp === null && /answer codes of wom_b\d\d changed between the waves \(1, 2, 3, 4, 5 then, 1, 2, 3, 4, 5, 6 now\)/.test(c.reason ?? "") || /Brand code 10/.test(c.reason ?? ""))).toBe(true);
    const w2 = await loadBrandAdvertisingWithChange(tenant, run, docs[1], "previous");
    const bmwPositive = w2.waveChange.changes!.wom["8|1"];
    expect(bmwPositive.changePp).not.toBeNull();
    expect(bmwPositive.test?.status).toBe("tested");
  });

  it("page 05 and the Category overview: age and decision style changes and tests equal the reference; acquirers below 50 are not tested", async () => {
    const { loadBrandAudienceWithChange, loadCategoryOverviewWithChange } = await import("../trackerPageChanges");
    const au = await loadBrandAudienceWithChange(tenant, run, docs[1], "previous");
    for (const code of ["1", "2", "3", "4"]) {
      const ref = pair(1, 0, `age:${code}`);
      expect(au.waveChange.changes!.age.category[code].changePp, `age ${code}`).toBeCloseTo(ref[0], 6);
      expectTest(au.waveChange.changes!.age.category[code].test, ref, `age ${code}`);
    }
    // 13 BMW acquirers in wave 1: the page's small-base rule, no test.
    expect(Object.values(au.waveChange.changes!.age.acquirers).every((c) => c.test === undefined || (c.test.status === "untested" && /Fewer than 50/.test(c.test.reason)))).toBe(true);
    const cat = await loadCategoryOverviewWithChange(tenant, run, docs[1], "previous");
    for (const code of ["1", "2", "3"]) {
      const ref = pair(1, 0, `decision:${code}`);
      expect(cat.waveChange.changes!.decisionStyle[code].changePp, `decision ${code}`).toBeCloseTo(ref[0], 6);
      expectTest(cat.waveChange.changes!.decisionStyle[code].test, ref, `decision ${code}`);
    }
    expect(cat.waveChange.changes!.repertoire.awareness.change).not.toBeNull();
  });

  it("a compared wave whose file cannot be read: failed with the reason, this wave still shows, the other waves still work, and it recovers", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const { loadBrandAssociationsWithChange } = await import("../trackerPageChanges");
    const key = (await q("select storage_path from documents where id = $1", [docs[1]]))[0].storage_path as string;
    await q("update documents set storage_path = $2 where id = $1", [docs[1], `${key}.missing`]);
    try {
      const o = await loadBrandOverview(tenant, run, docs[2]);
      expect(o.previous.status).toBe("failed");
      expect(o.figures.stages.length).toBeGreaterThan(0);
      expect(o.changes.every((c) => c.changePp === null && c.reason === "The compared wave's figures could not be read." && c.test === undefined)).toBe(true);
      expect(o.timeline.find((p) => p.wave === "Wave 2")?.status).toBe("failed");
      const a = await loadBrandAssociationsWithChange(tenant, run, docs[2], "previous");
      expect(a.waveChange.compared.status).toBe("failed");
      expect(a.waveChange.changes).toBeNull();
      expect(a.profile.status).toBe("ok");
      // Another wave still works: wave 3 against wave 1.
      const w1 = await loadBrandOverview(tenant, run, docs[2], "brand", { documentId: docs[0] });
      expect(w1.previous.status).toBe("ok");
      expect(w1.changes.some((c) => c.test?.status === "tested")).toBe(true);
    } finally {
      await q("update documents set storage_path = $2 where id = $1", [docs[1], key]);
    }
    expect((await loadBrandOverview(tenant, run, docs[2])).previous.status).toBe("ok");
  });
});

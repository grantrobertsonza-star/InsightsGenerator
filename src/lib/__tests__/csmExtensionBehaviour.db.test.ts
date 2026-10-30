// R6 CSM extension behaviour on the pack's files (real database, actual engine, the nine XLSX files as imported
// data files), against independent pandas values written from the pack instructions (helpers/
// csm_extension_reference.py, from the pack's CSV fixtures) where the pack publishes no reference:
//   - filters by raw code change both numerator and valid denominator (company and task), pending beside completion,
//     ordered paths and distinct channels, contacts, channel benchmarks, reasons for staying, channel records and
//     distinct customers, the noncustomer sample;
//   - keys and grains: text IDs with leading zeroes, opening from any family links the same wave, the samples are
//     never pooled, and the existing company tiles are never computed from channel records or noncustomers;
//   - the earlier CSM fixtures: every added construct Not measured, the existing figures unchanged;
//   - weight rescaling invariance;
//   - failure cases: a repeated channel record, a noncustomer ID that is a customer ID, a benchmark for a different
//     task, no recent journey at all.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { insertPack, PACK, packReferences, type Family, type PackDocs } from "./helpers/csmPackDb";

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

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 600_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
const TOL = 1e-6;
const HELPERS = path.join(process.cwd(), "src", "lib", "__tests__", "helpers");

type V = { value: number | null; raw: number; weighted: number };
const independent = (sector: "banking" | "mobile", wave: number, company: number | null = null, task: number | null = null) =>
  JSON.parse(
    execFileSync(PYTHON, ["-I", path.join(HELPERS, "csm_extension_reference.py"), path.join(PACK, sector), sector === "banking" ? "Banking" : "Mobile", String(wave), company === null ? "-" : String(company), task === null ? "-" : String(task)], { encoding: "utf8" }),
  );
type Fig = { status: string; reading?: { value: number | null; rawBase: number; weightedBase: number }; reason?: string };
function same(label: string, fig: Fig, v: V) {
  if (fig.status !== "ok" || !fig.reading) throw new Error(`${label}: ${JSON.stringify(fig)}`);
  expect(Math.abs((fig.reading.value as number) - (v.value as number)), `${label} value`).toBeLessThan(TOL);
  expect(fig.reading.rawBase, `${label} raw`).toBe(v.raw);
  expect(Math.abs(fig.reading.weightedBase - v.weighted), `${label} weighted`).toBeLessThan(TOL);
}
const modified = (dir: string, family: Family, sector: "banking", wave: number, ops: object) => (fam: Family, w: number, bytes: Buffer) => {
  if (fam !== family || w !== wave) return bytes;
  const src = path.join(dir, `in-${randomUUID()}.xlsx`);
  const dst = path.join(dir, `out-${randomUUID()}.xlsx`);
  writeFileSync(src, bytes);
  execFileSync(PYTHON, ["-I", path.join(HELPERS, "csm_modify.py"), src, dst, JSON.stringify(ops)]);
  void sector;
  return readFileSync(dst);
};

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R6 CSM extension behaviour (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let banking: { run: string; docs: PackDocs };
  let mobile: { run: string; docs: PackDocs };
  const dir = mkdtempSync(path.join(tmpdir(), "csmx-"));
  const none = { company: null, task: null, journeyChannel: null };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    banking = await insertPack(db, tenant, "banking", storage.objects, { waves: [1, 2] });
    mobile = await insertPack(db, tenant, "mobile", storage.objects, { waves: [2] });
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("company and task filters by raw code change numerator and denominator, equal to the independent values", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    for (const [label, pack, sector, wave, company, task] of [
      ["banking w1 all", banking, "banking", 1, null, null],
      ["banking w1 FNB payments", banking, "banking", 1, 1, 1],
      ["mobile w2 MTN problem", mobile, "mobile", 2, 2, 4],
    ] as const) {
      const ind = independent(sector, wave, company, task);
      const filters = { company: company === null ? null : String(company), task: task === null ? null : String(task), journeyChannel: null };
      const v = await loadCsmExtension(tenant, pack.run, pack.docs[wave].Relationship, "journey", filters);
      const j = v.journey!;
      if (j.status !== "ok") throw new Error(JSON.stringify(j));
      same(`${label} completion`, j.completion, ind.completion);
      same(`${label} pending`, j.pending, ind.pending);
      same(`${label} journey csat`, j.journeyCsat, ind.journey_csat_t2b);
      if (j.contacts.status !== "ok") throw new Error(JSON.stringify(j.contacts));
      expect(Math.abs((j.contacts.mean as number) - ind.contacts_mean.value)).toBeLessThan(TOL);
      if (j.paths.status !== "ok") throw new Error(JSON.stringify(j.paths));
      j.paths.rows.slice(0, 3).forEach((p, i) => {
        expect(p.path, `${label} path ${i}`).toBe(ind.paths[i].path);
        expect(Math.abs(p.share - ind.paths[i].share)).toBeLessThan(TOL);
      });
      for (const d of j.paths.distinct) expect(Math.abs(d.share - ind.distinct[String(d.channels)])).toBeLessThan(TOL);
      expect(j.paths.flagMismatches).toBe(0);
      // The path text names channels from the answer list; digital self service is never always "app".
      expect(j.paths.rows.some((p) => /Digital self service/.test(p.text))).toBe(true);
      expect(j.population.text).toContain("Recent tasks (journey_recent30 = 1)");
    }
  });

  it("benchmark by channel, reasons for staying, channel records and the noncustomer sample equal the independent values", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    const ind = independent("banking", 1);
    const c = (await loadCsmExtension(tenant, banking.run, banking.docs[1].Relationship, "competitive", none)).competitive!;
    if ("status" in c.benchmark) throw new Error(JSON.stringify(c.benchmark));
    expect(c.benchmark.recorded).toEqual({ asked: ind.benchmark_recorded.asked, comparable: ind.benchmark_recorded.comparable, noComparableUse: ind.benchmark_recorded.asked - ind.benchmark_recorded.comparable });
    for (const b of c.benchmark.byChannel) same(`benchmark channel ${b.code}`, b.figure, ind.benchmark_by_channel[b.code]);
    const n = c.noncustomer;
    if (n.status !== "ok") throw new Error(JSON.stringify(n));
    same("nc awareness", n.awareness, ind.nc_awareness);
    if (n.preferredChannel.status !== "ok") throw new Error("preferred channel");
    expect(Math.abs((n.preferredChannel.rows.find((r) => r.code === "3")!.share as number) - ind.nc_preferred_channel.value)).toBeLessThan(TOL);
    expect(n.preferredChannel.rawBase).toBe(ind.nc_preferred_channel.raw);
    // Unaware noncustomers give no expectations: the expected-performance base is the aware only.
    expect(ind.nc_unaware_with_expectations).toBe(0);
    for (const a of n.attributes) expect(a.expected.status === "ok" && a.expected.reading.rawBase).toBe(500 - ind.nc_unaware);
    // Recent alternative nonusers are counted, and the alternative rating is only for the recent users.
    expect(n.alternativeAsked!.recent + n.alternativeAsked!.notRecent).toBe(500);
    expect(n.alternative.status === "ok" && n.alternative.reading.rawBase).toBeLessThanOrEqual(n.alternativeAsked!.recent);

    const e = (await loadCsmExtension(tenant, banking.run, banking.docs[1].Relationship, "experience", none)).experience!;
    if (e.reasons.primary.status !== "ok") throw new Error("primary");
    for (const r of e.reasons.primary.rows) expect(Math.abs((r.share as number) - ind.stay_primary[r.code]), `primary ${r.code}`).toBeLessThan(TOL);
    e.reasons.coexist.forEach((f, i) => same(`coexist r0${i + 3}`, f, ind.coexist[`r0${i + 3}`]));
    if (e.channel.status !== "ok") throw new Error(JSON.stringify(e.channel));
    // Channel records are counted as records and distinct customers, never as customers.
    expect(e.channel.all.records).toBe(ind.channel_records);
    expect(e.channel.all.distinctCustomers).toBe(ind.channel_distinct_customers);
    for (const g of e.channel.byChannel) same(`frustrated channel ${g.code}`, g.emotions.find((x) => x.emotion === "frustrated")!.mean, ind.channel_frustrated_by_channel[g.code!]);
    // Mixed emotions: the four are separate figures with their own bases, and no combined index exists.
    expect(e.channel.all.emotions.map((x) => x.emotion)).toEqual(["reassured", "valued", "frustrated", "anxious", "angry", "disappointed"]);
    expect(new Set(e.channel.all.emotions.map((x) => x.mean.status === "ok" && x.mean.reading.rawBase)).size).toBeGreaterThan(1);
    // Verbatims are the file's own text.
    const relCsv = readFileSync(path.join(PACK, "banking", "test-reference", "Banking_CSM_Relationship_Wave_1.csv"), "utf8");
    if (e.journey.status !== "ok") throw new Error("journey");
    expect(e.journey.verbatims.length).toBeGreaterThan(0);
    for (const vb of e.journey.verbatims) expect(relCsv).toContain(vb.text);
  });

  it("keys and grains: opening from any family links the same wave; text IDs keep their leading zeroes; never pooled", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    const { loadCsmWaveFiles } = await import("../csmExtensionKeys");
    const w = await loadCsmWaveFiles(tenant, banking.run, banking.docs[1].Noncustomer);
    expect(w.open.grain).toBe("noncustomer");
    expect([w.relationship?.documentId, w.channel?.documentId, w.noncustomer?.documentId]).toEqual([banking.docs[1].Relationship, banking.docs[1].Channel, banking.docs[1].Noncustomer]);
    expect(w.relationship!.rows.every((r) => typeof r.respondent_id === "string" && (r.respondent_id as string).startsWith("0") && (r.respondent_id as string).length === 8)).toBe(true);
    expect(w.noncustomer!.rows.every((r) => typeof r.respondent_id === "string" && (r.respondent_id as string).startsWith("NC"))).toBe(true);
    expect(w.channel!.keys).toMatchObject({ ok: true, records: 1615, distinctPeople: 905 });
    expect(w.relationship!.sheetName).toBe("Respondents");
    expect(w.channel!.sheetName).toBe("Experiences");
    // Wave 2's files are another wave: never linked to wave 1.
    expect(w.linkProblems).toEqual([]);
    const fromChannel = await loadCsmExtension(tenant, banking.run, banking.docs[2].Channel, "journey", none);
    expect(fromChannel.openGrain).toBe("channel");
    expect(fromChannel.files.map((f) => f.documentId)).toEqual([banking.docs[2].Relationship, banking.docs[2].Channel, banking.docs[2].Noncustomer]);
    // Customer counts are the Relationship file's: 1,000 people, whatever the channel records.
    expect(fromChannel.files.find((f) => f.grain === "relationship")).toMatchObject({ records: 1000, distinctPeople: 1000 });
  });

  it("the existing company tiles are never computed from channel records or noncustomers; Relationship waves compare with Relationship waves", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    for (const fam of ["Channel", "Noncustomer"] as const) {
      const o = await loadBrandOverview(tenant, banking.run, banking.docs[2][fam], "csm");
      for (const id of ["satisfaction", "recommend", "stay", "switch"]) {
        const t = o.csm.find((x) => x.id === id)!;
        expect(t.status, `${fam} ${id}: ${JSON.stringify(t).slice(0, 300)}`).not.toBe("ok");
      }
    }
    const rel = await loadBrandOverview(tenant, banking.run, banking.docs[2].Relationship, "csm");
    expect(rel.previous).toMatchObject({ status: "ok", documentId: banking.docs[1].Relationship });
    const ref = packReferences("banking").find((r) => r.wave === 1 && r.dataset === "Relationship" && r.company === 0 && r.variable === "company_csat5" && r.statistic === "mean5")!;
    expect(Math.abs((rel.timeline[0].satisfaction?.mean as number) - (ref.expected as number))).toBeLessThan(TOL);
  });

  it("the earlier CSM fixtures: every added construct Not measured, the existing figures unchanged", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    const { loadBrandOverview } = await import("../trackerOverview");
    const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, 'Earlier CSM') returning id", [tenant]))[0].id as string;
    const key = `${tenant}/${run}/${randomUUID()}-w1.sav`;
    storage.objects.set(key, readFileSync(path.join(process.cwd(), "fixtures", "csm", "banking_relationship_w1_labels.sav")));
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup) values ($1, $2, 'table', 'raw', 'banking_w1.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: "Wave 1", waveDate: "2026-02" })],
    ))[0].id as string;
    const j = await loadCsmExtension(tenant, run, doc, "journey", none);
    expect(j.openGrain).toBe("relationship");
    if (j.journey!.status !== "ok") throw new Error(JSON.stringify(j.journey));
    for (const f of [j.journey!.recentShare, j.journey!.completion, j.journey!.journeyCsat, j.journey!.transferred]) expect(f.status, f.id).toBe("not_measured");
    expect(j.journey!.recentShare.status === "not_measured" && j.journey!.recentShare.reason).toBe("journey_recent30 is not in this file.");
    const e = (await loadCsmExtension(tenant, run, doc, "experience", none)).experience!;
    expect(e.journey.status).toBe("not_measured");
    expect(e.channel).toMatchObject({ status: "not_measured", reason: "No channel file is labelled Wave 1 in this project." });
    expect(e.experiencePreference.status).toBe("not_measured");
    expect(e.reasons.shares.every((f) => f.status === "not_measured")).toBe(true);
    const c = (await loadCsmExtension(tenant, run, doc, "competitive", none)).competitive!;
    expect("status" in c.benchmark ? c.benchmark.status : c.benchmark.customer.status).toBe("not_measured");
    expect(c.noncustomer.status).toBe("not_measured");
    // The existing figures are unchanged: the reference for this fixture (fixtures/csm).
    const REF = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "csm", "reference_relationship_w1_w2.json"), "utf8")).results as { wave: number; company: number; variable: string; statistic: string; expected: number }[];
    const o = await loadBrandOverview(tenant, run, doc, "csm");
    const sat = o.csm.find((t) => t.id === "satisfaction")!;
    if (sat.status !== "ok" || sat.id !== "satisfaction") throw new Error(JSON.stringify(sat));
    expect(sat.box).toBeCloseTo(REF.find((r) => r.wave === 1 && r.company === 0 && r.variable === "company_csat5" && r.statistic === "t2b")!.expected, 6);
  });

  it("weight rescaling: every share and mean unchanged, weighted bases scaled, raw bases unchanged", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    const k = 3.7;
    const scaled = await insertPack(db, tenant, "banking", storage.objects, {
      waves: [1],
      projectName: "Rescaled",
      bytesOf: (fam, w, bytes) => (fam === "Noncustomer" ? bytes : modified(dir, fam, "banking", w, { scaleWeight: k })(fam, w, bytes)),
    });
    for (const section of ["journey", "experience", "competitive"] as const) {
      const a = await loadCsmExtension(tenant, banking.run, banking.docs[1].Relationship, section, none);
      const b = await loadCsmExtension(tenant, scaled.run, scaled.docs[1].Relationship, section, none);
      const figs = (v: typeof a): Fig[] => {
        const out: Fig[] = [];
        const walk = (x: unknown) => {
          if (!x || typeof x !== "object") return;
          if ("reading" in x && "status" in x) out.push(x as Fig);
          for (const y of Object.values(x)) walk(y);
        };
        walk(v.journey ?? v.experience ?? v.competitive);
        return out;
      };
      const fa = figs(a);
      const fb = figs(b);
      expect(fa.length).toBeGreaterThan(5);
      expect(fb.length).toBe(fa.length);
      fa.forEach((x, i) => {
        const y = fb[i];
        if (x.status !== "ok") return;
        expect(Math.abs((y.reading!.value as number) - (x.reading!.value as number)), `${section} ${i}`).toBeLessThan(1e-9);
        expect(y.reading!.rawBase).toBe(x.reading!.rawBase);
        // Noncustomer figures are unit weight: their bases do not scale.
        const factor = Math.abs(y.reading!.weightedBase - x.reading!.weightedBase) < 1e-9 ? 1 : k;
        expect(Math.abs(y.reading!.weightedBase - factor * x.reading!.weightedBase)).toBeLessThan(1e-6);
      });
    }
  });

  it("failures are stated, never repaired: a repeated channel record, a noncustomer who is a customer, a different-task benchmark, no recent journey", async () => {
    const { loadCsmExtension } = await import("../csmExtension");
    // A channel record repeated: the Channel file is not used, with the reason; the customer figures stand.
    const dup = await insertPack(db, tenant, "banking", storage.objects, { waves: [1], projectName: "Dup", bytesOf: modified(dir, "Channel", "banking", 1, { duplicateRow: 1 }) });
    const v1 = await loadCsmExtension(tenant, dup.run, dup.docs[1].Relationship, "experience", none);
    expect(v1.files.find((f) => f.grain === "channel")).toMatchObject({ used: false });
    expect(v1.experience!.channel.status).toBe("not_measured");
    expect(v1.experience!.channel.status === "not_measured" && v1.experience!.channel.reason).toMatch(/More than one latest record/);
    expect(v1.experience!.journey.status).toBe("ok");
    // A noncustomer ID that is a customer ID: the samples would merge, so the linked files are not used.
    const relId = "01100001";
    const overlap = await insertPack(db, tenant, "banking", storage.objects, { waves: [1], projectName: "Overlap", bytesOf: modified(dir, "Noncustomer", "banking", 1, { set: [{ row: 1, column: "respondent_id", value: relId }] }) });
    const v2 = await loadCsmExtension(tenant, overlap.run, overlap.docs[1].Relationship, "competitive", none);
    expect(v2.linkProblems.join(" ")).toMatch(/noncustomer ID is also a customer ID \(01100001\)/);
    expect(v2.competitive!.noncustomer.status).toBe("not_measured");
    // A comparison recorded for a different task than the journey's: Not measured with the count, never a partial mean.
    const wb = readFileSync(path.join(PACK, "banking", "test-reference", "Banking_CSM_Relationship_Wave_1.csv"), "utf8").split(/\r?\n/);
    const header = wb[0].split(",");
    const at = wb.slice(1).findIndex((line) => line.split(",")[header.indexOf("benchmark_recent_same_task30")] === "1");
    const task = Number(wb[at + 1].split(",")[header.indexOf("journey_task")]);
    const other = await insertPack(db, tenant, "banking", storage.objects, { waves: [1], projectName: "Task", bytesOf: modified(dir, "Relationship", "banking", 1, { set: [{ row: at + 1, column: "benchmark_task", value: task === 1 ? 2 : 1 }] }) });
    const v3 = (await loadCsmExtension(tenant, other.run, other.docs[1].Relationship, "competitive", none)).competitive!;
    if ("status" in v3.benchmark) throw new Error("benchmark");
    expect(v3.benchmark.customer).toMatchObject({ status: "not_measured" });
    expect(v3.benchmark.problems.join(" ")).toMatch(/1 recorded comparison is for a different type of task/);
    // No recent journey at all: Not measured with the reason, never 0%.
    const noJourney = await insertPack(db, tenant, "banking", storage.objects, { waves: [1], projectName: "NoJourney", bytesOf: modified(dir, "Relationship", "banking", 1, { setAll: { journey_recent30: 0 } }) });
    const v4 = await loadCsmExtension(tenant, noJourney.run, noJourney.docs[1].Relationship, "journey", none);
    if (v4.journey!.status !== "ok") throw new Error(JSON.stringify(v4.journey));
    expect(v4.journey!.recentShare).toMatchObject({ status: "ok", reading: { value: 0 } });
    expect(v4.journey!.completion).toMatchObject({ status: "not_measured", reason: expect.stringMatching(/No customer in this population has a recent task/) });
    expect(v4.journey!.journeyCsat.status).toBe("not_measured");
  });
});

// The Audience and Media pages' R5 additions (Grant, 30 October 2026) through the actual loaders and the actual save,
// on a real disposable PostgreSQL with the actual engine; storage is an in-memory stand-in and the model is stubbed
// (never called). The client's brand is BMW, pre-filled from the programme's name. Expected figures and test decisions
// are computed independently by src/lib/__tests__/helpers/profile_reference.py (pandas, the formulas written out
// there), never taken from the app:
//   1. BMW wave 1 (SPSS, labels only): the default cards are age, gender and income; gender, income and province
//      (added) for BMW's 13 recent acquirers and all eligible respondents equal the reference weighted and unweighted
//      to 1e-6, with their bases; income in code order with "Prefer not to say" (99) kept as an answer in the base.
//   2. The saved list: add, hide, reorder, save, reload (dashboard and figures in the saved order); two saves from the
//      same revision: the second is a conflict that returns the first's list and writes nothing; a wave of the same
//      programme whose file lacks province shows it as not in this wave's file, and saving another choice there keeps
//      it; an ineligible question is refused.
//   3. Recognition through the real reader: gender and income worded differently, as an SPSS file labels them and as
//      a CSV with a codebook; a file without income (the card says so; nothing invented).
//   4. The Media page: compared with all eligible and with Toyota's recent acquirers, every share, base and index equal
//      to the reference; each medium's significance decision equal to the hand-written two-proportion z-test; with
//      BMW's 13 acquirers no test runs and no headline is claimed.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const packPath = (n: string) => path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n);
const SAV = packPath("wave1_labels_only_compressed.sav");
const REFERENCE = path.join(process.cwd(), "src", "lib", "__tests__", "helpers", "profile_reference.py");
function py(args: string[]) {
  const r = spawnSync(PYTHON, ["-I", REFERENCE, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
type Shares = Record<string, Record<string, [number | null, number]>>;
type ProfileRef = { acquirers_n: number } & Record<"weighted" | "unweighted", { category: Shares; acquirers: Shares }>;
type MediaRef = { focal_n: number; comparison_n: number } & Record<"weighted" | "unweighted", Record<string, { focal: [number, number]; comparison: [number, number]; index: number | null; z: number | null; p: number | null; decision: string }>>;
type Audience = Awaited<ReturnType<typeof import("../trackerAudience").loadBrandAudience>>;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Audience profile questions and Media comparisons (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const dir = mkdtempSync(path.join(tmpdir(), "audience-profiles-"));
  let program = "";
  let wave1 = { run: "", doc: "" };

  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const newRun = async (name: string, programId: string | null = null) => (await q("insert into runs (tenant_id, project_name, program_id) values ($1, $2, $3) returning id", [tenant, name, programId]))[0].id as string;
  async function savProject(file: string, programId: string | null = null) {
    const run = await newRun("BMW car tracker", programId);
    return { run, doc: await stored(run, "table", "bmw.sav", readFileSync(file)) };
  }
  const variant = (kind: string) => {
    const out = path.join(dir, `${kind}.sav`);
    py(["variant", SAV, out, kind]);
    return out;
  };
  const lib = async () => ({ ...(await import("../trackerAudience")), ...(await import("../trackerDashboards")) });
  /** Saves `choices` (replacing the stored set) from the revision the dashboard now has. */
  async function saveNow(p: { run: string; doc: string }, choices: object) {
    const { loadTrackerDashboard, saveTrackerChoices } = await lib();
    const v = await loadTrackerDashboard(tenant, p.run, p.doc);
    return saveTrackerChoices(tenant, p.run, p.doc, { scope: v.scopeKey, revision: v.revision }, choices, "grant@example.com");
  }
  const card = (a: Audience, variable: string) => {
    const c = a.profiles.find((p) => (p.status === "ok" || p.status === "not_in_file") && p.variable === variable);
    if (!c || c.status !== "ok") throw new Error(`${variable}: ${c?.status ?? "no card"}`);
    return c;
  };
  /** Every answer of each card for both groups equal to the reference; returns the number of figures compared. */
  function expectProfiles(a: Audience, ref: ProfileRef["weighted"], variables: string[]) {
    let figures = 0;
    for (const variable of variables) {
      const c = card(a, variable);
      expect(c.rows.map((r) => r.key), variable).toEqual(Object.keys(ref.category[variable]));
      for (const r of c.rows) {
        for (const [got, want, what] of [
          [r.category, ref.category[variable][r.key], "category"],
          [r.acquirers, ref.acquirers[variable][r.key], "acquirers"],
        ] as const) {
          expect(got.share, `${variable} ${what} ${r.key}`).toBeCloseTo(want[0]!, 6);
          expect(got.base, `${variable} ${what} ${r.key} base`).toBe(want[1]);
          figures += 1;
        }
      }
    }
    return figures;
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    program = (await q("insert into programs (tenant_id, name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id;
    wave1 = await savProject(SAV, program);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("BMW wave 1: age, gender and income by default; gender, income and an added province equal the reference, weighted and unweighted, with bases", async () => {
    const ref: ProfileRef = py(["profiles", SAV, "bought12_b08", "gender", "income", "province"]);
    expect(ref.acquirers_n).toBe(13);
    const { loadBrandAudience } = await lib();
    const before = Number((await q("select count(*)::int as n from document_tables where run_id = $1", [wave1.run]))[0].n);
    const a = await loadBrandAudience(tenant, wave1.run, wave1.doc);
    expect(Number((await q("select count(*)::int as n from document_tables where run_id = $1", [wave1.run]))[0].n)).toBe(before);
    expect(a.profilesSource).toBe("suggested");
    expect(a.profiles.map((p) => [p.role, p.status, p.status === "ok" ? p.variable : null])).toEqual([
      ["age", "ok", "age_band"],
      ["gender", "ok", "gender"],
      ["income", "ok", "income"],
    ]);
    expect(a.acquirers).toMatchObject({ status: "ok", n: 13, level: "very_small" });
    expect(expectProfiles(a, ref.weighted, ["gender", "income"])).toBe(2 * (4 + 6));
    // Income bands in the file's code order; "Prefer not to say" is an answer of its own, in the base.
    expect(card(a, "income").rows.map((r) => r.label)).toEqual(["Below R15,000", "R15,000–R29,999", "R30,000–R49,999", "R50,000–R79,999", "R80,000 or more", "Prefer not to say"]);
    expect(a.profileQuestions.map((x) => x.variable)).toEqual(expect.arrayContaining(["province", "settlement", "life_stage"]));

    const list = [{ role: "age" }, { role: "gender" }, { role: "income" }, { role: null, variable: "province", label: "Province" }];
    expect(await saveNow(wave1, { audienceProfiles: list })).toMatchObject({ saved: true });
    const withProvince = await loadBrandAudience(tenant, wave1.run, wave1.doc);
    expect(withProvince.profilesSource).toBe("chosen");
    expect(expectProfiles(withProvince, ref.weighted, ["gender", "income", "province"])).toBe(2 * (4 + 6 + 9));
    expect(await saveNow(wave1, { audienceProfiles: list, weighted: false })).toMatchObject({ saved: true });
    const unweighted = await loadBrandAudience(tenant, wave1.run, wave1.doc);
    expect(unweighted.weighted).toBe(false);
    expect(expectProfiles(unweighted, ref.unweighted, ["gender", "income", "province"])).toBe(38);
    expect(await saveNow(wave1, {})).toMatchObject({ saved: true });
  });

  it("the saved list: add, hide, reorder, save and reload; a concurrent save is a conflict; a wave without the question keeps it; an ineligible question is refused", async () => {
    const { loadBrandAudience, loadTrackerDashboard, saveTrackerChoices } = await lib();
    // Gender hidden, income moved first, province and settlement added.
    const list = [{ role: "income" }, { role: "age" }, { role: null, variable: "province", label: "Province" }, { role: null, variable: "settlement", label: "Settlement" }];
    const v = await loadTrackerDashboard(tenant, wave1.run, wave1.doc);
    const expected = { scope: v.scopeKey, revision: v.revision };
    expect(await saveTrackerChoices(tenant, wave1.run, wave1.doc, expected, { audienceProfiles: list }, "a@example.com")).toMatchObject({ saved: true });
    // A second save from the same revision (another screen): refused, given the current list, nothing written.
    const other = [{ role: "age" }];
    const lost = await saveTrackerChoices(tenant, wave1.run, wave1.doc, expected, { audienceProfiles: other }, "b@example.com");
    expect(lost).toMatchObject({ saved: false, reason: "conflict", current: { choices: { audienceProfiles: [{ role: "income" }, { role: "age" }, { variable: "province" }, { variable: "settlement" }] } } });
    const reloaded = await loadTrackerDashboard(tenant, wave1.run, wave1.doc);
    expect(reloaded.revision).toBe((expected.revision ?? 0) + 1);
    const order = (p: { status: string; role: string | null; variable?: string }) => (p.status === "ok" ? p.variable : p.role);
    expect(reloaded.dashboard.audienceProfiles.map(order)).toEqual(["income", "age_band", "province", "settlement"]);
    const a = await loadBrandAudience(tenant, wave1.run, wave1.doc);
    expect(a.profiles.map(order)).toEqual(["income", "age_band", "province", "settlement"]);
    expect(card(a, "settlement").rows.map((r) => r.label)).toEqual(["Metro or city", "Town", "Rural area"]);

    // Wave 2 of the programme, its file without province: shown as not in this wave's file, never dropped.
    const wave2 = await savProject(variant("no_province"), program);
    const w2 = await loadBrandAudience(tenant, wave2.run, wave2.doc);
    expect(w2.profiles.find((p) => p.status === "not_in_file")).toEqual({ status: "not_in_file", role: null, variable: "province", label: "Province", source: "chosen" });
    expect(card(w2, "settlement").rows.length).toBe(3);
    // Saving another choice from wave 2 with the list unchanged keeps province; adding it anew there is refused.
    expect(await saveNow(wave2, { audienceProfiles: list, weighted: false })).toMatchObject({ saved: true });
    expect((await loadTrackerDashboard(tenant, wave1.run, wave1.doc)).dashboard.audienceProfiles.map(order)).toEqual(["income", "age_band", "province", "settlement"]);
    expect(await saveNow(wave2, { audienceProfiles: [{ role: null, variable: "province", label: "Province" }] })).toMatchObject({ saved: true });
    expect(await saveNow(wave2, { audienceProfiles: [{ role: null, variable: "life_stage", label: "x" }, { role: null, variable: "province", label: "Province" }] })).toMatchObject({ saved: true });
    await saveNow(wave1, {});
    expect(await saveNow(wave2, { audienceProfiles: [{ role: null, variable: "province", label: "Province" }] })).toEqual({ saved: false, reason: "invalid", problems: ["province is not a single-choice question asked once in this file, so it cannot be a profile question."] });
    expect(await saveNow(wave1, { audienceProfiles: [{ role: null, variable: "bought12_b08", label: "x" }] })).toMatchObject({ saved: false, reason: "invalid" });
    await saveNow(wave1, {});
  });

  it("recognition through the real reader: gender and income in other words (SPSS labels, and a CSV with its codebook); a file without income", async () => {
    const { loadBrandAudience } = await lib();
    const reworded = variant("reworded");
    const sav = await savProject(reworded);
    const a = await loadBrandAudience(tenant, sav.run, sav.doc);
    expect(a.profiles.map((p) => (p.status === "ok" ? [p.role, p.variable, p.label] : [p.role, p.status]))).toEqual([
      ["age", "age_band", "Age group"],
      ["gender", "gender", "Sex of respondent"],
      ["income", "income", "Total household earnings per month"],
    ]);
    const ref: ProfileRef = py(["profiles", reworded, "bought12_b08", "gender", "income"]);
    expect(expectProfiles(a, ref.weighted, ["gender", "income"])).toBe(20);
    expect(card(a, "income").rows.map((r) => r.label)).toEqual(["R0 - R14 999", "R15 000 to R29 999", "R30 000 to R49 999", "R50 000 to R79 999", "R80 000+", "Refused"]);

    // The CSV-codebook form: the pack's first 60 respondents with metadata.json reworded the same way.
    const run = await newRun("BMW car tracker");
    const cbFile = path.join(dir, "metadata_reworded.json");
    py(["codebook", packPath("metadata.json"), cbFile]);
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored(run, "instrument", "metadata.json", readFileSync(cbFile), "codebook");
    const data = await stored(run, "table", "Car_Brand_Tracker_Wave_1.csv", readFileSync(packPath("wave1_first60.csv")));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    const csv = await loadBrandAudience(tenant, run, data);
    expect(csv.profiles.map((p) => (p.status === "ok" ? [p.role, p.variable, p.label] : [p.role, p.status]))).toEqual([
      ["age", "age_band", "Age group"],
      ["gender", "gender", "Sex of respondent"],
      ["income", "income", "Total household earnings per month"],
    ]);

    const noIncome = await savProject(variant("no_income"));
    const n = await loadBrandAudience(tenant, noIncome.run, noIncome.doc);
    expect(n.profiles[2]).toEqual({ status: "not_found", role: "income", reason: expect.stringMatching(/No question asked once whose wording names income/), source: "suggested" });
    expect(n.profiles.map((p) => p.status)).toEqual(["ok", "ok", "not_found"]);
    expect(n.profileQuestions.some((x) => x.variable === "income")).toBe(false);
  });

  it("Media page: against all eligible and against Toyota's recent acquirers, shares, bases and index equal the reference; each decision equals the hand-written z-test; small bases claim nothing", async () => {
    const { loadBrandMedia } = await lib();
    const large = variant("large");
    const p = await savProject(large);
    const check = (m: Awaited<ReturnType<typeof loadBrandMedia>>, ref: MediaRef["weighted"]) => {
      if (m.media.status !== "ok") throw new Error(m.media.reason);
      expect(m.media.test.ran).toBe(true);
      expect(m.media.rows.map((r) => r.key)).toEqual(Object.keys(ref));
      for (const r of m.media.rows) {
        const want = ref[r.key];
        expect(r.focal.share, `${r.key} focal`).toBeCloseTo(want.focal[0], 6);
        expect(r.focal.base).toBe(want.focal[1]);
        expect(r.comparison.share, `${r.key} comparison`).toBeCloseTo(want.comparison[0], 6);
        expect(r.comparison.base).toBe(want.comparison[1]);
        expect(r.test.status, `${r.key} decision (z ${want.z?.toFixed(3)}, p ${want.p?.toFixed(4)})`).toBe(want.decision);
      }
      return m.media.rows;
    };
    const { mediaIndex, mediaHeadline } = await import("../trackerAudienceFigures");

    const refCategory: MediaRef = py(["media", large, "bought12_b08"]);
    const all = await loadBrandMedia(tenant, p.run, p.doc, null);
    expect(all.acquirers).toMatchObject({ status: "ok", n: 360, level: "ok" });
    const rowsAll = check(all, refCategory.weighted);
    expect(rowsAll.filter((r) => r.test.status !== "no_difference").map((r) => [r.key, r.test.status])).toEqual([
      ["media_m03", "higher"],
      ["media_m12", "higher"],
    ]);
    for (const r of rowsAll) expect(mediaIndex(r, "ok", "ok").index!).toBeCloseTo(refCategory.weighted[r.key].index!, 6);
    expect(mediaHeadline(rowsAll, "BMW recent acquirers", "all eligible category respondents", "ok", "ok", true)?.higher).toEqual(["media_m03", "media_m12"]);

    const refToyota: MediaRef = py(["media", large, "bought12_b08", "bought12_b01"]);
    const toyota = await loadBrandMedia(tenant, p.run, p.doc, "1");
    expect(toyota.comparison).toMatchObject({ kind: "brand", group: { status: "ok", brand: { code: "1", label: "Toyota" }, variable: "bought12_b01", n: 200, level: "ok" } });
    expect(toyota.comparisonBrands.map((b) => b.label)).toContain("Toyota");
    expect(toyota.comparisonBrands.map((b) => b.label)).not.toContain("BMW");
    const rowsToyota = check(toyota, refToyota.weighted);
    // The boundary case: X (media_m05) is lower at z near -1.97 (p just under 0.05).
    expect(refToyota.weighted.media_m05.p!).toBeLessThan(0.05);
    expect(rowsToyota.find((r) => r.key === "media_m05")!.test.status).toBe("lower");
    for (const r of rowsToyota) expect(mediaIndex(r, "ok", "ok").index!).toBeCloseTo(refToyota.weighted[r.key].index!, 6);

    // Unweighted (the researcher's choice): the reference's unweighted figures and decisions.
    expect(await saveNow(p, { weighted: false })).toMatchObject({ saved: true });
    check(await loadBrandMedia(tenant, p.run, p.doc, "1"), refToyota.unweighted);
    check(await loadBrandMedia(tenant, p.run, p.doc, null), refCategory.unweighted);

    // BMW wave 1: 13 acquirers. Compared with Toyota (56): the comparison's base shown; no test, no headline, no index.
    const small = await loadBrandMedia(tenant, wave1.run, wave1.doc, "1");
    expect(small.comparison).toMatchObject({ kind: "brand", group: { status: "ok", n: 56, level: "ok" } });
    if (small.media.status !== "ok") throw new Error(small.media.reason);
    expect(small.media.test).toEqual({ ran: false, reason: "No test: a group has fewer than 50 respondents." });
    expect(small.media.rows.every((r) => r.test.status === "untested")).toBe(true);
    expect(mediaHeadline(small.media.rows, "BMW", "Toyota", "very_small", "ok", small.media.test.ran)).toBeNull();
    // A brand code the file's brand list lacks: the comparison says so; the focal figures still shown.
    const unknown = await loadBrandMedia(tenant, wave1.run, wave1.doc, "77");
    expect(unknown.comparison).toEqual({ kind: "brand", group: { status: "not_measured", reason: "Brand code 77 is not in this file's brand list." } });
    if (unknown.media.status !== "ok") throw new Error(unknown.media.reason);
    expect(unknown.media.rows.every((r) => r.focal.share !== null && r.comparison.share === null)).toBe(true);
  });
});

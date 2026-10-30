// Codex BH-F02 (independent D3c review, 30 October 2026): a loyalty (NPS) brand group the NPS tool could not score
// disappeared from the Brand Health dashboard without its base or a reason. Through the module's public action
// (buildBrandHealthDashboardAction) with the actual engine on a real disposable PostgreSQL database; storage is an
// in-memory stand-in and the model is never called. Grant's synthetic BMW pack (wave 1's first 60 rows as CSV,
// metadata.json as the codebook), with variants made here. Expected counts and scores are computed in this file from
// the CSV rows, independently of the app: a brand group is the respondents with owner_bX = 1; a valid answer is a
// non-blank nps_main; NPS is the weighted share answering 9 or 10 minus the share answering 0 to 6; the engine
// shows no figure for a group under 10 valid answers.
//   1. Fewer than ten valid answers (Volkswagen 6, BMW 5, ...): an unavailable row with the group's respondents,
//      valid answers and "Suppressed for a small base", never a score; a calculable group (Toyota 15, Suzuki 10)
//      equal to the independent NPS; every brand of the set exactly once.
//   2. Zero owners (nobody owns Haval in the variant): "No respondents in this brand's group", counts 0; an attribute
//      split by the same groups has no Haval figure on a base of 0 and the dashboard is still built.
//   3. Owners with no valid NPS (every Toyota owner's answer blank): "None of the 15 respondents ...".
//   4. Recovery: once Volkswagen's group grows to ten valid answers, it has its NPS, equal to the independent value.
//   5. A brand variable (main_brand): the categories under ten valid answers are unavailable rows with their counts.
// Skipped, with the reason, without a test database or python3 + pandas/openpyxl.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import type { BrandHealthDashboard, BrandHealthMapping } from "../brandHealthActions";

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

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
const pack = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", name));
const BRANDS = ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"];
const member = (i: number) => `owner_b${String(i + 1).padStart(2, "0")}`;

// The CSV rows, read and changed here without the app (the pack's CSV has no quoted fields).
type Row = Record<string, string>;
const lines = pack("wave1_first60.csv").toString("utf8").trim().split(/\r?\n/);
const header = lines[0].split(",");
const ORIGINAL: Row[] = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as Row);
const toCsv = (rows: Row[]) => Buffer.from([header.join(","), ...rows.map((r) => header.map((h) => r[h]).join(","))].join("\n") + "\n");

const owners = (rows: Row[], i: number) => rows.filter((r) => r[member(i)] === "1");
const valid = (rows: Row[]) => rows.filter((r) => r.nps_main !== "").map((r) => ({ w: Number(r.weight), x: Number(r.nps_main) }));
const share = (cs: { w: number; x: number }[], ok: (x: number) => boolean) => (100 * cs.filter((c) => ok(c.x)).reduce((s, c) => s + c.w, 0)) / cs.reduce((s, c) => s + c.w, 0);
const npsOf = (rows: Row[]) => Math.round((share(valid(rows), (x) => x >= 9) - share(valid(rows), (x) => x <= 6)) * 10) / 10;

const setMapping = (): BrandHealthMapping => ({
  brandVar: null,
  brandSet: "owner",
  ourBrand: "owner_b01",
  funnel: {},
  attributes: [],
  loyaltyVar: "nps_main",
  moments: [],
  positioning: { xVar: null, yVar: null },
});

/** Every brand of the set is either scored or unavailable, once; a suppressed group never carries a score. */
function expectEveryBrandOnce(loyalty: NonNullable<BrandHealthDashboard["loyalty"]>) {
  const scored = loyalty.byBrand.map((b) => b.brand);
  const unavailable = (loyalty.unavailable ?? []).map((u) => u.brand);
  expect([...scored, ...unavailable].sort()).toEqual([...BRANDS].sort());
  expect(scored.filter((b) => unavailable.includes(b))).toEqual([]);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Brand Health loyalty: groups without an NPS are kept with their counts and reason (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  /** A data file of these rows with the pack's codebook linked, in a project of its own. */
  async function dataFile(rows: Row[]) {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id as string;
    const stored = async (kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) => {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, bytes);
      return (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
      ))[0].id as string;
    };
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const codebook = await stored("instrument", "metadata.json", pack("metadata.json"), "codebook");
    const data = await stored("table", "Car_Brand_Tracker_Wave_1.csv", toCsv(rows));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    return { run, data };
  }
  async function dashboardOf(rows: Row[], mapping: BrandHealthMapping = setMapping()) {
    const { run, data } = await dataFile(rows);
    const { buildBrandHealthDashboardAction } = await import("../brandHealthActions");
    const res = await buildBrandHealthDashboardAction(run, data, mapping);
    if (!res.ok) throw new Error(res.error);
    expect(res.dashboard.loyalty, JSON.stringify(res.dashboard.withheld)).not.toBeNull();
    return res.dashboard;
  }
  const loyaltyOf = async (rows: Row[], mapping?: BrandHealthMapping) => (await dashboardOf(rows, mapping)).loyalty!;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("fewer than ten valid answers: an unavailable row with its counts and reason, never a score; calculable groups equal the independent NPS", async () => {
    const loyalty = await loyaltyOf(ORIGINAL);
    expectEveryBrandOnce(loyalty);
    for (let i = 0; i < BRANDS.length; i++) {
      const group = owners(ORIGINAL, i);
      const n = valid(group).length;
      if (n >= 10) {
        expect(loyalty.byBrand.find((b) => b.brand === BRANDS[i])!.nps, BRANDS[i]).toBe(npsOf(group));
      } else {
        expect(loyalty.unavailable!.find((u) => u.brand === BRANDS[i]), BRANDS[i]).toEqual({
          brand: BRANDS[i],
          groupN: group.length,
          validAnswers: n,
          reason: `Suppressed for a small base: ${n} valid answer${n === 1 ? "" : "s"} in this brand's group.`,
        });
      }
    }
    // The review's case: Volkswagen, six owners with a valid answer.
    expect(loyalty.unavailable!.find((u) => u.brand === "Volkswagen")).toMatchObject({ groupN: 6, validAnswers: 6 });
    expect(loyalty.byBrand.map((b) => b.brand)).toEqual(["Toyota", "Suzuki"]);
  });

  it("zero owners and owners with no valid NPS are told apart, each with its counts", async () => {
    const rows = ORIGINAL.map((r) => ({ ...r, owner_b10: "0", nps_main: r.owner_b01 === "1" ? "" : r.nps_main }));
    expect(owners(rows, 9)).toHaveLength(0);
    expect(owners(rows, 0)).toHaveLength(15);
    // An attribute split by the same groups: the empty group has no figure on a base of 0 (the engine refuses a
    // one-group banner, so it is not asked), and the dashboard is still built.
    const d = await dashboardOf(rows, { ...setMapping(), attributes: [{ variable: "nps_main", metric: "mean" }] });
    expect(d.attributes[0].byBrand.find((b) => b.brand === "Haval")).toEqual({ brand: "Haval", value: null, exact: null, n: 0 });
    const loyalty = d.loyalty!;
    expectEveryBrandOnce(loyalty);
    expect(loyalty.unavailable!.find((u) => u.brand === "Haval")).toEqual({ brand: "Haval", groupN: 0, validAnswers: 0, reason: "No respondents in this brand's group." });
    expect(loyalty.unavailable!.find((u) => u.brand === "Toyota")).toEqual({
      brand: "Toyota",
      groupN: 15,
      validAnswers: 0,
      reason: "None of the 15 respondents in this brand's group gave a valid answer.",
    });
  });

  it("recovery: once Volkswagen's group grows to ten valid answers it has its NPS, equal to the independent value", async () => {
    let added = 0;
    const rows = ORIGINAL.map((r) => {
      if (added < 4 && r.owner_b02 !== "1" && r.nps_main !== "") {
        added += 1;
        return { ...r, owner_b02: "1" };
      }
      return r;
    });
    const group = owners(rows, 1);
    expect(valid(group)).toHaveLength(10);
    const loyalty = await loyaltyOf(rows);
    expectEveryBrandOnce(loyalty);
    expect(loyalty.byBrand.find((b) => b.brand === "Volkswagen")!.nps).toBe(npsOf(group));
    expect(loyalty.unavailable!.some((u) => u.brand === "Volkswagen")).toBe(false);
  });

  it("a brand variable: the categories the NPS tool cannot score are unavailable rows with their counts", async () => {
    const loyalty = await loyaltyOf(ORIGINAL, { ...setMapping(), brandSet: null, brandVar: "main_brand", ourBrand: "Toyota" });
    const byMain = (code: number) => ORIGINAL.filter((r) => r.main_brand === String(code));
    expect(loyalty.byBrand.map((b) => b.brand).sort()).toEqual(["Suzuki", "Toyota"]);
    expect(loyalty.byBrand.find((b) => b.brand === "Toyota")!.nps).toBe(npsOf(byMain(1)));
    const expected = BRANDS.map((brand, i) => ({ brand, rows: byMain(i + 1) }))
      .filter(({ rows }) => rows.length > 0 && valid(rows).length < 10)
      .map(({ brand, rows }) => ({ brand, groupN: rows.length, validAnswers: valid(rows).length }));
    expect(loyalty.unavailable!.map(({ brand, groupN, validAnswers }) => ({ brand, groupN, validAnswers })).sort((a, b) => a.brand.localeCompare(b.brand))).toEqual(
      expected.sort((a, b) => a.brand.localeCompare(b.brand)),
    );
    expect(loyalty.unavailable!.every((u) => u.reason.startsWith("Suppressed for a small base"))).toBe(true);
  });
});

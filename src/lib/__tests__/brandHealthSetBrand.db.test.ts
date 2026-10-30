// Brand Health with a brand set as the brand source (Grant, 29 October 2026, the BMW car tracker: "make Brand
// variable accept a set such as owner_b ... a household owning two brands would count in both brand groups").
// Grant's synthetic BMW pack (fixtures/tracker-packs/bmw_car: wave 1's first 60 rows as CSV, metadata.json as the
// codebook) goes through the module's public actions (save, load, build, post a finding) with the local engine and
// a real disposable database; storage is an in-memory stand-in and the model is never called.
// Expected figures are computed in this file from the CSV rows, independently of the app:
//   - a plain question within brand X's group is read among respondents with owner_bX = 1, weighted by the file's
//     weight; a weighted mean is sum(w * x) / sum(w); NPS is the weighted share answering 9 or 10 minus the share
//     answering 0 to 6; the reported base is the Kish effective base (sum w)^2 / sum(w^2), rounded;
//   - a group under 10 answering cases is suppressed by the engine (no value), its base still reported;
//   - respondent 01000008 owns Toyota and Volkswagen and is in both groups.
// Boundary: a mapping with the plain brand variable main_brand reads as before (exclusive groups, no overlap note),
// including one saved before brand sets existed. Failure: a set that does not exist, a set that is not
// multiple-response, our brand outside the set, both a variable and a set: each refused with the reason and nothing
// saved over the previous mapping.
// Skipped, with the reason, without a test database or python3 + pandas/openpyxl.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import type { BrandHealthMapping } from "../brandHealthActions";

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

// The CSV rows, read here without the app (the pack's CSV has no quoted fields).
const lines = pack("wave1_first60.csv").toString("utf8").trim().split(/\r?\n/);
const header = lines[0].split(",");
const ROWS = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as Record<string, string>);

type Case = { id: string; w: number; x: number };
const answering = (inGroup: (r: Record<string, string>) => boolean, variable: string): Case[] =>
  ROWS.filter((r) => inGroup(r) && r[variable] !== "").map((r) => ({ id: r.respondent_id, w: Number(r.weight), x: Number(r[variable]) }));
const weightedMean = (cs: Case[]) => cs.reduce((s, c) => s + c.w * c.x, 0) / cs.reduce((s, c) => s + c.w, 0);
const kish = (cs: Case[]) => cs.reduce((s, c) => s + c.w, 0) ** 2 / cs.reduce((s, c) => s + c.w * c.w, 0);
const share = (cs: Case[], ok: (x: number) => boolean) => (100 * cs.filter((c) => ok(c.x)).reduce((s, c) => s + c.w, 0)) / cs.reduce((s, c) => s + c.w, 0);
const nps = (cs: Case[]) => share(cs, (x) => x >= 9) - share(cs, (x) => x <= 6);
const round1 = (x: number) => Math.round(x * 10) / 10;
const owns = (i: number) => (r: Record<string, string>) => r[member(i)] === "1";
const mainBrand = (i: number) => (r: Record<string, string>) => r.main_brand === String(i + 1);

function setMapping(over: Partial<BrandHealthMapping> = {}): BrandHealthMapping {
  return {
    brandVar: null,
    brandSet: "owner",
    ourBrand: "owner_b08",
    funnel: { awareness: { setKey: "aware" } },
    attributes: [{ variable: "nps_main", metric: "mean" }],
    loyaltyVar: "nps_main",
    moments: [],
    positioning: { xVar: null, yVar: null },
    ...over,
  };
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Brand Health with a brand set as the brand source (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  let data = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
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
    data = await stored("table", "Car_Brand_Tracker_Wave_1.csv", pack("wave1_first60.csv"));
    await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("the set's members are the brands, identified by member variable; a saved set mapping reloads with the set", async () => {
    const { loadBrandSetMembersAction, saveBrandHealthModuleAction, loadBrandHealthModuleAction } = await import("../brandHealthActions");
    const members = await loadBrandSetMembersAction(run, data, "owner");
    expect(members).toEqual({ ok: true, setLabel: "owner_b", members: BRANDS.map((brand, i) => ({ variable: member(i), brand })) });

    expect(await saveBrandHealthModuleAction(run, data, setMapping())).toEqual({ ok: true });
    const loaded = await loadBrandHealthModuleAction(run, data);
    expect(loaded).toEqual({ ok: true, mapping: setMapping() });
  });

  it("a plain question split by the set: each brand's group is its owners, overlapping, matching the CSV rows", async () => {
    const { buildBrandHealthDashboardAction } = await import("../brandHealthActions");
    const started = Date.now();
    const res = await buildBrandHealthDashboardAction(run, data, setMapping());
    const elapsedMs = Date.now() - started;
    if (!res.ok) throw new Error(res.error);
    const d = res.dashboard;
    console.log(`brand set dashboard built in ${elapsedMs} ms`);

    expect(d.brandSet).toBe("owner");
    expect(d.brandVar).toBeNull();
    expect(d.ourBrand).toBe("BMW");
    expect(d.ourBrandVariable).toBe("owner_b08");
    expect(d.brandMembers?.map((m) => m.brand)).toEqual(BRANDS);
    expect(d.groupsOverlap).toBe(true);
    expect(d.overlapNote).toBe(
      "Brands come from a multiple-response question (owner_b): a respondent in more than one brand's group is counted in each, so groups overlap and do not sum to the total.",
    );
    expect(d.withheld.map((w) => w.figure)).toEqual(["Tests across brand groups (significance between brands, NPS brand versus the rest)"]);

    // The attribute: mean of nps_main within each brand's owners.
    const attr = d.attributes[0];
    expect(attr.brandSplit).toBe("brand_groups");
    expect(attr.byBrand.map((b) => b.brand)).toEqual(BRANDS);
    for (let i = 0; i < BRANDS.length; i++) {
      const cases = answering(owns(i), "nps_main");
      const got = attr.byBrand[i];
      expect(got.n, BRANDS[i]).toBe(Math.round(kish(cases)));
      if (cases.length < 10) expect(got.value, `${BRANDS[i]} suppressed`).toBeNull();
      else expect(got.exact!, BRANDS[i]).toBeCloseTo(weightedMean(cases), 9);
    }
    // Toyota (15 owners) is computed with 01000008, who also owns Volkswagen; without that respondent the mean differs.
    const toyota = answering(owns(0), "nps_main");
    const volkswagen = answering(owns(1), "nps_main");
    expect(toyota.map((c) => c.id)).toContain("01000008");
    expect(volkswagen.map((c) => c.id)).toContain("01000008");
    // (the engine matches the full group to 9 decimals, so a difference of 1e-6 is decisive)
    expect(Math.abs(weightedMean(toyota.filter((c) => c.id !== "01000008")) - attr.byBrand[0].exact!)).toBeGreaterThan(1e-6);
    // Volkswagen's group is too small to show a mean, but its base counts 01000008 too.
    expect(attr.byBrand[1].n).toBe(Math.round(kish(volkswagen)));
    expect(Math.round(kish(volkswagen.filter((c) => c.id !== "01000008")))).not.toBe(attr.byBrand[1].n);
    // The groups overlap: their answering cases add up to more than the people answering.
    const groupIds = BRANDS.flatMap((_, i) => answering(owns(i), "nps_main").map((c) => c.id));
    expect(groupIds.length).toBeGreaterThan(new Set(groupIds).size);

    // Loyalty: NPS within each brand's owners, through the NPS tool.
    const toyotaNps = d.loyalty!.byBrand.find((b) => b.brand === "Toyota")!;
    // The NPS tool reports NPS to one decimal.
    expect(toyotaNps.nps).toBe(round1(nps(toyota)));
    const suzuki = answering(owns(6), "nps_main");
    expect(suzuki.filter((c) => ["01000036", "01000038", "01000050"].includes(c.id))).toHaveLength(3);
    expect(d.loyalty!.byBrand.find((b) => b.brand === "Suzuki")!.nps).toBe(round1(nps(suzuki)));

    // The awareness stage comes from per-brand columns (aware_b01..b10), not from brand groups: each brand's share
    // is everyone's, as with a brand variable.
    const aware = d.funnel[0];
    expect(aware.brandSplit).toBe("brand_columns");
    for (let i = 0; i < BRANDS.length; i++) {
      const cases = answering(() => true, `aware_b${String(i + 1).padStart(2, "0")}`);
      expect(aware.byBrand[i].brand).toBe(BRANDS[i]);
      expect(aware.byBrand[i].exact!).toBeCloseTo(share(cases, (x) => x === 1), 9);
    }
  });

  it("a posted finding carries the overlap note and the overlap caveat", async () => {
    const { buildBrandHealthDashboardAction, addBrandHealthFindingAction } = await import("../brandHealthActions");
    const res = await buildBrandHealthDashboardAction(run, data, setMapping());
    if (!res.ok) throw new Error(res.error);
    expect(await addBrandHealthFindingAction(run, data, res.dashboard, "attributes")).toEqual({ ok: true, added: true });
    expect(await addBrandHealthFindingAction(run, data, res.dashboard, "funnel")).toEqual({ ok: true, added: true });
    const rows = await q(
      `select stated_stats->>'section' as section, finding_text, stated_stats->'caveats' as caveats, stated_stats->>'brandSet' as brand_set
       from findings where run_id = $1 and stated_stats->>'source' = 'brand_health_tool' order by 1`,
      [run],
    );
    const attributes = rows.find((r) => r.section === "attributes")!;
    expect(attributes.finding_text).toContain("groups overlap and do not sum to the total");
    expect(attributes.caveats).toContain("brand_groups_overlap");
    expect(attributes.brand_set).toBe("owner");
    // The funnel here is read from per-brand columns only, so it is not split by the overlapping groups.
    const funnel = rows.find((r) => r.section === "funnel")!;
    expect(funnel.caveats).not.toContain("brand_groups_overlap");
    expect(funnel.finding_text).not.toContain("overlap");
  });

  it("boundary: a plain brand variable reads exclusive groups as before, including a mapping saved before brand sets", async () => {
    const { buildBrandHealthDashboardAction, loadBrandHealthModuleAction } = await import("../brandHealthActions");
    // Saved the way a mapping was saved before 29 October 2026: no brandSet field at all.
    const legacy = { brandVar: "main_brand", ourBrand: "BMW", funnel: {}, attributes: [{ variable: "nps_main", metric: "mean" }], loyaltyVar: null, moments: [], positioning: { xVar: null, yVar: null } };
    await q(
      `insert into brand_health_modules (tenant_id, run_id, document_id, mapping) values ($4, $1, $2, $3)
       on conflict (document_id) do update set mapping = $3`,
      [run, data, JSON.stringify(legacy), tenant],
    );
    const loaded = await loadBrandHealthModuleAction(run, data);
    expect(loaded).toEqual({ ok: true, mapping: { ...legacy, brandSet: null } });
    if (!loaded.ok || !loaded.mapping) throw new Error("not loaded");
    const res = await buildBrandHealthDashboardAction(run, data, loaded.mapping);
    if (!res.ok) throw new Error(res.error);
    const d = res.dashboard;
    expect(d.brandVar).toBe("main_brand");
    expect(d.brandSet).toBeNull();
    expect(d.groupsOverlap).toBe(false);
    expect(d.overlapNote).toBeNull();
    expect(d.withheld).toEqual([]);
    expect(d.ourBrand).toBe("BMW");
    const toyota = d.attributes[0].byBrand.find((b) => b.brand === "Toyota")!;
    expect(toyota.exact!).toBeCloseTo(weightedMean(answering(mainBrand(0), "nps_main")), 9);
    expect(toyota.n).toBe(Math.round(kish(answering(mainBrand(0), "nps_main"))));
  });

  it("failure: a set that does not exist, is not multiple-response, or does not hold our brand is refused and nothing is saved", async () => {
    const { buildBrandHealthDashboardAction, saveBrandHealthModuleAction, loadBrandHealthModuleAction, loadBrandSetMembersAction } = await import("../brandHealthActions");
    const before = await q(`select mapping, updated_at from brand_health_modules where run_id = $1 and document_id = $2`, [run, data]);

    const missing = await saveBrandHealthModuleAction(run, data, setMapping({ brandSet: "owner_x" }));
    expect(missing).toEqual({ ok: false, error: 'The brand set "owner_x" was not found in this file.' });
    expect(await buildBrandHealthDashboardAction(run, data, setMapping({ brandSet: "owner_x" }))).toEqual(missing);
    expect(await loadBrandSetMembersAction(run, data, "owner_x")).toEqual(missing);

    const notOurs = await saveBrandHealthModuleAction(run, data, setMapping({ ourBrand: "aware_b08" }));
    expect(notOurs).toEqual({ ok: false, error: 'Our brand (aware_b08) is not a member of the brand set "owner_b".' });

    const both = await saveBrandHealthModuleAction(run, data, setMapping({ brandVar: "main_brand" }));
    expect(both.ok).toBe(false);
    expect(!both.ok && both.error).toContain("names both a brand variable and a brand set");

    // A set the dictionary lists that is not a multiple-response set (the pack has batteries and grids).
    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary(tenant, run, data);
    const notMulti = dict.sets?.find((s) => s.kind === "battery" || s.kind === "grid");
    expect(notMulti).toBeDefined();
    const refused = await saveBrandHealthModuleAction(run, data, setMapping({ brandSet: notMulti!.key, ourBrand: null }));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("is not a multiple-response set");

    // The previous mapping is untouched and still loads.
    const after = await q(`select mapping, updated_at from brand_health_modules where run_id = $1 and document_id = $2`, [run, data]);
    expect(after).toEqual(before);
    expect((await loadBrandHealthModuleAction(run, data)).ok).toBe(true);

    // An unreadable saved mapping is reported, never read as an empty one.
    await q(`update brand_health_modules set mapping = $3 where run_id = $1 and document_id = $2`, [run, data, JSON.stringify({ brandVar: "main_brand", brandSet: "owner", ourBrand: null })]);
    const unreadable = await loadBrandHealthModuleAction(run, data);
    expect(unreadable.ok).toBe(false);
    expect(!unreadable.ok && unreadable.error).toContain("names both a brand variable and a brand set");
  });
});

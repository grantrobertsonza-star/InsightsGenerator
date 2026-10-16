// Pre-insights slide deck (Codex review 2026-10-16): the ACTUAL route against a REAL PostgreSQL
// (disposable database, the app's own db.ts). The earlier deck returned 500 whenever a pre-insight's
// finding had a verdict tier it did not map, and joined every verdict, so a re-verified finding
// appeared once per verdict.
//   - mixed: robust and use-with-caution pre-insights are shown with their labels and sources;
//     not-supported, insufficient-information, rejected and unverified ones are listed under
//     "Not included" with the reason and source; a re-verified finding uses its LATEST verdict and
//     appears once
//   - empty project and all-excluded project both export (200) with an explanatory slide
//   - the placement rule labels every tier and never throws on an unrecognised one
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set (the placement cases still run).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { placePreInsight } from "../preInsightDeckEligibility";

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/preInsightDeckEligibility", async () => await import("../preInsightDeckEligibility"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

const TENANT = "00000000-0000-4000-8000-0000000000f1";

async function pptxSlides(res: Response): Promise<string[]> {
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  return xml.map((x) => x.replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
}

describe("pre-insight deck placement rule", () => {
  it("labels both supported tiers and excludes every other state with a reason, without throwing", () => {
    expect(placePreInsight({ verdict_tier: "robust", finding_status: "accepted" })).toMatchObject({ include: true, label: "Robust" });
    expect(placePreInsight({ verdict_tier: "use_with_caution", finding_status: null })).toMatchObject({ include: true, label: "Use with caution" });
    expect(placePreInsight({ verdict_tier: "not_supported", finding_status: "accepted" })).toMatchObject({ include: false, reason: expect.stringMatching(/no longer supported/) });
    expect(placePreInsight({ verdict_tier: "insufficient_information", finding_status: "accepted" })).toMatchObject({ include: false });
    expect(placePreInsight({ verdict_tier: "robust", finding_status: "rejected" })).toMatchObject({ include: false, reason: "its finding was rejected" });
    expect(placePreInsight({ verdict_tier: null, finding_status: "accepted" })).toMatchObject({ include: false, reason: expect.stringMatching(/no verification verdict/) });
    expect(placePreInsight({ verdict_tier: "something_new", finding_status: "accepted" })).toMatchObject({ include: false, reason: expect.stringMatching(/unrecognised verdict/) });
  });
});

describe.skipIf(!TEST_DATABASE_URL)("pre-insights deck (real database, actual route)", () => {
  let db: DisposableDb;
  const runs: Record<string, string> = {};
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const params = (run: string) => ({ params: Promise.resolve({ id: run }) });

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    const newRun = (name: string) => one(`insert into runs (tenant_id, project_name) values ($1, $2) returning id`, [TENANT, name]);
    runs.mixed = await newRun("Mixed");
    runs.empty = await newRun("Empty");
    runs.excluded = await newRun("Excluded");

    const report = await one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', 'report.pdf', 'report.pdf') returning id`,
      [TENANT, runs.mixed],
    );
    const verdict = (finding: string, tier: string, at: string) =>
      db.pool.query(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care, created_at)
         values ($1, $2, $3, 'r', '{}', 'single_pass', 'single_source', '{}', $4::timestamptz)`,
        [TENANT, finding, tier, at],
      );
    const pre = async (run: string, headline: string, page: number, status: string, tiers: string[]) => {
      const f = await one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, theme, source_document_id, source_page)
         values ($1, $2, 'stated', $3, $4, 'Theme', $5, $6) returning id`,
        [TENANT, run, `Finding for ${headline}`, status, run === runs.mixed ? report : null, page],
      );
      for (const [i, tier] of tiers.entries()) await verdict(f, tier, `2026-10-0${i + 1}T00:00:00Z`);
      await db.pool.query(
        `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, 'o', 't', 'Act') `,
        [TENANT, run, f, headline],
      );
    };
    await pre(runs.mixed, "Robust one", 1, "accepted", ["robust"]);
    await pre(runs.mixed, "Caution one", 2, "accepted", ["use_with_caution"]);
    await pre(runs.mixed, "Reverified robust", 3, "accepted", ["use_with_caution", "robust"]); // two verdicts
    await pre(runs.mixed, "Now unsupported", 4, "accepted", ["robust", "not_supported"]);
    await pre(runs.mixed, "Too thin", 5, "accepted", ["insufficient_information"]);
    await pre(runs.mixed, "Rejected one", 6, "rejected", ["robust"]);
    await pre(runs.mixed, "Never verified", 7, "accepted", []);
    await pre(runs.excluded, "Only unsupported", 1, "accepted", ["not_supported"]);
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("mixed verdicts: supported ones shown with labels and sources, the rest listed with reasons", async () => {
    const { GET } = await import("../../app/api/runs/[id]/insights/export-deck/route");
    const slides = await pptxSlides(await GET(new Request("http://x/"), params(runs.mixed)));
    const all = slides.join("\n");
    const cards = slides.filter((s) => !/Not included/.test(s)).join("\n");
    const listed = slides.filter((s) => /Not included/.test(s)).join("\n");

    for (const h of ["Robust one", "Caution one", "Reverified robust"]) expect(cards.split(h).length - 1).toBe(1);
    expect(cards).toContain("ROBUST");
    expect(cards).toContain("USE WITH CAUTION");
    expect(cards).toContain("Source: report.pdf, p. 1");
    expect(cards).toContain("Source: report.pdf, p. 3");
    for (const h of ["Now unsupported", "Too thin", "Rejected one", "Never verified"]) expect(cards).not.toContain(h);

    expect(listed).toContain("Now unsupported: not included because its finding is no longer supported by the data.");
    expect(listed).toContain("Too thin: not included because there is not enough information to verify its finding.");
    expect(listed).toContain("Rejected one: not included because its finding was rejected.");
    expect(listed).toContain("Never verified: not included because its finding has no verification verdict.");
    expect(listed).toContain("Source: report.pdf, p. 4");
    expect(all).not.toMatch(/undefined/);
  });

  it("an empty project exports with an explanatory slide", async () => {
    const { GET } = await import("../../app/api/runs/[id]/insights/export-deck/route");
    const slides = await pptxSlides(await GET(new Request("http://x/"), params(runs.empty)));
    expect(slides.join("\n")).toContain("No insights have been generated for this project yet.");
  });

  it("a project whose pre-insights are all excluded exports, says so, and lists them", async () => {
    const { GET } = await import("../../app/api/runs/[id]/insights/export-deck/route");
    const all = (await pptxSlides(await GET(new Request("http://x/"), params(runs.excluded)))).join("\n");
    expect(all).toContain("No pre-insight currently rests on a supported finding");
    expect(all).toContain("Only unsupported: not included because its finding is no longer supported by the data.");
    expect(all).toContain("Source not recorded");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("pre-insights deck (real database, actual route)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});

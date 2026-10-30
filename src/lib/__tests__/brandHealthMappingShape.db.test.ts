// Codex BH-F01 (independent D3c review, 30 October 2026): a Brand Health mapping whose positioning (or funnel) is a
// boolean, number, string or array was read as an empty choice, so a save returned ok and wiped the saved axes.
// Through the module's public actions (saveBrandHealthModuleAction, loadBrandHealthModuleAction) on a real disposable
// PostgreSQL database; the request context is the test stand-in, storage is not read (a mapping with a brand variable
// is saved without reading the file), and the model is never called.
//   1. Refused before any write: every malformed shape returns the reason, and the saved mapping and its updated_at
//      are unchanged.
//   2. Controls: an absent or null positioning (a legacy mapping) and a valid empty positioning object save and
//      reload as empty axes.
//   3. A malformed stored mapping is a load error, never an empty mapping.
//   4. Recovery: a valid retry saves and reloads.
// Skipped, with the reason, without a test database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { BrandHealthMapping } from "../brandHealthActions";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const mapping = (over: Record<string, unknown> = {}): BrandHealthMapping =>
  ({
    brandVar: "main_brand",
    brandSet: null,
    ourBrand: "BMW",
    funnel: {},
    attributes: [{ variable: "nps_main", metric: "mean" }],
    loyaltyVar: "nps_main",
    moments: [],
    positioning: { xVar: "nps_main", yVar: "age_band" },
    ...over,
  }) as BrandHealthMapping;

describe.skipIf(!TEST_DATABASE_URL)("Brand Health mapping shapes: a malformed field is refused, never saved as empty (real database)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  let data = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const savedRow = async () => (await q(`select mapping, updated_at from brand_health_modules where run_id = $1 and document_id = $2`, [run, data]))[0];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id;
    data = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path) values ($1, $2, 'table', 'raw', 'tracker.csv', $3) returning id`,
      [tenant, run, `${tenant}/${run}/tracker.csv`],
    ))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("a malformed positioning or funnel is refused before any write; the saved mapping and updated_at are unchanged", async () => {
    const { saveBrandHealthModuleAction, loadBrandHealthModuleAction } = await import("../brandHealthActions");
    expect(await saveBrandHealthModuleAction(run, data, mapping())).toEqual({ ok: true });
    const before = await savedRow();
    expect(before.mapping.positioning).toEqual({ xVar: "nps_main", yVar: "age_band" });

    for (const bad of [false, true, 0, 7, "", "nps_main", [], ["nps_main", "age_band"]]) {
      expect(await saveBrandHealthModuleAction(run, data, mapping({ positioning: bad })), `positioning ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        error: "The saved Brand Health mapping could not be read: the positioning map is not a pair of axes.",
      });
      expect((await saveBrandHealthModuleAction(run, data, mapping({ funnel: bad }))).ok, `funnel ${JSON.stringify(bad)}`).toBe(false);
    }
    expect(await savedRow()).toEqual(before);
    expect(await loadBrandHealthModuleAction(run, data)).toEqual({ ok: true, mapping: mapping() });
  });

  it("controls: an absent or null positioning (legacy) and a valid empty object save and reload as empty axes", async () => {
    const { saveBrandHealthModuleAction, loadBrandHealthModuleAction } = await import("../brandHealthActions");
    const empty = mapping({ positioning: { xVar: null, yVar: null } });
    const { positioning: _omitted, ...absent } = mapping();
    for (const [what, sent] of [
      ["absent", absent],
      ["null", mapping({ positioning: null })],
      ["empty object", mapping({ positioning: {} })],
      ["empty axes", empty],
    ] as const) {
      expect(await saveBrandHealthModuleAction(run, data, sent as BrandHealthMapping), what).toEqual({ ok: true });
      expect(await loadBrandHealthModuleAction(run, data), what).toEqual({ ok: true, mapping: empty });
    }
    // A legacy record stored without positioning at all reads as empty axes too.
    await q(`update brand_health_modules set mapping = $3 where run_id = $1 and document_id = $2`, [run, data, JSON.stringify(absent)]);
    expect(await loadBrandHealthModuleAction(run, data)).toEqual({ ok: true, mapping: empty });
  });

  it("a malformed stored mapping is a load error; a valid retry saves and reloads", async () => {
    const { saveBrandHealthModuleAction, loadBrandHealthModuleAction } = await import("../brandHealthActions");
    for (const bad of [false, "nps_main", ["nps_main"]]) {
      await q(`update brand_health_modules set mapping = $3 where run_id = $1 and document_id = $2`, [run, data, JSON.stringify(mapping({ positioning: bad }))]);
      expect(await loadBrandHealthModuleAction(run, data), JSON.stringify(bad)).toEqual({
        ok: false,
        error: "The saved Brand Health mapping could not be read: the positioning map is not a pair of axes.",
      });
    }
    // Recovery: the researcher saves a valid mapping over the unreadable one.
    const stale = await savedRow();
    expect(await saveBrandHealthModuleAction(run, data, mapping())).toEqual({ ok: true });
    const after = await savedRow();
    expect(after.mapping).toEqual(mapping());
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(stale.updated_at).getTime());
    expect(await loadBrandHealthModuleAction(run, data)).toEqual({ ok: true, mapping: mapping() });
  });
});

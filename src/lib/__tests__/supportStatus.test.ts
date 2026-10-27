// FND-001 / REP-OUT-001 and ANA-NPS-003 downstream freshness: the support-status rule and its
// loader. The classifier tests are pure (actual classifyInsightSupport with constructed link rows).
// The loader tests run the actual loadInsightSupport against a fake database client: the db
// wrapper is mocked at its boundary (withTenantRepeatableRead hands the callback a scripted client), and the
// two current-settings lookups (resolveCurrentDesignSnapshotStatus, loadVariableOverrides) are
// mocked as external lookups while designFreshnessStatus stays real.
//
// What these do NOT establish: the SQL function finding_support_parts() itself (migration 0096)
// against PostgreSQL, real RLS, or real cascades. Those are prepared integration checks.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  available: true as boolean,
  rows: [] as Record<string, unknown>[],
  statements: [] as string[],
  fail: null as Error | null,
}));

vi.mock("../db", () => {
  const client = {
    query: async (sql: string) => {
      db.statements.push(sql);
      if (db.fail) throw db.fail;
      if (/to_regprocedure\('finding_support_parts/.test(sql)) return { rows: [{ available: db.available }] };
      if (/from synthesized_insights si/.test(sql)) return { rows: db.rows };
      // GT1000-F01: the saved driver analyses probe; these fixtures have no driver findings.
      if (/to_regclass\('public\.driver_analyses'\)/.test(sql)) return { rows: [{ present: true }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const run = async (_tenant: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run, withTenantRepeatableRead: run };
});

const settings = vi.hoisted(() => ({
  design: { ok: true, snapshot: JSON.stringify({ psu: null, strata: null }) } as { ok: true; snapshot: string } | { ok: false; error: string },
  overrides: {} as Record<string, unknown>,
  overridesError: null as Error | null,
  designThrows: null as Error | null,
}));

vi.mock("../crosstabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crosstabs")>();
  return {
    ...actual,
    resolveCurrentDesignSnapshotStatus: vi.fn(async () => {
      if (settings.designThrows) throw settings.designThrows;
      return settings.design;
    }),
  };
});
vi.mock("../variableOverrides", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../variableOverrides")>();
  return {
    ...actual,
    loadVariableOverrides: vi.fn(async () => {
      if (settings.overridesError) throw settings.overridesError;
      return settings.overrides;
    }),
  };
});
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

import {
  classifyInsightSupport,
  inheritSupport,
  summariseSupport,
  type DocumentSettingsCheck,
  type SupportLinkRow,
  type SupportParts,
} from "../supportStatusShared";

import { CURRENT_TABLE_METHOD } from "../tableMethod";

vi.setConfig({ testTimeout: 20000 });

const parts = (over: Partial<SupportParts> = {}): SupportParts => ({
  wording: "w1",
  figures: "f1",
  verdict: "robust",
  calculation: null,
  ...over,
});

function link(over: Partial<SupportLinkRow> = {}): SupportLinkRow {
  return {
    insightId: "si-1",
    triangulationCount: 2,
    linkId: "pi-1",
    findingId: "f-1",
    findingStatus: "accepted",
    findingText: "Region B is 15 points higher on Q3 top-2-box",
    recorded: parts(),
    current: parts(),
    calculatedTableDocumentId: null,
    designSnapshot: null,
    overridesSnapshot: null,
    ...over,
  };
}

const two = (a: Partial<SupportLinkRow> = {}, b: Partial<SupportLinkRow> = {}) => [
  link({ linkId: "pi-1", findingId: "f-1", ...a }),
  link({ linkId: "pi-2", findingId: "f-2", findingText: "NPS is higher among promoters of brand A", ...b }),
];
const none = new Map<string, DocumentSettingsCheck>();

describe("classifyInsightSupport (pure rule)", () => {
  it("F2: untouched support is current, with no reasons", () => {
    const r = classifyInsightSupport(two(), none, true);
    expect(r).toEqual({ status: "current", reasons: [] });
    expect(summariseSupport(r)).toBe("");
  });

  it("F3: an in-place wording edit, figures rewrite or verdict change is stale, naming the finding and the field", () => {
    const wording = classifyInsightSupport(two({ current: parts({ wording: "w2" }) }), none, true);
    expect(wording.status).toBe("stale");
    expect(wording.reasons).toEqual([expect.objectContaining({ kind: "wording", findingId: "f-1" })]);
    expect(summariseSupport(wording)).toMatch(/^Support changed since drafted: the wording of “Region B is 15 points/);

    const figures = classifyInsightSupport(two({}, { current: parts({ figures: "f2" }) }), none, true);
    expect(figures.reasons).toEqual([expect.objectContaining({ kind: "figures", findingId: "f-2" })]);

    const verdict = classifyInsightSupport(two({ current: parts({ verdict: "use_with_caution" }) }), none, true);
    expect(verdict.status).toBe("stale");
    expect(summariseSupport(verdict)).toMatch(/verification verdict .* changed \(robust → use with caution\)/);

    const recalculated = classifyInsightSupport(
      two({ recorded: parts({ calculation: "c1" }), current: parts({ calculation: "c2" }) }),
      none,
      true,
    );
    expect(recalculated.reasons[0].kind).toBe("calculation");
  });

  it("F5: a rejected source, a deleted source, and no remaining sources are each invalid", () => {
    const rejected = classifyInsightSupport(two({ findingStatus: "rejected" }), none, true);
    expect(rejected.status).toBe("invalid");
    expect(summariseSupport(rejected)).toMatch(/was rejected/);

    // A deleted finding cascades its pre-insight and link away: fewer links than the count.
    const deleted = classifyInsightSupport([link({ triangulationCount: 2 })], none, true);
    expect(deleted.status).toBe("invalid");
    expect(summariseSupport(deleted)).toMatch(/1 of 2 supporting findings no longer exist/);

    const empty = classifyInsightSupport(
      [link({ linkId: null, findingId: null, recorded: null, current: null })],
      none,
      true,
    );
    expect(empty.status).toBe("invalid");
    expect(summariseSupport(empty)).toMatch(/none of its supporting findings remain/);
  });

  it("F6: a legacy link (no recorded snapshot) or a database without 0096 is unknown, never current", () => {
    const legacy = classifyInsightSupport(two({ recorded: null }, { recorded: null }), none, true);
    expect(legacy.status).toBe("unknown");
    // The same reason on every legacy link is said once.
    expect(summariseSupport(legacy)).toBe(
      "Support not checked: it was drafted before support tracking, so later changes cannot be detected.",
    );
    expect(classifyInsightSupport(two(), none, false).status).toBe("unknown");
  });

  it("F5/F6: rejection is still detected without the migration (needs no snapshot), and invalid outranks unknown", () => {
    const r = classifyInsightSupport(two({ findingStatus: "rejected" }), none, false);
    expect(r.status).toBe("invalid");
  });

  it("precedence: invalid > stale > unknown > current, whatever order the reasons arrive in", () => {
    const r = classifyInsightSupport(
      two({ current: parts({ wording: "w2" }), recorded: null }, { findingStatus: "rejected" }),
      none,
      true,
    );
    expect(r.status).toBe("invalid");
    const s = classifyInsightSupport(two({ recorded: null }, { current: parts({ figures: "f9" }) }), none, true);
    expect(s.status).toBe("stale");
  });

  it("F4: a design or corrections change on a source's calculated table is stale; an unverifiable one is unknown", () => {
    const calc = (design: "current" | "stale" | "unknown", corrections: "current" | "stale" | "unknown", error?: string) =>
      new Map<string, DocumentSettingsCheck>([
        ["doc-1", { design: () => design, corrections: () => corrections, ...(error ? { error } : {}) }],
      ]);
    const rows = two({ calculatedTableDocumentId: "doc-1", tableMethod: CURRENT_TABLE_METHOD });
    expect(classifyInsightSupport(rows, calc("current", "current"), true).status).toBe("current");
    const design = classifyInsightSupport(rows, calc("stale", "current"), true);
    expect(design.status).toBe("stale");
    expect(summariseSupport(design)).toMatch(/survey design for the data behind/);
    const corrections = classifyInsightSupport(rows, calc("current", "stale"), true);
    expect(summariseSupport(corrections)).toMatch(/variable corrections for the data behind/);
    const failed = classifyInsightSupport(rows, calc("unknown", "current", "permission denied"), true);
    expect(failed.status).toBe("unknown");
    expect(summariseSupport(failed)).toMatch(/could not be checked \(permission denied\)/);
    // A settings lookup that never resolved is a failed check, not a pass.
    expect(classifyInsightSupport(rows, none, true).status).toBe("unknown");
  });

  it("batch 47: a source table built with an earlier method (or with none recorded) is changed, with the reason in words", () => {
    const ok = new Map<string, DocumentSettingsCheck>([["doc-1", { design: () => "current", corrections: () => "current" }]]);
    const current = classifyInsightSupport(two({ calculatedTableDocumentId: "doc-1", tableMethod: CURRENT_TABLE_METHOD }), ok, true);
    expect(current.status).toBe("current");
    for (const tableMethod of [null, undefined, "pooled-2026.10.26"]) {
      const earlier = classifyInsightSupport(two({ calculatedTableDocumentId: "doc-1", tableMethod }), ok, true);
      expect(earlier.status).toBe("stale");
      expect(earlier.reasons.map((r) => r.kind)).toContain("method_changed");
      expect(summariseSupport(earlier)).toMatch(/significance test and the don't know rules were updated/);
    }
    // A finding with no calculated table behind it (report text) is never judged on table method.
    expect(classifyInsightSupport(two({ tableMethod: null }), none, true).status).toBe("current");
    // Read from the table itself: still reported when the data file's settings could not be resolved.
    const unresolved = classifyInsightSupport(two({ calculatedTableDocumentId: "doc-1", tableMethod: null }), none, true);
    expect(unresolved.status).toBe("stale");
    expect(unresolved.reasons.map((r) => r.kind)).toEqual(expect.arrayContaining(["method_changed", "check_failed"]));
  });

  it("inheritance: a recommendation or narrative takes the worst status of what it rests on", () => {
    const current = classifyInsightSupport(two(), none, true);
    const stale = classifyInsightSupport(two({ current: parts({ wording: "x" }) }), none, true);
    expect(inheritSupport([current, stale]).status).toBe("stale");
    expect(inheritSupport([current, current]).status).toBe("current");
  });
});

describe("loadInsightSupport (actual loader, fake database client)", () => {
  beforeEach(() => {
    db.available = true;
    db.rows = [];
    db.statements = [];
    db.fail = null;
    settings.design = { ok: true, snapshot: JSON.stringify({ psu: null, strata: null }) };
    settings.overrides = {};
    settings.overridesError = null;
  });

  const raw = (over: Record<string, unknown> = {}) => ({
    insight_id: "si-1",
    triangulation_count: "2",
    link_id: "pi-1",
    finding_id: "f-1",
    finding_status: "accepted",
    finding_text: "Region B is higher",
    support_snapshot: parts(),
    current_parts: parts(),
    calculated_table_document_id: null,
    design_snapshot: null,
    overrides_snapshot: null,
    // Tables in these fixtures were built with the current method, unless a test says otherwise.
    table_method: CURRENT_TABLE_METHOD,
    ...over,
  });

  it("reads drafted and current fingerprints in one query when 0096 is present, and never writes", async () => {
    db.rows = [raw(), raw({ link_id: "pi-2", finding_id: "f-2", current_parts: parts({ figures: "f2" }) })];
    const { loadInsightSupport } = await import("../supportStatus");
    const result = await loadInsightSupport("t", "run-1");
    expect(result.snapshotsAvailable).toBe(true);
    expect(result.statusOf("si-1").status).toBe("stale");
    const main = db.statements.find((s) => /from synthesized_insights si/.test(s))!;
    expect(main).toMatch(/finding_support_parts\(f\.id\)/);
    expect(main).toMatch(/left join synthesized_insight_sources/);
    // F11: evaluation is read-only.
    expect(db.statements.some((s) => /\b(insert|update|delete)\b/i.test(s.replace(/'[^']*'/g, "")))).toBe(false);
  });

  it("without 0096 the catalog pre-check avoids the missing function and every link reads not checked", async () => {
    db.available = false;
    db.rows = [raw({ support_snapshot: null, current_parts: null }), raw({ link_id: "pi-2", finding_id: "f-2", support_snapshot: null, current_parts: null })];
    const { loadInsightSupport } = await import("../supportStatus");
    const result = await loadInsightSupport("t", "run-1");
    expect(result.snapshotsAvailable).toBe(false);
    expect(result.statusOf("si-1").status).toBe("unknown");
    const main = db.statements.find((s) => /from synthesized_insights si/.test(s))!;
    expect(main).not.toMatch(/finding_support_parts/);
    expect(main).toMatch(/null::jsonb as support_snapshot/);
  });

  it("an id the check did not cover reads unknown, not current", async () => {
    db.rows = [raw(), raw({ link_id: "pi-2", finding_id: "f-2" })];
    const { loadInsightSupport } = await import("../supportStatus");
    const result = await loadInsightSupport("t", "run-1");
    expect(result.statusOf("si-1").status).toBe("current");
    expect(result.statusOf("si-other").status).toBe("unknown");
  });

  it("F4: compares a calculated table's recorded corrections and design with the data file's current settings", async () => {
    const calcRow = (over: Record<string, unknown>) =>
      raw({
        calculated_table_document_id: "doc-1",
        design_snapshot: { design: { psu: null, strata: null } },
        overrides_snapshot: { "Q1 (2)": { type: "continuous" } },
        ...over,
      });
    db.rows = [calcRow({}), calcRow({ link_id: "pi-2", finding_id: "f-2" })];
    settings.overrides = { "Q1 (2)": { type: "continuous" } };
    const { loadInsightSupport } = await import("../supportStatus");
    expect((await loadInsightSupport("t", "run-1")).statusOf("si-1").status).toBe("current");

    settings.overrides = { "Q1 (2)": { type: "discrete" } };
    const changed = (await loadInsightSupport("t", "run-1")).statusOf("si-1");
    expect(changed.status).toBe("stale");
    expect(changed.reasons.map((r) => r.kind)).toContain("corrections_changed");

    settings.overrides = { "Q1 (2)": { type: "continuous" } };
    settings.design = { ok: true, snapshot: JSON.stringify({ psu: "psu", strata: "stratum" }) };
    expect((await loadInsightSupport("t", "run-1")).statusOf("si-1").reasons.map((r) => r.kind)).toContain("design_changed");

    settings.design = { ok: true, snapshot: JSON.stringify({ psu: null, strata: null }) };
    settings.overridesError = new Error("permission denied for table documents");
    const unverifiable = (await loadInsightSupport("t", "run-1")).statusOf("si-1");
    expect(unverifiable.status).toBe("unknown");
    expect(summariseSupport(unverifiable)).toMatch(/permission denied for table documents/);
  });

  it("golden-thread: only corrections to variables the table used mark it changed; an unrecorded request compares file-wide", async () => {
    const calc = (over: Record<string, unknown>) =>
      raw({
        calculated_table_document_id: "doc-1",
        design_snapshot: { design: { psu: null, strata: null } },
        overrides_snapshot: { Satisfaction: { type: "continuous" } },
        saved_request: { columnVars: ["Gender"], rowItems: [{ key: "Purchase", vars: ["Purchase"] }], weightVar: null },
        triangulation_count: "1",
        ...over,
      });
    const { loadInsightSupport } = await import("../supportStatus");
    // A correction to Convenience, which this Gender x Purchase table never used: still current.
    db.rows = [calc({})];
    settings.overrides = { Satisfaction: { type: "continuous" }, Convenience: { type: "continuous" } };
    expect((await loadInsightSupport("t", "run-1")).statusOf("si-1").status).toBe("current");
    // A correction to Purchase, which it did use: changed.
    settings.overrides = { Satisfaction: { type: "continuous" }, Purchase: { type: "continuous" } };
    expect((await loadInsightSupport("t", "run-1")).statusOf("si-1").reasons.map((r) => r.kind)).toContain("corrections_changed");
    // No recorded request: the cautious file-wide comparison, so the unrelated correction counts.
    db.rows = [calc({ saved_request: null })];
    settings.overrides = { Satisfaction: { type: "continuous" }, Convenience: { type: "continuous" } };
    expect((await loadInsightSupport("t", "run-1")).statusOf("si-1").status).toBe("stale");
  });

  it("golden-thread: a settings lookup that THROWS for one data file is contained; a rejected source elsewhere still reads invalid", async () => {
    settings.designThrows = new Error("stored file unreachable");
    db.rows = [
      raw({
        triangulation_count: "1",
        calculated_table_document_id: "doc-1",
        design_snapshot: { design: { psu: null, strata: null } },
        overrides_snapshot: {},
      }),
      raw({ insight_id: "si-2", triangulation_count: "1", link_id: "pi-9", finding_id: "f-9", finding_status: "rejected", finding_text: "Older claim" }),
    ];
    settings.overrides = {};
    const { loadInsightSupport } = await import("../supportStatus");
    const result = await loadInsightSupport("t", "run-1");
    expect(result.statusOf("si-1").status).toBe("unknown");
    expect(summariseSupport(result.statusOf("si-1"))).toMatch(/stored file unreachable/);
    // Batch 47: the loader reads the table's recorded method; an earlier one is changed even here.
    db.rows = [raw({ triangulation_count: "1", calculated_table_document_id: "doc-1", design_snapshot: { design: { psu: null, strata: null } }, overrides_snapshot: {}, table_method: null })];
    const earlier = (await loadInsightSupport("t", "run-1")).statusOf("si-1");
    expect(earlier.status).toBe("stale");
    expect(earlier.reasons.map((r) => r.kind)).toContain("method_changed");
    expect(result.statusOf("si-2").status).toBe("invalid");
    settings.designThrows = null;
  });

  it("a whole-check failure: loadInsightSupport throws; loadInsightSupportOrUnchecked reports unknown with the error, never current or empty", async () => {
    db.fail = new Error("connection terminated unexpectedly");
    const { loadInsightSupport, loadInsightSupportOrUnchecked } = await import("../supportStatus");
    await expect(loadInsightSupport("t", "run-1")).rejects.toThrow("connection terminated unexpectedly");
    const safe = await loadInsightSupportOrUnchecked("t", "run-1");
    expect(safe.error).toBe("connection terminated unexpectedly");
    expect(safe.statusOf("anything").status).toBe("unknown");
    expect(summariseSupport(safe.statusOf("anything"))).toMatch(/connection terminated unexpectedly/);
  });
});

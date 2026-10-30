// r6brandext: the brand dashboard extension's figures for the insurance pack (fixtures/packs-2026-10-30/brand/insurers),
// all three waves, through the actual loader (loadBrandExtension: recognition from the labelled workbook as imported,
// figures from the Cross tab engine computed without saving a table), weighted and unweighted, against every
// "Measurement extension" value of the pack's reference_results.json and Reference_Metrics.xlsx (value, numerator,
// denominator to 1e-6; raw base exact). Real disposable PostgreSQL and the actual Python engine; storage is an
// in-memory stand-in and the model is never called. Skipped, with the reason, without a test database or python3.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TEST_DATABASE_URL } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { expectReference, harness, PACK, packReferences, type Harness } from "./helpers/brandExtensionDb";

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

vi.setConfig({ testTimeout: 900_000, hookTimeout: 300_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const pack = PACK.insurers;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("insurance pack: extension figures equal the pack's reference values, every wave, weighted and unweighted", () => {
  let h: Harness;
  const refs = PYTHON_OK ? packReferences("insurers") : { json: [], xlsx: [] };
  beforeAll(async () => {
    h = await harness(storage);
  });
  afterAll(async () => {
    await h?.drop();
  });

  it("the workbook reference equals the JSON reference (369 values per weighting)", () => {
    expect(refs.json).toHaveLength(738);
    const key = (r: (typeof refs.json)[number]) => `${r.wave}|${r.metric}|${r.brand}|${r.weighting}`;
    const x = new Map(refs.xlsx.map((r) => [key(r), r]));
    for (const r of refs.json) {
      const w = x.get(key(r))!;
      expect(w, key(r)).toBeDefined();
      expect(Math.abs((w.expected ?? 0) - (r.expected ?? 0))).toBeLessThan(1e-6);
      expect(w.raw_base).toBe(r.raw_base);
    }
  });

  it.each([1, 2, 3])("wave %i", async (wave) => {
    const { loadBrandExtension } = await import("../brandExtension");
    const { loadVariableDictionaryWithStatus } = await import("../crosstabs");
    const run = await h.newRun(`insurance wave ${wave}`);
    const name = `${pack.prefix}_Brand_Tracker_Wave_${wave}.xlsx`;
    const doc = await h.stored(run, "table", name, readFileSync(path.join(pack.dir, name)));
    const dict = await loadVariableDictionaryWithStatus(h.tenant, run, doc);
    if (!dict.ok) throw new Error(dict.error);
    // The 49 added fields beside every original column.
    expect(dict.dictionary.variables).toHaveLength(pack.columns);
    expect(dict.dictionary.variables.filter((v) => /^(needsfit_|different_|pricejustify_|choice_(?!role))/.test(v.name))).toHaveLength(49);
    const tablesBefore = (await h.q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n;
    let checked = 0;
    for (const weighted of [true, false]) {
      const ext = await loadBrandExtension(h.tenant, run, doc, { weighted });
      expect(ext.weighted).toBe(weighted);
      for (const d of ext.diagnostics) expect(d.status, d.construct).toBe("found");
      if (ext.episode.status !== "ok" || ext.reasons.status !== "ok") throw new Error("episode or reasons not calculated");
      // Every respondent is either in the episode or outside it; the file's own gap flag agrees with the app's pairing.
      expect(ext.episode.episodeBase!.n + ext.episode.statuses.find((s) => s.key === "no_episode")!.n).toBe(1000);
      expect(ext.episode.storedGap?.agrees).toBe(true);
      expect(ext.reasons.exclusiveConflicts).toBe(0);
      expect(ext.reasons.overall.missing.n).toBe(0);
      expect(ext.reasons.otherText).toMatchObject({ textWithoutSelection: 0 });
      for (const c of ["needs_fit", "differentiation", "price_justification"] as const) {
        const m = ext.ratings[c];
        if (m.status !== "ok") throw new Error(m.reason);
        expect(m.routeBreaks).toBe(0);
        for (const b of m.brands) expect(b.missing.n, `${c} ${b.label}`).toBe(0);
      }
      checked += expectReference(ext, refs.json.filter((r) => r.wave === wave && r.weighting === (weighted ? "weighted" : "unweighted")));
      checked += expectReference(ext, refs.xlsx.filter((r) => r.wave === wave && r.weighting === (weighted ? "weighted" : "unweighted")));
    }
    expect(checked).toBe(2 * 2 * 123);
    // Computed, not saved.
    expect((await h.q("select count(*)::int as n from document_tables where run_id = $1", [run]))[0].n).toBe(tablesBefore);
  });
});

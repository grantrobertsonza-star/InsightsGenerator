// r6brandext: the brand dashboard extension through the actual loader on the forms and edge cases the guide lists,
// with a real disposable PostgreSQL database and the actual Python engine (storage an in-memory stand-in; the model
// never called). Expected values come from src/lib/__tests__/helpers/brand_extension_reference.py (pandas over the
// same file, written from the guide), or from the pack's own reference_results.json.
//   1. CSV with its codebook (Master_Codebook.xlsx linked as the codebook): every construct found, wave 1 figures
//      equal to the pack's reference.
//   2. Edge file (banking wave 1 with route breaks, unexpected missing and each episode case: matching and different
//      Other names, a blank name, a tracked brand typed as Other, no ideal, cannot recall, same and different
//      brands): every figure equal to the independent reference, weighted and unweighted; the typed tracked name is
//      offered as an alias, and once confirmed it resolves to the brand (the reference with that alias).
//   3. Confirmations: an ambiguous needs-fit question is Needs review; a stale revision is refused; a confirmation is
//      saved once with its provenance (a retry is a conflict, never a second row); the confirmed figures equal the
//      pack's reference; an invalid choice is refused; before migration 0140 the page still calculates and saving is
//      refused with the reason.
//   4. Weight rescaling: every weight times 3.7 leaves every percentage unchanged.
//   5. The original BMW pack (fixtures/tracker-packs/bmw_car): every construct Not measured.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_DATABASE_URL } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { expectReference, harness, PACK, packReferences, python, type Harness } from "./helpers/brandExtensionDb";
import type { BrandExtension } from "../brandExtension";

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
const bank = PACK.banks;
const W1_CSV = path.join(bank.ref, "Bank_Brand_Tracker_Wave_1.csv");
const META = path.join(bank.ref, "metadata.json");

type Expected = Record<"weighted" | "unweighted", {
  ratings: Record<string, Record<string, { aware_n: number; valid_n: number; top2: number | null; mean: number | null; dk: number | null; missing_n: number; answered_not_aware: number; dist: Record<string, number | null> }>>;
  episode: { eligible_n: number; paired_n: number; paired_w: number; gap_n: number; gap_rate: number | null; no_ideal_n: number; cannot_recall_n: number; unresolved_n: number; shares: Record<string, { actual: number | null; ideal: number | null }>; fulfilment: Record<string, { preferrers_n: number; rate: number | null }> };
  reasons: { eligible_n: number; completed_n: number; completed_w: number; share: Record<string, number | null> };
}>;

const close = (a: number | null | undefined, b: number | null | undefined, what: string) => {
  if (b === null || b === undefined) expect(a ?? null, what).toBeNull();
  else expect(Math.abs((a ?? NaN) - b), what).toBeLessThan(1e-6);
};

/** Every figure of the page against the independent reference. */
function expectIndependent(ext: BrandExtension, exp: Expected["weighted"]) {
  for (const [stem, c] of [["needsfit", "needs_fit"], ["different", "differentiation"], ["pricejustify", "price_justification"]] as const) {
    const m = ext.ratings[c];
    if (m.status !== "ok") throw new Error(m.reason);
    for (const b of m.brands) {
      const e = exp.ratings[stem][b.code];
      const what = `${c} ${b.label}`;
      expect([b.aware.n, b.valid.n, b.missing.n, b.answeredNotAware], what).toEqual([e.aware_n, e.valid_n, e.missing_n, e.answered_not_aware]);
      close(b.topTwo, e.top2, `${what} top two`);
      close(b.mean, e.mean, `${what} mean`);
      close(b.cannotJudge.share, e.dk, `${what} cannot judge`);
      b.distribution.forEach((d) => close(d.share, e.dist[d.code], `${what} ${d.code}`));
    }
  }
  const ep = ext.episode;
  if (ep.status !== "ok") throw new Error(ep.reason);
  expect(ep.episodeBase!.n).toBe(exp.episode.eligible_n);
  expect([ep.paired.n, ep.gap.n]).toEqual([exp.episode.paired_n, exp.episode.gap_n]);
  close(ep.paired.weighted, exp.episode.paired_w, "paired weighted");
  close(ep.gap.rate, exp.episode.gap_rate, "gap rate");
  const st = Object.fromEntries(ep.statuses.map((s) => [s.key, s.n]));
  expect([st.no_particular_ideal ?? 0, st.cannot_recall ?? 0, st.unresolved_other ?? 0]).toEqual([exp.episode.no_ideal_n, exp.episode.cannot_recall_n, exp.episode.unresolved_n]);
  for (const s of ep.shares) {
    const e = exp.episode.shares[s.kind === "other" ? "other" : s.code!];
    close(s.actual.share, e.actual, `${s.label} actual`);
    close(s.ideal.share, e.ideal, `${s.label} ideal`);
  }
  for (const f of ep.fulfilment) {
    expect(f.preferrers.n, f.label).toBe(exp.episode.fulfilment[f.code].preferrers_n);
    close(f.rate, exp.episode.fulfilment[f.code].rate, `${f.label} fulfilment`);
  }
  const r = ext.reasons;
  if (r.status !== "ok") throw new Error(r.reason);
  expect([r.overall.eligible.n, r.overall.completed.n]).toEqual([exp.reasons.eligible_n, exp.reasons.completed_n]);
  close(r.overall.completed.weighted, exp.reasons.completed_w, "completed weighted");
  for (const row of [...r.overall.reasons, r.overall.none!, r.overall.cannotRecall!]) close(row.share, exp.reasons.share[row.variable], row.variable);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("brand extension: forms, edge cases, confirmations and old packs (real database, actual engine)", () => {
  let h: Harness;
  const dir = mkdtempSync(path.join(tmpdir(), "brand-extension-"));
  const refs = PYTHON_OK ? packReferences("banks") : { json: [], xlsx: [] };
  const variant = (kind: string) => {
    const csv = path.join(dir, `${kind}.csv`);
    const meta = path.join(dir, `${kind}.json`);
    python(["variant", W1_CSV, META, csv, meta, kind]);
    return { csv, meta };
  };
  const expected = (csv: string, meta: string, aliases?: Record<string, string>): Expected => {
    const args = ["expected", csv, meta];
    if (aliases) {
      const f = path.join(dir, `aliases-${Date.now()}.json`);
      writeFileSync(f, JSON.stringify(aliases));
      args.push(f);
    }
    return JSON.parse(python(args));
  };
  /** A CSV with a codebook linked and confirmed, in a project of its own. */
  async function csvWithCodebook(name: string, csv: string, codebookName: string, codebook: Buffer) {
    const run = await h.newRun(name);
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
    const cb = await h.stored(run, "instrument", codebookName, codebook, "codebook");
    const data = await h.stored(run, "table", path.basename(csv), readFileSync(csv));
    await readInstrumentItems(h.tenant, run, cb);
    await suggestInstrumentLinks(h.tenant, run, cb, data);
    await confirmInstrumentLinks(h.tenant, run, cb, 0.9);
    return { run, data };
  }

  beforeAll(async () => {
    h = await harness(storage);
  });
  afterAll(async () => {
    await h?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("CSV with its codebook (Master_Codebook.xlsx): every construct found; wave 1 equal to the pack's reference, weighted", async () => {
    const { loadBrandExtension } = await import("../brandExtension");
    const { run, data } = await csvWithCodebook("Bank CSV", W1_CSV, "Master_Codebook.xlsx", readFileSync(path.join(bank.dir, "Master_Codebook.xlsx")));
    const ext = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    expect(ext.diagnostics.map((d) => [d.construct, d.status])).toEqual([["needs_fit", "found"], ["differentiation", "found"], ["price_justification", "found"], ["episode", "found"], ["reasons", "found"]]);
    expect(expectReference(ext, refs.json.filter((r) => r.wave === 1 && r.weighting === "weighted"))).toBe(123);
  });

  it("edge file: route breaks and unexpected missing apart, every episode case, every figure equal to the independent reference; a typed tracked brand is offered as an alias and resolves once confirmed", async () => {
    const { loadBrandExtension } = await import("../brandExtension");
    const { saveBrandExtensionConfirmation } = await import("../brandExtensionConfirmations");
    const v = variant("edges");
    const exp = expected(v.csv, v.meta);
    const { run, data } = await csvWithCodebook("Bank edges", v.csv, "metadata.json", readFileSync(v.meta));
    for (const weighted of [true, false]) {
      const ext = await loadBrandExtension(h.tenant, run, data, { weighted });
      expectIndependent(ext, exp[weighted ? "weighted" : "unweighted"]);
      const nf = ext.ratings.needs_fit;
      if (nf.status !== "ok") throw new Error(nf.reason);
      expect(nf.routeBreaks).toBe(2);
      expect(nf.brands[0].missing.n).toBe(2);
    }
    const before = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    if (before.episode.status !== "ok") throw new Error("episode");
    expect(before.episode.aliasSuggestions.map((a) => [a.name, a.code])).toEqual([["fnb", "8"]]);
    expect(before.episode.otherNames.find((o) => o.name === "synthetic other brand a")?.verbatim).toEqual(expect.arrayContaining(["Synthetic other brand A", "  synthetic OTHER   brand a "]));
    const saved = await saveBrandExtensionConfirmation(h.tenant, run, data, { scope: before.confirmations.scopeKey, revision: before.confirmations.revision }, { kind: "alias", name: "FNB", brandCode: "8", otherName: null }, "grant@example.org");
    expect(saved).toEqual({ saved: true, revision: 1 });
    const after = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    const withAlias = expected(v.csv, v.meta, { fnb: "brand:8" });
    expectIndependent({ ...after, reasons: before.reasons }, withAlias.weighted);
    if (after.episode.status !== "ok") throw new Error("episode");
    expect(after.episode.gap.n).toBe(before.episode.gap.n - 1);
    expect(after.episode.aliasSuggestions).toEqual([]);
    // The file's own flag says gap for that respondent; the page says so rather than hiding the difference.
    expect(after.episode.storedGap?.agrees).toBe(false);
    expect(after.confirmations.aliases).toEqual([expect.objectContaining({ name: "fnb", brandCode: "8", by: "grant@example.org", documentId: data })]);
  });

  it("confirmations: Needs review until confirmed; stale revisions refused; saved once with provenance; confirmed figures equal the reference; invalid choices refused", async () => {
    const { loadBrandExtension } = await import("../brandExtension");
    const { saveBrandExtensionConfirmation } = await import("../brandExtensionConfirmations");
    const v = variant("review");
    const { run, data } = await csvWithCodebook("Bank review", v.csv, "metadata.json", readFileSync(v.meta));
    const first = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    const d = first.diagnostics.find((x) => x.construct === "needs_fit")!;
    expect(d.status).toBe("needs_review");
    expect(first.ratings.needs_fit.status).toBe("needs_review");
    expect(d.candidates.map((c) => c.key.split(",")[0])).toEqual(["needsfit_b01", "needsfit2_b01"]);
    expect(first.confirmations).toMatchObject({ revision: null, storageAvailable: true });
    const expected0 = { scope: first.confirmations.scopeKey, revision: null };
    const change = { kind: "construct" as const, construct: "needs_fit" as const, choice: d.candidates[0].key };
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, { ...expected0, revision: 5 }, change, "g")).toMatchObject({ saved: false, reason: "conflict" });
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, expected0, { ...change, choice: "no_such,family" }, "g")).toMatchObject({ saved: false, reason: "invalid" });
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, expected0, { kind: "construct", construct: "differentiation", choice: "not_measured" }, "g")).toMatchObject({ saved: false, reason: "invalid" });
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, expected0, change, "grant@example.org")).toEqual({ saved: true, revision: 1 });
    // The same request again (a retry after a lost reply) is a conflict: one row, revision 1.
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, expected0, change, "grant@example.org")).toMatchObject({ saved: false, reason: "conflict", current: { revision: 1 } });
    expect((await h.q("select count(*)::int as n, max(revision) as r from brand_extension_confirmations where run_id = $1", [run]))[0]).toEqual({ n: 1, r: 1 });
    const confirmed = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    const cd = confirmed.diagnostics.find((x) => x.construct === "needs_fit")!;
    expect(cd.status).toBe("found");
    expect(cd.confirmed?.by).toBe("grant@example.org");
    expect(expectReference(confirmed, refs.json.filter((r) => r.wave === 1 && r.weighting === "weighted" && r.metric.startsWith("needsfit_")))).toBe(30);

    // Before migration 0140: the page still calculates (nothing could have been saved), and saving says why it cannot.
    await h.q("drop table brand_extension_confirmations");
    const pre = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    expect(pre.confirmations).toMatchObject({ storageAvailable: false, revision: null });
    expect(pre.ratings.needs_fit.status).toBe("needs_review");
    expect(await saveBrandExtensionConfirmation(h.tenant, run, data, expected0, change, "g")).toMatchObject({ saved: false, reason: "unavailable" });
  });

  it("weight rescaling: every weight times 3.7 leaves every percentage and mean unchanged (the original's independent reference)", async () => {
    const { loadBrandExtension } = await import("../brandExtension");
    const v = variant("rescaled");
    const original = expected(W1_CSV, META);
    const { run, data } = await csvWithCodebook("Bank rescaled", v.csv, "metadata.json", readFileSync(v.meta));
    const ext = await loadBrandExtension(h.tenant, run, data, { weighted: true });
    // Weighted bases scale by 3.7; the paired and completed bases are compared through the shares only.
    expectIndependent(ext, { ...original.weighted, episode: { ...original.weighted.episode, paired_w: original.weighted.episode.paired_w * 3.7 }, reasons: { ...original.weighted.reasons, completed_w: original.weighted.reasons.completed_w * 3.7 } });
  });

  it("the original BMW pack: every construct Not measured, with what is missing; nothing calculated or saved", async () => {
    const { loadBrandExtension } = await import("../brandExtension");
    const run = await h.newRun("BMW car tracker");
    const doc = await h.stored(run, "table", "bmw_wave1.sav", readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", "wave1_labels_only_compressed.sav")));
    const ext = await loadBrandExtension(h.tenant, run, doc, {});
    expect(ext.diagnostics.map((d) => d.status)).toEqual(["not_measured", "not_measured", "not_measured", "not_measured", "not_measured"]);
    for (const m of [...Object.values(ext.ratings), ext.episode, ext.reasons]) {
      expect(m.status).toBe("not_measured");
      if (m.status === "not_measured") expect(m.reason).toMatch(/^Not measured: .* Missing: /);
    }
    expect(ext.recognition.claimed).toEqual([]);
  });
});

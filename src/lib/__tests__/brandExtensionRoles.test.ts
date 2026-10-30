// r6brandext: recognising the brand dashboard extension's constructs (brandExtensionRoles.ts, called from
// recogniseTracker). Inputs are built from each pack's metadata.json the way a codebook gives them (question number,
// question type, multiple-response set, answer labels), the same assembly as fixtures/tracker-roles; the labelled
// workbook and the CSV with its codebook are read through the real engine in brandExtensionEdge.db.test.ts and the
// reference tests. Expected roles are written from each pack's questionnaire (01) and extension guide (03).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { recogniseTracker, type RoleVariable } from "../trackerRoles";
import { recogniseBrandExtension, withConfirmations, type BrandExtensionRecognition } from "../brandExtensionRoles";

type Meta = { brands: string[]; variables: { variable: string; label: string; question: string; data_type: string; question_type: string; mr_set: string }[]; labels: [string, string, number, string][] };
const BRAND = path.join(process.cwd(), "fixtures", "packs-2026-10-30", "brand");
const META: Record<string, string> = {
  banks: path.join(BRAND, "banks", "test-reference", "metadata.json"),
  insurers: path.join(BRAND, "insurers", "test-reference", "metadata.json"),
  telecoms: path.join(BRAND, "telecoms", "test-reference", "metadata.json"),
  cars: path.join(BRAND, "cars", "metadata.json"),
};
const meta = (pack: string): Meta => JSON.parse(readFileSync(META[pack], "utf8"));
const TYPE: Record<string, RoleVariable["questionType"]> = { categorical: "categorical", multiple_response: "multiple_response", ordinal: "scale", scale: "scale", continuous: "continuous", text: "text" };
/** A pack's variables as a codebook describes them (fixtures/tracker-roles/README.md's assembly). */
function fromMeta(m: Meta): RoleVariable[] {
  const labels = new Map<string, Record<string, string>>();
  for (const [v, , code, label] of m.labels) labels.set(v, { ...(labels.get(v) ?? {}), [String(code)]: label });
  return m.variables.map((v) => ({
    name: v.variable,
    label: v.label,
    ...(labels.get(v.variable) ? { valueLabels: labels.get(v.variable) } : {}),
    questionId: v.question || null,
    questionType: TYPE[v.question_type] ?? null,
    group: v.mr_set || null,
    numeric: v.data_type === "numeric",
    weightLike: v.variable === "weight",
    text: v.data_type === "text",
  }));
}
const EXTENSION = /^(needsfit_|different_|pricejustify_|choice_)/;
const found = <T,>(d: { status: string; value?: T }) => {
  if (d.status !== "found") throw new Error(`expected found, got ${d.status}: ${JSON.stringify(d)}`);
  return (d as { value: T }).value;
};

describe.each(["banks", "insurers", "telecoms", "cars"])("%s pack: every construct found from wording, labels and sets", (pack) => {
  const m = meta(pack);
  const vars = fromMeta(m);
  const rec = recogniseTracker(vars);
  const ext = rec.brandExtension!;

  it("49 extension variables, and the three ratings found with one variable per brand, five agreement points and the question's own code 9", () => {
    expect(vars.filter((v) => EXTENSION.test(v.name) && v.name !== "choice_role")).toHaveLength(49);
    for (const [c, stem] of [["needs_fit", "needsfit"], ["differentiation", "different"], ["price_justification", "pricejustify"]] as const) {
      const f = found(ext.ratings[c]);
      expect(f.byBrand.map((b) => b.variable)).toEqual(Array.from({ length: 10 }, (_, i) => `${stem}_b${String(i + 1).padStart(2, "0")}`));
      expect(f.byBrand.map((b) => b.code)).toEqual(rec.frame!.brands.map((b) => b.code));
      expect(f.scale.map((s) => s.code)).toEqual(["1", "2", "3", "4", "5"]);
      expect(f.cannotJudge).toEqual([{ code: "9", label: c === "price_justification" ? "Not familiar enough with its prices to judge" : "Do not know enough to judge" }]);
      expect(f.otherCodes).toEqual([]);
    }
  });

  it("the same-episode pair, its Other names, route, gap flag and status codes; never future first choice or the main brand", () => {
    const e = found(ext.episode);
    expect([e.actual.variable, e.ideal.variable, e.actualOther, e.idealOther, e.eligibility?.variable, e.gap?.variable]).toEqual(["choice_actual", "choice_ideal", "choice_actual_other", "choice_ideal_other", "choice_episode_eligible", "choice_gap"]);
    expect(e.codes).toEqual({ other: "96", noIdeal: "98", cannotRecallActual: "99", cannotRecallIdeal: "99" });
    expect(e.gap).toEqual({ variable: "choice_gap", sameCode: "0", differentCode: "1" });
    expect(e.brandCodes.map((b) => b.brand)).toEqual(rec.frame!.brands.map((b) => b.code));
    expect(e.event).toMatch(/^most recent /);
  });

  it("the reasons: the MR set in the questionnaire's order with exact labels, the two exclusive flags outside it, the Other text", () => {
    const r = found(ext.reasons);
    expect(r.options.map((o) => o.variable)).toEqual(Array.from({ length: 10 }, (_, i) => `choice_barrier_r${String(i + 1).padStart(2, "0")}`));
    const labels = new Map(m.variables.map((v) => [v.variable, v.label]));
    expect(r.options.map((o) => o.label)).toEqual(r.options.map((o) => labels.get(o.variable)!.replace(/^Choice gap reason: /, "")));
    expect(r.none).toEqual({ variable: "choice_barrier_none", code: "1" });
    expect(r.cannotRecall).toEqual({ variable: "choice_barrier_dk", code: "1" });
    expect(r.otherText).toBe("choice_barrier_other");
    expect(r.anotherReason).toBe("choice_barrier_r10");
  });

  it("category relevance (relevant_cXX) is not needs fit, and good value for money (a pick-any association) is not price justification", () => {
    const all = Object.values(ext.ratings).flatMap((d) => (d.status === "found" ? d.value.byBrand.map((b) => b.variable) : []));
    expect(all.some((v) => /^relevant_|^attr_/.test(v))).toBe(false);
  });

  it("nothing else changes: the recognition without the 49 columns is the same apart from the extension, the reasons list and the non-brand answers of the episode questions", () => {
    const before = recogniseTracker(vars.filter((v) => !EXTENSION.test(v.name) || v.name === "choice_role"));
    const strip = (r: ReturnType<typeof recogniseTracker>) => ({ ...r, brandExtension: undefined, frame: { ...r.frame!, questions: [], nonBrandCodes: [] }, otherLists: r.otherLists.filter((l) => l.group !== "choice_barriers"), questions: r.questions.filter((q) => q.id !== "non-brand-codes") });
    expect(strip(rec)).toEqual(strip(before));
    expect(rec.frame!.brands).toEqual(before.frame!.brands);
    // The episode questions now carry the brand list too; their extra answers are statuses, never brands.
    expect(rec.frame!.questions).toEqual([...before.frame!.questions, "choice_actual", "choice_ideal"]);
    expect(rec.frame!.nonBrandCodes.map((c) => c.code)).toEqual([...new Set([...before.frame!.nonBrandCodes.map((c) => c.code), "98", "99"])].sort((a, b) => Number(a) - Number(b)));
    // No rating is left as an unknown funnel stage.
    expect(rec.questions.filter((q) => q.id.startsWith("measure:"))).toEqual(before.questions.filter((q) => q.id.startsWith("measure:")));
  });
});

describe("earlier tracker fixtures: every construct Not measured, with what is missing", () => {
  const files = [
    ...readdirSync(path.join(process.cwd(), "fixtures", "tracker-roles")).filter((f) => f.endsWith(".json")).map((f) => path.join("tracker-roles", f)),
    ...readdirSync(path.join(process.cwd(), "fixtures", "tracker-raw")).filter((f) => f.endsWith(".json")).map((f) => path.join("tracker-raw", f)),
  ];
  it.each(files)("%s", (f) => {
    const rec = recogniseTracker(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", f), "utf8")));
    const ext = rec.brandExtension!;
    for (const d of [...Object.values(ext.ratings), ext.episode, ext.reasons]) {
      expect(d.status).toBe("not_measured");
      if (d.status === "not_measured") expect(d.missing.length).toBeGreaterThan(20);
    }
    expect(ext.claimed).toEqual([]);
  });
});

describe("ambiguity is a targeted question, never a guess", () => {
  const base = fromMeta(meta("banks"));
  const frame = recogniseTracker(base).frame!;
  const second: RoleVariable[] = base
    .filter((v) => v.name.startsWith("needsfit_b"))
    .map((v) => ({ ...v, name: v.name.replace("needsfit", "needsfit2"), label: v.label.replace("meets my personal needs", "fits my personal needs"), questionId: "E1b" }));
  const ambiguous = recogniseBrandExtension([...base, ...second], frame);

  it("two needs-fit families: Needs review with both as candidates; the other constructs unaffected", () => {
    const d = ambiguous.ratings.needs_fit;
    expect(d.status).toBe("needs_review");
    if (d.status !== "needs_review") return;
    expect(d.candidates.map((c) => c.variables[0])).toEqual(["needsfit_b01", "needsfit2_b01"]);
    expect(ambiguous.ratings.differentiation.status).toBe("found");
    expect(ambiguous.claimed).toEqual(expect.arrayContaining(["needsfit_b01", "needsfit2_b01"]));
  });

  it("a confirmation of one candidate makes it found with its provenance; not measured is the researcher's decision; a choice not in this file stays in review", () => {
    const d = ambiguous.ratings.needs_fit;
    if (d.status !== "needs_review") throw new Error("expected review");
    const key = d.candidates[0].key;
    const at = "2026-10-30T10:00:00.000Z";
    const confirmed = withConfirmations(ambiguous, { needs_fit: { choice: key, by: "grant@example.org", at, documentId: "d1" } }) as BrandExtensionRecognition;
    const n = confirmed.ratings.needs_fit;
    expect(n.status).toBe("found");
    if (n.status === "found") {
      expect(n.value.byBrand[0].variable).toBe("needsfit_b01");
      expect(n.confirmed).toEqual({ by: "grant@example.org", at, documentId: "d1" });
    }
    expect(withConfirmations(ambiguous, { needs_fit: { choice: "not_measured", by: "g", at, documentId: null } }).ratings.needs_fit.status).toBe("not_measured");
    const stale = withConfirmations(ambiguous, { needs_fit: { choice: "x_b01,x_b02", by: "g", at, documentId: null } }).ratings.needs_fit;
    expect(stale.status).toBe("needs_review");
    if (stale.status === "needs_review") expect(stale.reason).toMatch(/not one of this file's questions/);
    // A construct found without doubt is never overruled by a saved choice.
    const plain = recogniseBrandExtension(base, frame);
    expect(withConfirmations(plain, { needs_fit: { choice: "not_measured", by: "g", at, documentId: null } }).ratings.needs_fit.status).toBe("found");
  });

  it("variables named like the constructs but without wording or answer labels: Needs review, never mapped from the name", () => {
    const named = base.map((v) => (EXTENSION.test(v.name) ? { ...v, label: v.name, valueLabels: undefined, questionId: null, group: null } : v));
    const r = recogniseBrandExtension(named, frame);
    for (const c of ["needs_fit", "differentiation", "price_justification"] as const) {
      expect(r.ratings[c].status).toBe("needs_review");
      if (r.ratings[c].status === "needs_review") expect((r.ratings[c] as { candidates: unknown[] }).candidates).toEqual([]);
    }
    expect(r.episode.status).toBe("not_measured");
    expect(r.claimed).toEqual([]);
  });

  it("a yes/no association worded like needs fit is pick-any, not a five-point rating", () => {
    const binary = base.map((v) => (v.name.startsWith("needsfit_b") ? { ...v, valueLabels: { "0": "Not selected", "1": "Selected" }, questionType: "multiple_response" as const } : v));
    const d = recogniseBrandExtension(binary, frame).ratings.needs_fit;
    // Not read as needs fit; the names alone only ask for review, with no candidate to map.
    expect(d.status).toBe("needs_review");
    if (d.status === "needs_review") expect(d.candidates).toEqual([]);
    const renamed = binary.map((v) => (v.name.startsWith("needsfit_b") ? { ...v, name: v.name.replace("needsfit", "fitflag") } : v));
    expect(recogniseBrandExtension(renamed, frame).ratings.needs_fit.status).toBe("not_measured");
  });

  it("a five-point list whose top is not Strongly agree, or with a gap in its codes, is not read as agreement", () => {
    const rename = (v: RoleVariable) => ({ ...v, name: v.name.replace("needsfit", "q14") });
    const sat = base.map((v) => (v.name.startsWith("needsfit_b") ? rename({ ...v, valueLabels: { "1": "Very dissatisfied", "2": "Dissatisfied", "3": "Neutral", "4": "Satisfied", "5": "Very satisfied", "9": "Do not know enough to judge" } }) : v));
    expect(recogniseBrandExtension(sat, frame).ratings.needs_fit.status).toBe("not_measured");
    const gappy = base.map((v) => (v.name.startsWith("needsfit_b") ? rename({ ...v, valueLabels: { "1": "Strongly disagree", "2": "Disagree", "3": "Neither agree nor disagree", "4": "Agree", "6": "Strongly agree" } }) : v));
    expect(recogniseBrandExtension(gappy, frame).ratings.needs_fit.status).toBe("not_measured");
  });

  it("an unknown extra answer code on the scale makes the rating Needs review (never silently valid or missing)", () => {
    const extra = base.map((v) => (v.name.startsWith("different_b") ? { ...v, valueLabels: { ...v.valueLabels!, "7": "Refused to rate" } } : v));
    const d = recogniseBrandExtension(extra, frame).ratings.differentiation;
    expect(d.status).toBe("needs_review");
    if (d.status === "needs_review") expect(d.reason).toMatch(/7 Refused to rate/);
  });

  it("only future first choice and the main brand: the episode pair is not measured", () => {
    const without = base.filter((v) => !/^choice_(actual|ideal)/.test(v.name));
    const r = recogniseBrandExtension(without, frame);
    expect(r.episode.status).toBe("not_measured");
    if (r.episode.status === "not_measured") expect(r.episode.reason).toMatch(/Future first choice, the main brand/);
  });

  it("actual and ideal worded about different events: Needs review, with the two events named", () => {
    const moved = base.map((v) => (v.name === "choice_ideal" ? { ...v, label: v.label.replace("past 12 months", "past 24 months") } : v));
    const r = recogniseBrandExtension(moved, frame);
    expect(r.episode.status).toBe("needs_review");
    if (r.episode.status === "needs_review") expect(r.episode.reason).toMatch(/different events/);
  });

  it("a reasons list without the gap wording or outside a set is not taken for the reasons", () => {
    const plain = base.map((v) => (v.name.startsWith("choice_barrier_r") ? { ...v, label: v.label.replace("Choice gap reason: ", "Barrier: ") } : v));
    expect(recogniseBrandExtension(plain, frame).reasons.status).toBe("not_measured");
  });
});

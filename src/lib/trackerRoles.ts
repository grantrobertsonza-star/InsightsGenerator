// Which tracker a data file is, and what role each variable plays in its dashboard (plan D1, Grant 28 October
// 2026: "automatically generated from imported data"; "Automatic generation must use question types, brand
// codes, response options and bases, not just variable names"). Pure: no database, no model. Every role is a
// suggestion with its reason; anything the evidence does not settle is returned as a question for the
// researcher, never guessed. The contract is claude/tracker-roles.md; the expected roles for the test packs
// are claude/tracker-packs-role-spec-2026-10-28.md.

import { isZeroToTenScale } from "./descriptiveFindings";
import { brandFrameFromNames, DESIGN_VARIABLE, nameFamilies, nameWords, numberedBrandsWithoutNames, wordingOf } from "./trackerNameFamilies";

/** One variable as the recogniser reads it: what the data file and a confirmed codebook say about it. */
export type RoleVariable = {
  name: string;
  /** The label or question wording (from the data file or a confirmed codebook entry). Presentation and
   * question meaning only: never used as a category's identity. */
  label: string;
  /** Code to label, from the data file or codebook. Codes are the identity; labels are read for meaning. */
  valueLabels?: Record<string, string>;
  /** The question this variable belongs to (a codebook's question ID such as F1), when known. */
  questionId?: string | null;
  /** A codebook's question type when it gives one. */
  questionType?: "categorical" | "multiple_response" | "scale" | "continuous" | "text" | null;
  /** The multiple-response or grid group this variable belongs to (a codebook's MR set, or the set the reader
   * found), when known. Members outside every group (an exclusive None flag, an Other flag) stay outside. */
  group?: string | null;
  numeric: boolean;
  weightLike?: boolean;
  text?: boolean;
  /** How many different values the file holds (the reader's count); read when there are no answer labels. */
  distinct?: number;
};

export type BrandFrame = {
  /** The tracked brands: code (as written) and label, in code order. */
  brands: { code: string; label: string }[];
  /** Codes in the same lists that are not brands, with why ("Other", "None", "No first choice yet"). */
  nonBrandCodes: { code: string; label: string; reason: string }[];
  /** The single-choice questions whose answer lists are this frame. */
  questions: string[];
};

/** A question asked once per brand: its variables by brand code. */
export type PerBrandMeasure = {
  group: string;
  label: string;
  byBrand: { code: string; variable: string }[];
  /** Variables of the question that are not a brand (an exclusive None, an Other flag, "don't know"). */
  outside: string[];
  /** One single-response question per brand (opinion, word of mouth) rather than a yes/no per brand. */
  shape: "binary" | "single";
  stage: FunnelStage | null;
  stageReason: string | null;
};

/** Every stage a per-brand question can have: the one list for recognition, saving and the screens (Codex
 * D2A-F02: a second list in trackerDashboard.ts had not been given trial and frequent use, so they could not be
 * saved). */
export const FUNNEL_STAGES = ["unaided_awareness", "awareness", "consideration", "shortlist", "first_choice", "trial", "usage", "frequent_usage", "acquisition", "repeat", "rejection", "advertising", "word_of_mouth", "moment"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** A brand-by-item grid: one group per item (an attribute, a buying situation), each with a variable per brand. */
export type BrandGrid = { kind: "associations" | "moments"; items: { group: string; item: string; byBrand: { code: string; variable: string }[] }[] };

export type CsmRoles = {
  overallSatisfaction: string | null;
  recommend0to10: string | null;
  likelyToStay: string | null;
  likelyToSwitch: string | null;
  drivers: string[];
};

export type TrackerRecognition = {
  type: "brand" | "csm" | "brand_and_csm" | "unknown";
  frame: BrandFrame | null;
  measures: PerBrandMeasure[];
  grids: BrandGrid[];
  /** Lists whose options are not the brand frame (media, channels, journey steps): never brands or attributes. */
  otherLists: { group: string; label: string; reason: string }[];
  csm: CsmRoles;
  /** What the researcher must decide; never filled in by a guess. */
  questions: { id: string; text: string }[];
};

// ---- Rules ----------------------------------------------------------------------------------------------

/** Answer labels that are never a brand, whatever their code. */
const NON_BRAND = /^(other|others|other \(specify\)|none|none of (the|these)|no brand|no first choice|don'?t know|do not know|not sure|can'?t say|prefer not|refused|not applicable|n\/a|nothing)\b/i;

const clean = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ");
const lower = (s: string) => clean(s).toLowerCase();

/**
 * The brand frame: an answer list of a single-choice question (top of mind, first choice, main brand) whose
 * names are the brands that per-brand questions are about. What separates it from a rating scale shared by many
 * questions ("Would never choose" ... "First choice") is that its names reappear in other questions' wording
 * ("Consideration Toyota", "Toyota associated with Reliable"); a scale's answers do not. A list qualifies when at
 * least three of its names, and at least 60% of them, are named in the wording of variables that do not carry the
 * list; the list named most wins. Answers that are never brands ("Other", "None", "No first choice yet") are set
 * aside by their words, whatever their code.
 */
export function findBrandFrame(variables: RoleVariable[]): BrandFrame | null {
  const lists = variables.filter((v) => v.valueLabels && v.questionType !== "multiple_response" && Object.keys(v.valueLabels).length >= 3);
  const names = (v: RoleVariable) => Object.entries(v.valueLabels!).filter(([, l]) => !NON_BRAND.test(clean(l)));
  const signature = (v: RoleVariable) => names(v).map(([c, l]) => `${c}=${lower(l)}`).sort().join("|");
  const bySignature = new Map<string, RoleVariable[]>();
  for (const v of lists) {
    if (names(v).length < 3) continue;
    const sig = signature(v);
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), v]);
  }
  const words = (s: string) => ` ${lower(s).replace(/[^\p{L}\p{N}&+.'-]+/gu, " ")} `;
  let best: { carriers: RoleVariable[]; named: number } | null = null;
  for (const carriers of bySignature.values()) {
    const carrierNames = new Set(carriers.map((c) => c.name));
    const others = variables.filter((v) => !carrierNames.has(v.name)).map((v) => words(v.label));
    const list = names(carriers[0]);
    const named = list.filter(([, l]) => others.some((o) => o.includes(words(l)))).length;
    if (named < 3 || named < list.length * 0.6) continue;
    if (!best || named > best.named || (named === best.named && carriers.length > best.carriers.length)) best = { carriers, named };
  }
  if (!best) return null;
  const shared = best.carriers;
  const brands = names(shared[0])
    .map(([code, label]) => ({ code, label: clean(label) }))
    .sort((a, b) => Number(a.code) - Number(b.code) || a.code.localeCompare(b.code));
  const nonBrand = new Map<string, { code: string; label: string; reason: string }>();
  for (const v of shared) {
    for (const [code, label] of Object.entries(v.valueLabels!)) {
      if (NON_BRAND.test(clean(label)) && !nonBrand.has(code)) nonBrand.set(code, { code, label: clean(label), reason: `"${clean(label)}" is an answer, not a brand` });
    }
  }
  return { brands, nonBrandCodes: [...nonBrand.values()].sort((a, b) => Number(a.code) - Number(b.code)), questions: shared.map((v) => v.name) };
}

/** Which brand a variable stands for, from its label: the one brand of the frame its wording names. Ties and
 * brand names inside other brand names ("FNB" in "FNB Connect") go to the longest name; no name, no brand. */
/** A brand's names: its label, the label without a parenthetical note, and a former name it gives
 * ("GoTyme Bank (formerly TymeBank)" is also "GoTyme Bank" and "TymeBank"). */
function brandNames(label: string): string[] {
  const out = [label];
  const bare = clean(label.replace(/\([^)]*\)/g, " "));
  if (bare && bare !== label) out.push(bare);
  const former = /\((?:formerly|previously|was)\s+([^)]+)\)/i.exec(label);
  if (former) out.push(clean(former[1]));
  return out;
}

function brandNamed(label: string, frame: BrandFrame): string | null {
  const words = (x: string) => ` ${lower(x).replace(/[^\p{L}\p{N}&+.'-]+/gu, " ")} `;
  const l = words(label);
  const hits = frame.brands.filter((b) => brandNames(b.label).some((n) => l.includes(words(n))));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.label.length - a.label.length);
  const longest = hits[0];
  // Another hit that is not part of the longest name is a second brand: the label is about two brands.
  const others = hits.slice(1).filter((h) => !brandNames(longest.label).some((n) => brandNames(h.label).some((m) => lower(n).includes(lower(m)))));
  return others.length > 0 ? null : longest.code;
}

/** The question's wording once each member's brand name is taken out: the same for every member of a per-brand question. */
function stemOf(label: string, brand: { label: string }): string {
  let out = label;
  for (const n of brandNames(brand.label).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  return clean(out);
}

/** Funnel and brand-measure stage from the question's wording, with the words that decided it. */
const STAGE_WORDS: [FunnelStage, RegExp][] = [
  // Advertising first: "unprompted advertising recall" is about advertising, not brand awareness.
  ["advertising", /\badvert|\bad recall\b|\bads?\b/i],
  ["word_of_mouth", /\bword of mouth\b|\bwom\b|\bheard\b.*\b(said|say)\b/i],
  ["moment", /\bcep links?\b|\bmental (availability|market share|penetration)\b|\bnetwork size\b/i],
  ["unaided_awareness", /\b(spontaneous|unaided|unprompted)\b.*\b(awareness|recall)\b|\b(awareness|recall)\b.*\b(spontaneous|unaided|unprompted)\b/i],
  ["awareness", /\b(prompted|aided)?\s*(awareness|recognition|aware|heard of)\b/i],
  ["consideration", /\bconsider/i],
  ["shortlist", /\bshortlist/i],
  ["first_choice", /\bfirst choice\b|\bpreferred\b|\bmost likely to choose\b/i],
  ["rejection", /\bopinion\b|\bwould never\b|\breject/i],
  // Ever used before usage: having tried a brand is not using it now (D2, Grant's coffee tracker "ever used").
  ["trial", /\bever (used|bought|tried|purchased)\b|\btried\b|\btrial\b/i],
  // Frequent use before usage: "frequent" and "most often" are a stage of their own (the brand health funnel's
  // "Frequent / repeat usage").
  ["frequent_usage", /\bfrequent(ly)?\b|\bmost often\b|\bregular(ly)?\b/i],
  // Repeat before acquisition: "repeat brand acquisition" and "previously acquired same brand" are repeats.
  ["repeat", /\brepeat\b|\bprior same-brand\b|\bsame brand\b|\bagain\b/i],
  ["acquisition", /\bacquisition\b|\bacquired\b|\bbought\b|\bpurchased?\b|\bstart(ed)?\b/i],
  ["usage", /\b(own|owner|ownership|use|used|usage|bank with|customer of|current)\b|\bp3m\b|\bpast (3|three) months?\b/i],
];

function stageOf(wording: string): { stage: FunnelStage; reason: string } | null {
  for (const [stage, re] of STAGE_WORDS) {
    const m = re.exec(wording);
    if (m) return { stage, reason: `the question says "${m[0].trim()}"` };
  }
  return null;
}

// ---- Recognition ------------------------------------------------------------------------------------------

export function recogniseTracker(variables: RoleVariable[]): TrackerRecognition {
  // Survey-design variables (module selection, selection probability, response status) are not answers.
  const usable = variables.filter((v) => !v.weightLike && !v.text && !DESIGN_VARIABLE.test(v.label));
  const frame = findBrandFrame(usable);
  const questions: TrackerRecognition["questions"] = [];
  const measures: PerBrandMeasure[] = [];
  const grids: BrandGrid[] = [];
  const otherLists: TrackerRecognition["otherLists"] = [];

  // Groups: a codebook's MR set, else a question ID; a variable in neither is on its own.
  const groups = new Map<string, RoleVariable[]>();
  for (const v of usable) {
    const g = v.group ?? (v.questionId ? `q:${v.questionId}` : null);
    if (!g) continue;
    groups.set(g, [...(groups.get(g) ?? []), v]);
  }

  if (frame) {
    const gridItems = new Map<string, { group: string; item: string; byBrand: { code: string; variable: string }[] }[]>();
    for (const [group, members] of groups) {
      const byBrand: { code: string; variable: string }[] = [];
      const outside: string[] = [];
      for (const v of members) {
        const code = brandNamed(v.label, frame);
        if (code && !byBrand.some((b) => b.code === code)) byBrand.push({ code, variable: v.name });
        else outside.push(v.name);
      }
      // A per-brand question names most of the frame's brands, one variable each.
      if (byBrand.length >= Math.max(3, Math.ceil(frame.brands.length * 0.6))) {
        const first = members.find((m) => m.name === byBrand[0].variable)!;
        const brand = frame.brands.find((b) => b.code === byBrand[0].code)!;
        const stem = stemOf(first.label, brand);
        const isGridItem = /\b(associated with|recalled for|for)\b/i.test(stem) && stem.split(" ").length > 2;
        if (isGridItem) {
          const kind = /\brecalled for\b/i.test(stem) ? "moments" : "associations";
          const item = clean(stem.replace(/^.*?\b(associated with|recalled for)\b/i, ""));
          gridItems.set(kind, [...(gridItems.get(kind) ?? []), { group, item, byBrand: byBrand.sort((a, b) => Number(a.code) - Number(b.code)) }]);
          continue;
        }
        const shape: PerBrandMeasure["shape"] = first.questionType === "multiple_response" || isYesNo(first) ? "binary" : "single";
        const st = stageOf(stem);
        measures.push({ group, label: stem, byBrand: byBrand.sort((a, b) => Number(a.code) - Number(b.code)), outside, shape, stage: st?.stage ?? null, stageReason: st?.reason ?? null });
        continue;
      }
      // A list of options none of which is a brand of the frame: its own kind of list, never brands.
      if (members.length >= 3 && byBrand.length === 0 && members.every((m) => m.questionType === "multiple_response" || isYesNo(m))) {
        otherLists.push({ group, label: members[0].questionId ?? group, reason: "its options are not the tracked brands" });
      }
    }
    for (const [kind, items] of gridItems) grids.push({ kind: kind as BrandGrid["kind"], items });
  }

  // A raw file with no answer lists (D2): the brands from the names and labels of the questions asked per brand.
  let brandFrame = frame;
  if (!frame) {
    const named = recogniseFromNames(usable, measures, grids, otherLists);
    if (named) brandFrame = named;
    else if (numberedBrandsWithoutNames(usable)) {
      questions.push({ id: "brand-names", text: "This file numbers its brands in the variable names (for example _b01 to _b10) without naming them. Add its codebook or labels file so the brands can be named." });
    }
  }

  if (brandFrame) {
    const frame = brandFrame;
    // A funnel stage claimed by two questions is the researcher's choice. Advertising, word of mouth and
    // moment measures come in several kinds (unprompted and prompted recall, CEP links and mental
    // availability), each shown on its own, so two of them are not a conflict.
    const SEVERAL_ALLOWED = new Set<FunnelStage>(["advertising", "word_of_mouth", "moment"]);
    const byStage = new Map<FunnelStage, PerBrandMeasure[]>();
    for (const m of measures) if (m.stage && !SEVERAL_ALLOWED.has(m.stage)) byStage.set(m.stage, [...(byStage.get(m.stage) ?? []), m]);
    for (const [stage, ms] of byStage) {
      if (ms.length > 1) questions.push({ id: `stage:${stage}`, text: `Which question is ${stage.replace(/_/g, " ")}: ${ms.map((m) => m.label).join(" or ")}?` });
    }
    for (const m of measures.filter((x) => !x.stage)) questions.push({ id: `measure:${m.group}`, text: `What does "${m.label}" measure for each brand?` });
    questions.push({ id: "focal-brand", text: "Which brand is your client's (the main brand)?" });
    if (frame.nonBrandCodes.length > 0) {
      questions.push({ id: "non-brand-codes", text: `These answers are not brands and are left out of brand results: ${frame.nonBrandCodes.map((c) => `${c.code} ${c.label}`).join(", ")}. Is that right?` });
    }
  }

  const csm = recogniseCsm(usable, questions);
  const isBrand = !!brandFrame && measures.filter((m) => m.stage && ["awareness", "unaided_awareness", "consideration", "shortlist", "first_choice", "usage"].includes(m.stage)).length >= 2;
  const isCsm = !!csm.overallSatisfaction && !!csm.recommend0to10;
  const type = isBrand && isCsm ? "brand_and_csm" : isBrand ? "brand" : isCsm ? "csm" : "unknown";
  return { type, frame: brandFrame, measures, grids, otherLists, csm, questions };
}

/**
 * The brand list and the per-brand questions of a raw file with no answer lists (D2; trackerNameFamilies.ts):
 * a family of variables named after one brand whose items vary (Association_PlatoCoffee_GoodService, ...,
 * moment_m1_b1, moment_m2_b1, ...) is that brand's row of a grid of attributes or buying situations, however many
 * brands were asked; each other family whose names differ only in the brand is a question asked per brand; a
 * family with no brand among its items or in its name is a list of its own (media, channels, moments).
 * Fills measures, grids and otherLists; returns the brand list, or null when the names give none.
 */
function recogniseFromNames(usable: RoleVariable[], measures: PerBrandMeasure[], grids: BrandGrid[], otherLists: TrackerRecognition["otherLists"]): BrandFrame | null {
  const nf = brandFrameFromNames(usable, (text) => stageOf(text) !== null);
  if (!nf) return null;
  const byName = new Map(usable.map((v) => [v.name, v]));
  const order = new Map(nf.brands.map((b, i) => [b.code, i]));
  const brandCodes = new Set(nf.brands.map((b) => b.code));
  const nonBrandCodes = new Set(nf.nonBrand.map((c) => c.code));
  const frame: BrandFrame = {
    brands: nf.brands.map((b) => ({ code: b.code, label: clean(b.label) })),
    nonBrandCodes: nf.nonBrand.map((c) => ({ code: c.code, label: clean(c.label), reason: `"${clean(c.label)}" is an answer, not a brand` })),
    questions: [],
  };
  const parts = (t: string) => t.split("_");
  const wordedItem = (v: RoleVariable, brandCode: string, itemCode: string) => {
    if (!v.label || v.label.trim() === v.name) return nameWords(itemCode);
    const brandLabel = frame.brands.find((b) => b.code === brandCode)?.label ?? "";
    return clean(stemOf(v.label, { label: brandLabel }).replace(/^[\s:\-–]+|[\s:\-–]+$/g, "")) || nameWords(itemCode);
  };
  // Grids: families named after one brand whose items are attributes or buying situations
  // (Association_PlatoCoffee_*, moment_*_b1), however many brands were asked about.
  const gridItems = new Map<string, { kind: BrandGrid["kind"]; items: Map<string, BrandGrid["items"][number]> }>();
  const inGrid = new Set<string>();
  for (const f of nameFamilies(usable)) {
    const tp = parts(f.template);
    const at = tp.findIndex((p, i) => i !== f.slot && brandCodes.has(p));
    if (at < 0 || tp.length < 3) continue;
    const key = tp.map((p, i) => (i === at ? "#" : p)).join("_");
    const kind: BrandGrid["kind"] = /moment|occasion|situation|\bcep\b|need/i.test(key) ? "moments" : "associations";
    const grid = gridItems.get(key) ?? { kind, items: new Map() };
    for (const m of f.members) {
      if (/^(none|dk|other)$/i.test(m.code)) {
        inGrid.add(m.variable); // "No attributes associated" belongs to the grid, as an answer, not an item
        continue;
      }
      const v = byName.get(m.variable)!;
      const item: BrandGrid["items"][number] = grid.items.get(m.code) ?? { group: tp.map((p, i) => (i === at ? "*" : i === f.slot ? m.code : p)).join("_"), item: wordedItem(v, tp[at], m.code), byBrand: [] };
      if (!item.byBrand.some((b) => b.code === tp[at])) item.byBrand.push({ code: tp[at], variable: m.variable });
      grid.items.set(m.code, item);
      inGrid.add(m.variable);
    }
    gridItems.set(key, grid);
  }
  for (const { kind, items } of gridItems.values()) {
    const list = [...items.values()].map((it) => ({ ...it, byBrand: it.byBrand.sort((a: { code: string }, b: { code: string }) => order.get(a.code)! - order.get(b.code)!) }));
    const existing = grids.find((g) => g.kind === kind);
    if (existing) existing.items.push(...list);
    else grids.push({ kind, items: list });
  }
  // Questions asked once per brand: the brand families that are not grid cells.
  for (const f of nf.families) {
    if (f.members.every((m) => inGrid.has(m.variable))) continue;
    const byBrand = f.members.filter((m) => brandCodes.has(m.code)).map((m) => ({ code: m.code, variable: m.variable })).sort((a, b) => order.get(a.code)! - order.get(b.code)!);
    const outside = f.members.filter((m) => !brandCodes.has(m.code)).map((m) => m.variable);
    const first = byName.get(byBrand[0].variable)!;
    const brand = frame.brands.find((b) => b.code === byBrand[0].code)!;
    const labelled = !!first.label && first.label.trim() !== first.name;
    const stem = clean(stemOf(wordingOf(first), { label: labelled ? brand.label : nameWords(byBrand[0].code) }).replace(/[\s:\-–]+$/, ""));
    const binary = first.questionType === "multiple_response" || isYesNo(first) || (!first.valueLabels && first.distinct !== undefined && first.distinct <= 2);
    const st = stageOf(stem);
    measures.push({ group: f.template, label: stem, byBrand, outside, shape: binary ? "binary" : "single", stage: st?.stage ?? null, stageReason: st?.reason ?? null });
  }
  // Lists whose items are no brand: a family with its varying part last, no brand in its name or its items.
  const covered = new Set(nf.families.flatMap((f) => f.members.map((m) => m.variable)));
  for (const f of nameFamilies(usable)) {
    if (f.slot !== parts(f.template).length - 1) continue;
    if (f.members.some((m) => brandCodes.has(m.code) || covered.has(m.variable))) continue;
    if (parts(f.template).some((p) => brandCodes.has(p) || nonBrandCodes.has(p))) continue;
    otherLists.push({ group: f.template, label: nameWords(f.template.replace(/_?\*$/, "")), reason: "its options are not the tracked brands" });
  }
  return frame;
}

function isYesNo(v: RoleVariable): boolean {
  const codes = Object.keys(v.valueLabels ?? {});
  return codes.length > 0 && codes.length <= 2 && codes.every((c) => c === "0" || c === "1");
}

/**
 * Whether a variable is the 0 to 10 scale the Net Promoter calculation accepts (isZeroToTenScale, the one rule;
 * Codex D1-F01). "yes": its answer codes below the non-answer codes (98, 99) pass that rule, or, in a raw file
 * with no answer labels, its wording states "0 to 10" and it holds no more values than such a scale can.
 * "partial": its answer list includes 0 and 10 but not every point between, so the scale is not stated in full;
 * the researcher is asked. "no": anything else (1 to 10, 6 to 10, no 0, a top that is not 10). No endpoint is
 * inferred that the file does not give.
 */
function zeroToTen(v: RoleVariable): "yes" | "partial" | "no" {
  if (v.valueLabels) {
    const codes = Object.keys(v.valueLabels).map(Number).filter((n) => Number.isFinite(n) && n < 90);
    if (isZeroToTenScale(codes)) return "yes";
    return codes.includes(0) && codes.includes(10) && codes.every((n) => Number.isInteger(n) && n >= 0 && n <= 10) ? "partial" : "no";
  }
  return /\b0\s*(?:to|-|–)\s*10\b/i.test(wordingOf(v)) && v.distinct !== undefined && v.distinct <= 13 ? "yes" : "no";
}

/** The top of a rating scale: the highest plain code on its answer list below the non-answer codes (98, 99), or
 * for a raw file without answer labels the range its wording states ("0 to 10", "0to10", "(1-5)"). Never the
 * highest answer the data happens to hold (Codex D3A-F01: a sparse wave without 8 or 9 would move a top box). Used to
 * recognise roles. A non-answer coded below 90 (6 = Don't know on 1 to 5) is not excluded here, so the CSM tiles take
 * a labelled question's top from the engine's own answers instead (boxScaleTop, Codex D3AR-F01), and this only for a
 * question without an answer list. */
export function scaleTop(v: RoleVariable): number | null {
  const codes = Object.keys(v.valueLabels ?? {}).map(Number).filter((n) => Number.isInteger(n) && n < 90);
  if (codes.length) return Math.max(...codes);
  const stated = /\b(?:0|1)\s*(?:to|-|–)\s*(\d{1,2})\b/i.exec(wordingOf(v));
  if (stated) return Number(stated[1]);
  // A name that ends in its scale's size ("company_csat5", "continue5").
  const suffix = /[a-z](3|4|5|7|10|11)$/i.exec(v.name);
  return suffix ? Number(suffix[1]) : null;
}

/**
 * CSM roles from wording and answer lists: overall satisfaction (a rating of the company with a satisfied end),
 * likelihood to recommend on 0 to 10, likely to stay, likely to switch, and the driver battery (performance
 * ratings sharing one question). Two candidates for one role is a question for the researcher, except that
 * among several overall satisfaction ratings the one about the company (or provider, bank, brand) is the
 * relationship measure the others (call centre, agent, IVR) are parts of. A raw file without answer labels
 * (D2) is read from its wording, its names' words when it has no labels, and the scale its wording states.
 */
function recogniseCsm(variables: RoleVariable[], questions: TrackerRecognition["questions"]): CsmRoles {
  // Ratings only: a scale question or an answer list of three or more answers; without answer labels, a number
  // with three to eleven values. A yes/no flag that mentions switching ("Makes switching simple") is an
  // attribute, not a likelihood to switch.
  const rated = variables.filter(
    (v) =>
      v.numeric &&
      v.questionType !== "multiple_response" &&
      !isYesNo(v) &&
      (v.questionType === "scale" || Object.keys(v.valueLabels ?? {}).filter((c) => Number(c) < 90).length >= 3 || (!v.valueLabels && v.distinct !== undefined && v.distinct >= 3 && v.distinct <= 11)),
  );
  const words = (v: RoleVariable) => wordingOf(v);
  const pick = (id: string, role: string, test: (v: RoleVariable) => boolean, prefer?: (v: RoleVariable) => boolean): string | null => {
    let found = rated.filter(test);
    if (found.length > 1 && prefer && found.filter(prefer).length === 1) found = found.filter(prefer);
    if (found.length > 1) questions.push({ id: `csm:${id}`, text: `Which question is ${role}: ${found.map((v) => `${v.name} ("${words(v)}")`).join(" or ")}?` });
    return found.length === 1 ? found[0].name : null;
  };
  const labels = (v: RoleVariable) => Object.values(v.valueLabels ?? {}).join(" ").toLowerCase();
  const overallSatisfaction = pick(
    "satisfaction",
    "overall satisfaction",
    (v) => /\bsatisf|\bcsat/i.test(words(v)) && /\boverall\b|\bcompany\b|\bprovider\b|\bbank\b/i.test(words(v)) && !/\bchannel\b|\bhandling\b|\bivr\b/i.test(words(v)) && (!v.valueLabels || /satisf/.test(labels(v))),
    (v) => /\bcompany\b|\bprovider\b|\bbank\b|\bbrand\b/i.test(words(v)),
  );
  // The net promoter question is asked as a likelihood ("How likely ... recommend"); "recommend to a friend" in a
  // word-of-mouth battery is one of its items. Only a stated 0 to 10 scale qualifies (zeroToTen, D1-F01); a
  // recommend question whose list labels only some points is asked about, never assumed.
  // Not only the ratings: a list labelling only its two ends has too few answers to count as a rating.
  const recommends = variables.filter((v) => v.numeric && v.questionType !== "multiple_response" && !isYesNo(v) && /\brecommend/i.test(words(v)));
  for (const v of recommends.filter((x) => zeroToTen(x) === "partial")) {
    questions.push({ id: `csm:recommend-scale:${v.name}`, text: `Is ${v.name} ("${words(v)}") a 0 to 10 scale? Its answer list labels only ${Object.keys(v.valueLabels ?? {}).join(", ")}.` });
  }
  const recommend0to10 = pick("recommend", "likelihood to recommend (0 to 10)", (v) => /\brecommend/i.test(words(v)) && zeroToTen(v) === "yes", (v) => /\blikel\w*\b.*\brecommend|\bhow likely\b/i.test(words(v)));
  const likelyToStay = pick("stay", "likely to stay", (v) => /\b(continue|stay|remain)\b/i.test(words(v)) && !/\bswitch\b/i.test(words(v)));
  const likelyToSwitch = pick("switch", "likely to switch", (v) => /\bswitch/i.test(words(v)) && !/\bprice\b/i.test(words(v)));
  const roles = new Set([overallSatisfaction, recommend0to10, likelyToStay, likelyToSwitch].filter(Boolean));
  // Drivers: a battery of performance ratings: one question, three or more items, one answer list running
  // from poor to excellent (a rating of how well something is done). Importance and agreement batteries have
  // other answer lists and are not drivers.
  const byQuestion = new Map<string, RoleVariable[]>();
  for (const v of rated) {
    const l = labels(v);
    // One question: its codebook question ID, else its set, else its name less the last part (company_driver_d01
    // is "company_driver"): a raw workbook with its own labels gives no question IDs.
    const q = v.questionId ?? v.group ?? v.name.replace(/_[^_]+$/, "");
    if (/\bpoor\b/.test(l) && /\bexcellent\b/.test(l) && !/\bimportan/.test(l)) byQuestion.set(q, [...(byQuestion.get(q) ?? []), v]);
  }
  const sameList = (g: RoleVariable[]) => new Set(g.map((v) => JSON.stringify(v.valueLabels ?? {}))).size === 1;
  let batteries = [...byQuestion.values()].filter((g) => g.length >= 3 && sameList(g)).sort((a, b) => b.length - a.length);
  let batteryName = (g: RoleVariable[]) => g[0].questionId ?? g[0].group ?? g[0].name.replace(/_[^_]+$/, "");
  // Without answer labels: ratings on one stated scale whose names differ in one part (AgentEmpathy_*_0to10).
  if (batteries.length === 0) {
    const ratedByName = new Map(rated.filter((v) => !v.valueLabels && !roles.has(v.name)).map((v) => [v.name, v]));
    const fams = nameFamilies([...ratedByName.values()]).filter((f) => {
      const vs = f.members.map((m) => ratedByName.get(m.variable)!);
      // One scale: the same stated top, or none stated for any of them.
      return !/\bimportan/i.test(f.template) && new Set(vs.map((v) => scaleTop(v))).size === 1;
    });
    batteries = fams.map((f) => f.members.map((m) => ratedByName.get(m.variable)!)).sort((a, b) => b.length - a.length);
    const famName = new Map(fams.map((f) => [f.members[0].variable, nameWords(f.template.replace(/_?\*_?/g, " ").replace(/\b\d+ ?to ?\d+\b/gi, "").trim())]));
    batteryName = (g) => famName.get(g[0].name) ?? g[0].name;
  }
  if (batteries.length > 1 && batteries[0].length === batteries[1].length) questions.push({ id: "csm:drivers", text: `Which ratings are the drivers: ${batteries.map((g) => `${batteryName(g)} (${g.length})`).join(", ")}?` });
  const drivers = batteries.length === 1 || (batteries.length > 1 && batteries[0].length > batteries[1].length) ? batteries[0].map((v) => v.name) : [];
  return { overallSatisfaction, recommend0to10, likelyToStay, likelyToSwitch, drivers };
}

import { tokenSet } from "./instrumentMatch";

// Maps the questions a moderator actually asked onto the items of a
// discussion or interview guide. Pure: no database, no model. A match is a
// wording overlap, so it is a prompt to look, not a verdict.

export type GuideItemLike = { id: string; order: number; section: string | null; code: string | null; text: string };
export type TurnLike = { index: number; speaker: string | null; role: "participant" | "moderator" | "unknown"; text: string };

export const ASKED_MIN = 0.7; // asked close to as written
export const REWORDED_MIN = 0.4; // clearly the same topic in other words
export const MIN_TOKENS = 2; // items shorter than this (a bare "Why?") cannot be matched by wording
export const COVERAGE_PASS = 0.8;
export const COVERAGE_WARN = 0.5;
export const UNSCRIPTED_WARN = 0.5;

export type CoverageStatus = "asked" | "reworded" | "not_asked" | "unmatchable";

export type ItemCoverage = {
  itemId: string;
  status: CoverageStatus;
  /** Moderator turns that matched this item. */
  askedCount: number;
  firstTurn: number | null;
  /** Words the participants said after the first matching turn, up to the next moderator turn. */
  answerWords: number;
  confidence: number;
};

export type GuideCoverage = {
  items: ItemCoverage[];
  scored: number;
  asked: number;
  reworded: number;
  notAsked: number;
  unmatchable: number;
  coverage: number | null; // (asked + reworded) / scored
  moderatorQuestions: number;
  unscripted: { turn: number; text: string }[];
  unscriptedShare: number | null;
  /** Share of matched item pairs asked in the guide's order. */
  inOrder: number | null;
  checks: { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }[];
  status: "pass" | "warn" | "fail";
};

const wc = (s: string) => (s.match(/\S+/g) ?? []).length;

/** One moderator turn can hold several questions. Split on question marks, keep each question with its lead-in. */
export function questionUnits(text: string): string[] {
  const out: string[] = [];
  const re = /[^?.!]*\?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = m[0].replace(/\s+/g, " ").trim();
    if (q.length > 3) out.push(q);
  }
  return out;
}

function score(guide: Set<string>, asked: Set<string>): number {
  if (guide.size === 0 || asked.size === 0) return 0;
  let shared = 0;
  for (const t of guide) if (asked.has(t)) shared++;
  const cover = shared / guide.size; // how much of the guide item was said
  const jac = shared / (guide.size + asked.size - shared);
  return 0.6 * cover + 0.4 * jac;
}

export function computeGuideCoverage(items: GuideItemLike[], turns: TurnLike[]): GuideCoverage {
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const itemTokens = ordered.map((i) => tokenSet(i.text));

  // Moderator turns; where no role was detected, fall back to unlabelled turns that ask something.
  const hasModerator = turns.some((t) => t.role === "moderator");
  const modTurns = turns.filter((t) => (hasModerator ? t.role === "moderator" : t.role === "unknown" && t.text.includes("?")));

  type Unit = { turn: number; text: string; tokens: Set<string> };
  const units: Unit[] = [];
  for (const t of modTurns) for (const q of questionUnits(t.text)) units.push({ turn: t.index, text: q, tokens: tokenSet(q) });

  const cov: ItemCoverage[] = ordered.map((i, k) => ({
    itemId: i.id,
    status: itemTokens[k].size < MIN_TOKENS ? "unmatchable" : "not_asked",
    askedCount: 0,
    firstTurn: null,
    answerWords: 0,
    confidence: 0,
  }));

  const usedUnits = new Set<number>();
  units.forEach((u, ui) => {
    let best = -1;
    let bestScore = 0;
    for (let k = 0; k < ordered.length; k++) {
      if (cov[k].status === "unmatchable") continue;
      const s = score(itemTokens[k], u.tokens);
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    if (best < 0 || bestScore < REWORDED_MIN) return;
    usedUnits.add(ui);
    const c = cov[best];
    c.askedCount++;
    if (c.firstTurn === null || u.turn < c.firstTurn) c.firstTurn = u.turn;
    c.confidence = Math.max(c.confidence, bestScore);
  });

  for (const c of cov) {
    if (c.status === "unmatchable") continue;
    if (c.askedCount > 0) c.status = c.confidence >= ASKED_MIN ? "asked" : "reworded";
    if (c.firstTurn !== null) {
      let words = 0;
      for (const t of turns) {
        if (t.index <= c.firstTurn) continue;
        if (t.role === "moderator") break;
        if (t.role === "participant") words += wc(t.text);
      }
      c.answerWords = words;
    }
  }

  const count = (s: CoverageStatus) => cov.filter((c) => c.status === s).length;
  const asked = count("asked");
  const reworded = count("reworded");
  const notAsked = count("not_asked");
  const unmatchable = count("unmatchable");
  const scored = asked + reworded + notAsked;
  const coverage = scored > 0 ? (asked + reworded) / scored : null;

  const unscripted = units
    .filter((_, ui) => !usedUnits.has(ui))
    .filter((u) => u.tokens.size >= MIN_TOKENS)
    .map((u) => ({ turn: u.turn, text: u.text.length > 160 ? `${u.text.slice(0, 159)}…` : u.text }));
  const unscriptedShare = units.length > 0 ? unscripted.length / units.length : null;

  // Order: of the matched items, how many pairs were first asked in guide order.
  const firsts = cov.map((c) => c.firstTurn).filter((x): x is number => x !== null);
  let pairs = 0;
  let good = 0;
  for (let a = 0; a < firsts.length; a++) for (let b = a + 1; b < firsts.length; b++) {
    pairs++;
    if (firsts[a] <= firsts[b]) good++;
  }
  const inOrder = pairs > 0 ? good / pairs : null;

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const checks: GuideCoverage["checks"] = [];
  if (coverage === null) {
    checks.push({ id: "coverage", label: "Guide coverage", status: "warn", detail: "No guide item has enough wording to match." });
  } else {
    checks.push({
      id: "coverage",
      label: "Guide coverage",
      status: coverage >= COVERAGE_PASS ? "pass" : coverage >= COVERAGE_WARN ? "warn" : "fail",
      detail: `${asked + reworded} of ${scored} guide items were raised (${asked} close to as written, ${reworded} reworded). ${notAsked} do not appear to have been asked.`,
    });
  }
  if (unscriptedShare !== null) {
    checks.push({
      id: "unscripted",
      label: "Questions outside the guide",
      status: unscriptedShare > UNSCRIPTED_WARN ? "warn" : "pass",
      detail: `${unscripted.length} of ${units.length} moderator questions did not match a guide item. Follow-up probes are expected here.`,
    });
  }
  if (inOrder !== null) {
    checks.push({
      id: "order",
      label: "Guide order",
      status: inOrder >= 0.75 ? "pass" : "warn",
      detail: `${pct(inOrder)} of matched item pairs were raised in the guide's order.`,
    });
  }
  if (units.length === 0) {
    checks.push({ id: "questions", label: "Moderator questions found", status: "warn", detail: "No moderator questions were found in this transcript. Check the moderator labels and session type." });
  }
  const status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";

  return { items: cov, scored, asked, reworded, notAsked, unmatchable, coverage, moderatorQuestions: units.length, unscripted, unscriptedShare, inOrder, checks, status };
}

/** Topics from a guide to offer the open-coding pass as hints. Sections first, then main questions. */
export function guideHints(items: GuideItemLike[], max = 25): string[] {
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (t.length < 4 || seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push(t.length > 140 ? `${t.slice(0, 139)}…` : t);
  };
  for (const i of ordered) if (i.section) add(i.section);
  for (const i of ordered) if (tokenSet(i.text).size >= 3) add(i.text);
  return out;
}

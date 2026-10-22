// Suggests which dataset variables each questionnaire item produced. Pure:
// no database, no model. Every result is a suggestion with a stated method
// and confidence, and none of them is applied until the researcher confirms.

export type ItemLike = { id: string; code: string | null; text: string };
export type VariableLike = { name: string; label: string };

export type MatchMethod = "code" | "stem" | "wording";
export type MatchCandidate = {
  itemId: string;
  variable: string;
  method: MatchMethod;
  confidence: number; // 0 to 1
};

export const WORDING_MIN = 0.55;
export const STEM_CAP = 60;
/**
 * A multiple-response family (Grant, 2026-10-22: the FinScope stem EN20 showed No match although
 * the data has EN20_1 to EN20_n): two or more variables named the item's code, an explicit
 * separator (_ . or -) and a suffix. The codes are explicit, so the family sits at the confidence
 * "Confirm same-code matches" confirms (AUTO_CONFIRM_MIN, 0.9) and above the two weaker routes that
 * used to take members away from the stem: a wording match from another question (at most 0.89) and
 * a label that starts with another question's code (0.9). An exact code still wins (1).
 */
export const FAMILY_CONFIDENCE = 0.92;

const STOP = new Set(
  "the and for that this with from your you are was were have has had been will would could should what which when where who how why about into over than then them they their there these those also any all can not but our out its just more most some such only very per each both other another one two three four five ask read prompt interviewer please select none dont know refused code codes".split(" "),
);

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (w.length > 2 && !STOP.has(w)) out.add(w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w);
  }
  return out;
}

/** The word set used for wording overlap, shared with the guide matcher. */
export const tokenSet = tokens;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The item code as matching uses it: NFKC, without spaces or invisible characters (a PDF read can
 * carry a non-breaking or zero-width space), and without trailing punctuation ("EN20." or "Q5a)").
 * Empty when nothing code-like is left.
 */
export function matchableCode(code: string | null | undefined): string {
  return (code ?? "")
    .normalize("NFKC")
    .replace(/[\s\u200B-\u200D\uFEFF]/g, "")
    .replace(/[.):,;]+$/, "");
}

/**
 * The variables whose name is the item code: compared without case, spaces or invisible characters,
 * and with _ . and - treated as one separator (EN20.1 is EN20_1). Where that finds none, the looser
 * comparison that ignores separators altogether (Q1a and Q1_a) is used, but never across a separator
 * between two digits: removing it changes the number, so EN201 is not EN20_1 and EN20_1 is not EN201.
 * The one exact-code rule, for the matcher and for codeFamily.
 */
export function exactCodeVariables(code: string | null | undefined, variableNames: string[]): string[] {
  const c = matchableCode(code);
  if (!c) return [];
  const strict = (s: string) => matchableCode(s).toLowerCase().replace(/[_.\-]/g, "_");
  const exact = variableNames.filter((n) => strict(n) === strict(c));
  if (exact.length > 0) return exact;
  const splitsNumber = (s: string) => /\d[_.\-]+\d/.test(s);
  if (splitsNumber(c)) return [];
  return variableNames.filter((n) => norm(n) === norm(c) && !splitsNumber(n));
}

/**
 * The variables of a multiple-response family for an item code: names that are the code, then _ .
 * or -, then a suffix, compared case-insensitively. The separator is what puts the boundary at the
 * end of the code, so EN2 never takes EN20_1 and EN20 never takes EN201. Empty when a variable has
 * the code itself (that variable is the question) or fewer than two names qualify. In file order,
 * at most STEM_CAP. The one rule for the matcher and for "Link all" in the manual picker.
 */
export function codeFamily(code: string | null | undefined, variableNames: string[]): string[] {
  const c = matchableCode(code);
  if (!c) return [];
  if (exactCodeVariables(c, variableNames).length > 0) return [];
  const re = new RegExp(`^${esc(c)}[_.\\-][A-Za-z0-9_.\\-]+$`, "i");
  const members = variableNames.filter((n) => re.test(n));
  return members.length >= 2 ? members.slice(0, STEM_CAP) : [];
}

export function matchItems(items: ItemLike[], variables: VariableLike[]): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const names = variables.map((v) => v.name);

  // Inverted index over variable label tokens, for the wording pass.
  const labelTokens = variables.map((v) => tokens(v.label));
  const index = new Map<string, number[]>();
  labelTokens.forEach((set, i) => {
    for (const t of set) index.set(t, [...(index.get(t) ?? []), i]);
  });

  const best = new Map<string, MatchCandidate>(); // by variable, highest confidence wins

  const offer = (c: MatchCandidate) => {
    const cur = best.get(c.variable);
    if (!cur || c.confidence > cur.confidence) best.set(c.variable, c);
  };

  for (const item of items) {
    let matched = false;
    const code = matchableCode(item.code);
    if (code) {
      const exact = exactCodeVariables(code, names);
      if (exact.length > 0) {
        for (const name of exact) offer({ itemId: item.id, variable: name, method: "code", confidence: 1 });
        matched = true;
      } else {
        const family = new Set(codeFamily(code, names));
        for (const name of family) offer({ itemId: item.id, variable: name, method: "stem", confidence: FAMILY_CONFIDENCE });
        // Other stems (a letter suffix such as EN20a or EN20r1, or a single suffixed variable) may be
        // separate questions, so they stay below the confirm-all level for the researcher to check.
        const re = new RegExp(`^${esc(code)}(?:[_.\\-][A-Za-z0-9_.\\-]*|[A-Za-z](?:[_.\\-]?[A-Za-z0-9_.\\-]*)?)$`, "i");
        const stem = variables.filter((v) => !family.has(v.name) && re.test(v.name)).slice(0, STEM_CAP);
        for (const v of stem) offer({ itemId: item.id, variable: v.name, method: "stem", confidence: stem.length === 1 ? 0.8 : 0.85 });
        if (family.size > 0 || stem.length > 0) matched = true;
      }
      // A variable label that starts with the item's code is nearly as good as a name match.
      if (!matched) {
        const lead = new RegExp(`^\\s*${esc(code)}\\b`, "i");
        for (const v of variables) {
          if (lead.test(v.label)) {
            offer({ itemId: item.id, variable: v.name, method: "code", confidence: 0.9 });
            matched = true;
          }
        }
      }
    }
    if (matched) continue;

    const it = tokens(item.text);
    if (it.size < 2) continue;
    const overlap = new Map<number, number>();
    for (const t of it) for (const i of index.get(t) ?? []) overlap.set(i, (overlap.get(i) ?? 0) + 1);
    let bestI = -1;
    let bestScore = 0;
    for (const [i, shared] of overlap) {
      const l = labelTokens[i].size;
      if (l === 0) continue;
      if (shared < Math.min(3, l)) continue;
      const cover = shared / l;
      const jac = shared / (l + it.size - shared);
      const score = 0.6 * cover + 0.4 * jac;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestScore >= WORDING_MIN) {
      offer({ itemId: item.id, variable: variables[bestI].name, method: "wording", confidence: Math.round(Math.min(bestScore, 0.89) * 100) / 100 });
    }
  }
  out.push(...best.values());
  return out.sort((a, b) => b.confidence - a.confidence);
}

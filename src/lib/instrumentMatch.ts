// Suggests which dataset variables each questionnaire item produced. Pure:
// no database, no model. Every result is a suggestion with a stated method
// and confidence, and none of them is applied until the researcher confirms.

export type ItemLike = { id: string; code: string | null; text: string };
export type VariableLike = { name: string; label: string };

export type MatchMethod = "code" | "stem" | "wording" | "grid";
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
/**
 * IS-F06 (Codex, 27 October 2026): several columns that are the item's code once case, spacing and
 * separators are set aside (q1 and Q1, Q_1 and Q.1, Q1 and Ｑ１), and none of them written exactly as the
 * code. Each is offered below "Confirm same-code matches" (AUTO_CONFIRM_MIN), so the researcher chooses
 * which column the item describes; giving each confidence 1 bulk-confirmed the item to all of them.
 */
export const AMBIGUOUS_CODE_CONFIDENCE = 0.8;

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
  if (exact.length > 1) {
    // Several columns fit once case and separators are set aside (IS-F06): the one written exactly as
    // the code wins, first as written, then after NFKC and invisible characters; otherwise all are
    // returned and the matcher offers them for the researcher to choose (codeIsAmbiguous).
    const asWritten = exact.filter((n) => n.trim() === (code ?? "").trim());
    if (asWritten.length === 1) return asWritten;
    const sameCase = exact.filter((n) => matchableCode(n) === c);
    if (sameCase.length === 1) return sameCase;
  }
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

export function matchItems(
  items: ItemLike[],
  variables: VariableLike[],
  /** grids: suggest grid rows (needs migration 0130); gridLabels: more wording per variable for grid rows only
   * (its confirmed codebook entries), so the ordinary wording match is unchanged. */
  options: { grids?: boolean; gridLabels?: Map<string, string[]> } = {},
): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const names = variables.map((v) => v.name);

  // Inverted index over variable label tokens, for the wording pass.
  const labelTokens = variables.map((v) => tokens(v.label));
  const index = new Map<string, number[]>();
  labelTokens.forEach((set, i) => {
    for (const t of set) index.set(t, [...(index.get(t) ?? []), i]);
  });

  const best = new Map<string, MatchCandidate>(); // by variable, highest confidence wins
  const gridRows = options.grids ? gridRowMatches(items, variables, options.gridLabels) : new Map<string, GridRowMatch>();

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
        const confidence = exact.length === 1 ? 1 : AMBIGUOUS_CODE_CONFIDENCE;
        for (const name of exact) offer({ itemId: item.id, variable: name, method: "code", confidence });
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

    const rows = gridRows.get(item.id);
    if (rows) {
      for (const r of rows.variables) offer({ itemId: item.id, variable: r, method: "grid", confidence: rows.confidence });
      continue;
    }

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

// ---- Wording identical to a confirmed codebook entry (batch 49) ----

/** Fewer words than this is too little text to call two documents' wording the same question. */
export const IDENTICAL_WORDING_MIN_WORDS = 5;

/**
 * A question's wording as compared for "identical" (B49-F01, Codex, 28 October 2026). Only formatting is
 * set aside: Unicode compatibility forms (NFKC), case, runs of spacing, the style of quotation marks and
 * dashes, and punctuation closing the question. Everything that can carry meaning is kept: symbols and
 * signs ("< 5000" is not "> 5000", "-500" is not "+500"), numbers, and every script ("東京" is not "大阪").
 * The first version reduced the text to ASCII letters and digits and dropped any leading number, so those
 * pairs were linked and confirmed with no researcher.
 *
 * A leading question label is dropped only when it is unmistakably a label: the item's own code at the start
 * ("Q1 California..." for the entry Q1), or a number label closed by ".", ")" or ":" ("1A.", "Q1)", "Q 12:").
 * A number that opens the sentence ("18 years and older ...") stays: it may be the question.
 */
export function normalisedWording(text: string, code?: string | null): string {
  let t = text.normalize("NFKC").trim();
  const own = (code ?? "").normalize("NFKC").trim();
  if (own) {
    const lead = new RegExp(`^${esc(own)}(?:[.):]\\s*|\\s+)`, "i");
    t = t.replace(lead, "");
  }
  t = t.replace(/^(?:q\s?)?\d+[a-z]?[.):]\s+/i, "");
  return t
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[\s.?!:;]+$/, "")
    .trim();
}

/**
 * Whether a link through the codebook still rests on identical wording under the current rule. Links made
 * by the first rule (B49-F01) are checked again with it wherever they are read, so a false one stops
 * counting without anything being deleted; matching again turns it back into an ordinary suggestion.
 */
export function wordingIdentical(a: { text: string; code: string | null }, b: { text: string; code: string | null }): boolean {
  const wa = normalisedWording(a.text, a.code);
  return wa.split(" ").filter(Boolean).length >= IDENTICAL_WORDING_MIN_WORDS && wa === normalisedWording(b.text, b.code);
}

export type ConfirmedCodebookEntry = { variable: string; itemId: string; code: string | null; text: string };
export type CodebookWordingMatch = { itemId: string; variable: string; basisItemId: string; basisCode: string | null };

/**
 * Questionnaire items whose wording is identical (normalisedWording) to the wording of a codebook entry
 * the researcher confirmed for a variable of the same data file. Pure. Only unambiguous pairs: the
 * wording is at least IDENTICAL_WORDING_MIN_WORDS words, exactly one confirmed variable carries it in
 * the codebook, and exactly one questionnaire item has it; anything else is left to the ordinary
 * suggestions for the researcher to check. Identity is the variable name the codebook link confirmed,
 * never the wording on its own.
 */
export function codebookWordingMatches(items: ItemLike[], entries: ConfirmedCodebookEntry[]): CodebookWordingMatch[] {
  const enough = (w: string) => w.split(" ").filter(Boolean).length >= IDENTICAL_WORDING_MIN_WORDS;
  const byWording = new Map<string, ConfirmedCodebookEntry[]>();
  for (const e of entries) {
    const w = normalisedWording(e.text, e.code);
    if (!enough(w)) continue;
    const list = byWording.get(w) ?? [];
    if (!list.some((x) => x.variable === e.variable)) list.push(e);
    byWording.set(w, list);
  }
  const itemsByWording = new Map<string, ItemLike[]>();
  for (const i of items) {
    const w = normalisedWording(i.text, i.code);
    if (!enough(w)) continue;
    itemsByWording.set(w, [...(itemsByWording.get(w) ?? []), i]);
  }
  const out: CodebookWordingMatch[] = [];
  for (const [w, its] of itemsByWording) {
    const es = byWording.get(w);
    if (!es || es.length !== 1 || its.length !== 1) continue;
    out.push({ itemId: its[0].id, variable: es[0].variable, basisItemId: es[0].itemId, basisCode: es[0].code });
  }
  return out;
}


// ---- Grid (battery) questions (batch 53) ----

/**
 * A grid asks one question (the stem) about several rows (candidates, brands, statements), each answered on
 * the same scale, and the data has one single-choice column per row (Q5_1 ... Q5_8). In the codebook or the
 * data labels each row's column is labelled with the stem, a dash, and the row ("Q5_1 Regardless of whom ...
 * (already voted) - Tony Thurmond, ..."). The questionnaire's code may differ from the columns' ("5A" and
 * Q5), so neither the exact-code nor the family rule finds them, and no single wording equals stem plus row
 * (Grant, 28 October 2026, May 2026 IGS Poll). A grid is not a multiple-response question (one yes/no column
 * per option of "tick all that apply"), which the family rule handles.
 */
export type GridRowMatch = { variables: string[]; confidence: number };

/** A column's label as stem and row, or null: the leading column name is set aside, and the row is after the
 * last dash with spaces around it. Derived columns ("(summary)", "Combines Q5_1 and Q5b_1") are not rows. */
export function gridRowOf(v: VariableLike): { stem: string; row: string } | null {
  if (/_summary$/i.test(v.name) || /\(summary\)|\bcombines\b/i.test(v.label)) return null;
  const label = v.label.normalize("NFKC").trim().replace(new RegExp(`^${esc(v.name)}\\s+`, "i"), "");
  const m = /^([\s\S]*\S)\s+[-\u2010-\u2015\u2212]\s+(\S[\s\S]*)$/.exec(label);
  if (!m) return null;
  return { stem: m[1], row: m[2] };
}

/**
 * Grid rows for questionnaire items, by wording: the item's question (its text up to and including the first
 * question mark, formatting set aside by normalisedWording) is the stem of two or more columns, either exactly
 * or followed by a note the codebook adds after it ("(already voted)"). Rows are matched by their columns'
 * labels, never by position, so a randomised row order does not matter. A grid whose stem matches one item
 * only, and an item that matches one grid only, is suggested at FAMILY_CONFIDENCE (confirmable with "Confirm
 * same-code matches" and "Confirm all"); anything ambiguous is offered lower for the researcher to choose.
 * Questions shorter than IDENTICAL_WORDING_MIN_WORDS words are too little text to call a stem the same.
 */
export function gridRowMatches(items: ItemLike[], variables: VariableLike[], moreLabels: Map<string, string[]> = new Map()): Map<string, GridRowMatch> {
  const grids = new Map<string, string[]>();
  for (const v of variables) {
    // The column's own label and any confirmed codebook wording for it; a column is one row of each stem once.
    const stems = new Set<string>();
    for (const label of [v.label, ...(moreLabels.get(v.name) ?? [])]) {
      const r = gridRowOf({ name: v.name, label });
      if (r) stems.add(normalisedWording(r.stem));
    }
    for (const stem of stems) grids.set(stem, [...(grids.get(stem) ?? []), v.name]);
  }
  for (const [stem, names] of grids) if (names.length < 2) grids.delete(stem);
  const question = (i: ItemLike) => {
    const q = i.text.indexOf("?");
    return normalisedWording(q >= 0 ? i.text.slice(0, q + 1) : i.text, i.code);
  };
  const fits = (stem: string, q: string) => stem === q || (stem.startsWith(q) && /^[^\p{L}\p{N}]/u.test(stem.slice(q.length)));
  const itemsPerGrid = new Map<string, number>();
  const gridsPerItem = new Map<string, string[]>();
  for (const i of items) {
    const q = question(i);
    if (q.split(" ").filter(Boolean).length < IDENTICAL_WORDING_MIN_WORDS) continue;
    const found = [...grids.keys()].filter((stem) => fits(stem, q));
    if (found.length === 0) continue;
    gridsPerItem.set(i.id, found);
    for (const stem of found) itemsPerGrid.set(stem, (itemsPerGrid.get(stem) ?? 0) + 1);
  }
  const out = new Map<string, GridRowMatch>();
  for (const [itemId, found] of gridsPerItem) {
    const unambiguous = found.length === 1 && itemsPerGrid.get(found[0]) === 1;
    out.set(itemId, { variables: found.flatMap((stem) => grids.get(stem)!).slice(0, STEM_CAP), confidence: unambiguous ? FAMILY_CONFIDENCE : AMBIGUOUS_CODE_CONFIDENCE });
  }
  return out;
}

// ---- Codebook entries confirmed without a click (CB1) ----

/** One spelling per answer code: a whole number in any spelling ("1", "01", "1.0") is the number; other text is trimmed. */
function answerCode(code: string): string {
  const t = code.trim();
  return /^[+-]?\d+(?:\.0+)?$/.test(t) ? String(Number(t)) : t;
}

/**
 * Whether a codebook entry's answer list covers a variable's data (CB1, Grant 29 October 2026): every code the
 * variable holds (the dictionary's `codes`, missing values excluded) is one of the entry's answer codes. The entry
 * may list codes nobody chose. Unknown is never a fit: no answer list, or no observed codes (a measure, text,
 * decimals, more than the engine lists, or a dictionary built before codes were recorded), leaves the link for the
 * researcher to confirm.
 */
export function answerCodesFit(options: { code: string }[] | null | undefined, observed: string[] | null | undefined): boolean {
  if (!observed || observed.length === 0) return false;
  const listed = new Set((options ?? []).map((o) => answerCode(String(o.code ?? ""))).filter((c) => c !== ""));
  if (listed.size === 0) return false;
  return observed.every((c) => listed.has(answerCode(c)));
}

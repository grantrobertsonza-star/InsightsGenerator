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

export function matchItems(items: ItemLike[], variables: VariableLike[]): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const byNorm = new Map<string, string[]>();
  for (const v of variables) {
    const k = norm(v.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), v.name]);
  }

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
    const code = item.code?.trim();
    if (code) {
      const exact = byNorm.get(norm(code));
      if (exact) {
        for (const name of exact) offer({ itemId: item.id, variable: name, method: "code", confidence: 1 });
        matched = true;
      } else {
        const re = new RegExp(`^${esc(code)}(?:[_.\\-][A-Za-z0-9_.\\-]*|[A-Za-z](?:[_.\\-]?[A-Za-z0-9_.\\-]*)?)$`, "i");
        const stem = variables.filter((v) => re.test(v.name)).slice(0, STEM_CAP);
        for (const v of stem) offer({ itemId: item.id, variable: v.name, method: "stem", confidence: stem.length === 1 ? 0.8 : 0.85 });
        if (stem.length > 0) matched = true;
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

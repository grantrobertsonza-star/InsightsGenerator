// Cross-tabs over coded respondents: which themes go with which respondent
// attributes, and which themes tend to appear together. Counts only, always
// with their base. No significance testing: with interview-sized samples a
// p-value invites more confidence than the data can carry, so small bases are
// flagged instead.

export type CrosstabRespondent = {
  key: string;
  label: string;
  attributes: Record<string, string>;
  codeTurns: Record<string, number>; // code id to coded turns
};

export type CrosstabCode = { id: string; name: string };

export const SMALL_BASE = 5;

export type AttributeCell = {
  withTheme: number; // respondents in the group who voiced the theme
  base: number; // respondents in the group
  share: number | null;
  turns: number;
};

export type ThemesByAttribute = {
  attribute: string;
  groups: { value: string; base: number; small: boolean }[];
  unknown: number; // respondents with no value for this attribute
  rows: { codeId: string; codeName: string; cells: AttributeCell[] }[];
};

/** Attributes worth cutting by: present for several respondents, not unique per person. */
export function usableAttributes(respondents: CrosstabRespondent[]): string[] {
  const values = new Map<string, Map<string, number>>();
  for (const r of respondents) {
    for (const [k, v] of Object.entries(r.attributes)) {
      if (!v.trim()) continue;
      const m = values.get(k) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + 1);
      values.set(k, m);
    }
  }
  const out: string[] = [];
  for (const [k, m] of values) {
    const covered = [...m.values()].reduce((a, b) => a + b, 0);
    const distinct = m.size;
    // at least two groups, and not one group per person
    if (distinct >= 2 && distinct < covered && covered >= 2) out.push(k);
  }
  return out.sort();
}

export function themesByAttribute(
  respondents: CrosstabRespondent[],
  codes: CrosstabCode[],
  attribute: string,
): ThemesByAttribute {
  const byValue = new Map<string, CrosstabRespondent[]>();
  let unknown = 0;
  for (const r of respondents) {
    const v = r.attributes[attribute]?.trim();
    if (!v) {
      unknown += 1;
      continue;
    }
    const list = byValue.get(v) ?? [];
    list.push(r);
    byValue.set(v, list);
  }
  const values = [...byValue.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return {
    attribute,
    unknown,
    groups: values.map((value) => {
      const base = byValue.get(value)?.length ?? 0;
      return { value, base, small: base < SMALL_BASE };
    }),
    rows: codes.map((c) => ({
      codeId: c.id,
      codeName: c.name,
      cells: values.map((value) => {
        const group = byValue.get(value) ?? [];
        const withTheme = group.filter((r) => (r.codeTurns[c.id] ?? 0) > 0);
        return {
          withTheme: withTheme.length,
          base: group.length,
          share: group.length > 0 ? withTheme.length / group.length : null,
          turns: withTheme.reduce((n, r) => n + (r.codeTurns[c.id] ?? 0), 0),
        };
      }),
    })),
  };
}

export type Cooccurrence = {
  codes: CrosstabCode[];
  respondents: number; // base
  // pairs[i][j]: respondents who voiced both theme i and theme j. The diagonal
  // is the number who voiced theme i at all.
  pairs: number[][];
  // The same on coded turns, for themes that sit together in one remark.
  turnPairs: number[][];
};

export function cooccurrence(
  respondents: CrosstabRespondent[],
  codes: CrosstabCode[],
  turnCodes: string[][], // for each coded turn, the code ids it carries
): Cooccurrence {
  const n = codes.length;
  const idx = new Map(codes.map((c, i) => [c.id, i]));
  const pairs = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const r of respondents) {
    const has = codes
      .map((c, i) => ((r.codeTurns[c.id] ?? 0) > 0 ? i : -1))
      .filter((i) => i >= 0);
    for (const i of has) for (const j of has) pairs[i][j] += 1;
  }
  const turnPairs = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const ids of turnCodes) {
    const has = [
      ...new Set(
        ids
          .map((id) => idx.get(id))
          .filter((i): i is number => i !== undefined),
      ),
    ];
    for (const i of has) for (const j of has) turnPairs[i][j] += 1;
  }
  return { codes, respondents: respondents.length, pairs, turnPairs };
}

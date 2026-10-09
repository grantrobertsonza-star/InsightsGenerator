import type { VariableDictionary } from "./parseStatsFile";

// What a confirmed questionnaire adds to a data file: the question wording as
// a variable label where the file has none, and answer labels where the file
// has none. Pure. The Python engine applies the same overlay with the same
// rule (it never replaces a label the file already has).

export type LabelOverlay = {
  variableLabels: Record<string, string>;
  valueLabels: Record<string, Record<string, string>>;
  /** Full question wording per variable, for tooltips. */
  questions: Record<string, string>;
};

export type OverlayLink = {
  itemId: string;
  variable: string;
  code: string | null;
  text: string;
  options: { code: string; label: string }[];
};

export const MAX_LABEL_CHARS = 160;
export const MAX_QUESTION_CHARS = 400;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function buildLabelOverlay(links: OverlayLink[]): LabelOverlay {
  const perItem = new Map<string, number>();
  for (const l of links) perItem.set(l.itemId, (perItem.get(l.itemId) ?? 0) + 1);
  const out: LabelOverlay = { variableLabels: {}, valueLabels: {}, questions: {} };
  for (const l of links) {
    const text = l.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.questions[l.variable] ??= clip(l.code ? `${l.code}. ${text}` : text, MAX_QUESTION_CHARS);
    // One item to one variable: the wording and the answer labels belong to it.
    // One item to several variables (a multiple-response set): the options are
    // the variables themselves, not answer codes, so only the tooltip is set.
    if (perItem.get(l.itemId) === 1) {
      out.variableLabels[l.variable] ??= clip(l.code ? `${l.code}. ${text}` : text, MAX_LABEL_CHARS);
      const coded = l.options.filter((o) => o.code !== "" && o.label);
      if (coded.length >= 2) {
        const m: Record<string, string> = {};
        for (const o of coded) m[o.code] = o.label;
        out.valueLabels[l.variable] ??= m;
      }
    }
  }
  return out;
}

/** The dictionary as the workspace should show it, with questionnaire wording where the file's own label is just a name. */
export function enrichDictionary(dict: VariableDictionary, overlay: LabelOverlay): VariableDictionary {
  if (Object.keys(overlay.questions).length === 0) return dict;
  return {
    ...dict,
    variables: dict.variables.map((v) => {
      const question = overlay.questions[v.name];
      const label = overlay.variableLabels[v.name];
      const hasLabels = !!overlay.valueLabels[v.name];
      if (!question && !label && !hasLabels) return v;
      return {
        ...v,
        label: label && (!v.label || v.label === v.name) ? label : v.label,
        question,
        labelled: v.labelled || hasLabels,
        text: hasLabels ? false : v.text,
      };
    }),
  };
}

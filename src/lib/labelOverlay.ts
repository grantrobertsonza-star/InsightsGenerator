import type { VariableDictionary } from "./parseStatsFile";

// What a confirmed codebook or questionnaire adds to a data file: the question
// wording as a variable label where the file has none, and answer labels where
// the file has none. Pure. The Python engine applies the same overlay with the same
// rule (it never replaces a label the file already has).

export type LabelOverlay = {
  variableLabels: Record<string, string>;
  valueLabels: Record<string, Record<string, string>>;
  /** Full question wording per variable, for tooltips. */
  questions: Record<string, string>;
  /**
   * Variables whose answer labels differ between two linked documents. The labels applied are the
   * stronger source's (LABEL_SOURCE_ORDER); the other is kept here so the disagreement is shown,
   * never silently resolved. Absent when every link agrees or has no source.
   */
  conflicts?: LabelConflict[];
};

export type LabelSource = { documentId: string; instrumentType: string | null };

export type LabelConflict = {
  variable: string;
  applied: LabelSource & { labels: Record<string, string> };
  other: LabelSource & { labels: Record<string, string> };
};

export type OverlayLink = {
  itemId: string;
  variable: string;
  code: string | null;
  text: string;
  options: { code: string; label: string }[];
  /** The document the item comes from; links without one rank after every typed source. */
  source?: LabelSource;
};

export const MAX_LABEL_CHARS = 160;
export const MAX_QUESTION_CHARS = 400;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * LBL-01 (Grant, 2026-10-26): "the codebook is the authority on variables". Variable and answer
 * labels come from the data file itself first (the engine never replaces a label the file has),
 * then a codebook, then a questionnaire. Question wording for tooltips is the reverse of the last
 * two: a questionnaire states the question as asked, a codebook usually only a short label.
 */
export const LABEL_SOURCE_ORDER = ["codebook", "questionnaire"] as const;

export function labelSourceRank(instrumentType: string | null | undefined): number {
  const i = (LABEL_SOURCE_ORDER as readonly string[]).indexOf(instrumentType ?? "");
  return i < 0 ? LABEL_SOURCE_ORDER.length + (instrumentType ? 0 : 1) : i;
}

function wordingRank(instrumentType: string | null | undefined): number {
  return instrumentType === "questionnaire" ? 0 : instrumentType === "codebook" ? 1 : labelSourceRank(instrumentType);
}

/** Stable sort by a rank; ties keep the order given (the query's document and question order). */
function byRank<T>(rows: readonly T[], rank: (r: T) => number): T[] {
  return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([r]) => r);
}

const sameLabel = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

function labelsDiffer(a: Record<string, string>, b: Record<string, string>): boolean {
  const codes = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const c of codes) {
    if (!(c in a) || !(c in b) || !sameLabel(a[c], b[c])) return true;
  }
  return false;
}

export function buildLabelOverlay(links: OverlayLink[]): LabelOverlay {
  return resolveLabels(links).overlay;
}

/** Which link each applied label came from; an unrecorded source is null. */
export type AppliedLabelSources = Record<string, { variableLabel?: LabelSource | null; valueLabels?: LabelSource | null }>;

/**
 * The labels a set of links gives, and where each came from: the one implementation of LBL-01 for
 * both the calculations (buildLabelOverlay) and the Labels and documentation tab.
 */
export function resolveLabels(links: OverlayLink[]): { overlay: LabelOverlay; sources: AppliedLabelSources } {
  const sources: AppliedLabelSources = {};
  const perItem = new Map<string, number>();
  for (const l of links) perItem.set(l.itemId, (perItem.get(l.itemId) ?? 0) + 1);
  const out: LabelOverlay = { variableLabels: {}, valueLabels: {}, questions: {} };
  const textOf = (l: OverlayLink) => l.text.replace(/\s+/g, " ").trim();
  const withCode = (l: OverlayLink, text: string) => (l.code ? `${l.code}. ${text}` : text);

  for (const l of byRank(links, (x) => wordingRank(x.source?.instrumentType))) {
    const text = textOf(l);
    if (text) out.questions[l.variable] ??= clip(withCode(l, text), MAX_QUESTION_CHARS);
  }

  const appliedFrom: Record<string, OverlayLink> = {};
  const conflicts: LabelConflict[] = [];
  for (const l of byRank(links, (x) => labelSourceRank(x.source?.instrumentType))) {
    const text = textOf(l);
    if (!text) continue;
    // One item to one variable: the wording and the answer labels belong to it.
    // One item to several variables (a multiple-response set): the options are
    // the variables themselves, not answer codes, so only the tooltip is set.
    if (perItem.get(l.itemId) !== 1) continue;
    if (out.variableLabels[l.variable] === undefined) {
      out.variableLabels[l.variable] = clip(withCode(l, text), MAX_LABEL_CHARS);
      (sources[l.variable] ??= {}).variableLabel = l.source ?? null;
    }
    const coded = l.options.filter((o) => o.code !== "" && o.label);
    if (coded.length < 2) continue;
    const m: Record<string, string> = {};
    for (const o of coded) m[o.code] = o.label;
    const kept = out.valueLabels[l.variable];
    if (!kept) {
      out.valueLabels[l.variable] = m;
      appliedFrom[l.variable] = l;
      (sources[l.variable] ??= {}).valueLabels = l.source ?? null;
      continue;
    }
    const first = appliedFrom[l.variable];
    // Only a disagreement between two documents is a conflict; both sources must be known.
    if (first.source && l.source && first.source.documentId !== l.source.documentId && labelsDiffer(kept, m)
        && !conflicts.some((c) => c.variable === l.variable && c.other.documentId === l.source!.documentId)) {
      conflicts.push({ variable: l.variable, applied: { ...first.source, labels: kept }, other: { ...l.source, labels: m } });
    }
  }
  if (conflicts.length > 0) out.conflicts = conflicts;
  return { overlay: out, sources };
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

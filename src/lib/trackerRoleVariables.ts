// D2: the tracker role recogniser's input (trackerRoles.ts RoleVariable) assembled from what the app has read
// for a data file. Pure, so the assembly is tested apart from the reads in trackerInput.ts.
import type { QuestionMeta } from "./instruments";
import type { VariableDictionary } from "./parseStatsFile";
import type { RoleVariable } from "./trackerRoles";
import { isStringCategory } from "./variableKinds";

/**
 * The recogniser's input from a dictionary, the answer labels and the codebook question fields. A codebook's
 * set and type win over the reader's own: the codebook states them; the reader infers them. Most files carry no
 * codebook question fields (Grant, 29 October 2026: "90% standard raw files", SPSS, Excel, text, R, Python),
 * so the reader's sets are the usual source: a variable in any of them (a yes/no set, or a battery of one
 * question asked per brand) takes the set's name stem as its question group. The stem, not the set key, joins
 * a question the reader split in two (repeat_b01 to b06 read as yes/no flags, b07 to b10 with no "yes" among
 * the cases read, so put in a "repeat (battery)" set): both halves are one question, "repeat".
 */
export function roleVariablesFrom(
  dictionary: VariableDictionary,
  valueLabels: Record<string, Record<string, string>>,
  metaByVariable: Map<string, QuestionMeta>,
): RoleVariable[] {
  const setOf = new Map<string, { key: string; kind?: string }>();
  for (const s of dictionary.sets ?? []) for (const name of s.vars) if (!setOf.has(name)) setOf.set(name, s);
  return dictionary.variables.map((v) => {
    const meta = metaByVariable.get(v.name);
    const readerSet = setOf.get(v.name);
    const readerMulti = readerSet?.kind === "multi";
    const readerGroup = readerSet ? v.setKey || readerSet.key : null;
    const questionType = meta && meta.questionType !== undefined ? meta.questionType : readerMulti ? "multiple_response" : v.text ? "text" : null;
    return {
      name: v.name,
      label: wordingOfLabel(v.name, v.label),
      ...(valueLabels[v.name] ? { valueLabels: valueLabels[v.name] } : {}),
      questionId: meta?.questionId ?? null,
      questionType: questionType ?? null,
      group: meta && meta.mrSet !== undefined ? meta.mrSet ?? null : readerGroup,
      numeric: v.numeric,
      weightLike: v.weightLike,
      // A short list of repeated text answers ("Positive", "Neutral") is a category (the shared rule), not free text.
      text: (v.text ?? false) && !isStringCategory(v),
      distinct: v.nDistinct,
    };
  });
}

/**
 * The question's own wording, for role recognition: a label taken from a confirmed codebook or questionnaire entry is
 * shown as "aware_b01. Prompted resolved recognition Toyota" (labelOverlay puts the entry's code in front), and that
 * code differs per brand, so the brand names read from the labels (trackerNameFamilies.varyingLabels) found no shared
 * wording and a named brand list read as unnamed (owner's BMW tracker, 29 October 2026). Only a leading copy of the
 * variable's own name is removed; any other label is kept as it is. Screens and tables keep the full label.
 */
export function wordingOfLabel(name: string, label: string): string {
  const prefix = `${name}. `;
  return label.toLowerCase().startsWith(prefix.toLowerCase()) && label.length > prefix.length ? label.slice(prefix.length) : label;
}

/** The strongest confirmed codebook entry's question fields per variable (the loader's order: LABEL_SOURCE_ORDER). */
export function codebookQuestionsByVariable(items: { variable: string; confirmed: boolean; instrumentType: string | null; questionMeta: QuestionMeta | null }[]): Map<string, QuestionMeta> {
  const out = new Map<string, QuestionMeta>();
  for (const i of items) {
    if (!i.confirmed || i.instrumentType !== "codebook" || !i.questionMeta || out.has(i.variable)) continue;
    out.set(i.variable, i.questionMeta);
  }
  return out;
}


// D2 (Grant, 29 October 2026): what the tracker role recogniser (trackerRoles.ts) reads for one data file,
// built from what the app has actually imported, never from variable names alone:
//   - the variable list from the crosstab engine's dictionary (loadVariableDictionaryWithStatus), with the
//     labels every table uses;
//   - each variable's answer labels as the calculations see them: the file's own, then the confirmed
//     codebook and questionnaire labels (the overlay), applied by the engine's own rule (value_labels in
//     api/parse-stats-file.py);
//   - the question number, question type and multiple-response set from the strongest confirmed codebook
//     entry for the variable (instrument_items.question_meta, migration 0131). Without one, a question set
//     the reader found itself stands in for the group and multiple-response type; the question number is
//     then unknown (null), never guessed.
// The weight is the app's default weight rule (defaultWeight in starterTables.ts): Grant, 29 October 2026,
// "weight by default" when the file has one.
// A failed read of any of these refuses (the error names it); it never becomes an empty role list, which the
// recogniser would report as "not a tracker".
import { loadDocumentFile, loadVariableDictionaryWithStatus, overlayFor } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { getConfirmedItemsForData } from "./instruments";
import { runStatsTool } from "./parseStatsFile";
import { defaultWeight } from "./starterTables";
import type { RoleVariable } from "./trackerRoles";
import { codebookQuestionsByVariable, roleVariablesFrom } from "./trackerRoleVariables";

export type RoleInput = {
  variables: RoleVariable[];
  /** The weight the dashboards use by default; null when the file has none. */
  weightVar: string | null;
  /** Variables with more than 500 answer labels, whose list was cut (the recogniser sees the first 500). */
  labelsCut: string[];
  /** How many variables have a question number, type or set from a confirmed codebook entry. */
  withCodebookQuestion: number;
};

export async function loadRoleInput(tenantId: string, runId: string, documentId: string): Promise<RoleInput> {
  const [dict, setup, doc, overlay, items] = await Promise.all([
    loadVariableDictionaryWithStatus(tenantId, runId, documentId),
    loadDataSetupWithStatus(tenantId, documentId),
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    getConfirmedItemsForData(tenantId, runId, documentId),
  ]);
  if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
  if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
  const labels = await runStatsTool<{ valueLabels: Record<string, Record<string, string>>; cut: string[] }>("value_labels", doc.storage_path, doc.source_filename, {
    overlay,
    layout: setup.setup.layout,
    headerRowsSkipped: setup.setup.headerRowsSkipped,
    selectedSheet: doc.selected_sheet,
  });
  const meta = codebookQuestionsByVariable(items);
  return {
    variables: roleVariablesFrom(dict.dictionary, labels.valueLabels ?? {}, meta),
    weightVar: defaultWeight(dict.dictionary),
    labelsCut: labels.cut ?? [],
    withCodebookQuestion: meta.size,
  };
}

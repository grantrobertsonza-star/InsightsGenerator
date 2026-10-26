// Respondent-level quality checks for a case-level data file (Grant, 26 October 2026): straightlining in
// batteries, non-answer share, speeders and interviewer differences, computed by the engine over every
// case (respondent_quality in api/parse-stats-file.py, which states each rule and threshold). Flags for the
// researcher to look at: nothing here excludes a case or changes a table. Read on demand, not stored.
import { loadDataSetupWithStatus } from "./dataSetup";
import { loadDocumentFile } from "./crosstabs";
import { runStatsTool } from "./parseStatsFile";

export type RespondentQuality = {
  cases: number;
  idVariable: string | null;
  straightlining: {
    grids: { stem: string; items: string[]; points: number[]; eligible: number; straightliners: number; nearStraightliners: number }[];
    flagged: number;
    nearThreshold: number;
    minItems: number;
    minBatteries: number;
  };
  nonAnswer: { measured: boolean; variables: number; flagged: number; threshold: number; minAnswers: number; medianShare?: number | null };
  duration: { variable: string | null; median?: number | null; speeders?: number; superSpeeders?: number; long?: number; speederBelow?: number; superSpeederBelow?: number };
  interviewers: { variable: string | null; rows: { interviewer: string; cases: number; straightlinerRate: number; medianDuration?: number; check: string[] }[] };
  flaggedCases: number;
  topCases: { row: number; id: string | null; reasons: string[] }[];
  notes: string[];
};

/** The engine's respondent checks for one raw data file, read with its saved layout and sheet. */
export async function loadRespondentQuality(tenantId: string, runId: string, documentId: string): Promise<RespondentQuality> {
  const [doc, setup] = await Promise.all([loadDocumentFile(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  // A layout that cannot be read is not guessed: the wrong orientation would check the wrong cases.
  if (!setup.ok) throw new Error(`This file's layout setting could not be read (${setup.error}), so its respondents were not checked. Try again.`);
  return runStatsTool<RespondentQuality>("respondent_quality", doc.storage_path, doc.source_filename, {
    layout: setup.setup.layout,
    selectedSheet: doc.selected_sheet,
  });
}

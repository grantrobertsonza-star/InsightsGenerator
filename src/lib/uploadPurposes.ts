// What an added file is for, on the Import screen's single "Add files" panel (Grant, 2026-10-19:
// one Add files button and a type list, in place of one picker per type). Pure rules, shared by the
// panel and its tests. The server action (documentUploadActions.ts) is unchanged: each file is sent
// under the same form field the old per-type pickers used, so its limits and checks still apply.
import { LIMITS_CAPTION } from "./importLimits";

export type UploadPurposeId = "brief" | "proposal" | "raw" | "tables" | "output" | "transcript" | "report" | "questionnaire" | "interview_guide" | "focus_group_guide";

export type UploadPurpose = {
  id: UploadPurposeId;
  label: string;
  /** The form field documentUploadActions.ts reads for this kind of file. */
  field: string;
  /** Lower-case extensions this type takes; null takes any (the server reads what it can). */
  extensions: string[] | null;
  hint: string;
};

// In Grant's order: context first, then data, then what was written from it; questionnaires and
// guides last, since each is linked to the data or transcripts it belongs to. Questionnaire,
// interview guide and focus group guide are three types (Grant, 2026-10-20), each sent under its own
// field, so a batch can mix them and no separate "which is it" step is needed: a questionnaire is
// matched to a raw data file, a guide to the transcripts.
export const UPLOAD_PURPOSES: UploadPurpose[] = [
  { id: "brief", label: "Brief", field: "briefFiles", extensions: [".pdf", ".docx", ".txt"], hint: "The research brief: context, and checked in Research quality review." },
  { id: "proposal", label: "Proposal", field: "proposalFiles", extensions: [".pdf", ".docx", ".txt"], hint: "A research proposal: context, and checked in Research quality review." },
  { id: "raw", label: "Raw data", field: "rawTableFiles", extensions: [".csv", ".xlsx", ".xls", ".sav", ".dta"], hint: `One row per respondent. CSV/Excel, SPSS or Stata. ${LIMITS_CAPTION}.` },
  { id: "tables", label: "Tables", field: "tableFiles", extensions: [".csv", ".xlsx", ".xls", ".sav", ".dta"], hint: "Already aggregated: totals or percentages." },
  { id: "output", label: "Statistical output", field: "outputFiles", extensions: [".zip", ".csv", ".tsv", ".xlsx", ".xls", ".txt", ".md", ".docx"], hint: "A zip of models, clusters and logs." },
  { id: "transcript", label: "Qual data", field: "transcriptFiles", extensions: null, hint: "Transcripts, coded or uncoded." },
  { id: "report", label: "Report", field: "reportFiles", extensions: null, hint: "PDF, Word or PowerPoint, read for the findings it states." },
  { id: "questionnaire", label: "Questionnaire", field: "questionnaireFiles", extensions: [".pdf", ".docx"], hint: "A survey questionnaire: read, then matched to your raw data file's variables." },
  { id: "interview_guide", label: "Interview guide", field: "interviewGuideFiles", extensions: [".pdf", ".docx"], hint: "Read, then checked against your interview transcripts." },
  { id: "focus_group_guide", label: "Focus group guide", field: "focusGroupGuideFiles", extensions: [".pdf", ".docx"], hint: "Read, then checked against your focus group transcripts." },
];

export function purposeById(id: UploadPurposeId): UploadPurpose {
  return UPLOAD_PURPOSES.find((p) => p.id === id)!;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * A starting type, only where the extension leaves one sensible answer: SPSS and Stata files are
 * case-level data and a zip is statistical output. Anything else (a PDF can be a report, a
 * questionnaire, a brief or a proposal; a spreadsheet can be raw data or tables) is left for the
 * researcher to choose, because a wrong guess sends the file down the wrong reading path.
 */
export function suggestPurpose(filename: string): UploadPurposeId | null {
  const ext = extensionOf(filename);
  if (ext === ".sav" || ext === ".dta") return "raw";
  if (ext === ".zip") return "output";
  return null;
}

/** Why this file cannot go in as this type, or null when it can. */
export function purposeMismatch(filename: string, id: UploadPurposeId): string | null {
  const p = purposeById(id);
  if (!p.extensions) return null;
  const ext = extensionOf(filename);
  return p.extensions.includes(ext) ? null : `${p.label} takes ${p.extensions.join(", ")} files, not ${ext || "a file with no extension"}.`;
}

// What an added file is for, on the Import screen's single "Add files" panel (Grant, 2026-10-19:
// one Add files button and a type list, in place of one picker per type). Pure rules, shared by the
// panel and its tests. Each file is sent under its type's form field in the server action
// (documentUploadActions.ts), where the limits and checks for that kind apply; technical documents
// (2026-10-24) have their own field, `technicalFiles`.
import { INDICATOR_LIMITS_CAPTION, LIMITS_CAPTION, REFUSED_DATA_FILE } from "./importLimits";

export type UploadPurposeId = "brief" | "proposal" | "raw" | "tables" | "output" | "transcript" | "report" | "questionnaire" | "interview_guide" | "focus_group_guide" | "technical" | "codebook" | "indicator";

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
  { id: "technical", label: "Technical document", field: "technicalFiles", extensions: [".pdf", ".docx", ".txt"], hint: "Methodology, fieldwork, sampling, weighting or analysis notes: read by the Research assistant." },
  { id: "raw", label: "Raw data", field: "rawTableFiles", extensions: [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".sav", ".dta", ".sas7bdat", ".xpt", ".rds", ".rdata", ".rda", ".parquet"], hint: `One row per respondent. CSV, tab-delimited text, Excel, SPSS, Stata, SAS, R or Parquet. ${LIMITS_CAPTION}.` },
  // Grant, 2026-10-28: published statistics are one row per area, indicator and year, never one row
  // per respondent; read as series over time (indicatorData.ts), never as cases.
  { id: "indicator", label: "Indicator data", field: "indicatorFiles", extensions: [".csv", ".tsv", ".txt", ".xlsx", ".xls"], hint: `Published statistics by country or region and year, for example World Bank, IMF, OECD or Stats SA: read as series over time, not as respondents. ${INDICATOR_LIMITS_CAPTION}.` },
  { id: "tables", label: "Tables", field: "tableFiles", extensions: [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".sav", ".dta", ".sas7bdat", ".xpt", ".rds", ".rdata", ".rda", ".parquet"], hint: "Already aggregated: totals or percentages." },
  { id: "output", label: "Statistical output", field: "outputFiles", extensions: [".zip", ".csv", ".tsv", ".xlsx", ".xls", ".txt", ".md", ".docx"], hint: "A zip of models, clusters and logs." },
  { id: "transcript", label: "Qual data", field: "transcriptFiles", extensions: null, hint: "Transcripts, coded or uncoded." },
  { id: "report", label: "Report", field: "reportFiles", extensions: null, hint: "PDF, Word or PowerPoint, read for the findings it states." },
  { id: "questionnaire", label: "Questionnaire", field: "questionnaireFiles", extensions: [".pdf", ".docx", ".xlsx", ".xls", ".csv"], hint: "A survey questionnaire: read, then matched to your raw data file's variables." },
  { id: "codebook", label: "Codebook", field: "codebookFiles", extensions: [".xlsx", ".xls", ".csv", ".tsv", ".txt", ".json", ".pdf", ".docx"], hint: "The data file's variables with their labels and answer codes: matched to it by variable name." },
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


/** Why this file cannot go in as this type, or null when it can. */
export function purposeMismatch(filename: string, id: UploadPurposeId): string | null {
  const p = purposeById(id);
  if (!p.extensions) return null;
  const ext = extensionOf(filename);
  if (p.extensions.includes(ext)) return null;
  // A refused data file says why and what to upload instead, not only which types the slot takes.
  if (REFUSED_DATA_FILE[ext]) return REFUSED_DATA_FILE[ext];
  return `${p.label} takes ${p.extensions.join(", ")} files, not ${ext || "a file with no extension"}.`;
}

/**
 * A starting type for every added file (Grant, 2026-10-21: "should we not automatically select a
 * type? If wrong they can change it"). The panel shows it marked as suggested until the researcher
 * changes it, so a guess is visible, never silent. Rules, first match wins, read from the file name
 * and, for a CSV, its first lines:
 * - SPSS and Stata files are one row per respondent; a zip is statistical output.
 * - A PDF or Word file named as a focus group guide, an interview or discussion guide, or a
 *   questionnaire is that; one named as a brief (or terms of reference) or a proposal is that.
 * - A file named as a transcript, FGD, IDI or interview (not a guide) is qualitative data.
 * - A PDF, Word or PowerPoint file named as a report, deck or presentation is a report.
 * - A spreadsheet named as cross tabs, tables, a banner, a tabulation or output is tables.
 * - A CSV, TSV or text file whose first lines have an indicator data header is Indicator data
 *   (sampleLooksLikeIndicatorData); this is checked before the name rules for tables below.
 * - A CSV whose first lines read like tables (Total or Base rows, many percentages) is tables.
 * - Otherwise a spreadsheet is raw data (the most common case), a PDF, Word or PowerPoint file a
 *   report, and a text file qualitative data.
 * The suggestion always fits the file's extension (purposeMismatch is null); anything left over is a
 * report, a type that takes any file.
 */
export type PurposeSuggestion = {
  id: UploadPurposeId;
  /** Why it was suggested, for the select's title. */
  reason: string;
  /** Where questionnaires and guides share one type, which of them this file looks like. */
  instrument?: "questionnaire" | "interview_guide" | "focus_group_guide";
};

const SPREADSHEET = [".csv", ".xlsx", ".xls"];
const DOCUMENT = [".pdf", ".docx"];

function hasPurpose(id: string): boolean {
  return UPLOAD_PURPOSES.some((p) => p.id === id);
}

function instrumentSuggestion(kind: "questionnaire" | "interview_guide" | "focus_group_guide", reason: string): PurposeSuggestion {
  // One type per kind where this copy has three; one shared "instrument" type where it has one.
  return hasPurpose(kind) ? { id: kind as string as UploadPurposeId, reason } : { id: "instrument" as string as UploadPurposeId, reason, instrument: kind };
}

/** The cells of one delimited line, quote-aware (a quoted value may hold the separator). */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const WDI_HEADER = ["country name", "country code", "indicator name", "indicator code"];

/**
 * Whether a delimited file's first lines have an indicator data header, by the reader's own layout rules
 * (api/parse-stats-file.py `_indicator_layout` and `_ind_find_header`), applied to the first lines only:
 * - the first non-blank line holds REF_AREA and INDICATOR with TIME_PERIOD and OBS_VALUE (Data360 /
 *   SDMX long) or a year column (Data360 wide);
 * - or it holds DATASET, SERIES_CODE and OBS_MEASURE (the IMF data portal wide download);
 * - or REF_AREA, MEASURE, TIME_PERIOD and OBS_VALUE without INDICATOR (OECD Data Explorer SDMX-CSV), or
 *   STRUCTURE, REF_AREA and TIME_PERIOD without OBS_VALUE (its reference information, read as notes);
 * - or its last two columns are "Indicator name" and "Value" (a label and value table);
 * - or one of the first ten non-blank lines starts Country Name, Country Code, Indicator Name,
 *   Indicator Code (World Bank WDI, which has "Data Source" lines above its header).
 * A data row is never taken for a header, so a data dictionary listing those names as values is not
 * indicator data. Only a suggestion: the reader decides, and refuses anything else by name. A mirror of
 * the engine rule, kept equal by uploadPurposes.test.ts on the same fixture files.
 */
export function sampleLooksLikeIndicatorData(sample: string): boolean {
  const lines = sample.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return false;
  const sepOf = (line: string) => (["\t", ",", ";", "|"] as const).reduce((best, sep) => (splitLine(line, sep).length > splitLine(line, best).length ? sep : best), "," as string);
  const first = splitLine(lines[0], sepOf(lines[0]));
  const names = new Set(first);
  if (names.has("REF_AREA") && names.has("INDICATOR") && names.has("FREQ") && names.has("UNIT_MEASURE")) {
    const long = names.has("TIME_PERIOD") && names.has("OBS_VALUE");
    const wide = first.some((n) => /^[0-9]{4}$/.test(n)) && !names.has("TIME_PERIOD") && !names.has("OBS_VALUE");
    return long || wide;
  }
  if (names.has("DATASET") && names.has("SERIES_CODE") && names.has("OBS_MEASURE")) return true;
  // OECD SDMX-CSV data (no INDICATOR; its measure is MEASURE), and its reference information file (the
  // same dimension columns, STRUCTURE and no OBS_VALUE), read as notes for that data.
  if (names.has("REF_AREA") && names.has("MEASURE") && names.has("TIME_PERIOD") && names.has("OBS_VALUE") && !names.has("INDICATOR")) return true;
  if (names.has("REF_AREA") && names.has("TIME_PERIOD") && names.has("STRUCTURE") && !names.has("OBS_VALUE")) return true;
  const lower = first.map((n) => n.toLowerCase());
  if (lower.length >= 2 && lower[lower.length - 2] === "indicator name" && lower[lower.length - 1] === "value" && lower.slice(0, -2).every((n) => n.length > 0)) return true;
  return lines.some((l) => {
    const cells = splitLine(l, sepOf(l)).slice(0, 4).map((c) => c.toLowerCase());
    return WDI_HEADER.every((h, i) => cells[i] === h);
  });
}

/** True when a CSV's first lines read like aggregated tables rather than one row per respondent. */
export function csvLooksLikeTables(sample: string): boolean {
  const lines = sample.split(/\r?\n/).slice(0, 40).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  if (lines.some((l) => /^\s*"?\s*(total|base|unweighted base|weighted base)\b/i.test(l))) return true;
  const cells = lines.flatMap((l) => l.split(/[,;\t]/));
  const percent = cells.filter((c) => /^\s*"?\s*-?\d+(\.\d+)?\s*%\s*"?\s*$/.test(c)).length;
  return cells.length > 0 && percent / cells.length >= 0.2;
}

/**
 * True when a .txt file's first lines read like a delimited data table: a header and rows with the
 * same number of tab-, comma-, semicolon- or pipe-separated values, at least three per line. Prose and
 * transcripts rarely keep one count of separators across lines, so they stay text.
 */
export function textLooksLikeDataTable(sample: string): boolean {
  const lines = sample.split(/\r?\n/).slice(0, 20).filter((l) => l.trim().length > 0);
  // The sample may end part-way through a line.
  const complete = lines.length > 2 ? lines.slice(0, -1) : lines;
  if (complete.length < 2) return false;
  return ["\t", ",", ";", "|"].some((sep) => {
    const counts = complete.map((l) => l.split(sep).length);
    return counts[0] >= 3 && counts.every((n) => n === counts[0]);
  });
}

export function suggestPurposeFor(filename: string, csvSample?: string | null): PurposeSuggestion {
  const ext = extensionOf(filename);
  const dot = filename.lastIndexOf(".");
  const name = ` ${(dot < 0 ? filename : filename.slice(0, dot)).toLowerCase().replace(/[_\-.]+/g, " ")} `;
  const fromName = "Suggested from the file name";
  const fits = (s: PurposeSuggestion): PurposeSuggestion =>
    purposeMismatch(filename, s.id) === null ? s : { id: "report", reason: "Suggested: a report takes any file" };

  if ([".sav", ".dta", ".sas7bdat", ".xpt", ".rds", ".rdata", ".rda", ".parquet"].includes(ext)) return { id: "raw", reason: "Suggested: SPSS, Stata, SAS, R and Parquet files are one row per respondent" };
  if (ext === ".zip") return { id: "output", reason: "Suggested: a zip is statistical output" };
  // Codebooks and spreadsheet questionnaires are named as such far more often than not (Grant, 2026-10-26).
  if (/codebook|code book|data dictionary|datadictionary|variable list|variable labels|\bdictionary\b/.test(name) && purposeMismatch(filename, "codebook") === null) {
    return { id: "codebook", reason: fromName };
  }
  if (ext === ".json") return { id: "codebook", reason: "Suggested: a JSON file is read as a codebook" };
  // "questionnaire responses.xlsx" is the answers, not the form: a name that says so stays data.
  if ([".xlsx", ".xls", ".csv"].includes(ext) && /questionnaire|survey instrument|xlsform|\bform\b/.test(name) && !/respons|answers|\bdata\b|results|export/.test(name)) {
    return fits(instrumentSuggestion("questionnaire", fromName));
  }
  if (DOCUMENT.includes(ext)) {
    if (/focus group guide|fgd guide/.test(name)) return fits(instrumentSuggestion("focus_group_guide", fromName));
    if (/interview guide|discussion guide|topic guide|idi guide/.test(name)) return fits(instrumentSuggestion("interview_guide", fromName));
    if (/questionnaire|survey instrument/.test(name)) return fits(instrumentSuggestion("questionnaire", fromName));
  }
  if ([...DOCUMENT, ".txt"].includes(ext)) {
    if (/ brief |\btor\b|terms of reference/.test(name)) return fits({ id: "brief", reason: fromName });
    if (/proposal/.test(name)) return fits({ id: "proposal", reason: fromName });
    // Before the report rule: a survey's "Technical Report" documents its method, not its findings.
    if (/technical|methodolog|fieldwork|field work|sampling|weighting|survey design/.test(name)) return fits({ id: "technical", reason: fromName });
  }
  if (/transcript|\bfgd\b|\bidi\b|interview|focus group/.test(name) && !/guide/.test(name)) return { id: "transcript", reason: fromName };
  if ([...DOCUMENT, ".pptx"].includes(ext) && /report|deck|presentation|findings/.test(name)) return { id: "report", reason: fromName };
  // Before the name rules for tables: a published-statistics header says more than a file name does.
  if ([".csv", ".tsv", ".txt"].includes(ext) && csvSample && hasPurpose("indicator") && sampleLooksLikeIndicatorData(csvSample)) {
    return { id: "indicator", reason: "Suggested: its first lines read like published statistics by area and year" };
  }
  if (SPREADSHEET.includes(ext)) {
    if (/cross ?tabs?|crosstab|\btables?\b|\btabs\b|banner|tabulation|output/.test(name)) return { id: "tables", reason: fromName };
    if (ext === ".csv" && csvSample && csvLooksLikeTables(csvSample)) return { id: "tables", reason: "Suggested: its first lines read like totals or percentages" };
    return { id: "raw", reason: "Suggested: most spreadsheets are raw data, one row per respondent" };
  }
  if (ext === ".tsv") return { id: "output", reason: "Suggested: a TSV file is read as statistical output" };
  if (ext === ".txt" && csvSample && textLooksLikeDataTable(csvSample)) {
    return csvLooksLikeTables(csvSample)
      ? { id: "tables", reason: "Suggested: its first lines read like totals or percentages" }
      : { id: "raw", reason: "Suggested: its first lines read like a data table, one row per respondent" };
  }
  if (ext === ".txt" || ext === ".md") return { id: "transcript", reason: "Suggested: a text file is read as qualitative data" };
  return fits({ id: "report", reason: "Suggested: read as a report" });
}

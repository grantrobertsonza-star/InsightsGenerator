// Reads the shape of a statistical output file and says what it is for.
// Pure: no database, no model, only headers, a few rows and the file name.
// Every answer carries the signals it came from, so it can be checked.

export type OutputRole = "evidence" | "assurance" | "provenance" | "unclassified";

export type OutputKind =
  | "model_coefficients"
  | "odds_ratios"
  | "proportions"
  | "cluster_profile"
  | "descriptive_table"
  | "word_tables"
  | "diagnostics"
  | "validation_checks"
  | "cluster_diagnostics"
  | "survey_design"
  | "manifest"
  | "session_info"
  | "author_notes"
  | "console_log"
  | "other_table"
  | "other_document";

export const KIND_LABEL: Record<OutputKind, string> = {
  model_coefficients: "Model coefficients",
  odds_ratios: "Odds ratios and intervals",
  proportions: "Proportions with intervals",
  cluster_profile: "Cluster profile",
  descriptive_table: "Descriptive table",
  word_tables: "Tables in a Word file",
  diagnostics: "Model diagnostics",
  validation_checks: "Validation checks",
  cluster_diagnostics: "Cluster diagnostics",
  survey_design: "Design or audit record",
  manifest: "Run manifest",
  session_info: "Session information",
  author_notes: "Author notes",
  console_log: "Console log",
  other_table: "Unclassified table",
  other_document: "Unclassified document",
};

export const ROLE_LABEL: Record<OutputRole, string> = {
  evidence: "Evidence",
  assurance: "Assurance",
  provenance: "Context",
  unclassified: "To check",
};

export type OutputProfile = {
  headers: string[];
  rowCount: number;
  /** The first few rows as text, for the roll-down and for classification. */
  sample: string[][];
  numericColumns: number;
  sheets?: { name: string; rows: number; cols: number }[];
  textLength?: number;
};

export type OutputClass = {
  role: OutputRole;
  kind: OutputKind;
  confidence: "high" | "medium" | "low";
  signals: string[];
};

// --- Reading a delimited file -------------------------------------------

export const SAMPLE_ROWS = 5;
export const MAX_COUNTED_ROWS = 500000;

function sniffDelimiter(firstLine: string, ext: string): string {
  if (ext === ".tsv") return "\t";
  const counts: [string, number][] = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** A small CSV reader: quotes, doubled quotes, CRLF and a BOM. Keeps only the header and a few rows. */
export function parseDelimited(text: string, ext = ".csv"): { headers: string[]; sample: string[][]; rowCount: number; numericColumns: number } {
  const src = text.replace(/^﻿/, "");
  const delim = sniffDelimiter(src.slice(0, src.search(/\r?\n/) === -1 ? undefined : src.search(/\r?\n/)), ext);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let count = -1; // data rows, not counting the header
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") {
      if (records.length < SAMPLE_ROWS + 1) records.push(row);
      count++;
    }
    row = [];
  };
  for (let i = 0; i < src.length && count < MAX_COUNTED_ROWS; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  const headers = (records[0] ?? []).map((h) => h.trim());
  const sample = records.slice(1, SAMPLE_ROWS + 1);
  const numericColumns = headers.filter((_, c) => sample.length > 0 && sample.every((r) => r[c] !== undefined && r[c] !== "" && Number.isFinite(Number(r[c])))).length;
  return { headers, sample, rowCount: Math.max(0, count), numericColumns };
}

/** Every record of a delimited file, for readers that need more than the sample. Capped for safety. */
export function parseDelimitedAll(text: string, ext = ".csv", maxRows = 200000): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^\uFEFF/, "");
  const nl = src.search(/\r?\n/);
  const delim = sniffDelimiter(src.slice(0, nl === -1 ? undefined : nl), ext);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") records.push(row);
    row = [];
  };
  for (let i = 0; i < src.length && records.length <= maxRows; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  const headers = (records[0] ?? []).map((h) => h.trim());
  return { headers, rows: records.slice(1).map((r) => headers.map((_, i) => r[i] ?? "")) };
}

// --- Classifying ---------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

export type ClassifyInput = {
  name: string; // base file name
  path: string; // relative path inside the upload
  ext: string; // lower case, with the dot
  profile: OutputProfile;
  /** Extracted text for Word and text files. */
  text?: string;
};

function make(role: OutputRole, kind: OutputKind, confidence: OutputClass["confidence"], ...signals: string[]): OutputClass {
  return { role, kind, confidence, signals };
}

export function classifyOutput(input: ClassifyInput): OutputClass {
  const name = norm(input.name.replace(/\.[^.]+$/, ""));
  const H = input.profile.headers.map(norm);
  const joined = H.join(" | ");
  const has = (re: RegExp) => H.some((h) => re.test(h));
  const nameHas = (re: RegExp) => re.test(name);
  const text = (input.text ?? "").slice(0, 20000);

  // Documents and text first: they have no columns.
  if ([".docx", ".txt", ".md", ".rtf"].includes(input.ext)) {
    if (nameHas(/session ?info/)) return make("provenance", "session_info", "high", "file name says session information");
    if (/R version \d|^\s*>\s/m.test(text) || nameHas(/console|r output|session log|\blog\b/)) {
      return make("provenance", "console_log", "high", "R banner or console prompts in the text");
    }
    if (nameHas(/interpretation|readme|read me|guide|notes|methodology/)) {
      return make("provenance", "author_notes", "high", "file name says it is a guide or notes");
    }
    if (nameHas(/diagnostic/)) return make("assurance", "diagnostics", "medium", "file name says diagnostics");
    if (/Table\s+[A-Z]?\d+(\.\d+)?\s*[:.]/.test(text)) return make("evidence", "word_tables", "medium", "numbered table captions in the text");
    return make("unclassified", "other_document", "low", "no recognisable pattern");
  }

  if (input.profile.headers.length === 0) return make("unclassified", "other_table", "low", "no header row found");

  // Context: how the run or the survey design was set up.
  if (H.length === 2 && H[0] === "item" && H[1] === "value") return make("provenance", "manifest", "high", "item and value columns");
  if (nameHas(/manifest|session ?info/)) return make("provenance", "manifest", "high", "file name says manifest");
  if (nameHas(/survey design|singleton|strat|psu|merge audit|source file audit|weight comparison|stratifier|field manifest/) || nameHas(/\baudit\b/)) {
    return make("provenance", "survey_design", "medium", "file name points to survey design or audit records");
  }

  // A replication or validation file checks other results, whatever its columns.
  if (nameHas(/replication|validation|exact/)) return make("assurance", "validation_checks", "medium", "file name points to replication or validation");

  // Evidence by content.
  const est = has(/^(estimate|coef|coefficient|beta|b|log odds|logit)$/) || has(/\bestimate\b/);
  const se = has(/std\.? error|^se$|std error|standard error|\bse\b/);
  const pv = has(/^p$|p value|pr |^pr$|p val|\bp\b/) || has(/\bpr\b/);
  const stat = has(/t value|z value|^t$|^z$|wald/);
  const orCol = has(/^(or|hr|rr|irr|aor)$/) || has(/odds ratio|hazard ratio|risk ratio/) || has(/^exp b/);
  const ci = has(/2 5|97 5|ci low|ci high|ci l|ci u|lower|upper|conf/);
  if (est && se && (pv || stat)) return make("evidence", "model_coefficients", "high", "estimate, standard error and a p or test statistic");
  if (orCol && (ci || pv)) return make("evidence", "odds_ratios", "high", "ratio column with intervals or p value");
  if (orCol || (est && ci)) return make("evidence", "odds_ratios", "medium", "ratio or estimate with intervals");

  // Assurance: checks on the evidence.
  const status = H.findIndex((h) => /^(status|result|check result|passed|pass)$/.test(h));
  if (status >= 0 && input.profile.sample.some((r) => /^(pass|fail|ok|true|false|warn)/i.test(r[status] ?? ""))) {
    return make("assurance", "validation_checks", "high", "a status column holding pass or fail values");
  }
  if (has(/identical/) || nameHas(/validation|replication|exact/)) return make("assurance", "validation_checks", "medium", "file name or columns point to validation");
  if (has(/silhouette|^wss$|within ?ss|tot withinss|elbow/) || nameHas(/silhouette|\bwss\b|withinss|stability|elbow/)) {
    return make("assurance", "cluster_diagnostics", "high", "silhouette, within-cluster sums of squares or stability");
  }
  if (has(/gvif|\bvif\b|deff|design effect|separation|aic|bic|deviance|pseudo|auc|hosmer|fitted|r2|r squared/) ||
      nameHas(/diagnostic|gvif|\bvif\b|deff|design effect|separation|fitted probability|distribution|sparse|diagnostics/)) {
    return make("assurance", "diagnostics", "high", "model fit, collinearity, design effect or separation columns or name");
  }

  // Evidence: descriptive results.
  const propCol = has(/prop|pct|percent|share|%/);
  const ciCol = has(/ci|lower|upper|\bse\b|std error/);
  if (propCol && ciCol) return make("evidence", "proportions", "high", "percentages with intervals or standard errors");
  if (nameHas(/cluster|typology/) || has(/^cluster/)) {
    return make("evidence", "cluster_profile", "medium", "cluster profile");
  }
  if (propCol || (H.length >= 3 && input.profile.numericColumns >= 2)) {
    return make("evidence", "descriptive_table", "medium", "labelled rows with percentage or numeric columns");
  }
  return make("unclassified", "other_table", "low", "no recognisable pattern");
}

// --- Families --------------------------------------------------------------

/**
 * Groups files into families for the roll-down: a subfolder is its own family;
 * loose files group by the first word of the name when two or more share it.
 */
export function assignFamilies(paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const token = (p: string) => {
    const base = p.split("/").pop() ?? p;
    const parts = base.replace(/\.[^.]+$/, "").split(/[_\-\s]+/).filter(Boolean);
    while (parts.length > 1 && /^\d+$/.test(parts[0])) parts.shift();
    return parts[0] ?? base;
  };
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (!p.includes("/")) counts.set(token(p).toLowerCase(), (counts.get(token(p).toLowerCase()) ?? 0) + 1);
  }
  for (const p of paths) {
    if (p.includes("/")) {
      const segs = p.split("/");
      out.set(p, segs[segs.length - 2]);
    } else {
      const t = token(p);
      out.set(p, (counts.get(t.toLowerCase()) ?? 0) >= 2 ? t : "Other files");
    }
  }
  return out;
}

export function roleCounts(files: { role: OutputRole }[]): Record<OutputRole, number> {
  const c: Record<OutputRole, number> = { evidence: 0, assurance: 0, provenance: 0, unclassified: 0 };
  for (const f of files) c[f.role]++;
  return c;
}

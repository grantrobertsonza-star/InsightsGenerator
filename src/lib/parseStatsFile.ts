import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { supabaseAdmin } from "./supabaseAdmin";

const execFileAsync = promisify(execFile);

const BUCKET = "documents";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string | number | null>[];
  /** Set only when a very wide file was cut down to its usable variables. */
  totalVariables?: number;
  keptVariables?: number;
};

import { isStatsFileName } from "./statsFileName";
export { isStatsFileName };

/**
 * Reads an SPSS (.sav), Stata (.dta), or SAS (.sas7bdat) file by handing
 * it to the Python conversion function at api/parse-stats-file.py (see
 * that file for why this has to leave the Node/TypeScript runtime: there's
 * no reliable JS reader for these binary formats, and their variable/value
 * label metadata is usually the actual point of the format, not optional
 * extra).
 *
 * Returns the same { headers, rows } shape parseTableDocument does, with
 * headers already resolved to each variable's label (falling back to its
 * raw SPSS/Stata/SAS name when it has none) and categorical values already
 * decoded from numeric codes to their label text, so every downstream
 * consumer - the table preview, the banner-plan picker,
 * bannerPlanComputation.ts - sees exactly what it already expects from a
 * CSV/Excel upload and needs no SPSS-specific branch of its own.
 *
 * This function tells the Python function where the file already is in
 * Supabase Storage rather than sending it the file's bytes, and the
 * Python function writes its result back to storage rather than returning
 * it directly, both for the same reason: Vercel serverless functions cap
 * a function invocation's request AND response body at 4.5MB, and a real
 * SPSS/Stata/SAS file - let alone its fully label-decoded JSON equivalent,
 * which is usually larger again - routinely exceeds that (confirmed
 * against a 26MB real file: a direct byte-body call failed with
 * FUNCTION_PAYLOAD_TOO_LARGE, a 413, before this was fixed). Downloading
 * the converted result from storage here is an ordinary Supabase Storage
 * download, not a function invocation payload, so it has no such limit.
 */
export async function parseStatsFile(storagePath: string, sourceFilename: string): Promise<ParsedTable> {
  // Plain `next dev` does not serve the Python function, so when neither
  // VERCEL_URL nor PARSE_STATS_FILE_URL is set, run the same conversion
  // with a local Python instead (needs: pip install pyreadstat).
  if (!process.env.VERCEL_URL && !process.env.PARSE_STATS_FILE_URL) {
    return runLocalStatsPython<ParsedTable>(storagePath, sourceFilename, "convert");
  }
  // VERCEL_URL is set automatically on Vercel (preview and production) to
  // this deployment's own hostname, so this always calls the sibling
  // Python function within the same deployment rather than guessing at a
  // separately configured service URL. PARSE_STATS_FILE_URL is the escape
  // hatch for local development with `vercel dev`, where VERCEL_URL isn't
  // set; without either, this falls back to localhost on the default
  // Next.js dev port, which only works if the Python function is also
  // being served locally (plain `next dev` does not do that -- use
  // `vercel dev` to exercise this path locally at all).
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.PARSE_STATS_FILE_URL ?? "http://127.0.0.1:3000";

  const response = await fetch(`${base}/api/parse-stats-file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storagePath, sourceFilename, bucket: BUCKET }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      message = (JSON.parse(detail) as { error?: string }).error ?? detail;
    } catch {
      // detail wasn't JSON; use it as-is
    }
    throw new Error(
      `Couldn't read this as SPSS/Stata/SAS data (${response.status}). ${message || "The conversion step failed."}`
    );
  }

  const { resultPath } = (await response.json()) as { resultPath: string };

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(resultPath);
  if (error || !data) {
    throw new Error(`Converted SPSS/Stata/SAS result could not be read back from storage: ${error?.message}`);
  }
  const parsed = JSON.parse(await data.text()) as ParsedTable;

  // Best-effort cleanup: this intermediate file has no further use once
  // read, and leaving it around would otherwise just accumulate in the
  // bucket indefinitely. A failure here is never worth surfacing to the
  // caller - the actual table has already been read successfully.
  await supabaseAdmin.storage.from(BUCKET).remove([resultPath]).catch(() => {});

  return parsed;
}

async function runLocalStatsPython<T>(
  storagePath: string,
  sourceFilename: string,
  action: "convert" | "dictionary" | "crosstab" | "categories",
  args: unknown = {},
): Promise<T> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Couldn't download the file from storage to read it: ${error?.message}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "stats-"));
  try {
    const input = path.join(dir, "input.bin");
    const output = path.join(dir, "out.json");
    await writeFile(input, Buffer.from(await data.arrayBuffer()));
    const argsFile = path.join(dir, "args.json");
    await writeFile(argsFile, JSON.stringify(args ?? {}));
    const script = path.join(process.cwd(), "scripts", "parse_stats_local.py");

    const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
    let lastError = "";
    let ran = false;
    for (const cmd of candidates) {
      try {
        await execFileAsync(cmd, [script, input, sourceFilename, output, action, argsFile], { maxBuffer: 10 * 1024 * 1024 });
        ran = true;
        break;
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === "ENOENT") continue; // this interpreter name isn't installed
        lastError = (err.stderr || err.message || "").trim().split("\n").slice(-3).join(" ");
        if (/No module named ['"]?pyreadstat/.test(lastError)) {
          throw new Error("Reading SPSS/Stata/SAS files locally needs the Python package pyreadstat. Run: pip install pyreadstat");
        }
        ran = true;
        break;
      }
    }
    if (!ran) {
      throw new Error("Reading SPSS/Stata/SAS files locally needs Python. Install Python, then run: pip install pyreadstat");
    }
    if (lastError) throw new Error(`Couldn't read this as SPSS/Stata/SAS data. ${lastError}`);
    return JSON.parse(await readFile(output, "utf-8")) as T;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type VariableInfo = {
  name: string;
  label: string;
  /** Full question wording from a confirmed questionnaire, for tooltips. */
  question?: string;
  numeric: boolean;
  nValid: number;
  pctValid: number;
  nDistinct: number;
  labelled: boolean;
  weightLike: boolean;
  isFlag?: boolean;
  /** Free-text answers (a string variable with no value labels). */
  text?: boolean;
  setKey?: string | null;
  inSet?: string;
};
/** A multiple-response question: yes/no option variables that share a name stem. */
export type SetKind = "multi" | "grid" | "battery";
export type VariableSet = {
  key: string;
  kind?: SetKind;
  label: string;
  vars: string[];
  nValid: number;
  pctValid: number;
};
export type WeightAudit = {
  name: string;
  label: string;
  nValid: number;
  nInvalid: number;
  sum?: number;
  min?: number;
  max?: number;
  median?: number;
  maxOverMedian?: number;
  nEff?: number;
  deff?: number;
  efficiencyPct?: number;
  topOnePctShare?: number;
};
export type DataAudit = {
  weights: WeightAudit[];
  dk: {
    declaredMissing: number;
    variables: number;
    cases: number;
    top: { variable: string; label: string; codes: string; cases: number }[];
  } | null;
};
export type VariableDictionary = {
  version?: number;
  nCases: number;
  variables: VariableInfo[];
  sets?: VariableSet[];
  /** Weights and missing-code audit, shown in the data quality report. */
  audit?: DataAudit | null;
  /** Excel workbooks: the sheets the data and the labels were read from. */
  sheets?: { data?: string; variables?: string | null; values?: string | null };
};

export type CrosstabNet = { label: string; vars: string[] };
export type CrosstabRowItem = {
  key: string;
  label: string;
  stem?: string;
  vars: string[];
  kind?: SetKind | "nets";
  nets?: CrosstabNet[];
  /** Groups of answer categories added as NET rows under a single-choice question. */
  groups?: CrosstabGroup[];
};
/** One condition that cases must meet. All filters of a table must hold. */
export type CrosstabFilter = {
  variable: string;
  /** in / notIn: answer labels in `values`. between: numeric `min` and/or `max`, both included. */
  op: "in" | "notIn" | "between";
  values?: string[];
  min?: number | null;
  max?: number | null;
};
export type CrosstabGroup = {
  label: string;
  /** Answers in the group. For a net score these are the positive answers. */
  cats: string[];
  /** net: a subtotal of the answers (default). score: share of the positive answers minus share of the negative ones, in points. mean: mean of the answer codes. */
  kind?: "net" | "score" | "mean";
  /** Negative answers of a net score. */
  minus?: string[];
  /** Where the row sits: after the answers (default), or above or below the answers it summarises. */
  place?: "end" | "above" | "below";
};
export type CrosstabRequest = {
  columnVars: string[];
  rowItems: CrosstabRowItem[];
  weightVar: string | null;
  /** Per column variable: categories combined into one column. */
  columnGroups?: Record<string, CrosstabGroup[]>;
  /** Which way of making tables produced this one. Used to group the table set by mode. */
  source?: "workspace" | "ask" | "window" | "starter";
  /** Built from the suggested starter set: findings from it are controlled for false discoveries. */
  starter?: boolean;
  /** How the many column tests in a table are corrected. Defaults to false discovery rate. */
  correction?: Correction;
  /** Survey design for Taylor series variance: PSU variable, optional strata variable. */
  design?: { psu: string; strata: string | null };
  /** Leave don't know, refused and not applicable out of percentage bases. Defaults to true. */
  excludeDk?: boolean;
  /** Restrict the whole table to one category of a filter variable. */
  filters?: CrosstabFilter[];
  /** Extra percentiles (0 to 100) to report for averages. */
  percentiles?: number[];
};
export type Correction = "none" | "bonferroni" | "fdr";
export type CategoryList = { variable: string; label: string; categories: { label: string; n: number }[] };

export type CellBase = { n: number; w: number; nEff: number };
/**
 * The NET column of one banner variable for one row: everyone with a valid answer
 * to the question and to that banner variable. Never tested, so no p, flag or letter.
 * Absent on tables saved before 9 October 2026.
 */
/** Descriptive statistics of a numeric variable (weighted when a weight is used). */
export type CrosstabDesc = {
  n: number;
  nEff: number;
  mean: number | null;
  sd: number | null;
  variance: number | null;
  sem: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p10?: number | null;
  p90?: number | null;
  sum?: number | null;
  mode?: number | null;
  skewness?: number | null;
  kurtosis?: number | null;
  /** Histogram bars: one per value when there are 12 or fewer, otherwise ten equal-width bins. */
  hist?: { lo: number; hi: number; pct: number }[];
  percentiles?: { p: number; v: number | null }[];
};
export type CrosstabNetCell = {
  block: number;
  count: number | null;
  pct: number | null;
  rowPct: number | null;
  /** Share of responses (mentions), multiple response only. */
  respPct?: number | null;
  /** Unweighted number of cases in the cell. */
  nCell: number | null;
  base: CellBase;
};
export type CrosstabRow = {
  label: string;
  variable?: string;
  /** A base row: the unweighted n of valid answers in each column. */
  isBase?: boolean;
  /** The second base row shown on weighted tables: the effective base (Kish). Also has isBase. */
  isEffBase?: boolean;
  isNet?: boolean;
  /** A net score or mean score row: shown as points or an average, not a percentage. */
  isScore?: boolean;
  isMean?: boolean;
  /** Descriptive statistics of an average or grid row. */
  desc?: CrosstabDesc | null;
  /** Eta of an average against each banner variable. */
  eta?: { block: number; label: string; eta: number }[];
  count: (number | null)[];
  /** Unweighted number of cases in each cell. Absent on tables saved before 9 October 2026. */
  nCell?: (number | null)[];
  /** One entry per banner variable, in block order. Absent on tables saved before 9 October 2026. */
  net?: CrosstabNetCell[];
  pct: (number | null)[];
  rowPct: (number | null)[];
  /** Share of responses (mentions) in each column, multiple response options only. */
  respPct?: (number | null)[];
  p: (number | null)[];
  /** Corrected p-values, present when a correction was applied. */
  pAdj?: (number | null)[];
  sig: number[];
  /** Standard error of each column percentage, in percentage points (design based when a design was given). */
  se?: (number | null)[];
  /** Letters of the columns this cell is significantly higher than (column-pair test). */
  letters?: string[];
  base: CellBase[];
  total: { count: number | null; nCell?: number | null; pct: number | null; respPct?: number | null; base: CellBase };
};
/** What produced a table, kept so any number can be traced and reproduced. */
export type CrosstabProvenance = {
  builtAt: string;
  engine: string | null;
  sourceFile: string;
  sourceDocumentId: string;
  cases: number | null;
  weightVar: string | null;
  correction: Correction;
  design?: { psu: string; strata: string | null } | null;
  columnVars: string[];
  rowKeys: string[];
  rowItems?: { key: string; label: string | null; kind?: string; vars: string[] }[];
  excludeDk?: boolean;
  filters?: CrosstabFilter[];
  columnGroups: Record<string, string[]>;
  questionnaireLabels: boolean;
  starter: boolean;
};
/** Whole-table association test of one question against one banner variable (first-order Rao-Scott). */
/** Whole-table test of one answer against one banner variable, with association measures from the weighted table. */
export type TableTest = {
  block: number;
  label: string;
  chi2: number;
  df: number;
  p: number;
  nEff: number;
  deff: number | null;
  cramersV?: number;
  contingencyC?: number;
  phi?: number;
  lambdaAnswer?: number | null;
  lambdaBanner?: number | null;
  lambdaSym?: number | null;
  gamma?: number;
  tauB?: number;
  tauC?: number;
  somersD?: number;
  /** Share of cells with an expected count under 5 (unweighted cases). */
  lowExpectedPct?: number;
  minExpected?: number;
  /** Fisher exact p, 2 by 2 tables only. */
  fisherP?: number;
};
export type CrosstabResult = {
  version: 2;
  engine?: string;
  provenance?: CrosstabProvenance;
  weightVar: string | null;
  weightLabel: string | null;
  /** True when no banner variable was chosen: one column of all respondents, no comparison tests. */
  overall?: boolean;
  excludeDk?: boolean;
  filters?: { variable: string; label: string; op: string; text: string }[];
  /** Free text under the table, set by the researcher. */
  caption?: string;
  blocks: { var: string; label: string }[];
  columns: { block: number; blockLabel: string; name: string; letter?: string; isGroup?: boolean; n: number; w: number; nEff: number }[];
  /** Base of the NET column of each banner variable. Absent on tables saved before 9 October 2026. */
  nets?: { block: number; blockLabel: string; n: number; w: number; nEff: number }[];
  total: CellBase;
  questions: { key: string; label: string; kind: "single" | "multi" | "numeric" | "grid"; rows: CrosstabRow[]; tableTests?: TableTest[]; /** Mean, spread and range of the codes of a coded single choice question. */ desc?: CrosstabDesc }[];
  notes?: {
    test: string;
    correction?: Correction;
    dkNote?: string;
    filterNote?: string | null;
    expectedNote?: string;
    respNote?: string;
    design?: string;
    overlap?: string;
    tableTest?: string;
    designUsed?: { psu: string; strata: string | null; nPsu: number; nStrata: number; pooledPsus: number; casesMissingDesign: number } | null;
    minBase: number;
    minReliable?: number;
    lowBase: number;
    multiBase: string;
    means: string;
  };
  skipped: { variable: string; reason: string }[];
  /** True when the table came from the starter set. */
  starter?: boolean;
};

/**
 * Runs the dictionary or crosstab step of the Python tool against a file
 * already in storage. On Vercel (or with PARSE_STATS_FILE_URL set) it calls
 * the Python function; otherwise it runs the same code with local Python.
 */
export async function runStatsTool<T>(
  action: "dictionary" | "crosstab" | "categories",
  storagePath: string,
  sourceFilename: string,
  args: unknown = {},
): Promise<T> {
  if (!process.env.VERCEL_URL && !process.env.PARSE_STATS_FILE_URL) {
    return runLocalStatsPython<T>(storagePath, sourceFilename, action, args);
  }
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.PARSE_STATS_FILE_URL ?? "http://127.0.0.1:3000";
  const response = await fetch(`${base}/api/parse-stats-file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args, storagePath, sourceFilename, bucket: BUCKET }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      message = (JSON.parse(detail) as { error?: string }).error ?? detail;
    } catch {
      // not JSON
    }
    throw new Error(message || `The ${action} step failed (${response.status}).`);
  }
  return ((await response.json()) as { result: T }).result;
}

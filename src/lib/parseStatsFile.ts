import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import type { TableCell } from "./rowCells";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { supabaseAdmin } from "./supabaseAdmin";
import { convertedCopyPath } from "./documentStorageCleanup";
import { beginConvertedCopy, finishConvertedCopy } from "./projectStorageCleanup";

const execFileAsync = promisify(execFile);

const BUCKET = "documents";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, TableCell>[];
  /** Set only when a very wide file was cut down to its usable variables. */
  totalVariables?: number;
  keptVariables?: number;
  /** The engine reader that produced it (STATS_READER), stored as the table's read provenance. */
  reader?: string;
};

import { isStatsFileName } from "./statsFileName";
import { SIGNATURE_HEADER, signParseRequest } from "./parseRequestSignature";
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
  return runEngineConversion<ParsedTable>("convert", storagePath, sourceFilename, {});
}

/**
 * Runs one of the engine's actions whose answer is too large to return directly: "convert"
 * (SPSS/Stata/SAS, above), "table" (the one reader for CSV, TSV and Excel; parseTable.ts) or
 * "indicators" (Indicator data; indicatorData.ts). The answers are respondent-level tables or a file's
 * indicator observations, usually past a serverless response limit, so the engine writes them to the
 * file's converted copy and this reads them back from storage (see parseStatsFile's comment), then
 * removes the copy.
 */
export async function runEngineConversion<T>(
  action: "convert" | "table" | "indicators",
  storagePath: string,
  sourceFilename: string,
  args: Record<string, unknown>,
): Promise<T> {
  // Plain `next dev` does not serve the Python function, so when neither
  // VERCEL_URL nor PARSE_STATS_FILE_URL is set, run the same conversion
  // with a local Python instead (needs: pip install pyreadstat).
  if (!process.env.VERCEL_URL && !process.env.PARSE_STATS_FILE_URL) {
    return runLocalStatsPython<T>(storagePath, sourceFilename, action, args);
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

  // The converted copy is respondent-level data (Codex RR-F03). It is recorded before the parser is
  // asked, in a record that outlives the project, and removed (with its record) once the parser has
  // answered; a removal that fails stays on the record for retry. A request that fails without an
  // answer leaves the record in flight: the parser may still write the copy, and a retry removes it
  // after the in-flight time (projectStorageCleanup.ts). Nothing is asked when it cannot be recorded.
  const converted = convertedCopyPath(storagePath);
  const intent = await beginConvertedCopy(storagePath, converted);
  let parserDone = false;
  try {
    const response = await fetch(`${base}/api/parse-stats-file`, {
      method: "POST",
      // IMP-001: the request is signed for exactly this file and action (parseRequestSignature.ts);
      // the shared secret itself is never sent. PARSE_STATS_SHARED_SECRET must hold the same value
      // here and in the Python function's environment, or every request fails with a 401, surfaced
      // below as an actionable message rather than a generic parsing failure.
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signParseRequest(action, BUCKET, storagePath) },
      body: JSON.stringify({ storagePath, sourceFilename, bucket: BUCKET, action, args }),
    });
    parserDone = true;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      let message = detail;
      try {
        message = (JSON.parse(detail) as { error?: string }).error ?? detail;
      } catch {
        // detail wasn't JSON; use it as-is
      }
      if (response.status === 401) {
        throw new Error(
          "The conversion service rejected this request as unauthorized. PARSE_STATS_SHARED_SECRET must be set to the " +
            "same value in both this app's environment and the parse-stats-file function's own environment.",
        );
      }
      throw new Error(
        `Couldn't read this data file (${response.status}). ${message || "The conversion step failed."}`
      );
    }

    const { resultPath } = (await response.json()) as { resultPath: string };
    // It must be where the parser is known to write it, so a reply can never point this at another
    // object.
    if (resultPath !== converted) {
      throw new Error("The conversion service answered with an unexpected result location, so its result was not used.");
    }
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(resultPath);
    if (error || !data) {
      throw new Error(`The data file's converted result could not be read back from storage: ${error?.message}`);
    }
    return JSON.parse(await data.text()) as T;
  } finally {
    await finishConvertedCopy(intent, converted, parserDone);
  }
}
// --- Local worker -------------------------------------------------------
// Under plain `next dev` the Python engine runs on this machine. Starting a
// new Python process, importing pandas and re-reading the data file for every
// table is slow, so one worker (scripts/parse_stats_worker.py) is kept alive
// and keeps the last files it read in memory. If it cannot start, or dies, the
// one-shot runner below is used instead, exactly as before.

type WorkerReply = { id?: number; result?: unknown; error?: string; ready?: boolean; restart?: boolean };
/** The worker's own script changed on disk since it started; it exits and the request goes to a fresh one. */
class WorkerRestarting extends Error {}
type LocalWorker = {
  proc: ChildProcess;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  nextId: number;
  /** WORKER_PROTOCOL of the code that started it. Absent on a worker started before the tag existed. */
  protocol?: number;
};
/**
 * The worker conversation this code speaks: refuses unknown actions, asks to restart when its script
 * changes (batch 31). A worker kept on globalThis from before that (a dev server running since an
 * older version) cannot run the new script's guard, so it is recognised by the missing or older tag
 * and replaced before it is used (Codex B31-F01). Raise this when the request or reply shape changes.
 */
const WORKER_PROTOCOL = 6; // 3: the respondent_quality action; 4: codebook and instrument_sheet; 5: indicators; 6: value_labels

const WORKER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
// Kept on globalThis so a hot reload does not leave an orphan worker behind.
// __statsWorkerStarts counts workers that reached "ready" in this process, so a test can show that
// simultaneous callers share one replacement (B35-F02) on any platform, without listing processes.
const workerHolder = globalThis as unknown as { __statsWorker?: Promise<LocalWorker | null>; __statsWorkerOff?: boolean; __statsWorkerLive?: LocalWorker; __statsWorkerStarts?: number };
/** Forgets this worker, unless a newer one has replaced it (an old worker exiting must not orphan the new one). */
function forgetWorker(worker: LocalWorker) {
  if (workerHolder.__statsWorkerLive !== worker) return;
  workerHolder.__statsWorker = undefined;
  workerHolder.__statsWorkerLive = undefined;
}

function startWorker(): Promise<LocalWorker | null> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "scripts", "parse_stats_worker.py");
    const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
    const tryNext = (k: number) => {
      if (k >= candidates.length) return resolve(null);
      let settled = false;
      const proc = spawn(candidates[k], ["-u", script], {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      const worker: LocalWorker = { proc, pending: new Map(), nextId: 1, protocol: WORKER_PROTOCOL };
      proc.stdin!.on("error", () => {}); // a dead worker is reported through "exit"
      const fail = (message: string) => {
        for (const p of worker.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(message));
        }
        worker.pending.clear();
        forgetWorker(worker); // next call starts a fresh one
      };
      const startupTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        resolve(null);
      }, 60_000);
      let buffer = "";
      proc.stdout!.setEncoding("utf8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: WorkerReply;
          try {
            msg = JSON.parse(line) as WorkerReply;
          } catch {
            continue;
          }
          if (msg.ready) {
            if (!settled) {
              settled = true;
              clearTimeout(startupTimer);
              workerHolder.__statsWorkerStarts = (workerHolder.__statsWorkerStarts ?? 0) + 1;
              resolve(worker);
            }
            continue;
          }
          const p = msg.id !== undefined ? worker.pending.get(msg.id) : undefined;
          if (!p) continue;
          worker.pending.delete(msg.id as number);
          clearTimeout(p.timer);
          if (msg.restart) {
            forgetWorker(worker);
            p.reject(new WorkerRestarting("restart"));
          } else if (msg.error !== undefined) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      });
      proc.on("error", (e: NodeJS.ErrnoException) => {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          if (e.code === "ENOENT") tryNext(k + 1); // this interpreter name is not installed
          else resolve(null);
          return;
        }
        fail("The statistics worker stopped. Try again.");
      });
      proc.on("exit", () => {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          resolve(null); // could not load (for example pyreadstat missing): fall back to one-shot
          return;
        }
        fail("The statistics worker stopped. Try again.");
      });
    };
    tryNext(0);
  });
}

async function callWorker<T>(srcPath: string, sourceFilename: string, action: string, args: unknown): Promise<{ ok: true; value: T } | { ok: false; unavailable: true }> {
  try {
    return await callWorkerOnce<T>(srcPath, sourceFilename, action, args);
  } catch (error) {
    // Once only: a fresh worker runs the current script, so it does not ask again.
    if (error instanceof WorkerRestarting) return callWorkerOnce<T>(srcPath, sourceFilename, action, args);
    throw error;
  }
}

async function callWorkerOnce<T>(srcPath: string, sourceFilename: string, action: string, args: unknown): Promise<{ ok: true; value: T } | { ok: false; unavailable: true }> {
  if (workerHolder.__statsWorkerOff) return { ok: false, unavailable: true };
  if (!workerHolder.__statsWorker) workerHolder.__statsWorker = startWorker();
  const awaited = workerHolder.__statsWorker;
  let worker = await awaited;
  if (worker && worker.protocol !== WORKER_PROTOCOL) {
    // Started by older code: stop it (its pending requests fail as a stopped worker) and use a fresh one.
    // B35-F02: single flight. Every caller that waited on the old worker reaches this point; only the
    // first, finding the holder still on the promise it awaited, stops the old worker and starts the
    // replacement. The others find the holder already moved on and share that replacement, so no
    // second worker is started and left running without an owner.
    if (workerHolder.__statsWorker === awaited) {
      workerHolder.__statsWorkerLive = worker;
      forgetWorker(worker);
      worker.proc.kill();
      workerHolder.__statsWorker = startWorker();
    }
    // undefined when the replacement could not start and the caller that started it gave up on it.
    worker = (await workerHolder.__statsWorker) ?? null;
  }
  if (worker) workerHolder.__statsWorkerLive = worker;
  if (!worker) {
    workerHolder.__statsWorker = undefined;
    workerHolder.__statsWorkerOff = true; // do not retry a worker that cannot start this session
    return { ok: false, unavailable: true };
  }
  return new Promise((resolve, reject) => {
    const id = worker.nextId++;
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      worker.proc.kill(); // a stuck request: drop the worker, the next call starts a new one
      forgetWorker(worker);
      reject(new Error("The statistics worker took too long and was restarted. Try again."));
    }, WORKER_REQUEST_TIMEOUT_MS);
    worker.pending.set(id, {
      resolve: (v) => resolve({ ok: true, value: v as T }),
      reject,
      timer,
    });
    const ok = worker.proc.stdin!.write(JSON.stringify({ id, src: srcPath, sourceFilename, action, args }) + "\n");
    void ok;
  });
}

/** How long a downloaded data file is reused before it is fetched again. */
const STATS_CACHE_FRESH_MS = 10 * 60 * 1000;
/**
 * A cached download older than this is deleted. Longer than the reuse window plus the worker's
 * longest request (5 minutes), so a file handed to the worker just inside the window is never
 * removed while the worker reads it.
 */
export const STATS_CACHE_KEEP_MS = 30 * 60 * 1000;
const STATS_CACHE_PREFIX = "stats-src-";
let lastSweep = 0;

/**
 * Removes cached data file downloads (and half-written `.part` files left by a crash) older than
 * STATS_CACHE_KEEP_MS from `dir`. Before this, each data file read left its download in the
 * temporary folder for good: respondent-level data kept on disk with no end, and the folder
 * growing by one file per data file per session. Best effort: a file that cannot be removed now
 * (in use on Windows, already gone) is left for the next sweep and never fails the read that ran
 * the sweep. Returns the names removed.
 */
export async function sweepStatsCache(dir: string = tmpdir(), now: number = Date.now()): Promise<string[]> {
  const removed: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(STATS_CACHE_PREFIX)) continue;
    const file = path.join(dir, name);
    try {
      const info = await stat(file);
      if (!info.isFile() || now - info.mtimeMs <= STATS_CACHE_KEEP_MS) continue;
      await rm(file, { force: true });
      removed.push(name);
    } catch {
      // Left for the next sweep.
    }
  }
  return removed;
}

async function runLocalStatsPython<T>(
  storagePath: string,
  sourceFilename: string,
  action: "convert" | "table" | "indicators" | "dictionary" | "crosstab" | "categories" | "columns" | "respondent_quality" | "codebook" | "instrument_sheet" | "value_labels",
  args: unknown = {},
): Promise<T> {
  // The same data file is read many times in a session (every table built,
  // every variable list), so the download is kept on disk for a few minutes
  // instead of being fetched again each time.
  const cached = path.join(tmpdir(), `${STATS_CACHE_PREFIX}${createHash("sha1").update(storagePath).digest("hex")}`);
  // At most once a minute per server process, old downloads are cleared (sweepStatsCache).
  if (Date.now() - lastSweep > 60 * 1000) {
    lastSweep = Date.now();
    void sweepStatsCache();
  }
  let bytes: Buffer | null = null;
  try {
    const info = await stat(cached);
    if (Date.now() - info.mtimeMs < STATS_CACHE_FRESH_MS) bytes = await readFile(cached);
  } catch {
    // not cached yet
  }
  if (!bytes) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      throw new Error(`Couldn't download the file from storage to read it: ${error?.message}`);
    }
    bytes = Buffer.from(await data.arrayBuffer());
    // Written under a temporary name and renamed, so the worker never reads half a file.
    const part = `${cached}.${process.pid}.${Date.now()}.part`;
    await writeFile(part, bytes).then(() => rename(part, cached)).catch(() => rm(part, { force: true }).catch(() => {}));
  }
  const cachedOk = await stat(cached).then(() => true, () => false);
  try {
    const viaWorker = cachedOk ? await callWorker<T>(cached, sourceFilename, action, args ?? {}) : null;
    if (viaWorker?.ok) return viaWorker.value;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(/worker/i.test(message) ? message : `Couldn't read this data file. ${message}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "stats-"));
  try {
    const input = path.join(dir, "input.bin");
    const output = path.join(dir, "out.json");
    await writeFile(input, bytes);
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
          throw new Error("Reading SPSS/Stata/SAS files locally needs the Python package pyreadstat. Run: pip install -r requirements.txt");
        }
        // R (.rds, .RData) and Parquet files need two more packages (26 October 2026).
        if (/No module named ['"]?(pyreadr|fastparquet)/.test(lastError)) {
          throw new Error("Reading R and Parquet files locally needs the Python packages pyreadr and fastparquet. Run: pip install -r requirements.txt");
        }
        ran = true;
        break;
      }
    }
    if (!ran) {
      throw new Error("Reading SPSS/Stata/SAS files locally needs Python. Install Python, then run: pip install pyreadstat");
    }
    if (lastError) throw new Error(`Couldn't read this data file. ${lastError}`);
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
  /** The distinct whole-number values the variable holds, as code strings, when there are at most 60 (dictionary
   * version 16); null for a measure or decimals; absent from an older dictionary. */
  codes?: string[] | null;
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
  /** IMP-SHIP-002 (Codex round 2): id-like columns whose Excel cell format Python could
   * not faithfully reproduce (a custom numeric format other than plain text or zero-
   * padding) - the "or explicitly report unsupported formatting" half of the identifier
   * contract. Absent or empty means every id-like column is either safe or not Excel. */
  unsupportedIdentifierColumns?: string[];
  /** Exact duplicate cases across every variable in the file (version 6+). */
  duplicateCases?: number;
  /** The document's layout setting (rows_are_cases/columns_are_cases) in effect when this
   * dictionary was computed, so a cached copy can be told apart from a stale one read under
   * a different orientation. Absent on dictionaries cached before this was tracked. */
  layout?: string | null;
  /** The document's header row choice (DataSetup.headerRowsSkipped) in effect when this dictionary was computed: a
   * cached copy read under another header row names other variables and is stale. Absent on dictionaries cached
   * before the choice existed, all read with the header detected automatically, so absent is read as null. */
  headerRowsSkipped?: number | null;
  /** An Excel workbook whose label sheets (or codebook) declared two different labels for the
   * same variable or the same value code, and where each came from. Present only when such a
   * conflict was found; capped at 50 entries. IMP-015 (version 7+): neither label is applied -
   * the code is shown with every competing label (resolution "shown_as_conflict"); "kept" and
   * "discarded" only record which source was read later. */
  labelConflicts?: {
    variable: string;
    kind: "variable_label" | "value_label";
    value?: string | number;
    keptSheet?: string | null;
    kept?: unknown;
    discardedSheet?: string | null;
    discarded?: unknown;
    resolution?: "shown_as_conflict";
  }[];
  /** IMP-015: variable names in a workbook's label sheets that match no data column, so their
   * labels never apply (often a renamed or misspelt column). Capped at 50. */
  unmatchedLabelVariables?: string[];
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
  /** in / notIn: answer labels in `values`. between: numeric `min` and/or `max`, both included. codes: raw answer
   * codes in `codes` (any of them), matched by the code's one text form (CrosstabRow.rawCode), never by label; a blank
   * or missing answer is outside. Built for tracker dashboard segments by trackerSegment.segmentFilters only. */
  op: "in" | "notIn" | "between" | "codes";
  values?: string[];
  codes?: string[];
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
  /**
   * Mean only: when the engine does not judge the answers an ordered scale (its _is_ordered_scale:
   * the file's measurement level, a numbered scale, or scale wording in the labels), the row's label
   * gains "(mean of the answer codes, which may not be in order)" and the row carries
   * codesMayBeUnordered. Set by plain-English mean requests (crosstabAsk.ts).
   */
  qualifyCodes?: boolean;
};
export type CrosstabRequest = {
  columnVars: string[];
  rowItems: CrosstabRowItem[];
  weightVar: string | null;
  /** Per column variable: categories combined into one column. */
  columnGroups?: Record<string, CrosstabGroup[]>;
  /** Which way of making tables produced this one. Used to group the table set by mode. */
  source?: "workspace" | "ask" | "window" | "starter" | "assistant";
  /** Built from the suggested starter set: findings from it are controlled for false discoveries. */
  starter?: boolean;
  /** How the many column tests in a table are corrected. Defaults to false discovery rate. */
  correction?: Correction;
  /** Survey design for Taylor series variance: PSU variable, optional strata variable. ANA-NPS-003
   * (second counter-review): `psu` is nullable because a strata-only design (clustering variable
   * absent, stratification variable present) is a supported, distinct design from "no design at
   * all" - the engine already treats each case as its own primary sampling unit within its stratum
   * in that case (api/parse-stats-file.py's _Design.build). A `design` object with both fields
   * null/absent is equivalent to omitting `design`. */
  design?: { psu: string | null; strata: string | null };
  /** Leave don't know, refused and not applicable out of percentage bases. Defaults to true. */
  excludeDk?: boolean;
  /** Batch 48, the "Mean" tick: a mean row above each single choice question whose codes form a rating
   * scale. Only true asks; absent (a request saved before the tick) builds without. */
  meanRows?: boolean;
  /** Restrict the whole table to one category of a filter variable. */
  filters?: CrosstabFilter[];
  /** Extra percentiles (0 to 100) to report for averages. */
  percentiles?: number[];
  /** Set when this table is one panel of a layered set (SPSS-style layers: one subtable per
   * category of a layer variable, built as N separate requests sharing a layerGroup id). Metadata
   * only, not read by the Python engine; buildCrosstab stores it alongside the result so the saved
   * tables can be grouped and labelled in the list. */
  layerGroup?: string;
  layerVariable?: string;
  layerLabel?: string;
  layerCategory?: string;
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
  /** pctExact: the same share unrounded (engine 2026.10.28 on; CT5K-F01). */
  hist?: { lo: number; hi: number; pct: number; pctExact?: number }[];
  percentiles?: { p: number; v: number | null }[];
};
export type CrosstabNetCell = {
  block: number;
  count: number | null;
  pct: number | null;
  /** The NET column's count and pct unrounded (see CrosstabRow.countExact). */
  countExact?: number | null;
  pctExact?: number | null;
  rowPct: number | null;
  /** Share of responses (mentions), multiple response only. */
  respPct?: number | null;
  /** Unweighted number of cases in the cell. */
  nCell: number | null;
  base: CellBase;
};
export type CrosstabRow = {
  label: string;
  /** The answer's underlying code (or, for a variable with no value labels, the category text
   * itself), stable across a value-label wording change in a way `label` is not - a codebook
   * relabelling code 4 from "Good" to "Excellent" between waves keeps the same rawCode. Present
   * on single-choice category rows; absent on base/net/mean/score rows, which have no one code. */
  rawCode?: string;
  variable?: string;
  /** A base row: the unweighted n of valid answers in each column. */
  isBase?: boolean;
  /** The second base row shown on weighted tables: the effective base (Kish). Also has isBase. */
  isEffBase?: boolean;
  isNet?: boolean;
  /** A net score or mean score row: shown as points or an average, not a percentage. */
  isScore?: boolean;
  isMean?: boolean;
  /** Batch 48: a mean row added by the Mean tick (label "Mean"), not a group the researcher defined. */
  autoMean?: boolean;
  /** A requested mean whose codes the engine does not judge an ordered scale (CrosstabGroup.qualifyCodes); its label says so. */
  codesMayBeUnordered?: boolean;
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
  /** CT5K-F01 (batch 59): the weighted count and the percentage (or, on a mean or score row, the mean) of
   * each column unrounded, saved with the table. `count` and `pct` are rounded for display; every figure
   * derived from them (NPS, top-box, coded means, the export's Total line) is computed from these and
   * rounded once at the end (read through src/lib/crosstabExact.ts). pctExact is null exactly where pct
   * is. Absent on tables built before engine 2026.10.28, which tableMethodStatus reports as earlier. */
  countExact?: (number | null)[];
  pctExact?: (number | null)[];
  rowPct: (number | null)[];
  /** Share of responses (mentions) in each column, multiple response options only. */
  respPct?: (number | null)[];
  p: (number | null)[];
  /** Corrected p-values, present when a correction was applied. */
  pAdj?: (number | null)[];
  sig: number[];
  /** Standard error of each column percentage, in percentage points (design based when a design was given). */
  se?: (number | null)[];
  /** se unrounded (engine 2026.10.28 on), for intervals around derived figures; see countExact. */
  seExact?: (number | null)[];
  /** Letters of the columns this cell is significantly higher than (column-pair test). */
  letters?: string[];
  /** Standardized residual (observed minus expected, over the square root of expected), one per column.
   * Only present on single-choice questions with a banner variable, the same table the chi-square test runs on. */
  residual?: (number | null)[];
  /** Adjusted residual: the standardized residual divided by its own standard error, so it reads like a z-score. */
  adjResidual?: (number | null)[];
  base: CellBase[];
  total: { count: number | null; nCell?: number | null; pct: number | null; countExact?: number | null; pctExact?: number | null; respPct?: number | null; base: CellBase };
};
/** What produced a table, kept so any number can be traced and reproduced. */
export type CrosstabProvenance = {
  /** Batch 48: the Mean tick as it was when this table was built. */
  meanRows?: boolean;
  builtAt: string;
  engine: string | null;
  sourceFile: string;
  sourceDocumentId: string;
  cases: number | null;
  weightVar: string | null;
  correction: Correction;
  /** ANA-NPS-003 (second counter-review): see the matching comment on CrosstabRequest.design -
   * `psu` is nullable to record a strata-only design distinctly from no design at all. */
  design?: { psu: string | null; strata: string | null } | null;
  columnVars: string[];
  rowKeys: string[];
  rowItems?: { key: string; label: string | null; kind?: string; vars: string[] }[];
  excludeDk?: boolean;
  filters?: CrosstabFilter[];
  columnGroups: Record<string, string[]>;
  questionnaireLabels: boolean;
  starter: boolean;
  /** Engineering brief round 4 (criterion 4, "persist the authoritative sheet explicitly
   * in calculation provenance"): which sheet was actually authoritative when this table
   * was built - null for a CSV/stats file, which has no sheet concept. Previously this
   * provenance recorded sourceFile/sourceDocumentId but nothing naming which sheet of a
   * multi-sheet workbook the saved numbers came from. */
  selectedSheet?: string | null;
  /** The header row choice the file was read under (DataSetup.headerRowsSkipped, decision 9): null when detected
   * automatically. Absent on tables built before it was recorded (all read with detection). Provenance only: a table
   * is not marked stale by it, the same as for the layout. */
  headerRowsSkipped?: number | null;
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
  /** Engineering brief round 4 (criterion 4): the sheet this exact read actually used
   * (api/parse-stats-file.py's meta.sheets["data"]). Absent/null for a CSV or a stats
   * file, which has no sheet concept. */
  selectedSheet?: string | null;
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
  /** var/rawCode: a banner column's identity (its variable and answer code, same text form as
   * CrosstabRow.rawCode); rawCodes for a grouped column. Absent for the overall column, a set
   * member column, and tables built by an engine before 2026.10.16-9. */
  columns: { block: number; blockLabel: string; name: string; letter?: string; isGroup?: boolean; n: number; w: number; nEff: number; var?: string; rawCode?: string; rawCodes?: string[] }[];
  /** Base of the NET column of each banner variable. Absent on tables saved before 9 October 2026. */
  nets?: { block: number; blockLabel: string; n: number; w: number; nEff: number }[];
  total: CellBase;
  questions: { key: string; label: string; kind: "single" | "multi" | "numeric" | "grid"; rows: CrosstabRow[]; tableTests?: TableTest[]; /** Mean, spread and range of the codes of a coded single choice question. */ desc?: CrosstabDesc;
    /** ANA-NPS-003: present only when this question is an 11-point 0-10 NPS scale and a sampling
     * design was supplied. The actual Taylor-linearised standard error (percentage points) of the
     * promoters-minus-detractors contrast itself, computed server-side from the per-case d_i =
     * +1/-1/0 indicator via the same dsg.totals/var_totals machinery as every other design-based
     * figure in this table - not an approximation from individual categories' own design effects.
     * `total` is the Total column's reading; `columns[i]` matches `columns[i]` above. computeNps()
     * in descriptiveFindings.ts prefers this over its own SRS/avg-design-effect fallback whenever
     * it's available. */
    npsContrastSe?: { total: number | null; columns: (number | null)[] };
    /** D2b: each banner column's NPS against the rest of its banner variable, in points, with the domain contrast's
     * standard error (design-based, or with-replacement without a design) and Benjamini-Hochberg adjusted p across the
     * columns of one banner variable. Present for a 0 to 10 scale with two or more columns. */
    npsGroupTests?: {
      method: "design" | "with_replacement";
      correction: "fdr";
      columns: ({ block: number; nps: number; restNps: number; difference: number; se: number; z: number | null; p: number | null; pAdjusted?: number } | null)[];
    };
  }[];
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
    /** The version of the rules this table's figures and flags came from (engine TABLE_METHOD); absent on a
     * table built before it was recorded. Compared with CURRENT_TABLE_METHOD by tableMethodStatus. */
    methodVersion?: string;
    /** Batch 48: whether the Mean tick was on when the table was built, and the questions it gave no mean
     * (codes not a rating scale), in words; null when none. */
    meanRows?: boolean;
    meanNotAdded?: string | null;
    /** Under a survey design, cells or column pairs at 0% or 100% left untested, with the count; null when none. */
    degenerateUntested?: string | null;
    designUsed?: { psu: string; strata: string | null; nPsu: number; nStrata: number; pooledPsus: number; casesMissingDesign: number } | null;
    /** ANA-NPS-003 (second counter-review): true only when a sampling design was actually applied
     * to compute this table's design-aware figures (server-side dsg is not None) - as opposed to
     * `designUsed` being non-null merely because a design was REQUESTED (designUsed also carries
     * the degenerate "requested but every case was missing" case). Every row's own `se` falls back
     * to a plain SRS/Kish formula whenever a design was not actually applied, including that
     * degenerate case, and that SRS fallback SE is not distinguishable from a genuine design-based
     * category SE just by looking at it. Consumers must not treat the presence of a row's `se` as
     * proof a design correction applied; they must check this flag (or prefer `npsContrastSe`,
     * which is only ever populated when this is true). */
    designApplied?: boolean;
    /** ANA-NPS-003: the confidence-interval method actually used for every design-based and
     * SRS/Kish standard error in this table, persisted as explicit output metadata (see
     * api/parse-stats-file.py) rather than only living in that file's own comments. */
    intervalMethod?: string;
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
  action: "dictionary" | "crosstab" | "categories" | "columns" | "respondent_quality" | "codebook" | "instrument_sheet" | "value_labels",
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
    // Signed for this action and file, as in convert() above.
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signParseRequest(action, BUCKET, storagePath) },
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
    if (response.status === 401) {
      throw new Error(
        "The conversion service rejected this request as unauthorized. PARSE_STATS_SHARED_SECRET must be set to the " +
          "same value in both this app's environment and the parse-stats-file function's own environment.",
      );
    }
    throw new Error(message || `The ${action} step failed (${response.status}).`);
  }
  return ((await response.json()) as { result: T }).result;
}

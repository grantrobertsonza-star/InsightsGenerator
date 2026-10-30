// R6 CSM extension: the three data files of one CSM wave (Relationship, Channel, Noncustomer), each read with
// the one table reader (parseTableDocument, the engine's read every calculation uses), and their keys and grains
// checked. The contract is claude/csm-extension.md ("Import keys and grains").
//
// Keys (pack instructions): a current customer is study + sector + wave + respondent_id, the ID kept as text
// with its leading zeroes; a channel record is that customer key + experience_id, with channel a dimension, never
// the person key; a noncustomer is keyed apart (its own IDs, NC-prefixed in the pack). Study is the project; the
// wave is the files' shared wave label, confirmed by the data's own wave column when it has one; the sector is
// the company answer list, which must name the same companies by the same codes in every linked file.
// Checked here, each failure stated, never repaired:
//   - every ID is text (a number would have lost leading zeroes), present, and unique within its grain;
//   - one latest row per customer and channel; experience_id unique;
//   - every channel record's customer is in the same wave's Relationship file, with the same weight;
//   - noncustomer IDs never coincide with customer IDs, so the samples cannot be unioned by key;
//   - the wave column, when present, holds one value, the same in the linked files.
// Files are linked only by the wave label the researcher set (Import data), never by row position or upload order.
// A wave with two files of one grain is ambiguous and that grain is not used.
import { loadDocumentFile, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { parseTableDocument } from "./parseTable";
import { isPlainTableFileName } from "./dataSetupShared";
import type { TableCell } from "./rowCells";
import { codeNamesDiffer } from "./trackerFigures";
import { loadRoleInput } from "./trackerInput";
import type { RoleVariable } from "./trackerRoles";
import { loadProjectWaves } from "./waveFiles";
import { csmGrainOf, type CsmGrain, type CsmSampleType } from "./csmExtensionRoles";

export type Row = Record<string, TableCell>;

export type KeyCheck = {
  ok: boolean;
  /** False when the file's rows cannot be read by the table reader (an SPSS, Stata or SAS file): its keys are
   * unknown, said so, and never taken as checked. */
  checked: boolean;
  records: number | null;
  /** Distinct customers (Relationship, Channel) or distinct noncustomers. */
  distinctPeople: number | null;
  problems: string[];
};

const MAX_LISTED = 3;
const listed = (xs: string[]) => `${xs.slice(0, MAX_LISTED).join(", ")}${xs.length > MAX_LISTED ? ` and ${xs.length - MAX_LISTED} more` : ""}`;

/** The text form of an ID cell; null when it is absent or was read as a number (leading zeroes would be lost). */
function textId(v: TableCell): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Keys of one file by its grain. Pure. */
export function checkKeys(rows: Row[], grain: CsmGrain): KeyCheck & { ids: Set<string> } {
  const problems: string[] = [];
  const ids = new Set<string>();
  const notText: string[] = [];
  const dupes: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = textId(r.respondent_id);
    if (id === null) {
      notText.push(`row ${i + 1}`);
      continue;
    }
    if (grain !== "channel" && ids.has(id)) dupes.push(id);
    ids.add(id);
  }
  if (notText.length) problems.push(`respondent_id is missing or not text in ${notText.length} record${notText.length === 1 ? "" : "s"} (${listed(notText)}); IDs must be kept as text so leading zeroes survive.`);
  if (dupes.length) problems.push(`respondent_id repeats in ${dupes.length} record${dupes.length === 1 ? "" : "s"} (${listed(dupes)}); one record per person is required in this file.`);
  if (grain === "channel") {
    const pairs = new Set<string>();
    const pairDupes: string[] = [];
    const experiences = new Set<string>();
    const expDupes: string[] = [];
    for (const r of rows) {
      const id = textId(r.respondent_id);
      if (id === null) continue;
      const pair = `${id}|${String(r.channel)}`;
      if (pairs.has(pair)) pairDupes.push(`${id} in channel ${String(r.channel)}`);
      pairs.add(pair);
      const e = textId(r.experience_id);
      if (e === null) expDupes.push(`${id} (no experience_id)`);
      else if (experiences.has(e)) expDupes.push(e);
      else experiences.add(e);
    }
    if (pairDupes.length) problems.push(`More than one latest record for a customer in one channel: ${listed(pairDupes)}.`);
    if (expDupes.length) problems.push(`experience_id is missing or repeated: ${listed(expDupes)}.`);
  }
  return { ok: problems.length === 0, checked: true, records: rows.length, distinctPeople: ids.size, problems, ids };
}

/** Channel records against the same wave's customers: each record's customer exists, with the same weight. Pure. */
export function checkChannelLink(channelRows: Row[], relationshipRows: Row[]): string[] {
  const byId = new Map<string, Row>();
  for (const r of relationshipRows) {
    const id = textId(r.respondent_id);
    if (id !== null) byId.set(id, r);
  }
  const orphans: string[] = [];
  const weightDiffers: string[] = [];
  for (const e of channelRows) {
    const id = textId(e.respondent_id);
    if (id === null) continue;
    const c = byId.get(id);
    if (!c) orphans.push(id);
    else if (typeof e.weight === "number" && typeof c.weight === "number" && Math.abs(e.weight - c.weight) > 1e-9) weightDiffers.push(id);
  }
  const problems: string[] = [];
  if (orphans.length) problems.push(`${orphans.length} channel record${orphans.length === 1 ? " belongs" : "s belong"} to no customer in this wave's Relationship file (${listed(orphans)}).`);
  if (weightDiffers.length) problems.push(`${weightDiffers.length} channel record${weightDiffers.length === 1 ? " has" : "s have"} a weight different from the customer's (${listed(weightDiffers)}).`);
  return problems;
}

/** The wave column's values, when the file has one. Pure. */
export function waveValues(rows: Row[]): string[] {
  if (rows.length === 0 || !Object.hasOwn(rows[0], "wave")) return [];
  return [...new Set(rows.map((r) => String(r.wave ?? "")))].sort();
}

export type CsmFile = {
  documentId: string;
  filename: string;
  grain: CsmGrain;
  sampleType: CsmSampleType;
  grainEvidence: string;
  /** The data sheet the reader used; null for a file without sheets or whose rows were not read. */
  sheetName: string | null;
  /** Whether the rows were read (CSV, TSV and Excel files); paths, verbatims and the links need them. */
  rowsRead: boolean;
  variables: RoleVariable[];
  weightVar: string | null;
  rows: Row[];
  keys: KeyCheck;
};

export type CsmWaveFiles = {
  /** The open file's wave label, null when it has none (the open file is then read alone). */
  wave: string | null;
  open: { documentId: string; grain: CsmGrain | null; reason?: string };
  relationship: CsmFile | null;
  channel: CsmFile | null;
  noncustomer: CsmFile | null;
  /** Why a grain has no file: none labelled this wave, two of them, or a failed read. */
  absent: Partial<Record<CsmGrain, string>>;
  /** Problems linking the files (wave values, company lists, channel records to customers). */
  linkProblems: string[];
  /** Other files with this wave label that are not a CSM grain or could not be read, each with why. */
  notUsed: string[];
};

async function readFile(tenantId: string, runId: string, documentId: string, filename: string): Promise<{ file: CsmFile } | { grain: null; reason: string }> {
  const [input, doc, setup] = await Promise.all([loadRoleInput(tenantId, runId, documentId), loadDocumentFile(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  if (!setup.ok) throw new Error(`The set-up of ${filename} could not be read: ${setup.error}`);
  // The table reader reads CSV, TSV and Excel only. Another format (an earlier SPSS fixture) keeps its figures from
  // the engine's tables, with its keys said to be unchecked; it cannot be linked to other files.
  const table = isPlainTableFileName(doc.source_filename)
    ? await parseTableDocument(doc.storage_path, doc.source_filename, { selectedSheet: doc.selected_sheet, layout: setup.setup.layout, headerRowsSkipped: setup.setup.headerRowsSkipped })
    : null;
  const g = csmGrainOf(input.variables.map((v) => v.name), table?.sheetName ?? null);
  if (g.grain === null) return { grain: null, reason: g.reason };
  const keys: KeyCheck = table
    ? (({ ids: _ids, ...k }) => (void _ids, k))(checkKeys(table.rows, g.grain))
    : { ok: true, checked: false, records: null, distinctPeople: null, problems: [] };
  return {
    file: {
      documentId,
      filename,
      grain: g.grain,
      sampleType: g.sampleType,
      grainEvidence: g.evidence,
      sheetName: table?.sheetName ?? null,
      rowsRead: table !== null,
      variables: input.variables,
      weightVar: input.weightVar,
      rows: table?.rows ?? [],
      keys,
    },
  };
}

const answersOf = (f: CsmFile, name: string) => Object.entries(f.variables.find((v) => v.name === name)?.valueLabels ?? {}).map(([code, label]) => ({ code, label }));

/** Company lists of two linked files: every code both have names the same company. Pure apart from the files. */
export function companyListProblems(a: { code: string; label: string }[], b: { code: string; label: string }[], aName: string, bName: string): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const common = a.filter((x) => b.some((y) => y.code === x.code));
  if (common.length === 0) return [`${aName} and ${bName} share no company code, so they are not the same sector.`];
  const differs = common.map((x) => codeNamesDiffer(x.code, a, b, "Company", "company list")).filter((x): x is string => x !== null);
  return differs.length ? [`${aName} and ${bName} name companies differently, so they are not linked: ${differs.slice(0, MAX_LISTED).join(" ")}`] : [];
}

/**
 * The open file and the other CSM files carrying the same wave label in this project, read and checked. A file
 * that is not a CSM grain (no respondent_id, or a sheet that contradicts its fields) is reported, not used.
 */
export async function loadCsmWaveFiles(tenantId: string, runId: string, documentId: string): Promise<CsmWaveFiles> {
  const waves = await loadProjectWaves(tenantId, runId);
  const all = [...waves.included, ...waves.excluded];
  const open = all.find((w) => w.documentId === documentId);
  const label = open?.wave.trim().toLowerCase() ?? null;
  const sameWave = label === null ? [] : all.filter((w) => w.wave.trim().toLowerCase() === label);
  const candidates = sameWave.length ? sameWave : [{ documentId, filename: "this file" }];
  // The open file's read failing fails the page; another file's failed read is stated against that file and its
  // grain is not used (never read as absent data).
  // One file after another: the engine keeps the last two files read, so reading the wave's files in turn reads
  // each once, where interleaved reads of three files would read every file again for each request.
  const read: { c: { documentId: string; filename: string }; r: Awaited<ReturnType<typeof readFile>> }[] = [];
  for (const c of candidates) {
    try {
      read.push({ c, r: await readFile(tenantId, runId, c.documentId, c.filename) });
    } catch (e) {
      if (c.documentId === documentId) throw e;
      read.push({ c, r: { grain: null, reason: `${c.filename} could not be read: ${e instanceof Error ? e.message : String(e)}` } });
    }
  }
  const out: CsmWaveFiles = { wave: open?.wave ?? null, open: { documentId, grain: null }, relationship: null, channel: null, noncustomer: null, absent: {}, linkProblems: [], notUsed: [] };
  const byGrain: Record<CsmGrain, CsmFile[]> = { relationship: [], channel: [], noncustomer: [] };
  const unreadable: string[] = [];
  for (const { c, r } of read) {
    if ("file" in r) byGrain[r.file.grain].push(r.file);
    else if (c.documentId !== documentId) unreadable.push(r.reason.startsWith(c.filename) ? r.reason : `${c.filename}: ${r.reason}`);
    if (c.documentId === documentId) {
      if ("file" in r) out.open.grain = r.file.grain;
      else out.open.reason = r.reason;
    }
  }
  for (const g of ["relationship", "channel", "noncustomer"] as const) {
    const fs = byGrain[g];
    if (fs.length === 1) out[g] = fs[0];
    else if (fs.length > 1) out.absent[g] = `Two or more ${g} files are labelled ${open?.wave ?? "this wave"} (${fs.map((f) => f.filename).join(", ")}), so none is used. Label each wave's files once.`;
    else out.absent[g] = label === null ? `This file has no wave label, so no ${g} file is linked to it. Label the wave's files under Import data.` : `No ${g} file is labelled ${open?.wave} in this project.`;
  }
  out.notUsed = unreadable;
  // The wave the data say, and the sector the company lists say.
  const present = [out.relationship, out.channel, out.noncustomer].filter((f): f is CsmFile => f !== null);
  const valuesByFile = present.map((f) => ({ f, v: waveValues(f.rows) })).filter((x) => x.v.length > 0);
  for (const { f, v } of valuesByFile) if (v.length > 1) out.linkProblems.push(`${f.filename} holds more than one wave value in its wave column (${v.join(", ")}).`);
  const distinct = new Set(valuesByFile.filter((x) => x.v.length === 1).map((x) => x.v[0]));
  if (distinct.size > 1) out.linkProblems.push(`The files labelled ${open?.wave} hold different wave values in their wave columns (${valuesByFile.map((x) => `${x.f.filename}: ${x.v.join(", ")}`).join("; ")}).`);
  if (out.relationship) {
    for (const other of [out.channel, out.noncustomer]) {
      if (other && (!other.rowsRead || !out.relationship.rowsRead)) out.linkProblems.push(`${other.filename} cannot be linked to ${out.relationship.filename}: the rows of ${!other.rowsRead ? other.filename : out.relationship.filename} are not read (only CSV, TSV and Excel files are), so its keys are unchecked.`);
    }
    for (const other of [out.channel, out.noncustomer]) {
      if (other) out.linkProblems.push(...companyListProblems(answersOf(out.relationship, "company"), answersOf(other, "company"), out.relationship.filename, other.filename));
    }
    if (out.channel) out.linkProblems.push(...checkChannelLink(out.channel.rows, out.relationship.rows));
    if (out.noncustomer) {
      const customers = new Set(out.relationship.rows.map((r) => textId(r.respondent_id)).filter((x): x is string => x !== null));
      const shared = out.noncustomer.rows.map((r) => textId(r.respondent_id)).filter((x): x is string => x !== null && customers.has(x));
      if (shared.length) out.linkProblems.push(`${shared.length} noncustomer ID${shared.length === 1 ? " is" : "s are"} also a customer ID (${listed(shared)}); the samples must stay separate.`);
    }
  }
  return out;
}

/**
 * The project's waves restricted to files of the open file's grain (R6 CSM extension): the existing dashboards'
 * previous wave and trend compare a Relationship file only with Relationship files, never with the same wave's
 * Channel or Noncustomer file (which would read a different population as "the previous wave"). The grain here is
 * structural (csmGrainOf on the variable names; a file with no respondent_id has no CSM grain and matches only
 * others without one), so a brand tracker's waves are all kept, as before. A wave whose variables cannot be read
 * is kept, so its own read fails visibly where it is used, as before.
 */
export async function wavesOfSameGrain<W extends { documentId: string }>(tenantId: string, runId: string, documentId: string, waves: W[]): Promise<W[]> {
  const grainOf = async (id: string): Promise<CsmGrain | null | "unread"> => {
    const d = await loadVariableDictionaryWithStatus(tenantId, runId, id);
    if (!d.ok) return "unread";
    const g = csmGrainOf(d.dictionary.variables.map((v) => v.name), null);
    return g.grain;
  };
  const own = await grainOf(documentId);
  if (own === "unread") return waves;
  const grains = await Promise.all(waves.map((w) => (w.documentId === documentId ? Promise.resolve(own) : grainOf(w.documentId))));
  return waves.filter((_, i) => grains[i] === own || grains[i] === "unread");
}

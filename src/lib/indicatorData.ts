// Indicator data (batch 54; Grant, 28 October 2026): published statistics such as World Bank Data360,
// WDI or Findex downloads, read by the engine's "indicators" action (api/parse-stats-file.py,
// indicator_observations) and stored as series and observations (migration 0126). Contract:
// claude/indicator-data.md.
//
// Reading a file:
//   - the engine answers with tidy observations, which are checked here before anything is written
//     (validateIndicatorResult): the engine is a boundary, and a malformed answer is refused, never
//     partly stored;
//   - publishing is one transaction that locks the document row (ownership checked on the write: the
//     file must be this project's Indicator data), writes the new read's series and observations under
//     a new read id, points indicator_reads at it and only then deletes the previous read's rows. A
//     failure anywhere rolls the whole write back, so the previous published version stays;
//   - a failed read (engine or write) is recorded on indicator_reads beside the previous version, and the
//     document's processing status says failed only when there is no usable version;
//   - a retry or a concurrent second read replaces the published version (the row lock serialises
//     them); rows are never added twice (unique series per read, unique observation per series, area
//     and period).
// Before migration 0126 nothing here writes: indicatorDataAvailable is false and callers say so.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant, withTenantRead, withTenantRepeatableRead } from "./db";
import { markDocumentProcessingStatus } from "./documentUpload";
import { runEngineConversion } from "./parseStatsFile";

export const INDICATOR_NOT_AVAILABLE_MESSAGE =
  "Indicator data is not available yet: it needs the database update 0126_indicator_observations.sql.";

import { INDICATOR_LAYOUTS, INDICATOR_LAYOUT_LABEL, MAX_INDICATOR_AREAS, type IndicatorLayout } from "./indicatorLayouts";
export { INDICATOR_LAYOUTS, INDICATOR_LAYOUT_LABEL, MAX_INDICATOR_AREAS, type IndicatorLayout };

export type IndicatorBreakdown = { dimension: string; code: string; label: string | null };
export type IndicatorGroup = { column: string; value: string };
export type EngineIndicatorSeries = {
  key: string;
  indicatorCode: string | null;
  indicatorLabel: string | null;
  breakdowns: IndicatorBreakdown[];
  unitCode: string | null;
  unitLabel: string | null;
  unitMult: number | null;
  valueScale: "proportion" | "percent" | null;
  baseDescription: string | null;
  groups: IndicatorGroup[] | null;
};
export type IndicatorArea = { code: string | null; label: string | null };
/** [series index, area index, period (null: not stated), value as written, status code, note]. */
export type EngineObservation = [number, number, string | null, string, string | null, string | null];
/** One English note of OECD reference information: the dimension codes it names (any other value matches). */
export type EngineNote = { key: Record<string, string>; keyLabels: Record<string, string>; period: string | null; field: string; fieldLabel: string | null; text: string; line: number };
export type EngineIndicatorResult = {
  reader: string;
  layout: IndicatorLayout;
  provenance: Record<string, unknown>;
  series: EngineIndicatorSeries[];
  areas: IndicatorArea[];
  observations: EngineObservation[];
  /** Only for oecd_notes, which has no series or observations. */
  notes?: EngineNote[];
};

/**
 * The engine's rule for a number written as text (_STRICT_NUMBER in api/parse-stats-file.py). A mirror,
 * kept equal by indicatorData.test.ts, which reads the engine source: a value the engine let through is
 * checked again here before it is cast to numeric in the database.
 */
export const STRICT_NUMBER = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

const isText = (v: unknown): v is string => typeof v === "string";
const textOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** The engine's answer, checked; throws naming what is wrong. Nothing is stored from a refused answer. */
export function validateIndicatorResult(raw: unknown): EngineIndicatorResult {
  const fail = (what: string): never => {
    throw new Error(`The indicator reader gave an answer that cannot be stored (${what}), so nothing was changed.`);
  };
  if (!raw || typeof raw !== "object") return fail("no result");
  const r = raw as Record<string, unknown>;
  if (!isText(r.reader)) fail("no reader");
  if (!(INDICATOR_LAYOUTS as readonly string[]).includes(r.layout as string)) fail(`unknown layout ${String(r.layout)}`);
  if (!r.provenance || typeof r.provenance !== "object") fail("no provenance");
  if (!Array.isArray(r.series) || !Array.isArray(r.areas) || !Array.isArray(r.observations)) fail("missing series, areas or observations");
  const series = r.series as unknown[];
  const keys = new Set<string>();
  for (const s of series) {
    const x = s as Record<string, unknown>;
    if (!x || !isText(x.key) || keys.has(x.key)) fail("a series without a unique key");
    keys.add(x.key as string);
    if (!textOrNull(x.indicatorCode) || !textOrNull(x.indicatorLabel) || (x.indicatorCode === null && x.indicatorLabel === null)) fail("a series without an indicator");
    if (!Array.isArray(x.breakdowns) || !(x.breakdowns as unknown[]).every((b) => isText((b as IndicatorBreakdown)?.dimension) && isText((b as IndicatorBreakdown).code) && textOrNull((b as IndicatorBreakdown).label))) fail("a malformed breakdown");
    if (!textOrNull(x.unitCode) || !textOrNull(x.unitLabel) || !textOrNull(x.baseDescription)) fail("a malformed unit");
    if (!(x.unitMult === null || Number.isInteger(x.unitMult))) fail("a unit multiplier that is not a whole number");
    if (!(x.valueScale === null || x.valueScale === "proportion" || x.valueScale === "percent")) fail("an unknown value scale");
    if (!(x.groups === null || (Array.isArray(x.groups) && (x.groups as unknown[]).every((g) => isText((g as IndicatorGroup)?.column) && isText((g as IndicatorGroup).value))))) fail("malformed groups");
  }
  const areas = r.areas as unknown[];
  const areaCodes = new Set<string | null>();
  for (const a of areas) {
    const x = a as Record<string, unknown>;
    if (!x || !textOrNull(x.code) || !textOrNull(x.label) || areaCodes.has(x.code as string | null)) fail("a malformed or repeated area");
    areaCodes.add(x.code as string | null);
  }
  const isTextMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every(isText);
  if (r.layout === "oecd_notes") {
    if (series.length > 0 || areas.length > 0 || (r.observations as unknown[]).length > 0) fail("notes with observations");
    if (!isText((r.provenance as Record<string, unknown>).dataflow)) fail("notes without a dataflow");
    if (!Array.isArray(r.notes) || r.notes.length === 0) fail("no notes");
    const lines = new Set<string>();
    for (const n of r.notes as unknown[]) {
      const x = n as Record<string, unknown>;
      if (!x || !isTextMap(x.key) || !isTextMap(x.keyLabels) || !textOrNull(x.period) || !isText(x.field) || !textOrNull(x.fieldLabel) || !isText(x.text) || !Number.isInteger(x.line)) fail("a malformed note");
      const k = `${x.line}|${x.field}`;
      if (lines.has(k)) fail("a repeated note");
      lines.add(k);
    }
  } else if (r.notes !== undefined && !(Array.isArray(r.notes) && r.notes.length === 0)) {
    fail("notes in a data file");
  }
  const seen = new Set<string>();
  for (const o of r.observations as unknown[]) {
    if (!Array.isArray(o) || o.length !== 6) fail("a malformed observation");
    const [si, ai, period, value, status, note] = o as unknown[];
    if (!Number.isInteger(si) || (si as number) < 0 || (si as number) >= series.length) fail("an observation of an unknown series");
    if (!Number.isInteger(ai) || (ai as number) < 0 || (ai as number) >= areas.length) fail("an observation of an unknown area");
    if (!textOrNull(period) || !textOrNull(status) || !textOrNull(note)) fail("a malformed observation");
    if (!isText(value) || !STRICT_NUMBER.test(value)) fail(`a value that is not a plain number (${String(value)})`);
    const k = JSON.stringify([si, ai, period]);
    if (seen.has(k)) fail("two values for one observation");
    seen.add(k);
  }
  return raw as EngineIndicatorResult;
}

let tablesPresent = false;
/** Migration 0126. Remembered once true; asked again while false, so applying it needs no restart. */
export async function indicatorDataAvailable(client: PoolClient): Promise<boolean> {
  if (tablesPresent) return true;
  const r = await client.query<{ ok: boolean }>("select to_regclass('public.indicator_reads') is not null and to_regclass('public.indicator_observations') is not null as ok");
  tablesPresent = r.rows[0]?.ok === true;
  return tablesPresent;
}

export class IndicatorDocumentNotFoundError extends Error {
  constructor() {
    super("That file is not Indicator data in this project. It may have been removed; reload the page.");
    this.name = "IndicatorDocumentNotFoundError";
  }
}

/** Locks the document row: the file must be this tenant's, this project's, and Indicator data. */
async function lockIndicatorDocument(client: PoolClient, tenantId: string, runId: string, documentId: string): Promise<void> {
  const doc = await client.query("select id from documents where id = $1 and run_id = $2 and tenant_id = $3 and kind = 'indicator' for update", [documentId, runId, tenantId]);
  if (doc.rowCount !== 1) throw new IndicatorDocumentNotFoundError();
}

const OBSERVATION_BATCH = 20_000;

export type PublishedIndicatorRead = { readId: string; series: number; observations: number; areas: number; notes: number };

/**
 * Publishes a validated read as the file's current version, in one transaction (see the file header).
 * Throws IndicatorDocumentNotFoundError when the file is not this project's Indicator data; nothing is
 * written then.
 */
export async function publishIndicatorRead(tenantId: string, runId: string, documentId: string, result: EngineIndicatorResult): Promise<PublishedIndicatorRead> {
  return withTenant(tenantId, async (client) => {
    if (!(await indicatorDataAvailable(client))) throw new Error(INDICATOR_NOT_AVAILABLE_MESSAGE);
    await lockIndicatorDocument(client, tenantId, runId, documentId);
    const readId = randomUUID();
    const counts = new Array<number>(result.series.length).fill(0);
    for (const o of result.observations) counts[o[0]]++;
    const s = result.series;
    const inserted = await client.query<{ id: string; series_key: string }>(
      `insert into indicator_series (tenant_id, document_id, read_id, series_key, indicator_code, indicator_label, breakdowns,
                                     unit_code, unit_label, unit_mult, value_scale, base_description, groups, observation_count)
       select $1, $2, $3, x.key, x.code, x.label, x.breakdowns::jsonb, x.unit_code, x.unit_label, x.unit_mult, x.scale, x.base, x.groups::jsonb, x.n
       from unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[], $11::text[], $12::text[], $13::text[], $14::int[])
         as x(key, code, label, breakdowns, unit_code, unit_label, unit_mult, scale, base, groups, n)
       returning id, series_key`,
      [
        tenantId,
        documentId,
        readId,
        s.map((x) => x.key),
        s.map((x) => x.indicatorCode),
        s.map((x) => x.indicatorLabel),
        s.map((x) => JSON.stringify(x.breakdowns)),
        s.map((x) => x.unitCode),
        s.map((x) => x.unitLabel),
        s.map((x) => x.unitMult),
        s.map((x) => x.valueScale),
        s.map((x) => x.baseDescription),
        s.map((x) => (x.groups ? JSON.stringify(x.groups) : null)),
        counts,
      ],
    );
    const idByKey = new Map(inserted.rows.map((row) => [row.series_key, row.id]));
    const seriesIds = s.map((x) => idByKey.get(x.key)!);
    for (let start = 0; start < result.observations.length; start += OBSERVATION_BATCH) {
      const batch = result.observations.slice(start, start + OBSERVATION_BATCH);
      await client.query(
        `insert into indicator_observations (tenant_id, document_id, series_id, area_code, period, value_text, value, status, note)
         select $1, $2, x.series_id, x.area_code, x.period, x.value_text, x.value_text::numeric, x.status, x.note
         from unnest($3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) as x(series_id, area_code, period, value_text, status, note)`,
        [
          tenantId,
          documentId,
          batch.map((o) => seriesIds[o[0]]),
          batch.map((o) => result.areas[o[1]].code),
          batch.map((o) => o[2]),
          batch.map((o) => o[3]),
          batch.map((o) => o[4]),
          batch.map((o) => o[5]),
        ],
      );
    }
    const notes = result.notes ?? [];
    if (notes.length > 0) {
      await client.query(
        `insert into indicator_notes (tenant_id, document_id, read_id, dataflow, note_key, key_labels, period, field, field_label, note_text, line)
         select $1, $2, $3, $4, x.k::jsonb, x.l::jsonb, x.period, x.field, x.label, x.txt, x.line
         from unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::int[]) as x(k, l, period, field, label, txt, line)`,
        [
          tenantId,
          documentId,
          readId,
          String(result.provenance.dataflow),
          notes.map((n) => JSON.stringify(n.key)),
          notes.map((n) => JSON.stringify(n.keyLabels)),
          notes.map((n) => n.period),
          notes.map((n) => n.field),
          notes.map((n) => n.fieldLabel),
          notes.map((n) => n.text),
          notes.map((n) => n.line),
        ],
      );
    }
    // Published: the read row now names the new version, and the failure of an earlier attempt, if any,
    // is cleared because this read replaced what it failed to replace.
    await client.query(
      `insert into indicator_reads (document_id, tenant_id, read_id, reader, layout, provenance, areas, series_count, observation_count, published_at, failure, failed_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now(), null, null)
       on conflict (document_id) do update set read_id = excluded.read_id, reader = excluded.reader, layout = excluded.layout,
         provenance = excluded.provenance, areas = excluded.areas, series_count = excluded.series_count,
         observation_count = excluded.observation_count, published_at = excluded.published_at, failure = null, failed_at = null`,
      [documentId, tenantId, readId, result.reader, result.layout, JSON.stringify(result.provenance), JSON.stringify(result.areas), s.length, result.observations.length],
    );
    await client.query("delete from indicator_series where document_id = $1 and read_id <> $2", [documentId, readId]);
    await client.query("delete from indicator_notes where document_id = $1 and read_id <> $2", [documentId, readId]);
    return { readId, series: s.length, observations: result.observations.length, areas: result.areas.length, notes: notes.length };
  });
}

/**
 * Records a failed read beside the published version (if any). Returns whether a usable version
 * remains. Throws IndicatorDocumentNotFoundError when the file is not this project's Indicator data.
 */
export async function recordIndicatorReadFailure(tenantId: string, runId: string, documentId: string, failure: string): Promise<{ previousVersionKept: boolean }> {
  return withTenant(tenantId, async (client) => {
    if (!(await indicatorDataAvailable(client))) throw new Error(INDICATOR_NOT_AVAILABLE_MESSAGE);
    await lockIndicatorDocument(client, tenantId, runId, documentId);
    const r = await client.query<{ read_id: string | null }>(
      `insert into indicator_reads (document_id, tenant_id, failure, failed_at) values ($1, $2, $3, now())
       on conflict (document_id) do update set failure = excluded.failure, failed_at = excluded.failed_at
       returning read_id`,
      [documentId, tenantId, failure],
    );
    return { previousVersionKept: r.rows[0]?.read_id != null };
  });
}

export type IndicatorReadOutcome =
  | ({ ok: true } & PublishedIndicatorRead)
  | { ok: false; error: string; unavailable?: boolean; previousVersionKept: boolean };

/**
 * Reads an Indicator data file with the engine and publishes the result. A failure (the file refused,
 * the engine unreachable, the write failing) is recorded and returned, never thrown, with whether the
 * previous version is still the one shown. The document's processing status says ready after a
 * published read, failed when no usable version exists.
 */
export async function readIndicatorDocument(tenantId: string, runId: string, documentId: string): Promise<IndicatorReadOutcome> {
  const doc = await withTenantRead(tenantId, async (client) => {
    if (!(await indicatorDataAvailable(client))) return "unavailable" as const;
    const r = await client.query<{ storage_path: string; source_filename: string }>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3 and kind = 'indicator'",
      [documentId, runId, tenantId],
    );
    return r.rows[0] ?? null;
  });
  if (doc === "unavailable") return { ok: false, error: INDICATOR_NOT_AVAILABLE_MESSAGE, unavailable: true, previousVersionKept: false };
  if (!doc) return { ok: false, error: new IndicatorDocumentNotFoundError().message, previousVersionKept: false };
  try {
    const raw = await runEngineConversion<unknown>("indicators", doc.storage_path, doc.source_filename, {});
    const published = await publishIndicatorRead(tenantId, runId, documentId, validateIndicatorResult(raw));
    await markDocumentProcessingStatus(tenantId, documentId, "ready");
    return { ok: true, ...published };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof IndicatorDocumentNotFoundError) return { ok: false, error: message, previousVersionKept: false };
    try {
      const { previousVersionKept } = await recordIndicatorReadFailure(tenantId, runId, documentId, message);
      if (!previousVersionKept) await markDocumentProcessingStatus(tenantId, documentId, "failed");
      return { ok: false, error: message, previousVersionKept };
    } catch (recordError) {
      // The failure itself could not be recorded (the file removed meanwhile, say): both are said, and
      // whether an earlier version is still shown is not known here.
      const why = recordError instanceof Error ? recordError.message : String(recordError);
      return { ok: false, error: `${message} The failure could not be recorded either: ${why}`, previousVersionKept: false };
    }
  }
}

export type IndicatorSeriesSummary = {
  id: string;
  key: string;
  indicatorCode: string | null;
  indicatorLabel: string | null;
  breakdowns: IndicatorBreakdown[];
  unitCode: string | null;
  unitLabel: string | null;
  unitMult: number | null;
  valueScale: "proportion" | "percent" | null;
  baseDescription: string | null;
  groups: IndicatorGroup[] | null;
  observationCount: number;
  /** Areas with at least one value in this series (null: an area the file does not state). */
  areaCodes: (string | null)[];
};

export type IndicatorCatalogue =
  | { state: "unavailable"; message: string }
  | { state: "not_read" }
  | { state: "failed"; failure: string; failedAt: string }
  | {
      state: "ready";
      readId: string;
      fileName: string;
      layout: IndicatorLayout;
      reader: string;
      provenance: Record<string, unknown>;
      publishedAt: string;
      areas: IndicatorArea[];
      series: IndicatorSeriesSummary[];
      observationCount: number;
      /** A later attempt that failed; the version shown is the earlier published one. */
      lastFailure: { failure: string; failedAt: string } | null;
      /** Notes of the same dataflow from notes files in this project (data files; empty otherwise). */
      notes: IndicatorNote[];
      /** For a notes file: its dataflow, its note count and the data files of that dataflow in the project. */
      notesFile: { dataflow: string; count: number; matchingFiles: string[] } | null;
    };

export type IndicatorNote = { fileName: string; key: Record<string, string>; keyLabels: Record<string, string>; period: string | null; field: string; fieldLabel: string | null; text: string };

/**
 * What a file's published read holds, for choosing a series and areas: one consistent snapshot of the
 * read row and its series. Throws IndicatorDocumentNotFoundError when the file is not this project's.
 */
export async function loadIndicatorCatalogue(tenantId: string, runId: string, documentId: string): Promise<IndicatorCatalogue> {
  return withTenantRepeatableRead(tenantId, async (client) => {
    if (!(await indicatorDataAvailable(client))) return { state: "unavailable", message: INDICATOR_NOT_AVAILABLE_MESSAGE };
    const doc = await client.query<{ source_filename: string }>("select source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3 and kind = 'indicator'", [documentId, runId, tenantId]);
    if (!doc.rows[0]) throw new IndicatorDocumentNotFoundError();
    const read = (
      await client.query<{ read_id: string | null; reader: string | null; layout: IndicatorLayout | null; provenance: Record<string, unknown>; areas: IndicatorArea[]; observation_count: number; published_at: Date | null; failure: string | null; failed_at: Date | null }>(
        "select read_id, reader, layout, provenance, areas, observation_count, published_at, failure, failed_at from indicator_reads where document_id = $1",
        [documentId],
      )
    ).rows[0];
    if (!read) return { state: "not_read" };
    if (!read.read_id) return { state: "failed", failure: read.failure ?? "The file could not be read.", failedAt: (read.failed_at ?? new Date(0)).toISOString() };
    const series = await client.query<{
      id: string; series_key: string; indicator_code: string | null; indicator_label: string | null; breakdowns: IndicatorBreakdown[]; unit_code: string | null; unit_label: string | null;
      unit_mult: number | null; value_scale: "proportion" | "percent" | null; base_description: string | null; groups: IndicatorGroup[] | null; observation_count: number; area_codes: (string | null)[];
    }>(
      `select s.id, s.series_key, s.indicator_code, s.indicator_label, s.breakdowns, s.unit_code, s.unit_label, s.unit_mult, s.value_scale,
              s.base_description, s.groups, s.observation_count,
              coalesce((select array_agg(distinct o.area_code) from indicator_observations o where o.series_id = s.id), '{}') as area_codes
       from indicator_series s where s.document_id = $1 and s.read_id = $2
       order by s.indicator_code nulls last, s.indicator_label, s.series_key`,
      [documentId, read.read_id],
    );
    // Notes are matched by dataflow (STRUCTURE_ID) among this project's current Indicator data files: a
    // removed file is in the bin's run and is not matched; only each file's published read counts.
    const dataflow = typeof read.provenance.dataflow === "string" ? read.provenance.dataflow : null;
    let notes: IndicatorNote[] = [];
    let notesFile: { dataflow: string; count: number; matchingFiles: string[] } | null = null;
    if (dataflow && read.layout === "oecd_notes") {
      const count = (await client.query<{ n: number }>("select count(*)::int as n from indicator_notes where document_id = $1 and read_id = $2", [documentId, read.read_id])).rows[0].n;
      const matching = await client.query<{ source_filename: string }>(
        `select d.source_filename from documents d join indicator_reads r on r.document_id = d.id
         where d.run_id = $1 and d.tenant_id = $2 and d.kind = 'indicator' and d.id <> $3 and r.read_id is not null
           and r.layout <> 'oecd_notes' and r.provenance->>'dataflow' = $4
         order by d.source_filename`,
        [runId, tenantId, documentId, dataflow],
      );
      notesFile = { dataflow, count, matchingFiles: matching.rows.map((x) => x.source_filename) };
    } else if (dataflow) {
      const found = await client.query<{ source_filename: string; note_key: Record<string, string>; key_labels: Record<string, string>; period: string | null; field: string; field_label: string | null; note_text: string }>(
        `select d.source_filename, n.note_key, n.key_labels, n.period, n.field, n.field_label, n.note_text
         from indicator_notes n
         join indicator_reads r on r.document_id = n.document_id and r.read_id = n.read_id
         join documents d on d.id = n.document_id
         where d.run_id = $1 and d.tenant_id = $2 and d.kind = 'indicator' and n.dataflow = $3
         order by d.source_filename, n.line, n.field`,
        [runId, tenantId, dataflow],
      );
      notes = found.rows.map((x) => ({ fileName: x.source_filename, key: x.note_key, keyLabels: x.key_labels, period: x.period, field: x.field, fieldLabel: x.field_label, text: x.note_text }));
    }
    return {
      state: "ready",
      readId: read.read_id,
      fileName: doc.rows[0].source_filename,
      layout: read.layout as IndicatorLayout,
      reader: read.reader ?? "",
      provenance: read.provenance,
      publishedAt: read.published_at!.toISOString(),
      areas: read.areas,
      observationCount: read.observation_count,
      series: series.rows.map((x) => ({
        id: x.id,
        key: x.series_key,
        indicatorCode: x.indicator_code,
        indicatorLabel: x.indicator_label,
        breakdowns: x.breakdowns,
        unitCode: x.unit_code,
        unitLabel: x.unit_label,
        unitMult: x.unit_mult,
        valueScale: x.value_scale,
        baseDescription: x.base_description,
        groups: x.groups,
        observationCount: x.observation_count,
        areaCodes: x.area_codes,
      })),
      lastFailure: read.failure && read.failed_at ? { failure: read.failure, failedAt: read.failed_at.toISOString() } : null,
      notes,
      notesFile,
    };
  });
}

export type IndicatorObservation = { areaCode: string | null; period: string | null; valueText: string; status: string | null; note: string | null };
export type IndicatorObservationsResult =
  | { ok: true; readId: string; seriesId: string; observations: IndicatorObservation[] }
  | { ok: false; stale: true; error: string }
  | { ok: false; stale?: false; error: string };


/**
 * The observations of one series for the chosen areas, from the published read the caller was shown
 * (readId). A newer read since then answers stale, so the caller reloads the catalogue rather than mix
 * versions. Throws IndicatorDocumentNotFoundError when the file is not this project's.
 */
export async function loadIndicatorObservations(
  tenantId: string,
  runId: string,
  documentId: string,
  request: { readId: string; seriesId: string; areaCodes: (string | null)[] },
): Promise<IndicatorObservationsResult> {
  if (request.areaCodes.length === 0) return { ok: false, error: "Choose at least one area." };
  if (request.areaCodes.length > MAX_INDICATOR_AREAS) return { ok: false, error: `Choose at most ${MAX_INDICATOR_AREAS} areas at once.` };
  return withTenantRepeatableRead(tenantId, async (client) => {
    if (!(await indicatorDataAvailable(client))) return { ok: false, error: INDICATOR_NOT_AVAILABLE_MESSAGE };
    const doc = await client.query("select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3 and kind = 'indicator'", [documentId, runId, tenantId]);
    if (doc.rowCount !== 1) throw new IndicatorDocumentNotFoundError();
    const read = await client.query<{ read_id: string | null }>("select read_id from indicator_reads where document_id = $1", [documentId]);
    if (read.rows[0]?.read_id !== request.readId) {
      return { ok: false, stale: true, error: "This file was read again since the list was loaded. The list has been refreshed; choose again." };
    }
    const series = await client.query("select 1 from indicator_series where id = $1 and document_id = $2 and read_id = $3", [request.seriesId, documentId, request.readId]);
    if (series.rowCount !== 1) return { ok: false, error: "That series is not in this file." };
    const codes = request.areaCodes.filter((c): c is string => c !== null);
    const withUnstated = request.areaCodes.includes(null);
    const r = await client.query<{ area_code: string | null; period: string | null; value_text: string; status: string | null; note: string | null }>(
      `select area_code, period, value_text, status, note from indicator_observations
       where series_id = $1 and (area_code = any($2::text[]) or ($3 and area_code is null))
       order by area_code nulls first, period nulls first`,
      [request.seriesId, codes, withUnstated],
    );
    return {
      ok: true,
      readId: request.readId,
      seriesId: request.seriesId,
      observations: r.rows.map((x) => ({ areaCode: x.area_code, period: x.period, valueText: x.value_text, status: x.status, note: x.note })),
    };
  });
}

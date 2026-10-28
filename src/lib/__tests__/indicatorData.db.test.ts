// Indicator data (batch 54; contract claude/indicator-data.md) against a real disposable PostgreSQL built
// from every migration, with the actual uploadDocumentsAction, readIndicatorDocument (the local engine,
// api/parse-stats-file.py indicator_observations), publishIndicatorRead, loadIndicatorCatalogue,
// loadIndicatorObservations and the bin. Storage is an in-memory stand-in; the model is never called.
//   - upload as Indicator data: stored as kind 'indicator', read on upload, values as written;
//   - the long and wide DHS downloads give the same stored observations;
//   - ownership: another organisation, another project or another kind of file is refused on the write
//     and on the read, with nothing changed;
//   - a retry and two concurrent reads leave one version, never duplicated rows, and an answer for the
//     replaced version is refused as stale;
//   - a failed reread (the engine cannot read it, or the write fails part-way) keeps the previous
//     version, records the failure, and the next good read clears it;
//   - a file the reader refuses stays added, with its failure recorded and the status failed;
//   - remove to the bin hides it, restore brings the same version back, erase deletes its rows.
// Expected values are cells of the fixture files read with a plain CSV split, never the app's output.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../outputIngest", () => ({ ingestOutputFiles: vi.fn() }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (key: string, body: Uint8Array) => {
          storage.objects.set(key, new Uint8Array(body));
          return { error: null };
        },
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([storage.objects.get(key)!.slice()]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async (keys: string[]) => {
          for (const k of keys) storage.objects.delete(k);
          return { data: keys.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const FIX = path.join(process.cwd(), "fixtures", "indicator-data");
const fixture = (name: string) => readFileSync(path.join(FIX, name));

/** Cells of a quoted CSV fixture by header name (every cell is quoted and holds no comma inside quotes we need). */
function csvRows(name: string): Record<string, string>[] {
  const lines = fixture(name).toString("utf8").trim().split("\n");
  const split = (l: string) => (l.match(/"((?:[^"]|"")*)"/g) ?? []).map((c) => c.slice(1, -1).replace(/""/g, '"'));
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("indicator data: upload, read, persistence and the bin (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  let run = "";
  let otherRun = "";
  let foreignRun = "";
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const lib = () => import("../indicatorData");

  async function upload(name: string, bytes: Buffer, field = "indicatorFiles", runId = run) {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const fd = new FormData();
    fd.append(field, new File([new Uint8Array(bytes)], name, { type: "text/csv" }));
    return uploadDocumentsAction(runId, fd);
  }
  const docId = async (name: string, runId = run) => (await q<{ id: string }>("select id from documents where run_id = $1 and source_filename = $2", [runId, name]))[0]?.id;
  const counts = async (documentId: string) =>
    (await q<{ series: number; obs: number; reads: number }>(
      `select (select count(*)::int from indicator_series where document_id = $1) as series,
              (select count(*)::int from indicator_observations where document_id = $1) as obs,
              (select count(*)::int from indicator_reads where document_id = $1) as reads`,
      [documentId],
    ))[0];
  async function ready(documentId: string, runId = run) {
    const c = await (await lib()).loadIndicatorCatalogue(tenant, runId, documentId);
    if (c.state !== "ready") throw new Error(`catalogue is ${c.state}`);
    return c;
  }
  /** Stored observations as (series key, area, period) -> value as written, through the public reads. */
  async function storedValues(documentId: string) {
    const { loadIndicatorObservations } = await lib();
    const c = await ready(documentId);
    const out = new Map<string, string>();
    for (const s of c.series) {
      for (let i = 0; i < s.areaCodes.length; i += 12) {
        const r = await loadIndicatorObservations(tenant, run, documentId, { readId: c.readId, seriesId: s.id, areaCodes: s.areaCodes.slice(i, i + 12) });
        if (!r.ok) throw new Error(r.error);
        for (const o of r.observations) out.set(JSON.stringify([s.key, o.areaCode, o.period]), o.valueText);
      }
    }
    return out;
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    for (const t of [tenant, otherTenant]) await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [t]);
    run = (await q<{ id: string }>("insert into runs (tenant_id, project_name) values ($1, 'Indicators') returning id", [tenant]))[0].id;
    otherRun = (await q<{ id: string }>("insert into runs (tenant_id, project_name) values ($1, 'Other project') returning id", [tenant]))[0].id;
    foreignRun = (await q<{ id: string }>("insert into runs (tenant_id, project_name) values ($1, 'Other organisation') returning id", [otherTenant]))[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("stores a file added as Indicator data as kind indicator and reads its values as written", async () => {
    expect(await upload("DHS_SD.csv", fixture("DHS_SD.csv"))).toEqual({ ok: true, added: ["DHS_SD.csv"], alreadyPresent: [] });
    const id = await docId("DHS_SD.csv");
    expect((await q("select kind, processing_status, ingestion_type from documents where id = $1", [id]))[0]).toEqual({ kind: "indicator", processing_status: "ready", ingestion_type: null });
    const rows = csvRows("DHS_SD.csv");
    expect(await counts(id)).toEqual({ series: 3, obs: rows.length, reads: 1 });
    const c = await ready(id);
    expect(c.layout).toBe("sdmx_long");
    expect(c.areas.find((a) => a.code === "ZAF")).toEqual({ code: "ZAF", label: "South Africa" });
    const s03 = c.series.find((s) => s.breakdowns.some((b) => b.code === "ANCC_IRN_03"))!;
    expect(s03).toMatchObject({ indicatorCode: "RH_ANCC_W_IRN", unitCode: "PT_W_SUB", unitLabel: "Percentage of women in the same subgroup", unitMult: 0, valueScale: null });
    const { loadIndicatorObservations } = await lib();
    const r = await loadIndicatorObservations(tenant, run, id, { readId: c.readId, seriesId: s03.id, areaCodes: ["ZAF", "COG"] });
    if (!r.ok) throw new Error(r.error);
    // Hand-picked cell (Grant's file): ZAF 2016 ANCC_IRN_03 = 89.8; the CSV row says the same.
    expect(r.observations.find((o) => o.areaCode === "ZAF" && o.period === "2016")).toEqual({ areaCode: "ZAF", period: "2016", valueText: "89.8", status: "A", note: "DHS, 2016" });
    const want = rows.filter((x) => x.COMP_BREAKDOWN_1 === "ANCC_IRN_03" && (x.REF_AREA === "ZAF" || x.REF_AREA === "COG")).map((x) => `${x.REF_AREA} ${x.TIME_PERIOD} ${x.OBS_VALUE}`).sort();
    expect(r.observations.map((o) => `${o.areaCode} ${o.period} ${o.valueText}`).sort()).toEqual(want);
    // The stored numeric equals the text written.
    expect((await q("select value::text as v from indicator_observations where document_id = $1 and area_code = 'ZAF' and period = '2016' and value_text = '89.8'", [id]))[0]).toEqual({ v: "89.8" });
  });

  it("the long and wide DHS downloads give the same stored observations", async () => {
    expect(await upload("DHS_SD_WIDEF.csv", fixture("DHS_SD_WIDEF.csv"))).toMatchObject({ ok: true });
    const longId = await docId("DHS_SD.csv");
    const wideId = await docId("DHS_SD_WIDEF.csv");
    expect((await ready(wideId)).layout).toBe("data360_wide");
    const [a, b] = [await storedValues(longId), await storedValues(wideId)];
    expect(a.size).toBe(csvRows("DHS_SD.csv").length);
    expect([...b].sort()).toEqual([...a].sort());
    // COG 2011 ANCC_IRN_03 = 84.4 in the wide file (hand-picked); COG 2010 is a blank cell: no row, never zero.
    const key03 = (await ready(wideId)).series.find((s) => s.breakdowns.some((x) => x.code === "ANCC_IRN_03"))!.key;
    expect(b.get(JSON.stringify([key03, "COG", "2011"]))).toBe("84.4");
    expect(b.has(JSON.stringify([key03, "COG", "2010"]))).toBe(false);
  });

  it("a label and value file keeps proportions as written with the scale recorded, and its area and year from the file name", async () => {
    expect(await upload("findex_ZAF_2024_indicator_percent.csv", fixture("findex_ZAF_2024_indicator_percent.csv"))).toMatchObject({ ok: true });
    const id = await docId("findex_ZAF_2024_indicator_percent.csv");
    const c = await ready(id);
    const account = c.series.find((s) => s.indicatorLabel === "Account (%, age 15+)")!;
    expect(account).toMatchObject({ indicatorCode: null, unitCode: "%", valueScale: "proportion", baseDescription: "age 15+", areaCodes: ["ZAF"] });
    const r = await (await lib()).loadIndicatorObservations(tenant, run, id, { readId: c.readId, seriesId: account.id, areaCodes: ["ZAF"] });
    expect(r).toMatchObject({ ok: true, observations: [{ areaCode: "ZAF", period: "2024", valueText: "0.811259662052011" }] });
  });

  it("an IMF data portal file and an OECD SDMX-CSV file are stored with their dataset description, frequency and withheld values", async () => {
    const { loadIndicatorObservations } = await lib();
    expect(await upload("IMF_STA_IL_slice.csv", fixture("IMF_STA_IL_slice.csv"))).toMatchObject({ ok: true });
    const imf = await ready(await docId("IMF_STA_IL_slice.csv"));
    expect(imf.layout).toBe("imf_wide");
    expect(imf.provenance.dataset).toMatchObject({ DATASET: "IMF.STA:IL(13.0.1)", PUBLISHER: "International Monetary Fund (IMF)" });
    const monthly = imf.series.find((s) => s.indicatorCode === "RXF11ORA_REVS" && s.breakdowns.some((b) => b.dimension === "FREQUENCY" && b.code === "M"))!;
    expect(monthly).toMatchObject({ unitCode: "USD", unitLabel: "US dollar", unitMult: 6, areaCodes: ["GBR"] });
    const r = await loadIndicatorObservations(tenant, run, await docId("IMF_STA_IL_slice.csv"), { readId: imf.readId, seriesId: monthly.id, areaCodes: ["GBR"] });
    // Hand-picked from Grant's download: GBR.RXF11ORA_REVS.USD.M 1999-M07 = 8543.3092353324; only monthly periods.
    expect(r.ok && r.observations.find((o) => o.period === "1999-M07")?.valueText).toBe("8543.3092353324");
    expect(r.ok && r.observations.every((o) => /^[0-9]{4}-M[0-9]{2}$/.test(o.period ?? ""))).toBe(true);

    expect(await upload("OECD_FDI_INC_AGGR_filtered_slice.csv", fixture("OECD_FDI_INC_AGGR_filtered_slice.csv"))).toMatchObject({ ok: true });
    const oecd = await ready(await docId("OECD_FDI_INC_AGGR_filtered_slice.csv"));
    expect(oecd.layout).toBe("oecd_sdmx");
    expect((oecd.provenance.withheld as unknown[]).length).toBe(10);
  });

  it("OECD reference notes: stored with their dataflow, shown with the matching data file, matched to no data of another dataflow; reread, bin, restore and erase", async () => {
    const { readIndicatorDocument, loadIndicatorCatalogue } = await lib();
    const { removeDocumentToBin, restoreDocumentFromBin, eraseRemovedDocument } = await import("../documentBin");
    const { notesFor } = await import("../indicatorDisplay");
    expect(await upload("OECD_FDI_INC_AGGR_reference.csv", fixture("OECD_FDI_INC_AGGR_reference.csv"))).toMatchObject({ ok: true });
    const notesDoc = await docId("OECD_FDI_INC_AGGR_reference.csv");
    const notesCat = await ready(notesDoc);
    expect(notesCat.layout).toBe("oecd_notes");
    expect(notesCat.notesFile).toEqual({ dataflow: "OECD.DAF.INV:DSD_FDI@DF_FDI_INC_AGGR(1.0)", count: 129, matchingFiles: ["OECD_FDI_INC_AGGR_filtered_slice.csv"] });
    expect((await q("select processing_status from documents where id = $1", [notesDoc]))[0]).toEqual({ processing_status: "ready" });
    const noteRows = async () => (await q<{ n: number }>("select count(*)::int as n from indicator_notes where document_id = $1", [notesDoc]))[0].n;
    expect(await noteRows()).toBe(129);

    // The data file's catalogue carries the notes of its dataflow; they apply by dimension codes.
    const dataDoc = await docId("OECD_FDI_INC_AGGR_filtered_slice.csv");
    const data = await ready(dataDoc);
    expect(data.notes).toHaveLength(129);
    const total = data.series.find((s) => s.indicatorCode === "T_D4P_F" && s.breakdowns.some((b) => b.dimension === "TYPE_ENTITY" && b.code === "ALL") && s.areaCodes.includes("NLD"))!;
    const shown = notesFor(data.notes, total, ["NLD", "DEU"]);
    // Hand-picked from the file: the NLD data source note on the 2008 to 2009 break in series, and the "~" note for the measure.
    expect(shown.find((n) => n.key.REF_AREA === "NLD" && n.field === "DATA_SOURCE" && n.period === "2009")?.text).toMatch(/^Note from the Central Bank of Netherlands: There is a \u2018break in series\u2019 between 2008 and 2009/);
    expect(shown.some((n) => JSON.stringify(n.key) === JSON.stringify({ MEASURE: "T_D4P_F" }))).toBe(true);
    expect(notesFor(data.notes, total, ["DEU"]).some((n) => n.key.REF_AREA === "NLD")).toBe(false);
    // Notes never change values: the data file's rows are what they were.
    const before = await counts(dataDoc);

    // Retry: the same notes, never twice.
    expect(await readIndicatorDocument(tenant, run, notesDoc)).toMatchObject({ ok: true, notes: 129 });
    expect(await noteRows()).toBe(129);
    expect(await counts(dataDoc)).toEqual(before);

    // Notes of another dataflow are accepted and say they match no data yet.
    const other = Buffer.from(fixture("OECD_FDI_INC_AGGR_reference.csv").toString("utf8").replaceAll("OECD.DAF.INV:DSD_FDI@DF_FDI_INC_AGGR(1.0)", "OECD.SDD.NAD:DSD_NAMAIN1@DF_QNA(1.0)"));
    expect(await upload("QNA_reference.csv", other)).toMatchObject({ ok: true });
    expect((await ready(await docId("QNA_reference.csv"))).notesFile).toEqual({ dataflow: "OECD.SDD.NAD:DSD_NAMAIN1@DF_QNA(1.0)", count: 129, matchingFiles: [] });
    expect((await ready(dataDoc)).notes).toHaveLength(129);

    // Bin: a removed notes file no longer annotates the data; restore brings the same notes back; erase deletes them.
    const { removalId } = await removeDocumentToBin(tenant, run, notesDoc, null);
    expect((await ready(dataDoc)).notes).toHaveLength(0);
    await restoreDocumentFromBin(tenant, run, removalId);
    expect((await ready(dataDoc)).notes).toHaveLength(129);
    await removeDocumentToBin(tenant, run, notesDoc, null);
    await eraseRemovedDocument(tenant, run, notesDoc);
    expect(await noteRows()).toBe(0);
    await expect(loadIndicatorCatalogue(tenant, run, notesDoc)).rejects.toThrow();
  });

  it("another organisation, another project or another kind of file is refused on the write and the read; nothing changes", async () => {
    const { publishIndicatorRead, recordIndicatorReadFailure, loadIndicatorCatalogue, loadIndicatorObservations, IndicatorDocumentNotFoundError } = await lib();
    const id = await docId("DHS_SD.csv");
    const before = await counts(id);
    const c = await ready(id);
    const minimal = { reader: "test", layout: "sdmx_long" as const, provenance: {}, series: [{ key: "k", indicatorCode: "X", indicatorLabel: null, breakdowns: [], unitCode: null, unitLabel: null, unitMult: null, valueScale: null, baseDescription: null, groups: null }], areas: [{ code: "ZAF", label: null }], observations: [[0, 0, "2020", "1", null, null]] as [number, number, string, string, null, null][] };
    await expect(publishIndicatorRead(otherTenant, run, id, minimal)).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    await expect(publishIndicatorRead(tenant, otherRun, id, minimal)).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    await expect(recordIndicatorReadFailure(tenant, otherRun, id, "x")).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    await expect(loadIndicatorCatalogue(otherTenant, run, id)).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    await expect(loadIndicatorObservations(tenant, otherRun, id, { readId: c.readId, seriesId: c.series[0].id, areaCodes: ["ZAF"] })).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    // A raw data file is not Indicator data.
    expect(await upload("survey.csv", Buffer.from("id,q1\n1,2\n"), "rawTableFiles")).toMatchObject({ ok: true });
    await expect(publishIndicatorRead(tenant, run, await docId("survey.csv"), minimal)).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    // Through the action, a file of another project answers as not in this project.
    const { readIndicatorFileAgainAction, indicatorCatalogueAction } = await import("../indicatorDataActions");
    expect(await readIndicatorFileAgainAction(foreignRun, id)).toMatchObject({ ok: false, previousVersionKept: false });
    expect(await indicatorCatalogueAction(otherRun, id)).toEqual({ ok: false, error: new IndicatorDocumentNotFoundError().message });
    expect(await counts(id)).toEqual(before);
    expect((await ready(id)).readId).toBe(c.readId);
  });

  it("a retry and two concurrent reads leave one version without duplicated rows; an answer for the replaced version is stale", async () => {
    const { readIndicatorDocument, loadIndicatorObservations } = await lib();
    const id = await docId("DHS_SD.csv");
    const before = await counts(id);
    const old = await ready(id);
    const values = await storedValues(id);
    expect(await readIndicatorDocument(tenant, run, id)).toMatchObject({ ok: true, series: 3, observations: before.obs });
    const [x, y] = await Promise.all([readIndicatorDocument(tenant, run, id), readIndicatorDocument(tenant, run, id)]);
    expect(x).toMatchObject({ ok: true });
    expect(y).toMatchObject({ ok: true });
    expect(await counts(id)).toEqual(before);
    const now = await ready(id);
    expect(now.readId).not.toBe(old.readId);
    // The later of the two concurrent reads is the published one.
    expect([x.ok && x.readId, y.ok && y.readId]).toContain(now.readId);
    expect(await storedValues(id)).toEqual(values);
    expect((await q("select count(distinct read_id)::int as n from indicator_series where document_id = $1", [id]))[0]).toEqual({ n: 1 });
    const stale = await loadIndicatorObservations(tenant, run, id, { readId: old.readId, seriesId: old.series[0].id, areaCodes: ["ZAF"] });
    expect(stale).toMatchObject({ ok: false, stale: true });
  });

  it("a failed reread keeps the previous version and says so; the next good read clears the failure", async () => {
    const { readIndicatorDocument } = await lib();
    const id = await docId("DHS_SD.csv");
    const before = await ready(id);
    const values = await storedValues(id);
    // 1. The engine cannot read it: the stored object is gone (and the local download cache with it).
    const key = (await q<{ storage_path: string }>("select storage_path from documents where id = $1", [id]))[0].storage_path;
    const bytes = storage.objects.get(key)!;
    storage.objects.delete(key);
    rmSync(path.join(tmpdir(), `stats-src-${createHash("sha1").update(key).digest("hex")}`), { force: true });
    const failed = await readIndicatorDocument(tenant, run, id);
    expect(failed).toMatchObject({ ok: false, previousVersionKept: true });
    const after = await ready(id);
    expect(after.readId).toBe(before.readId);
    expect(after.lastFailure?.failure).toMatch(/download/i);
    expect(await storedValues(id)).toEqual(values);
    expect((await q("select processing_status from documents where id = $1", [id]))[0]).toEqual({ processing_status: "ready" });
    // 2. The write fails part-way (after the new series are in): the whole write rolls back.
    storage.objects.set(key, bytes);
    await db.pool.query(`create or replace function test_fail_indicator_insert() returns trigger language plpgsql as $$ begin raise exception 'test: observation write failed'; end $$`);
    await db.pool.query("create trigger test_fail_indicator before insert on indicator_observations for each statement execute function test_fail_indicator_insert()");
    try {
      const writeFailed = await readIndicatorDocument(tenant, run, id);
      expect(writeFailed).toMatchObject({ ok: false, previousVersionKept: true, error: expect.stringContaining("observation write failed") });
    } finally {
      await db.pool.query("drop trigger test_fail_indicator on indicator_observations");
    }
    expect((await ready(id)).readId).toBe(before.readId);
    expect(await counts(id)).toMatchObject({ series: 3, obs: values.size });
    expect(await storedValues(id)).toEqual(values);
    // 3. Recovery: the next read publishes and clears the failure.
    expect(await readIndicatorDocument(tenant, run, id)).toMatchObject({ ok: true });
    expect((await ready(id)).lastFailure).toBeNull();
  });

  it("a file the reader refuses stays added, with its failure recorded and its status failed", async () => {
    expect(await upload("DHS_SD_DATADICT.csv", fixture("DHS_SD_DATADICT.csv"))).toMatchObject({ ok: true, added: ["DHS_SD_DATADICT.csv"] });
    const id = await docId("DHS_SD_DATADICT.csv");
    const c = await (await lib()).loadIndicatorCatalogue(tenant, run, id);
    expect(c).toMatchObject({ state: "failed", failure: expect.stringContaining("not in a recognised indicator layout") });
    expect(await counts(id)).toEqual({ series: 0, obs: 0, reads: 1 });
    expect((await q("select processing_status from documents where id = $1", [id]))[0]).toEqual({ processing_status: "failed" });
  });

  const FULL_FINDATA = path.join(process.env.INDICATOR_FULL_FILES ?? "/mnt/user-data/attachments/2029d29d-347f-5d3f-9a5d-a57af1db9390", "a3a07561-WB_FINDATA_WIDEF.csv");
  it.skipIf(!existsSync(FULL_FINDATA))("the full 13.6 MB FinData download is read and stored within the import limits (time and memory printed)", async () => {
    const bytes = readFileSync(FULL_FINDATA);
    const started = performance.now();
    let peak = process.memoryUsage().rss;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
    let result;
    try {
      result = await upload("WB_FINDATA_WIDEF.csv", bytes);
    } finally {
      clearInterval(timer);
    }
    const seconds = (performance.now() - started) / 1000;
    expect(result).toMatchObject({ ok: true, added: ["WB_FINDATA_WIDEF.csv"] });
    const id = await docId("WB_FINDATA_WIDEF.csv");
    // 249,113 non-blank year cells, counted independently by scripts/indicator_selftest.py with the csv module.
    expect(await counts(id)).toEqual({ series: 83, obs: 249113, reads: 1 });
    const c = await ready(id);
    const usa = c.series.find((x) => x.indicatorCode === "FD_FDI_OVRL" && x.breakdowns.map((b) => b.code).join() === "A,_T,FM")!;
    const r = await (await lib()).loadIndicatorObservations(tenant, run, id, { readId: c.readId, seriesId: usa.id, areaCodes: ["USA"] });
    expect(r.ok && r.observations.find((o) => o.period === "2006")?.valueText).toBe("71.9801025390625");
    const catalogueBytes = JSON.stringify(c).length;
    console.log(`MEASURED full FinData upload, engine read and store: ${seconds.toFixed(1)} s; Node rss peak ${(peak / 1e6).toFixed(0)} MB (engine runs in its own Python process); catalogue answer ${(catalogueBytes / 1e3).toFixed(0)} KB`);
  });

  it("remove to the bin hides the file's data, restore brings the same version back, erase deletes its rows", async () => {
    const { removeDocumentToBin, restoreDocumentFromBin, eraseRemovedDocument } = await import("../documentBin");
    const { loadIndicatorCatalogue, IndicatorDocumentNotFoundError } = await lib();
    const id = await docId("DHS_SD_WIDEF.csv");
    const before = await ready(id);
    const rows = await counts(id);
    const { removalId } = await removeDocumentToBin(tenant, run, id, null);
    await expect(loadIndicatorCatalogue(tenant, run, id)).rejects.toBeInstanceOf(IndicatorDocumentNotFoundError);
    expect(await counts(id)).toEqual(rows);
    await restoreDocumentFromBin(tenant, run, removalId);
    expect((await ready(id)).readId).toBe(before.readId);
    expect(await counts(id)).toEqual(rows);
    await removeDocumentToBin(tenant, run, id, null);
    await eraseRemovedDocument(tenant, run, id);
    expect(await counts(id)).toEqual({ series: 0, obs: 0, reads: 0 });
    expect((await q("select count(*)::int as n from documents where id = $1", [id]))[0]).toEqual({ n: 0 });
  });
});

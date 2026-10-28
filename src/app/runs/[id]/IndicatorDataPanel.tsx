"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import * as Plot from "@observablehq/plot";
import { indicatorCatalogueAction, indicatorObservationsAction, readIndicatorFileAgainAction, type IndicatorCatalogueResult } from "@/lib/indicatorDataActions";
import type { IndicatorObservationsResult, IndicatorSeriesSummary } from "@/lib/indicatorData";
import { INDICATOR_LAYOUT_LABEL, MAX_INDICATOR_AREAS } from "@/lib/indicatorLayouts";
import {
  areaName,
  breakdownChoices,
  breakdownText,
  chartPoints,
  createRequestOrder,
  datasetLines,
  noteText,
  notesFor,
  withheldCells,
  indicatorCsv,
  indicatorOptions,
  isMarkedStatus,
  periodAxis,
  seriesFor,
  shownNumber,
  shownText,
  sourceText,
  statusMarkers,
  unitText,
} from "@/lib/indicatorDisplay";
import { buildIndicatorPlotOptions } from "@/lib/indicatorChartOptions";

const btn = "rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-slate-400 disabled:opacity-50";
const select = "w-full rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground";

type Choice = { indicatorKey: string; picks: Record<string, string>; areaCodes: (string | null)[] };

/**
 * The Indicator data view of one file (batch 54; contract claude/indicator-data.md): choose an indicator,
 * its breakdown values and up to MAX_INDICATOR_AREAS areas, and see a line chart of the value over time
 * (a year with no value is a gap, never zero), the unit and source, a table and a CSV of what is shown.
 *
 * The choice lives in this view only and is not saved: a reload starts again from the first indicator.
 * Answers are tied to the request that asked for them (createRequestOrder) and to this file, so an
 * earlier answer arriving late never replaces a newer choice or shows against another file. When the
 * file has been read again since the list was loaded, the list is loaded again rather than mixing two
 * versions.
 */
export default function IndicatorDataPanel({ runId, documentId }: { runId: string; documentId: string }) {
  const [catalogue, setCatalogue] = useState<{ documentId: string; result: IndicatorCatalogueResult } | null>(null);
  const [reload, setReload] = useState(0);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [answer, setAnswer] = useState<{ key: string; result: IndicatorObservationsResult } | null>(null);
  const [areaFilter, setAreaFilter] = useState("");
  const [reading, startReading] = useTransition();
  const [readMessage, setReadMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const order = useRef(createRequestOrder());

  useEffect(() => {
    let current = true;
    indicatorCatalogueAction(runId, documentId)
      .then((result) => current && setCatalogue({ documentId, result }))
      .catch((e) => current && setCatalogue({ documentId, result: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
    return () => {
      current = false;
    };
  }, [runId, documentId, reload]);

  const shown = catalogue?.documentId === documentId ? catalogue.result : null;
  const ready = shown?.ok && shown.catalogue.state === "ready" ? shown.catalogue : null;
  const series = useMemo(() => ready?.series ?? [], [ready]);
  const indicators = useMemo(() => indicatorOptions(series), [series]);

  // Another file starts from its first indicator. One area only (a country summary) is chosen for the
  // researcher; otherwise none is, until they choose. A new read of the same file keeps the choice
  // where the new read still has that indicator, and its answers are asked for again (readId is part
  // of the request).
  const readId = ready?.readId ?? null;
  const [choiceFor, setChoiceFor] = useState<string | null>(null);
  if (ready && choiceFor !== `${documentId}|${readId}`) {
    const sameFile = choiceFor?.startsWith(`${documentId}|`) ?? false;
    setChoiceFor(`${documentId}|${readId}`);
    if (!sameFile || !choice || !indicators.some((x) => x.key === choice.indicatorKey)) {
      const first = indicators[0]?.key ?? "";
      setChoice({ indicatorKey: first, picks: {}, areaCodes: ready.areas.length === 1 ? [ready.areas[0].code] : [] });
    }
  }

  const chosen = ready && choice ? seriesFor(series, choice.indicatorKey, choice.picks) : null;
  const requestKey = chosen && choice && choice.areaCodes.length > 0 ? JSON.stringify([documentId, readId, chosen.id, choice.areaCodes]) : null;

  useEffect(() => {
    if (!requestKey || !ready || !chosen || !choice) return;
    const n = order.current.next();
    indicatorObservationsAction(runId, documentId, { readId: ready.readId, seriesId: chosen.id, areaCodes: choice.areaCodes })
      .then((result) => {
        if (!order.current.isLatest(n)) return;
        if (!result.ok && result.stale) setReload((x) => x + 1);
        setAnswer({ key: requestKey, result });
      })
      .catch((e) => order.current.isLatest(n) && setAnswer({ key: requestKey, result: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
    // requestKey carries every input of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = answer && answer.key === requestKey ? answer.result : null;

  function readAgain() {
    setReadMessage(null);
    startReading(async () => {
      try {
        const r = await readIndicatorFileAgainAction(runId, documentId);
        setReadMessage(
          r.ok
            ? { ok: true, text: `Read again: ${r.series} series, ${r.observations.toLocaleString("en-GB")} values.` }
            : { ok: false, text: `${r.error}${r.previousVersionKept ? " The version read before is still shown." : ""}` },
        );
      } catch (e) {
        setReadMessage({ ok: false, text: `The file could not be read again: ${e instanceof Error ? e.message : String(e)}` });
      }
      setReload((x) => x + 1);
    });
  }

  const readAgainButton = (
    <button type="button" className={btn} onClick={readAgain} disabled={reading} data-testid="indicator-read-again">
      {reading ? "Reading..." : "Read the file again"}
    </button>
  );
  const readNote = readMessage && (
    <p role="status" data-testid="indicator-read-message" className={readMessage.ok ? "text-xs text-muted" : "text-xs text-danger"}>
      {readMessage.text}
    </p>
  );

  const frame = (body: ReactNode) => (
    <div data-testid="indicator-data" className="flex flex-col gap-3 rounded-lg border border-border bg-white p-3 text-xs">
      {body}
    </div>
  );

  if (!shown) return frame(<p className="text-muted">Loading indicator data...</p>);
  if (!shown.ok) return frame(<p className="text-danger">{shown.error}</p>);
  const c = shown.catalogue;
  if (c.state === "unavailable") return frame(<p data-testid="indicator-unavailable" className="text-muted">{c.message}</p>);
  if (c.state === "not_read") return frame(<><p className="text-muted">This file has not been read yet.</p>{readAgainButton}{readNote}</>);
  if (c.state === "failed") {
    return frame(
      <>
        <p data-testid="indicator-read-failure" className="text-danger">This file could not be read as indicator data: {c.failure}</p>
        <div>{readAgainButton}</div>
        {readNote}
      </>,
    );
  }

  if (c.notesFile) {
    const nf = c.notesFile;
    return frame(
      <>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-foreground">Indicator notes</p>
            <p className="text-muted" data-testid="indicator-summary">{`${INDICATOR_LAYOUT_LABEL[c.layout]}: ${nf.count} English ${nf.count === 1 ? "note" : "notes"} for the dataflow ${nf.dataflow}. Notes never change values.`}</p>
          </div>
          {readAgainButton}
        </div>
        {readNote}
        <p data-testid="indicator-notes-match" className="text-muted">
          {nf.matchingFiles.length > 0
            ? `Shown under the chart of matching series in ${nf.matchingFiles.join(", ")}.`
            : "These notes match no data in this project yet: add the OECD data download of the same dataflow as Indicator data."}
        </p>
      </>,
    );
  }

  const choices = choice ? breakdownChoices(series, choice.indicatorKey) : [];
  const varying = new Set(choices.map((x) => x.dimension));
  const withData = new Set(chosen?.areaCodes ?? []);
  const areaList = c.areas.filter((a) => withData.has(a.code));
  const filter = areaFilter.trim().toLowerCase();
  const visibleAreas = filter ? areaList.filter((a) => `${a.code ?? ""} ${a.label ?? ""}`.toLowerCase().includes(filter)) : areaList;
  const setPick = (patch: Partial<Choice>) => choice && setChoice({ ...choice, ...patch });
  const toggleArea = (code: string | null) => {
    if (!choice) return;
    const on = choice.areaCodes.includes(code);
    setPick({ areaCodes: on ? choice.areaCodes.filter((x) => x !== code) : [...choice.areaCodes, code] });
  };

  return frame(
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold text-foreground">Indicator data</p>
          <p className="text-muted" data-testid="indicator-summary">
            {`${INDICATOR_LAYOUT_LABEL[c.layout]}: ${c.series.length} ${c.series.length === 1 ? "series" : "series"}, ${c.areas.length} ${c.areas.length === 1 ? "area" : "areas"}, ${c.observationCount.toLocaleString("en-GB")} values. Read ${new Date(c.publishedAt).toLocaleString("en-GB")}.`}
          </p>
        </div>
        {readAgainButton}
      </div>
      {readNote}
      {c.lastFailure && (
        <p data-testid="indicator-last-failure" className="rounded-lg border border-danger bg-danger-light px-2 py-1 text-danger">
          The last attempt to read this file again failed ({c.lastFailure.failure}). The version read on {new Date(c.publishedAt).toLocaleString("en-GB")} is shown.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-muted">
            Indicator
            <select className={select} aria-label="Indicator" value={choice?.indicatorKey ?? ""} onChange={(e) => setPick({ indicatorKey: e.target.value, picks: {} })}>
              {indicators.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {choices.map((d) => (
            <label key={d.dimension} className="flex flex-col gap-1 text-muted">
              {d.dimension}
              <select
                className={select}
                aria-label={`Breakdown ${d.dimension}`}
                value={chosen?.breakdowns.find((b) => b.dimension === d.dimension)?.code ?? ""}
                onChange={(e) => setPick({ picks: { ...(choice?.picks ?? {}), [d.dimension]: e.target.value } })}
              >
                {d.values.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {chosen && <SeriesFacts series={chosen} skip={varying} />}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-muted">{`Areas (up to ${MAX_INDICATOR_AREAS}; ${areaList.length} with values for this series)`}</legend>
          {areaList.length > 8 && <input value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} placeholder="Find an area" aria-label="Find an area" className="rounded-lg border border-border px-2 py-1" />}
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto" data-testid="indicator-areas">
            {visibleAreas.map((a) => {
              const on = choice?.areaCodes.includes(a.code) ?? false;
              const full = (choice?.areaCodes.length ?? 0) >= MAX_INDICATOR_AREAS;
              return (
                <label key={a.code ?? "(none)"} className="flex items-center gap-1.5 text-foreground">
                  <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggleArea(a.code)} />
                  {areaName(a.code, c.areas)}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      {chosen && choice && choice.areaCodes.length === 0 && <p className="text-muted">Choose one or more areas to see their values over time.</p>}
      {chosen && choice && choice.areaCodes.length > 0 && !current && <p className="text-muted">Loading values...</p>}
      {current && !current.ok && <p className="text-danger">{current.error}</p>}
      {current?.ok && chosen && choice && (
        <IndicatorResult
          series={chosen}
          areaCodes={choice.areaCodes}
          catalogue={c}
          observations={current.observations}
        />
      )}
    </>,
  );
}

function SeriesFacts({ series, skip }: { series: IndicatorSeriesSummary; skip: Set<string> }) {
  const fixed = breakdownText(series.breakdowns, skip);
  return (
    <div className="flex flex-col gap-0.5 text-muted">
      {fixed && <p>{`Breakdowns: ${fixed}`}</p>}
      <p>{unitText(series)}</p>
      {series.groups && <p>{`Group: ${series.groups.map((g) => `${g.column}: ${g.value}`).join("; ")}`}</p>}
    </div>
  );
}

type ReadyCatalogue = Extract<Extract<IndicatorCatalogueResult, { ok: true }>["catalogue"], { state: "ready" }>;

function IndicatorResult({ series, areaCodes, catalogue, observations }: { series: IndicatorSeriesSummary; areaCodes: (string | null)[]; catalogue: ReadyCatalogue; observations: import("@/lib/indicatorData").IndicatorObservation[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const withheld = useMemo(() => withheldCells(catalogue.provenance, series.key, areaCodes), [catalogue.provenance, series.key, areaCodes]);
  const withheldPeriods = useMemo(() => [...withheld].map((k) => k.split("\u0000")[1] || null), [withheld]);
  const axis = useMemo(() => periodAxis([...observations.map((o) => o.period), ...withheldPeriods]), [observations, withheldPeriods]);
  const statuses = useMemo(() => (catalogue.provenance.statuses ?? {}) as Record<string, string | null>, [catalogue.provenance]);
  const points = useMemo(() => chartPoints(observations, areaCodes, catalogue.areas, series, statuses, withheldPeriods), [observations, areaCodes, catalogue.areas, series, statuses, withheldPeriods]);
  const markers = useMemo(() => statusMarkers(observations, statuses), [observations, statuses]);
  const areaNames = areaCodes.map((code) => areaName(code, catalogue.areas));
  const source = sourceText(catalogue.provenance, catalogue.fileName);
  const notes = notesFor(catalogue.notes, series, areaCodes);
  const unit = unitText(series);
  const yLabel = series.valueScale !== null ? "Percent" : (series.unitLabel ?? series.unitCode ?? "Value");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = Math.min(container.clientWidth || 640, 760);
    const plot = Plot.plot(buildIndicatorPlotOptions(Plot, { points, axis: axis.map((p) => p ?? "Not stated"), areas: areaNames, yLabel, width, markers })) as unknown as HTMLElement & { remove?: () => void };
    container.innerHTML = "";
    container.appendChild(plot);
    return () => plot.remove?.();
    // areaNames is derived from areaCodes and the catalogue, both in points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, axis, yLabel, markers]);

  const byKey = new Map(observations.map((o) => [`${o.areaCode ?? ""}\u0000${o.period ?? ""}`, o]));
  const periodsWithValues = axis.filter((p) => areaCodes.some((a) => byKey.has(`${a ?? ""}\u0000${p ?? ""}`) || withheld.has(`${a ?? ""}\u0000${p ?? ""}`)));
  const nonNormal = observations.filter((o) => isMarkedStatus(o.status));

  function download() {
    const withheldList = [...withheld].map((k) => {
      const [area, period] = k.split("\u0000");
      return { areaCode: area === "" ? null : area, period: period === "" ? null : period };
    });
    const csv = indicatorCsv({ series, areas: catalogue.areas, observations, statuses, source, withheld: withheldList, notes });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${catalogue.fileName.replace(/\.[^.]+$/, "")}-${(series.indicatorCode ?? "indicator").replace(/[^A-Za-z0-9_.-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-2">
      <figure className="flex flex-col gap-1 rounded-xl border border-border bg-white p-3" data-testid="indicator-chart">
        <figcaption className="font-semibold text-foreground">{series.indicatorLabel ?? series.indicatorCode}</figcaption>
        <div ref={containerRef} className="w-full overflow-x-auto" />
        {markers.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-muted" data-testid="indicator-status-legend" aria-label="Marked values">
            {markers.map((m) => (
              <li key={m.code}>{`Open ${m.symbol}: ${m.label}, as the file marks it. Other points are normal values.`}</li>
            ))}
          </ul>
        )}
        <p className="text-muted" data-testid="indicator-chart-unit">{unit}</p>
        <p className="text-muted" data-testid="indicator-chart-source">{source}</p>
        {datasetLines(catalogue.provenance).map((line) => (
          <p key={line} className="text-muted" data-testid="indicator-dataset-line">
            {line}
          </p>
        ))}
        {notes.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="indicator-notes">
            <p className="font-medium text-foreground">{`Notes from ${[...new Set(notes.map((n) => n.fileName))].join(", ")} (they never change the values)`}</p>
            <ul className="flex flex-col gap-1 text-muted">
              {notes.map((n, i) => (
                <li key={i}>{noteText(n)}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-muted">Lines join consecutive periods only. A gap is a period with no value in the file; it is never drawn as zero.</p>
        {withheld.size > 0 && (
          <p className="text-muted" data-testid="indicator-withheld">{`${withheld.size} ${withheld.size === 1 ? "value is" : "values are"} withheld by the publisher as confidential: not drawn, never zero, and marked in the table.`}</p>
        )}
      </figure>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted">{`${observations.length} ${observations.length === 1 ? "value" : "values"} shown.`}</p>
        <button type="button" className={btn} onClick={download} data-testid="indicator-download">
          Download CSV of what is shown
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs" data-testid="indicator-table">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border px-2 py-1 text-left font-semibold">Period</th>
              {areaCodes.map((a) => (
                <th key={a ?? "(none)"} scope="col" className="border-b border-border px-2 py-1 text-right font-semibold">
                  {areaName(a, catalogue.areas)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periodsWithValues.map((p) => (
              <tr key={p ?? "(none)"}>
                <th scope="row" className="border-b border-border px-2 py-1 text-left font-normal">{p ?? "Not stated"}</th>
                {areaCodes.map((a) => {
                  const o = byKey.get(`${a ?? ""}\u0000${p ?? ""}`);
                  return (
                    <td key={a ?? "(none)"} className="border-b border-border px-2 py-1 text-right tabular-nums" title={o ? `As written in the file: ${o.valueText}${o.note ? `; ${o.note}` : ""}` : withheld.has(`${a ?? ""}\u0000${p ?? ""}`) ? "The file withholds this value as confidential" : "No value in the file"}>
                      {o ? `${shownText(shownNumber(o.valueText, series), series)}${isMarkedStatus(o.status) ? ` (${markers.find((m) => m.code === o.status)?.label ?? o.status})` : ""}` : withheld.has(`${a ?? ""}\u0000${p ?? ""}`) ? "Withheld (confidential)" : "No value"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {nonNormal.length > 0 && <p className="mt-1 text-muted">A status in brackets is the file&apos;s own observation status.</p>}
      </div>
    </div>
  );
}

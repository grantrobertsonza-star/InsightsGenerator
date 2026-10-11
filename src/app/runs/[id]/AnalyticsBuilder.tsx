"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { loadVariablesAction } from "@/lib/crosstabActions";
import {
  addDriverFindingsAction,
  driverFindingCountsAction,
  removeDriverFindingsAction,
  deleteDriverAnalysisAction,
  listDriverAnalysesAction,
  runDriverAnalysisAction,
  saveDriverAnalysisAction,
} from "@/lib/driverActions";
import type { DriverReport, DriverRequest, SavedDriverAnalysis } from "@/lib/drivers";
import type { VariableDictionary, VariableInfo } from "@/lib/parseStatsFile";
import { KANO_LABELS, kanoPlace, type KanoQuadrantName } from "@/lib/driverQuadrant";

const IMPORTANCE_LIKE = /importan|(^|[^a-z])imp([^a-z]|$)/i;
const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "and", "is", "was", "are", "how", "importance", "important", "very", "your", "you", "in", "for", "on", "my", "with", "at", "it", "i", "me"]);
const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );

/** The importance question whose wording most overlaps the predictor's, when it overlaps enough to be a safe guess. */
function suggestImportance(pred: VariableInfo, candidates: VariableInfo[]): string {
  const a = wordsOf(pred.label ?? "");
  if (a.size === 0) return "";
  let best = "";
  let bestScore = 0;
  for (const c of candidates) {
    const b = wordsOf(c.label ?? "");
    if (b.size === 0) continue;
    const common = [...a].filter((w) => b.has(w)).length;
    const score = common / (a.size + b.size - common);
    if (score > bestScore) {
      bestScore = score;
      best = c.name;
    }
  }
  return bestScore >= 0.5 ? best : "";
}

/**
 * The launcher on a data file's card, beside Crosstabs. The work happens in a full-window workspace
 * because a survey can have thousands of variables.
 */
export default function AnalyticsBuilder({
  runId,
  documentId,
  filename,
}: {
  runId: string;
  documentId: string;
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">Analytics</p>
          <p className="text-[11px] text-muted">
            Driver analysis: pick an outcome such as overall satisfaction and the questions that may explain it, and see which
            matter most, with the overlap between them handled.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          Open analytics
        </button>
      </div>
      {open && <AnalyticsWorkspace runId={runId} documentId={documentId} filename={filename} onClose={() => setOpen(false)} />}
    </div>
  );
}

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);

function usable(v: VariableInfo): boolean {
  return v.numeric && !v.text && !v.weightLike && v.nDistinct >= 2;
}

function AnalyticsWorkspace({
  runId,
  documentId,
  filename,
  onClose,
}: {
  runId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [dict, setDict] = useState<VariableDictionary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [outcomeType, setOutcomeType] = useState<"continuous" | "binary">("continuous");
  const [topBoxMin, setTopBoxMin] = useState("");
  const [predictors, setPredictors] = useState<Set<string>>(new Set());
  const [predFilter, setPredFilter] = useState("");
  const [weightVar, setWeightVar] = useState("");
  // predictor -> its importance question. "" means the researcher chose none; a missing key means "use the suggestion".
  const [statedPick, setStatedPick] = useState<Record<string, string>>({});
  const [report, setReport] = useState<DriverReport | null>(null);
  const [saved, setSaved] = useState<SavedDriverAnalysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    loadVariablesAction(runId, documentId).then((r) => {
      if (!live) return;
      if (r.ok) setDict(r.dictionary);
      else setError(r.error);
    });
    listDriverAnalysesAction(runId, documentId).then((r) => {
      if (live && r.ok) setSaved(r.items);
    });
    driverFindingCountsAction(runId).then((r) => {
      if (live && r.ok) setCounts(r.counts);
    });
    return () => {
      live = false;
    };
  }, [runId, documentId]);

  const vars = useMemo(() => (dict?.variables ?? []).filter(usable), [dict]);
  const weights = useMemo(() => (dict?.variables ?? []).filter((v) => v.weightLike), [dict]);
  const match = (v: VariableInfo, q: string) => {
    const s = q.trim().toLowerCase();
    return !s || v.name.toLowerCase().includes(s) || (v.label ?? "").toLowerCase().includes(s);
  };
  const outcomeChoices = vars.filter((v) => match(v, outcomeFilter)).slice(0, 80);
  const predChoices = vars.filter((v) => v.name !== outcome && match(v, predFilter));

  const toggle = (name: string) =>
    setPredictors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const importanceChoices = useMemo(
    () => vars.filter((v) => IMPORTANCE_LIKE.test(v.name) || IMPORTANCE_LIKE.test(v.label ?? "")),
    [dict], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const chosenPreds = vars.filter((v) => predictors.has(v.name));
  const statedFor = (pred: VariableInfo): string => {
    if (pred.name in statedPick) return statedPick[pred.name];
    return suggestImportance(
      pred,
      importanceChoices.filter((c) => c.name !== pred.name && c.name !== outcome && !predictors.has(c.name)),
    );
  };

  const canRun = outcome !== "" && predictors.size >= 2 && !busy;

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const request: DriverRequest = {
      outcome,
      outcomeType,
      topBoxMin: outcomeType === "binary" && topBoxMin.trim() !== "" ? Number(topBoxMin) : null,
      predictors: [...predictors],
      weightVar: weightVar || null,
      statedImportance: Object.fromEntries(
        chosenPreds.map((p) => [p.name, statedFor(p)] as const).filter(([, imp]) => imp !== ""),
      ),
    };
    const r = await runDriverAnalysisAction(runId, documentId, request);
    setBusy(false);
    if (r.ok) setReport(r.report);
    else {
      setReport(null);
      setError(r.error);
    }
  }

  async function save() {
    if (!report) return;
    const title = `Drivers of ${report.outcomeLabel}`;
    const r = await saveDriverAnalysisAction(runId, documentId, title, report);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const list = await listDriverAnalysesAction(runId, documentId);
    if (list.ok) setSaved(list.items);
    setMessage("Saved.");
    startTransition(() => router.refresh());
  }

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Analytics workspace">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">Analytics: driver analysis</p>
          <p className="text-[11px] text-muted">{filename}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
          Close
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-h-0 space-y-4 overflow-y-auto border-r border-border p-4 text-xs">
          {!dict && !error && <p className="text-muted">Loading the variable list...</p>}
          <section className="space-y-1.5">
            <p className="font-medium text-foreground">1. Outcome</p>
            <input
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              placeholder="Search variables"
              className="w-full rounded border border-border px-2 py-1"
            />
            <select
              size={6}
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setPredictors((p) => {
                  const n = new Set(p);
                  n.delete(e.target.value);
                  return n;
                });
              }}
              className="w-full rounded border border-border px-1 py-1"
              aria-label="Outcome variable"
            >
              {outcomeChoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}: {v.label}
                </option>
              ))}
            </select>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={outcomeType === "continuous"} onChange={() => setOutcomeType("continuous")} />
                Score (use the average, linear regression)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={outcomeType === "binary"} onChange={() => setOutcomeType("binary")} />
                Top box (yes or no, logistic regression)
              </label>
              {outcomeType === "binary" && (
                <label className="ml-5 flex items-center gap-1.5">
                  Top box starts at code
                  <input
                    value={topBoxMin}
                    onChange={(e) => setTopBoxMin(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="top two"
                    className="w-20 rounded border border-border px-1.5 py-0.5"
                  />
                </label>
              )}
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">
              2. Predictors <span className="font-normal text-muted">({predictors.size} chosen)</span>
            </p>
            <input
              value={predFilter}
              onChange={(e) => setPredFilter(e.target.value)}
              placeholder="Search variables"
              className="w-full rounded border border-border px-2 py-1"
            />
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setPredictors((p) => new Set([...p, ...predChoices.slice(0, 40).map((v) => v.name)]))}
              >
                Tick shown (up to 40)
              </button>
              <button type="button" className="text-muted hover:underline" onClick={() => setPredictors(new Set())}>
                Clear
              </button>
            </div>
            <div className="max-h-72 space-y-0.5 overflow-y-auto rounded border border-border p-1.5">
              {predChoices.slice(0, 300).map((v) => (
                <label key={v.name} className="flex items-start gap-1.5">
                  <input type="checkbox" checked={predictors.has(v.name)} onChange={() => toggle(v.name)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{v.name}</span> <span className="text-muted">{v.label}</span>
                  </span>
                </label>
              ))}
              {predChoices.length === 0 && <p className="p-1 text-muted">No numeric variables match.</p>}
            </div>
          </section>

          {weights.length > 0 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">3. Weight (optional)</p>
              <select value={weightVar} onChange={(e) => setWeightVar(e.target.value)} className="w-full rounded border border-border px-1 py-1">
                <option value="">None</option>
                {weights.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}: {w.label}
                  </option>
                ))}
              </select>
            </section>
          )}

          {predictors.size > 0 && importanceChoices.length > 0 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">
                4. Stated importance <span className="font-normal text-muted">(optional)</span>
              </p>
              <p className="text-[11px] text-muted">
                If the survey also asked how important each thing is, pair them to see what people say matters against what
                actually moves the outcome. Pairs below were matched on wording; change any that look wrong.
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-1.5">
                {chosenPreds.slice(0, 40).map((p) => (
                  <div key={p.name} className="space-y-0.5">
                    <p className="truncate text-[11px]" title={p.label ?? p.name}>
                      {p.label || p.name}
                    </p>
                    <select
                      value={statedFor(p)}
                      onChange={(e) => setStatedPick((prev) => ({ ...prev, [p.name]: e.target.value }))}
                      className="w-full rounded border border-border px-1 py-0.5"
                    >
                      <option value="">No importance question</option>
                      {importanceChoices
                        .filter((c) => c.name !== p.name && c.name !== outcome)
                        .slice(0, 300)
                        .map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}: {(c.label ?? "").slice(0, 70)}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          <button
            type="button"
            disabled={!canRun}
            onClick={run}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Working..." : "Run driver analysis"}
          </button>
          {predictors.size < 2 && <p className="text-muted">Choose an outcome and at least two predictors.</p>}

          {saved.length > 0 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">Saved analyses</p>
              {saved.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                  <button type="button" className="text-left text-primary hover:underline" onClick={() => setReport(s.report)}>
                    {s.title} <span className="text-muted">({new Date(s.createdAt).toLocaleDateString()})</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    {(counts[s.id] ?? 0) > 0 ? (
                      <button
                        type="button"
                        className="text-muted hover:underline"
                        onClick={async () => {
                          const r = await removeDriverFindingsAction(runId, s.id);
                          if (r.ok) {
                            setCounts((c) => ({ ...c, [s.id]: 0 }));
                            setMessage(`Took ${r.removed} findings out of use.`);
                          } else setError(r.error);
                        }}
                      >
                        Remove {counts[s.id]} findings
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={async () => {
                          const r = await addDriverFindingsAction(runId, s.id);
                          if (r.ok) {
                            setCounts((c) => ({ ...c, [s.id]: r.added }));
                            setMessage(`Added ${r.added} findings, marked as modelled results.`);
                            startTransition(() => router.refresh());
                          } else setError(r.error);
                        }}
                      >
                        Add to findings
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-muted hover:text-danger"
                      onClick={async () => {
                        await deleteDriverAnalysisAction(runId, s.id);
                        setSaved((p) => p.filter((x) => x.id !== s.id));
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 text-xs">
          {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-danger">{error}</p>}
          {message && <p className="mb-3 text-muted">{message}</p>}
          {!report && !error && (
            <p className="max-w-xl text-muted">
              Driver analysis shows which questions are most closely tied to the outcome. Questions that overlap, such as two
              ways of asking about the same thing, share their weight between them instead of one of them getting all of it
              or a negative score. The result is a ranking with an interval on each weight, so you can see which differences
              are real. It describes what goes with the outcome in this survey. It does not prove cause.
            </p>
          )}
          {report && <ReportView report={report} onSave={save} />}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function ReportView({ report, onSave }: { report: DriverReport; onSave: () => void }) {
  const r = report.result;
  const maxShare = Math.max(...r.rows.map((x) => x.share), 0.0001);
  const methodText =
    r.method === "shapley"
      ? "Importance is each question's average contribution across every order in which questions can be added (Shapley split of the explained variance)."
      : r.method === "relative_weights"
        ? "Importance uses Johnson's relative weights, which split the explained variance when questions overlap."
        : "Importance is the size of each standardised coefficient.";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Drivers of {report.outcomeLabel}</p>
          <p className="text-muted">{report.outcomeNote}</p>
          <p className="text-muted">
            {r.n.toLocaleString()} of {report.casesInFile.toLocaleString()} cases used{report.weighted ? ", weighted" : ""}.
            {r.fit.mcFadden === null
              ? ` The questions together explain ${pct(r.fit.rSquared)} of the variation (adjusted ${pct(r.fit.adjRSquared)}).`
              : ` Pseudo R-squared ${r.fit.mcFadden.toFixed(2)} (McFadden), ${r.fit.nagelkerke?.toFixed(2)} (Nagelkerke). The model classifies ${pct(r.fit.classificationRate)} of cases correctly, against ${pct(r.fit.baseRate)} by always guessing the larger group.`}
          </p>
        </div>
        <button type="button" onClick={onSave} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
          Save this analysis
        </button>
      </div>

      {r.warnings.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="text-[11px] uppercase text-muted">
            <tr>
              <th className="py-1 pr-2">Rank</th>
              <th className="py-1 pr-2">Question</th>
              <th className="py-1 pr-2">Share of explained variation</th>
              <th className="py-1 pr-2">Rank range</th>
              <th className="py-1 pr-2">Correlation</th>
              <th className="py-1 pr-2">{r.fit.mcFadden === null ? "Std. beta" : "Odds ratio per SD"}</th>
              <th className="py-1 pr-2">p</th>
              <th className="py-1">Overlap (VIF)</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.name} className="border-t border-border align-top">
                <td className="py-1.5 pr-2 font-medium">{x.rank}</td>
                <td className="py-1.5 pr-2">{x.name}</td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded bg-slate-200" aria-hidden>
                      <div className="h-full rounded bg-primary" style={{ width: `${(x.share / maxShare) * 100}%` }} />
                    </div>
                    <span className="font-medium">{pct(x.share, 1)}</span>
                    {x.shareLow !== null && x.shareHigh !== null && (
                      <span className="text-muted">
                        ({pct(x.shareLow)} to {pct(x.shareHigh)})
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-muted">{x.rankLow !== null ? (x.rankLow === x.rankHigh ? `${x.rankLow}` : `${x.rankLow} to ${x.rankHigh}`) : "-"}</td>
                <td className="py-1.5 pr-2">{x.correlation.toFixed(2)}</td>
                <td className="py-1.5 pr-2">{x.effect.toFixed(2)}</td>
                <td className="py-1.5 pr-2">{x.pValue === null ? "-" : x.pValue < 0.001 ? "<.001" : x.pValue.toFixed(3)}</td>
                <td className={`py-1.5 ${x.vif > 5 ? "text-amber-700" : ""}`}>{Number.isFinite(x.vif) ? x.vif.toFixed(1) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        {methodText} Intervals come from 95% bootstrap ranges, repeatable because the resampling is seeded. A rank range that spans
        several places means those questions cannot be separated reliably. The p value tests whether the question adds
        anything once the others are in the model. This describes association in this survey, not cause.
      </p>

      <Quadrant report={report} />
      <StatedQuadrant report={report} />
      {report.skipped.length > 0 && (
        <p className="text-[11px] text-muted">
          Left out: {report.skipped.map((s) => `${s.variable} (${s.reason})`).join("; ")}.
        </p>
      )}
    </div>
  );
}

/** Importance against performance: where to act first. Performance is the share giving the top two answers, or the average when that is not meaningful. */
function Quadrant({ report }: { report: DriverReport }) {
  const rows = report.result.rows
    .map((r) => {
      const p = report.performance.find((x) => x.name === r.name);
      return { name: r.name, importance: r.share, perf: p?.topTwo ?? null, mean: p?.mean ?? null };
    });
  const useTop = rows.filter((r) => r.perf !== null).length >= Math.ceil(rows.length / 2);
  const pts = rows
    .map((r) => ({ name: r.name, x: useTop ? r.perf : r.mean, y: r.importance }))
    .filter((p): p is { name: string; x: number; y: number } => p.x !== null);
  if (pts.length < 3) return null;
  const W = 560;
  const H = 320;
  const pad = { l: 46, r: 16, t: 14, b: 40 };
  const xs = pts.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const yMax = Math.max(...pts.map((p) => p.y)) * 1.1;
  const sx = (v: number) => pad.l + ((v - xMin) / xSpan) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const medX = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const medY = 1 / pts.length;
  return (
    <div>
      <p className="mb-1 font-medium text-foreground">Importance against performance</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label="Importance against performance by question">
        <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" opacity="0.3" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="currentColor" opacity="0.3" />
        <line x1={sx(medX)} y1={pad.t} x2={sx(medX)} y2={H - pad.b} stroke="currentColor" opacity="0.2" strokeDasharray="4 4" />
        <line x1={pad.l} y1={sy(medY)} x2={W - pad.r} y2={sy(medY)} stroke="currentColor" opacity="0.2" strokeDasharray="4 4" />
        {pts.map((p) => (
          <g key={p.name}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={5} className="fill-primary" stroke="white" strokeWidth={2} />
            <text x={sx(p.x) + 8} y={sy(p.y) + 3} fontSize="10" fill="currentColor">
              {p.name.length > 28 ? `${p.name.slice(0, 27)}...` : p.name}
            </text>
          </g>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7">
          {useTop ? "Performance: share giving the top two answers" : "Performance: average answer"}
        </text>
        <text x={12} y={(pad.t + H - pad.b) / 2} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7" transform={`rotate(-90 12 ${(pad.t + H - pad.b) / 2})`}>
          Importance (share)
        </text>
      </svg>
      <p className="text-[11px] text-muted">
        Questions high on importance and low on performance are the first to fix. The dashed lines mark the middle of the
        questions shown.
      </p>
    </div>
  );
}

const QUADRANT_FILL: Record<KanoQuadrantName, string> = {
  satisfiers: "#047857",
  exciters: "#7c3aed",
  mustBes: "#b45309",
  indifference: "#64748b",
};

/**
 * Derived against stated importance: what actually moves the outcome against what people say matters.
 * Both axes are centred on the average of the questions shown and scaled to standard deviations.
 */
function StatedQuadrant({ report }: { report: DriverReport }) {
  const stated = report.stated ?? [];
  const joined = stated
    .map((s) => {
      const r = report.result.rows.find((x) => x.name === s.name);
      return r ? { name: s.name, derived: r.share, top: s.topTwo, mean: s.mean } : null;
    })
    .filter((x): x is { name: string; derived: number; top: number | null; mean: number | null } => x !== null);
  const useTop = joined.length > 0 && joined.every((j) => j.top !== null);
  const points = joined
    .map((j) => ({ name: j.name, derived: j.derived, stated: useTop ? j.top : j.mean }))
    .filter((p): p is { name: string; derived: number; stated: number } => p.stated !== null);
  if (points.length < 3) return null;
  const placed = kanoPlace(points);

  const W = 620;
  const H = 400;
  const pad = { l: 56, r: 24, t: 26, b: 46 };
  const rx = Math.max(1.5, ...placed.map((p) => Math.abs(p.zx))) * 1.1;
  const ry = Math.max(1.5, ...placed.map((p) => Math.abs(p.zy))) * 1.1;
  const sx = (z: number) => pad.l + ((z + rx) / (2 * rx)) * (W - pad.l - pad.r);
  const sy = (z: number) => H - pad.b - ((z + ry) / (2 * ry)) * (H - pad.t - pad.b);
  const cx = sx(0);
  const cy = sy(0);

  // Labels: to the right of the point, or to its left near the right edge, nudged down when two would overlap.
  const taken: { x1: number; x2: number; y: number }[] = [];
  const labels = [...placed]
    .sort((a, b) => sy(a.zy) - sy(b.zy))
    .map((p) => {
      const text = p.name.length > 30 ? `${p.name.slice(0, 29)}...` : p.name;
      const width = text.length * 5.3;
      const left = sx(p.zx) > W * 0.62;
      const x1 = left ? sx(p.zx) - 8 - width : sx(p.zx) + 8;
      const x2 = x1 + width;
      let y = sy(p.zy) + 3;
      for (let tries = 0; tries < 12; tries++) {
        const clash = taken.find((t) => x1 < t.x2 && x2 > t.x1 && Math.abs(t.y - y) < 11);
        if (!clash) break;
        y = clash.y + 11;
      }
      taken.push({ x1, x2, y });
      return { p, text, left, y };
    });

  const groups = (["satisfiers", "exciters", "mustBes", "indifference"] as KanoQuadrantName[]).map((q) => ({
    q,
    names: placed.filter((p) => p.quadrant === q).map((p) => p.name),
  }));

  return (
    <div>
      <p className="mb-1 font-medium text-foreground">Derived against stated importance</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label="Derived importance against stated importance by question">
        <line x1={cx} y1={pad.t} x2={cx} y2={H - pad.b} stroke="currentColor" opacity="0.25" strokeDasharray="4 4" />
        <line x1={pad.l} y1={cy} x2={W - pad.r} y2={cy} stroke="currentColor" opacity="0.25" strokeDasharray="4 4" />
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="currentColor" opacity="0.2" />
        <text x={pad.l + 6} y={pad.t + 13} fontSize="10.5" fontWeight="600" fill={QUADRANT_FILL.exciters}>
          Exciters (the unexpected)
        </text>
        <text x={W - pad.r - 6} y={pad.t + 13} fontSize="10.5" fontWeight="600" textAnchor="end" fill={QUADRANT_FILL.satisfiers}>
          Satisfiers (key drivers)
        </text>
        <text x={pad.l + 6} y={H - pad.b - 6} fontSize="10.5" fontWeight="600" fill={QUADRANT_FILL.indifference}>
          Indifference (secondary)
        </text>
        <text x={W - pad.r - 6} y={H - pad.b - 6} fontSize="10.5" fontWeight="600" textAnchor="end" fill={QUADRANT_FILL.mustBes}>
          Must-be&apos;s (potential dissatisfiers)
        </text>
        {labels.map(({ p, text, left, y }) => (
          <g key={p.name}>
            <circle cx={sx(p.zx)} cy={sy(p.zy)} r={5} fill={QUADRANT_FILL[p.quadrant]} stroke="white" strokeWidth={2} />
            <text x={left ? sx(p.zx) - 8 : sx(p.zx) + 8} y={y} fontSize="10" textAnchor={left ? "end" : "start"} fill="currentColor">
              {text}
            </text>
          </g>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 10} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7">
          Stated importance ({useTop ? "share rating it top two" : "average rating"}), low to high
        </text>
        <text x={14} y={(pad.t + H - pad.b) / 2} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.7" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}>
          Derived importance (share of explained variance), low to high
        </text>
      </svg>
      <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
        {groups.map(({ q, names }) => (
          <div key={q} className="rounded border border-border px-2 py-1">
            <p className="text-[11px] font-medium" style={{ color: QUADRANT_FILL[q] }}>
              {KANO_LABELS[q].title}
            </p>
            <p className="text-[10.5px] text-muted">{KANO_LABELS[q].meaning}</p>
            <p className="text-[11px]">{names.length > 0 ? names.join("; ") : "None"}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Both axes are centred on the average of the questions shown and scaled to standard deviations, so the dashed lines
        mark the middle of what was asked. Derived importance comes from the model above, not from asking. This follows the
        quadrant approach Lieberman (2023) describes, which uses Johnson&apos;s relative weights for the derived axis; the
        corner names are a market research convention, not a strict Kano survey. The gap between the two axes is the
        finding: a question high on derived and low on stated importance is doing more than people say.
      </p>
    </div>
  );
}

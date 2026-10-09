"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  confirmLinksAction,
  guideCoverageAction,
  loadInstrumentReviewAction,
  readInstrumentAction,
  setInstrumentTargetAction,
  setLinkStatusAction,
} from "@/lib/instrumentActions";
import type { InstrumentItem, InstrumentLink, InstrumentSummary } from "@/lib/instruments";
import type { GuideReport } from "@/lib/guides";

type DataDoc = { id: string; name: string };

const methodLabel: Record<InstrumentLink["method"], string> = {
  code: "Same code",
  stem: "Code stem",
  wording: "Wording",
  manual: "Chosen by you",
};

const btn =
  "rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-slate-50 disabled:opacity-50";
const btnPrimary =
  "rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white hover:bg-primary-hover disabled:opacity-50";

/**
 * A questionnaire or guide on the Import page: read its items, link them to a
 * data file's variables, and check the links. Nothing is applied until a link
 * is confirmed here.
 */
export default function InstrumentCard({
  runId,
  documentId,
  summary,
  dataDocs,
  fixedTarget,
  autoStart,
  onlyTranscript,
}: {
  runId: string;
  documentId: string;
  summary: InstrumentSummary;
  dataDocs: DataDoc[];
  /** The data file this questionnaire belongs to, when the card sits inside that file's own card. */
  fixedTarget?: string;
  /** Read and match without waiting for a click. */
  autoStart?: boolean;
  /** Guides inside a transcript's card: check coverage for that transcript only. */
  onlyTranscript?: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(fixedTarget ?? summary.forDocumentId ?? dataDocs[0]?.id ?? "");
  const [review, setReview] = useState<{ items: InstrumentItem[]; links: InstrumentLink[] } | null>(null);
  const [report, setReport] = useState<GuideReport | null>(null);
  const [filter, setFilter] = useState<"suggested" | "unmatched" | "confirmed" | "all">("suggested");

  const isGuide = summary.type === "interview_guide" || summary.type === "focus_group_guide";
  const read = summary.items > 0;

  // Read, then match (questionnaires) or check coverage (guides), once, without a click.
  const started = useRef(false);
  const coverageRan = useRef(false);
  useEffect(() => {
    if (started.current || pending) return;
    const needsRead = !!autoStart && summary.items === 0;
    const links = summary.links.suggested + summary.links.confirmed + summary.links.rejected;
    const needsMatch = !!autoStart && !isGuide && !!target && summary.items > 0 && links === 0;
    if (!needsRead && !needsMatch) return;
    started.current = true;
    start(async () => {
      if (needsRead) {
        const r = await readInstrumentAction(runId, documentId);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      if (!isGuide && target) {
        const m = await setInstrumentTargetAction(runId, documentId, target);
        if (!m.ok) setError(m.error);
        else setMessage(`${m.suggested} links suggested. Check them before they are used.`);
      }
    });
  }, [autoStart, pending, summary.items, summary.links.suggested, summary.links.confirmed, summary.links.rejected, isGuide, target, runId, documentId]);

  // Guide coverage is a cheap count, so it runs by itself once the guide is read.
  useEffect(() => {
    if (!isGuide || summary.items === 0 || coverageRan.current) return;
    coverageRan.current = true;
    void guideCoverageAction(runId, documentId, onlyTranscript).then((r) => {
      if (r.ok) setReport(r.report);
    });
  }, [isGuide, summary.items, runId, documentId, onlyTranscript]);

  function run(fn: () => Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }>, ok?: (r: Record<string, unknown>) => string) {
    setError(null);
    setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else if (ok) setMessage(ok(r));
      if (review) await reload();
    });
  }

  async function reload() {
    const r = await loadInstrumentReviewAction(documentId);
    if (r.ok) setReview({ items: r.items, links: r.links });
    else setError(r.error);
  }

  const linksByItem = new Map<string, InstrumentLink[]>();
  for (const l of review?.links ?? []) linksByItem.set(l.itemId, [...(linksByItem.get(l.itemId) ?? []), l]);
  const rows = (review?.items ?? []).filter((i) => {
    const ls = linksByItem.get(i.id) ?? [];
    if (filter === "all") return true;
    if (filter === "unmatched") return ls.length === 0;
    return ls.some((l) => l.status === filter);
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-white p-3 text-xs">
      {!read ? (
        <div className="space-y-2">
          <p className="text-muted">
            {autoStart && !error
              ? "Reading now. This can take a minute and runs by itself."
              : isGuide
              ? "Read the guide to list its questions and probes. They will be matched to the questions asked in your transcripts."
              : "Read the questionnaire to list its questions, answer options and skip instructions. They are then matched to your data file's variables."}
          </p>
          <button className={btnPrimary} disabled={pending} onClick={() => run(() => readInstrumentAction(runId, documentId), (r) => `Read ${r.items} items.`)}>
            {pending ? "Reading, this can take a minute..." : isGuide ? "Read guide" : "Read questionnaire"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={summary.items} label={isGuide ? "Questions and probes" : "Items read"} />
          {!isGuide && <Stat value={`${summary.withRouting} of ${summary.statedRoutingText}`} label={summary.fromJumps > 0 ? `Skip instructions understood (+${summary.fromJumps} from GO TO jumps)` : "Skip instructions understood"} />}
          {!isGuide && <Stat value={summary.links.confirmed} label="Links confirmed" />}
          {!isGuide && <Stat value={summary.links.suggested} label="Links to check" />}
        </div>
      )}

      {read && !isGuide && (
        <div className="flex flex-wrap items-center gap-2">
          {dataDocs.length === 0 ? (
            <span className="text-muted">Add the data file this questionnaire belongs to, then match.</span>
          ) : (
            <>
              {!fixedTarget && <label className="text-muted" htmlFor={`target-${documentId}`}>Data file</label>}
              {!fixedTarget && <select
                id={`target-${documentId}`}
                className="max-w-[16rem] truncate rounded-lg border border-border bg-white px-2 py-1 text-[11px]"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {dataDocs.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>}
              <button
                className={btnPrimary}
                disabled={pending || !target}
                onClick={() => run(() => setInstrumentTargetAction(runId, documentId, target), (r) => `${r.suggested} links suggested. Check them before they are used.`)}
              >
                {pending ? "Matching..." : summary.links.suggested + summary.links.confirmed > 0 ? "Match again" : "Match to variables"}
              </button>
            </>
          )}
          {summary.links.suggested > 0 && (
            <button className={btn} disabled={pending} onClick={() => run(() => confirmLinksAction(runId, documentId), (r) => `Confirmed ${r.confirmed} same-code matches.`)}>
              Confirm same-code matches
            </button>
          )}
          {(summary.links.suggested + summary.links.confirmed > 0 || review) && (
            <button className={btn} disabled={pending} onClick={() => (review ? setReview(null) : void reload())}>
              {review ? "Hide matches" : "Review matches"}
            </button>
          )}
        </div>
      )}

      {read && isGuide && (
        <div className="space-y-2">
          <p className="text-muted">
            Guide read. Its topics are offered to the coding pass as hints, and checking coverage shows which guide
            questions each session actually raised.
          </p>
          <button
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await guideCoverageAction(runId, documentId, onlyTranscript);
                if (r.ok) setReport(r.report);
                return r;
              })
            }
          >
            {pending ? "Checking..." : report ? "Check again" : "Check coverage"}
          </button>
          {report && <GuideCoveragePanel report={report} />}
        </div>
      )}

      {message && <p className="text-foreground">{message}</p>}
      {error && <p className="text-danger">{error}</p>}

      {review && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(["suggested", "unmatched", "confirmed", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${filter === f ? "bg-primary text-white" : "border border-border bg-white text-muted"}`}
              >
                {f === "suggested" ? "To check" : f === "unmatched" ? "No match" : f === "confirmed" ? "Confirmed" : "All"}
              </button>
            ))}
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-left">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="w-16 px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Question</th>
                  <th className="px-2 py-1.5">Linked variable</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((i) => (
                  <tr key={i.id} className="border-b border-border align-top last:border-0">
                    <td className="px-2 py-1.5 font-medium text-foreground">{i.code ?? ""}</td>
                    <td className="px-2 py-1.5 text-muted">
                      {i.text}
                      {i.routingText && (
                        <div className="mt-0.5 text-[10px]">
                          Skip: {i.routingText}
                          {i.routing ? "" : " (not understood, so not used)"}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {(linksByItem.get(i.id) ?? []).length === 0 ? (
                        <span className="text-muted">No match</span>
                      ) : (
                        (linksByItem.get(i.id) ?? []).slice(0, 6).map((l) => (
                          <div key={l.id} className="mb-1 flex flex-wrap items-center gap-1.5">
                            <span className={l.status === "rejected" ? "text-muted line-through" : "font-medium text-foreground"}>{l.variable}</span>
                            <span className="text-[10px] text-muted">{methodLabel[l.method]}, {Math.round(l.confidence * 100)}%</span>
                            {l.status !== "confirmed" && (
                              <button className={btn} disabled={pending} onClick={() => run(() => setLinkStatusAction(runId, l.id, "confirmed"))}>Confirm</button>
                            )}
                            {l.status !== "rejected" && (
                              <button className={btn} disabled={pending} onClick={() => run(() => setLinkStatusAction(runId, l.id, "rejected"))}>Reject</button>
                            )}
                            {l.status === "confirmed" && <span className="text-[10px] text-success">Confirmed</span>}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 300 && <p className="text-muted">Showing the first 300 of {rows.length}. Use the filters to narrow the list.</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

const statusText: Record<string, string> = { asked: "Asked", reworded: "Reworded", not_asked: "Not asked", unmatchable: "Too short to match" };

function GuideCoveragePanel({ report }: { report: GuideReport }) {
  if (report.transcripts.length === 0) {
    return <p className="text-muted">No transcripts in this run yet. Add them, then check coverage.</p>;
  }
  const neverAsked = report.perItem.filter((p) => p.neverAsked);
  const byItem = new Map(report.items.map((i) => [i.id, i]));
  return (
    <div className="space-y-3">
      <p className="text-muted">
        Matched by wording, so a Reworded or Not asked flag is a prompt to read the session, not a verdict.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-left">
          <thead className="bg-slate-50">
            <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-2 py-1.5">Session</th>
              <th className="px-2 py-1.5 text-right">Guide items raised</th>
              <th className="px-2 py-1.5 text-right">Not asked</th>
              <th className="px-2 py-1.5 text-right">Moderator questions outside the guide</th>
              <th className="px-2 py-1.5 text-right">In guide order</th>
            </tr>
          </thead>
          <tbody>
            {report.transcripts.map((t) => (
              <tr key={t.documentId} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5 font-medium text-foreground">{t.name}</td>
                <td className="px-2 py-1.5 text-right text-muted">
                  {t.coverage.asked + t.coverage.reworded} of {t.coverage.scored}
                </td>
                <td className="px-2 py-1.5 text-right text-muted">{t.coverage.notAsked}</td>
                <td className="px-2 py-1.5 text-right text-muted">
                  {t.coverage.unscripted.length} of {t.coverage.moderatorQuestions}
                </td>
                <td className="px-2 py-1.5 text-right text-muted">
                  {t.coverage.inOrder === null ? "n/a" : `${Math.round(t.coverage.inOrder * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {neverAsked.length > 0 && (
        <div>
          <p className="font-medium text-foreground">Guide items no session raised ({neverAsked.length})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
            {neverAsked.slice(0, 12).map((p) => (
              <li key={p.itemId}>{byItem.get(p.itemId)?.text}</li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary className="cursor-pointer select-none font-medium text-muted">Each guide item by session</summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-left">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-2 py-1.5">Guide item</th>
                {report.transcripts.map((t) => (
                  <th key={t.documentId} className="max-w-[8rem] truncate px-2 py-1.5">{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.items.map((i) => (
                <tr key={i.id} className="border-b border-border align-top last:border-0">
                  <td className="px-2 py-1.5 text-muted">{i.text}</td>
                  {report.transcripts.map((t) => {
                    const c = t.coverage.items.find((x) => x.itemId === i.id);
                    return (
                      <td key={t.documentId} className={`px-2 py-1.5 ${c?.status === "not_asked" ? "text-amber-700" : "text-muted"}`}>
                        {c ? statusText[c.status] : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

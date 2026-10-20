"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  chooseInstrumentLinkAction,
  confirmLinksAction,
  guideCoverageAction,
  loadInstrumentReviewAction,
  readInstrumentAction,
  setInstrumentTargetAction,
  listLinkableVariablesAction,
  setLinkStatusAction,
} from "@/lib/instrumentActions";
import type { InstrumentItem, InstrumentLink, InstrumentSummary } from "@/lib/instruments";
import type { GuideReport } from "@/lib/guides";
import { useInstrumentAutoStart } from "./useInstrumentAutoStart";

type DataDoc = { id: string; name: string };

const methodLabel: Record<InstrumentLink["method"], string> = {
  code: "Same code",
  stem: "Code stem",
  wording: "Wording",
  manual: "Chosen by you",
};

const btn =
  "rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-slate-50 disabled:opacity-50";
// The per-link Confirm and Reject: small and on one line beside the variable.
const linkBtn =
  "whitespace-nowrap rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-slate-50 disabled:opacity-50";
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
  const [ownPending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(fixedTarget ?? summary.forDocumentId ?? dataDocs[0]?.id ?? "");
  const [review, setReview] = useState<{ items: InstrumentItem[]; links: InstrumentLink[] } | null>(null);
  const [report, setReport] = useState<GuideReport | null>(null);
  const [filter, setFilter] = useState<"suggested" | "unmatched" | "confirmed" | "all">("suggested");
  // Choosing a variable by hand (Grant, 2026-10-20): the question whose picker is open, and the data
  // file's variables, loaded once per data file when a picker first opens.
  const [choosing, setChoosing] = useState<string | null>(null);
  const [variables, setVariables] = useState<{ forTarget: string; list: { name: string; label: string }[] } | null>(null);
  const [variablesError, setVariablesError] = useState<string | null>(null);

  async function openPicker(itemId: string) {
    setChoosing(itemId);
    setVariablesError(null);
    if (variables?.forTarget === target) return;
    const r = await listLinkableVariablesAction(runId, target);
    if (r.ok) setVariables({ forTarget: target, list: r.variables });
    else setVariablesError(r.error);
  }

  const isGuide = summary.type === "interview_guide" || summary.type === "focus_group_guide";
  const read = summary.items > 0;

  // Read, then match (questionnaires), once, without a click: the same rule the one-line entry in a
  // data file's pane uses. Guide coverage below runs by itself once the guide is read.
  const auto = useInstrumentAutoStart({ runId, documentId, summary, isGuide, target, enabled: !!autoStart });
  const pending = ownPending || auto.running;
  const shownError = error ?? auto.error;
  const shownMessage = message ?? auto.message;
  const coverageRan = useRef(false);

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
  // Variables already confirmed for a question of this data file, with that question's code: they
  // cannot be chosen for another one (chooseInstrumentLink refuses it too).
  const itemCode = new Map((review?.items ?? []).map((i) => [i.id, i.code ?? i.text.slice(0, 30)]));
  const takenBy = new Map(
    (review?.links ?? []).filter((l) => l.status === "confirmed" && l.dataDocumentId === target).map((l) => [l.variable, { itemId: l.itemId, code: itemCode.get(l.itemId) ?? "" }]),
  );
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
            {auto.running
              ? "Reading now. This can take a minute and runs by itself."
              : summary.readFailure && !shownError
              ? `The last read failed: ${summary.readFailure} Read it again to try once more.`
              : isGuide
              ? "Read the guide to list its questions and probes. They will be matched to the questions asked in your transcripts."
              : "Read the questionnaire to list its questions, answer options and skip instructions. They are then matched to your data file's variables."}
          </p>
          <button
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              run(
                () => readInstrumentAction(runId, documentId),
                (r) => {
                  if (r.complete) return `Read ${r.items} items.`;
                  const failedChunks = Number(r.failedChunks ?? 0);
                  const incompleteItems = Number(r.incompleteItems ?? 0);
                  // IMP-012: an incomplete read used to always be reported as a chunk count,
                  // but a chunk can read back fine while a specific item in it was individually
                  // unusable or had its option list cut off - that read is just as incomplete,
                  // with failedChunks sitting at 0, which used to print as "0 parts of the
                  // document could not be read" and read as nothing having gone wrong at all.
                  const reason =
                    failedChunks > 0
                      ? `${failedChunks} part${failedChunks === 1 ? "" : "s"} of the document could not be read`
                      : `${incompleteItems} item${incompleteItems === 1 ? "" : "s"} came back incomplete (an unreadable question or a cut-off list of answer options)`;
                  return `Read ${r.items} items, but ${reason}. Existing items were kept rather than removed; read again to try to fill in the rest.`;
                },
              )
            }
          >
            {pending ? "Reading, this can take a minute..." : isGuide ? "Read guide" : "Read questionnaire"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={summary.items} label={isGuide ? "Questions and probes" : "Items read"} />
          {!isGuide && <Stat value={`${summary.withRouting} of ${summary.statedRoutingText}`} label={summary.fromJumps > 0 ? `Skip instructions understood (+${summary.fromJumps} from GO TO jumps)` : "Skip instructions understood"} />}
          {!isGuide && <Stat value={summary.links.confirmed} label="Links confirmed" />}
          {!isGuide && (
            <Stat
              value={summary.itemsToCheck}
              label={`Questions to check (${summary.links.suggested.toLocaleString("en-GB")} ${summary.links.suggested === 1 ? "link" : "links"}; a grid question can have many)`}
            />
          )}
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

      {read && (
        <button className={btn} disabled={pending} onClick={() => run(
          () => readInstrumentAction(runId, documentId),
          r => r.complete
            ? `Read ${r.items} items.`
            : `Read incomplete: ${r.failedChunks ?? 0} unread parts and ${r.incompleteItems ?? 0} incomplete items. Previously confirmed links were preserved.`,
        )}>
          {pending ? "Reading..." : "Read again"}
        </button>
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

      {summary.readStatus?.complete === false && (
        <p role="status" className="text-amber-800">The last read was incomplete: {summary.readStatus.failedChunks} unread parts and {summary.readStatus.incompleteItems} incomplete items. Previously confirmed links were preserved. Read again to retry.</p>
      )}
      {read && !summary.readStatus && (
        <p role="status" className="text-amber-800">Reading coverage is unknown for these saved items. Read again to establish complete coverage; confirmed links are preserved.</p>
      )}
      {shownMessage && <p className="text-foreground">{shownMessage}</p>}
      {shownError && <p className="text-danger">{shownError}</p>}

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
            {/* Fixed columns (Grant, 2026-10-20: the buttons were squeezed into a narrow last column and
                stacked): the links column is wide enough for a variable, its method and both buttons on
                one line, and the question wraps instead. */}
            <table className="w-full min-w-[640px] table-fixed text-left">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="w-16 px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Question</th>
                  <th className="w-[22rem] px-2 py-1.5">Linked variable</th>
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
                    <td className="px-2 py-1.5" data-testid="item-links" data-item-code={i.code ?? ""}>
                      {(linksByItem.get(i.id) ?? []).length === 0 ? (
                        <span className="text-muted">No match</span>
                      ) : (
                        (linksByItem.get(i.id) ?? []).slice(0, 6).map((l) => (
                          <div key={l.id} className="mb-1 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <span className={`block truncate ${l.status === "rejected" ? "text-muted line-through" : "font-medium text-foreground"}`} title={l.variable}>
                                {l.variable}
                              </span>
                              <span className="block whitespace-nowrap text-[10px] text-muted">
                                {`${methodLabel[l.method]}${l.method === "manual" ? "" : `, ${Math.round(l.confidence * 100)}%`}`}
                                {l.status === "confirmed" && <span className="ml-1 text-success">· Confirmed</span>}
                                {l.status === "rejected" && <span className="ml-1">· Rejected</span>}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {l.status !== "confirmed" && (
                                <button className={linkBtn} disabled={pending} onClick={() => run(() => setLinkStatusAction(runId, l.id, "confirmed"))}>Confirm</button>
                              )}
                              {l.status !== "rejected" && (
                                <button className={linkBtn} disabled={pending} onClick={() => run(() => setLinkStatusAction(runId, l.id, "rejected"))}>Reject</button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      {!isGuide && target && choosing !== i.id && (
                        <button className="mt-0.5 text-[11px] font-medium text-primary hover:underline disabled:opacity-50" disabled={pending} onClick={() => void openPicker(i.id)}>
                          {(linksByItem.get(i.id) ?? []).length === 0 ? "Choose variable" : "Choose another"}
                        </button>
                      )}
                      {choosing === i.id && (
                        <VariablePicker
                          variables={variables?.forTarget === target ? variables.list : null}
                          error={variablesError}
                          taken={takenBy}
                          itemId={i.id}
                          disabled={pending}
                          onCancel={() => setChoosing(null)}
                          onChoose={(name) =>
                            run(
                              async () => {
                                const r = await chooseInstrumentLinkAction(runId, documentId, i.id, target, name);
                                if (r.ok) setChoosing(null);
                                return r;
                              },
                              () => `Linked ${i.code ?? "the question"} to ${name}, confirmed as chosen by you.`,
                            )
                          }
                        />
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

/** A search over the data file's variables, by name or label; one already confirmed elsewhere is shown, not offered. */
function VariablePicker({
  variables,
  error,
  taken,
  itemId,
  disabled,
  onChoose,
  onCancel,
}: {
  variables: { name: string; label: string }[] | null;
  error: string | null;
  taken: Map<string, { itemId: string; code: string }>;
  itemId: string;
  disabled: boolean;
  onChoose: (name: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matches = (variables ?? []).filter((v) => needle === "" || v.name.toLowerCase().includes(needle) || v.label.toLowerCase().includes(needle));
  return (
    <div className="mt-1 space-y-1.5 rounded-lg border border-primary/30 bg-slate-50 p-2" data-testid="variable-picker">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          aria-label="Search the data file's variables"
          placeholder="Variable name or label"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-[11px]"
        />
        <button className={btn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {!error && !variables && <p className="text-muted">Loading the data file&apos;s variables...</p>}
      {variables && (
        <ul className="max-h-48 space-y-0.5 overflow-auto">
          {matches.slice(0, 12).map((v) => {
            const t = taken.get(v.name);
            const elsewhere = t && t.itemId !== itemId;
            return (
              <li key={v.name}>
                <button
                  type="button"
                  disabled={disabled || !!elsewhere}
                  onClick={() => onChoose(v.name)}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-foreground">{v.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{v.label}</span>
                  {elsewhere && <span className="shrink-0 text-[10px] text-muted">{`confirmed for ${t.code}`}</span>}
                </button>
              </li>
            );
          })}
          {matches.length === 0 && <li className="text-muted">No variable matches that.</li>}
          {matches.length > 12 && <li className="text-[10px] text-muted">{`Showing 12 of ${matches.length}. Type more to narrow it.`}</li>}
        </ul>
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

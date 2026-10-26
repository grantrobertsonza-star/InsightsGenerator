"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLabelDocumentationAction } from "@/lib/instrumentActions";
import type { LabelDocumentation, LabelOrigin } from "@/lib/labelDocumentation";

const ORIGIN: Record<LabelOrigin, string> = { data_file: "Data file", codebook: "Codebook", questionnaire: "Questionnaire", other: "Linked document" };
const FILTERS = [
  { id: "all", label: "All variables" },
  { id: "undocumented", label: "Not documented" },
  { id: "conflict", label: "Labels disagree" },
  { id: "codebook_only", label: "Codebook only" },
  { id: "questionnaire_only", label: "Questionnaire only" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];
const ROWS_SHOWN = 300;

/**
 * Labels and documentation for one raw data file (LBL-01, Grant, 26 October 2026): its own labels,
 * its codebook and its questionnaire side by side, where each applied label comes from, and where a
 * codebook and a questionnaire disagree. Read when the tab first comes into view and again on
 * Refresh (after confirming links below). A response for an earlier request is dropped, so a late
 * answer never replaces a newer one.
 */
export default function LabelDocumentationPanel({ runId, documentId }: { runId: string; documentId: string }) {
  const [doc, setDoc] = useState<LabelDocumentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(0);

  const load = useCallback(() => {
    const token = ++latest.current;
    setLoading(true);
    setError(null);
    void loadLabelDocumentationAction(runId, documentId)
      .then((r) => {
        if (token !== latest.current) return;
        if (r.ok) setDoc(r.documentation);
        else setError(r.error);
      })
      .catch((e: unknown) => {
        if (token === latest.current) setError(e instanceof Error ? e.message : "The labels could not be loaded.");
      })
      .finally(() => {
        if (token === latest.current) setLoading(false);
      });
  }, [runId, documentId]);

  useEffect(() => {
    if (!root.current) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(load, 0);
      return () => clearTimeout(t);
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        load();
        watch.disconnect();
      }
    });
    watch.observe(root.current);
    return () => {
      watch.disconnect();
      latest.current += 1;
    };
  }, [load]);

  const rows = useMemo(() => {
    if (!doc) return [];
    const needle = search.trim().toLowerCase();
    return doc.variables.filter((v) => {
      const documented = !!(v.fileLabel || v.codebook || v.questionnaire);
      const keep =
        filter === "all" ||
        (filter === "undocumented" && !documented) ||
        (filter === "conflict" && v.conflict) ||
        (filter === "codebook_only" && !!v.codebook && !v.questionnaire) ||
        (filter === "questionnaire_only" && !!v.questionnaire && !v.codebook);
      if (!keep) return false;
      if (!needle) return true;
      return [v.name, v.fileLabel, v.codebook?.text, v.questionnaire?.text].some((t) => t?.toLowerCase().includes(needle));
    });
  }, [doc, filter, search]);

  return (
    <div ref={root} className="space-y-3 rounded-xl border border-border bg-white p-4" data-testid="label-documentation">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Labels and documentation</h3>
          <p className="mt-1 max-w-3xl text-xs text-muted">
            Each variable beside its codebook entry and questionnaire question. Tables use the data file&apos;s own
            labels first, then the codebook&apos;s, then the questionnaire&apos;s. Where a codebook and a questionnaire
            give different answer labels, the codebook&apos;s are used and the difference is listed here. Only
            confirmed links count; confirm them below.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface disabled:opacity-60">
          {loading ? "Reading..." : "Refresh"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          The labels could not be read: {error}{" "}
          <button type="button" className="underline" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {loading && !doc && <p className="text-xs text-muted">Reading the file and its documents...</p>}
      {doc && (
        <div className="space-y-3 text-xs text-foreground">
          <div className="grid grid-cols-2 gap-2 @lg:grid-cols-5">
            <Tile value={doc.coverage.variables} label="Variables" />
            <Tile value={doc.coverage.documented} label="Documented" />
            <Tile value={doc.coverage.byCodebook} label="In the codebook" />
            <Tile value={doc.coverage.byQuestionnaire} label="In the questionnaire" />
            <Tile value={doc.coverage.undocumented} label="Not documented" testId="ld-undocumented" />
          </div>

          {doc.documents.length === 0 ? (
            <p className="text-muted">No codebook or questionnaire is linked to this file. Add one with Add files; its entries are matched to these variables by name.</p>
          ) : (
            <ul className="space-y-0.5 text-muted" data-testid="ld-documents">
              {doc.documents.map((d) => (
                <li key={d.id}>
                  <span className="font-medium text-foreground">{d.type === "codebook" ? "Codebook" : "Questionnaire"}:</span> {d.filename}, {d.entries} {d.entries === 1 ? "entry" : "entries"},{" "}
                  {d.confirmed} {d.confirmed === 1 ? "variable" : "variables"} confirmed
                </li>
              ))}
            </ul>
          )}

          {doc.conflicts.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="ld-conflicts">
              <h4 className="font-semibold">Answer labels that disagree ({doc.conflicts.length})</h4>
              <ul className="mt-1 space-y-1">
                {doc.conflicts.map((c) => (
                  <li key={`${c.variable}-${c.other.filename}`}>
                    <span className="font-medium">{c.variable}</span>: used from {c.applied.filename} ({labelList(c.applied.labels)}); {c.other.filename} gives{" "}
                    {labelList(c.other.labels)}.
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-md border border-border px-2 py-1">
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input aria-label="Search variables" placeholder="Search names and wording" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 rounded-md border border-border px-2 py-1" />
            <span className="text-muted">
              {rows.length} of {doc.variables.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left" data-testid="ld-table">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2 font-medium">Variable</th>
                  <th className="py-1 pr-2 font-medium">Data file label</th>
                  <th className="py-1 pr-2 font-medium">Codebook</th>
                  <th className="py-1 pr-2 font-medium">Questionnaire</th>
                  <th className="py-1 font-medium">Labels used from</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, ROWS_SHOWN).map((v) => (
                  <tr key={v.name} className="border-b border-border/60 align-top" data-variable={v.name}>
                    <td className="py-1 pr-2 font-mono">
                      {v.name}
                      {v.conflict && <span className="ml-1 rounded bg-amber-50 px-1 font-sans text-[11px] text-amber-800">disagree</span>}
                    </td>
                    <td className="py-1 pr-2">{v.fileLabel ?? <span className="text-muted">None</span>}</td>
                    <td className="py-1 pr-2">{v.codebook ? entry(v.codebook) : <span className="text-muted">Not linked</span>}</td>
                    <td className="py-1 pr-2">{v.questionnaire ? entry(v.questionnaire) : <span className="text-muted">Not linked</span>}</td>
                    <td className="py-1">
                      {v.labelFrom || v.answerLabelsFrom || v.answerLabelsNote ? (
                        <>
                          {v.labelFrom && <div>Label: {ORIGIN[v.labelFrom]}</div>}
                          {v.answerLabelsFrom && <div>Answers: {ORIGIN[v.answerLabelsFrom]}</div>}
                          {v.answerLabelsNote && <div className="text-amber-800" data-testid="answer-labels-note">{v.answerLabelsNote}</div>}
                        </>
                      ) : (
                        <span className="text-muted">Name only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > ROWS_SHOWN && <p className="mt-1 text-muted">Showing the first {ROWS_SHOWN}. Search or filter to find the rest.</p>}
          </div>

          {doc.entriesWithoutColumnTotal > 0 && (
            <details className="rounded-lg border border-border p-3" data-testid="ld-unmatched">
              <summary className="cursor-pointer font-semibold">Codebook entries with no confirmed column ({doc.entriesWithoutColumnTotal})</summary>
              <p className="mt-1 text-muted">
                Entries a waiting suggestion may still match, or that match no variable in this file (a variable dropped
                from the release, or named differently).
              </p>
              <ul className="mt-1 space-y-0.5">
                {doc.entriesWithoutColumn.map((e, i) => (
                  <li key={`${e.documentId}-${e.code ?? ""}-${i}`}>
                    <span className="font-mono">{e.code ?? "(no name)"}</span> {e.text}{" "}
                    <span className="text-muted">{e.state === "suggested" ? "(suggested, to confirm)" : "(no match found)"}</span>
                  </li>
                ))}
              </ul>
              {doc.entriesWithoutColumnTotal > doc.entriesWithoutColumn.length && <p className="mt-1 text-muted">Showing the first {doc.entriesWithoutColumn.length}.</p>}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function entry(e: { code: string | null; text: string; answers: number }) {
  return (
    <>
      {e.code && <span className="font-mono">{e.code}. </span>}
      {e.text}
      {e.answers > 0 && <span className="text-muted"> ({e.answers} answer labels)</span>}
    </>
  );
}

function labelList(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([code, label]) => `${code} = ${label}`)
    .join(", ");
}

function Tile({ value, label, testId }: { value: number; label: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2" data-testid={testId}>
      <div className="text-lg font-semibold text-foreground">{value.toLocaleString("en-ZA")}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import {
  checkOutputSetAction,
  deleteOutputFileAction,
  deleteOutputSetAction,
  generateOutputFindingsAction,
  saveOutputSetAction,
} from "@/lib/outputSetActions";
import type { StoredChecks } from "@/lib/outputAnalysisRun";
import { KIND_LABEL, ROLE_LABEL, roleCounts, type OutputRole } from "@/lib/outputClassify";
import type { OutputFile, OutputSet } from "@/lib/outputSets";

const roleClass: Record<OutputRole, string> = {
  evidence: "bg-blue-50 text-blue-700",
  assurance: "bg-emerald-50 text-emerald-700",
  provenance: "bg-slate-100 text-slate-600",
  unclassified: "bg-amber-50 text-amber-700",
};

const checkClass: Record<"pass" | "flag" | "info", { dot: string; label: string }> = {
  pass: { dot: "bg-emerald-500", label: "Passed" },
  flag: { dot: "bg-amber-500", label: "Look at this" },
  info: { dot: "bg-slate-400", label: "For information" },
};

const input = "rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground";

function FileRow({ runId, file, onError }: { runId: string; file: OutputFile; onError: (m: string) => void }) {
  const [pending, start] = useTransition();
  const size = file.sheets > 1 ? `${file.sheets} sheets` : file.rows > 0 || file.cols > 0 ? `${file.rows.toLocaleString()} rows, ${file.cols} columns` : file.textLength > 0 ? `${file.textLength.toLocaleString()} characters` : "";
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground" title={file.path}>{file.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${roleClass[file.role]}`}>{ROLE_LABEL[file.role]}</span>
          <span title={file.signals.join("; ")}>{KIND_LABEL[file.kind]}{file.confidence === "low" ? ", unsure" : ""}</span>
          {size && <span>{size}</span>}
        </p>
        {file.headers.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-muted" title={file.headers.join(", ")}>{file.headers.join(", ")}</p>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-danger hover:text-danger disabled:opacity-50"
        onClick={() => {
          if (!confirm(`Remove ${file.name} from this set?`)) return;
          start(async () => {
            const r = await deleteOutputFileAction(runId, file.id);
            if (!r.ok) onError(r.error);
          });
        }}
      >
        Remove
      </button>
    </li>
  );
}

/**
 * A set of statistical output files from one study: models, cluster results,
 * diagnostics, run logs. Rolled up by default, grouped by family.
 */
export default function OutputSetCard({ runId, set }: { runId: string; set: OutputSet }) {
  const [name, setName] = useState(set.name);
  const [wave, setWave] = useState(set.waveLabel ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [checks, setChecks] = useState<StoredChecks | null>(set.checks);
  const [busy, setBusy] = useState<"check" | "findings" | null>(null);
  const [made, setMade] = useState<number | null>(null);
  const counts = roleCounts(set.files);

  function run(kind: "check" | "findings") {
    setBusy(kind);
    setError(null);
    const call = kind === "check" ? checkOutputSetAction(runId, set.id) : generateOutputFindingsAction(runId, set.id);
    call
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setChecks(r.checks);
        if (kind === "findings") setMade(r.checks.findings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  const families = new Map<string, OutputFile[]>();
  for (const f of set.files) families.set(f.family, [...(families.get(f.family) ?? []), f]);
  const ordered = [...families.entries()].sort((a, b) => (a[0] === "Other files" ? 1 : b[0] === "Other files" ? -1 : a[0].localeCompare(b[0])));

  function save(n: string, w: string) {
    if (n.trim() === set.name && w.trim() === (set.waveLabel ?? "")) return;
    start(async () => {
      const r = await saveOutputSetAction(runId, set.id, n, w);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border border-l-4 border-l-indigo-400 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Set name"
              className={`${input} w-64 font-medium`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => save(name, wave)}
            />
            <input
              aria-label="Wave or study label"
              placeholder="Wave or study label (optional)"
              className={`${input} w-52`}
              value={wave}
              onChange={(e) => setWave(e.target.value)}
              onBlur={() => save(name, wave)}
            />
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">Statistical output</span>
          </div>
          <p className="text-[11px] text-muted">
            {set.files.length} file{set.files.length === 1 ? "" : "s"}: {counts.evidence} evidence, {counts.assurance} assurance, {counts.provenance} context
            {counts.unclassified > 0 ? `, ${counts.unclassified} to check` : ""}.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:border-danger hover:text-danger disabled:opacity-50"
          onClick={() => {
            if (!confirm(`Remove the whole set "${set.name}" and its ${set.files.length} files?`)) return;
            start(async () => {
              const r = await deleteOutputSetAction(runId, set.id);
              if (!r.ok) setError(r.error);
            });
          }}
        >
          Remove set
        </button>
      </div>
      <p className="text-[11px] text-muted">
        Evidence is what findings will be built from. Assurance says how far to trust it (diagnostics, design effects, checks). Context explains how it was
        produced (logs, manifests, survey design, the author&apos;s notes). Files are sorted by what they contain, so the sort is a suggestion to check.
      </p>
      <div className="space-y-2 rounded-lg border border-border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            Checks and findings
            {checks && <span className="ml-2 font-normal text-muted">last checked {new Date(checks.analysedAt).toLocaleString()}</span>}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary disabled:opacity-50"
              onClick={() => run("check")}
            >
              {busy === "check" ? "Checking..." : "Check this set"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              onClick={() => {
                if (checks?.generatedAt && !confirm("This replaces the findings already made from this set. Continue?")) return;
                run("findings");
              }}
            >
              {busy === "findings" ? "Making findings..." : checks?.generatedAt ? "Make findings again" : "Make findings"}
            </button>
          </div>
        </div>
        {!checks && (
          <p className="text-[11px] text-muted">
            Checking compares the files with each other (for example odds ratios against coefficients), reads the diagnostics and robustness files, and
            reads reference categories from the console log. Findings carry those notes with them.
          </p>
        )}
        {made !== null && (
          <p className="text-xs text-emerald-700">
            {made} finding{made === 1 ? "" : "s"} made. They are on the Findings page, each with the assurance notes that apply to it.
          </p>
        )}
        {checks && (
          <ul className="space-y-1.5">
            {checks.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${checkClass[c.status].dot}`} title={checkClass[c.status].label} />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{c.title}.</span> <span className="text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
            {checks.checks.length === 0 && <li className="text-[11px] text-muted">Nothing in this set could be checked yet.</li>}
          </ul>
        )}
        {checks && checks.unread.length > 0 && (
          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer select-none">
              {checks.unread.length} evidence file{checks.unread.length === 1 ? "" : "s"} gave no finding of their own
            </summary>
            <ul className="mt-1 space-y-0.5">
              {checks.unread.map((u) => (
                <li key={u.fileId}>
                  <span className="font-medium text-foreground">{u.fileName}</span>: {u.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <details className="rounded-lg border border-border bg-white p-3">
        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
          Files by family <span className="font-normal text-muted">({ordered.length} group{ordered.length === 1 ? "" : "s"})</span>
        </summary>
        <div className="mt-3 space-y-2">
          {ordered.map(([family, files]) => {
            const c = roleCounts(files);
            return (
              <details key={family} className="rounded-lg border border-border bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-foreground">
                  {family}{" "}
                  <span className="font-normal text-muted">
                    {files.length} file{files.length === 1 ? "" : "s"}
                    {c.unclassified > 0 ? `, ${c.unclassified} to check` : ""}
                  </span>
                </summary>
                <ul className="mt-2">
                  {files.map((f) => (
                    <FileRow key={f.id} runId={runId} file={f} onError={setError} />
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </details>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

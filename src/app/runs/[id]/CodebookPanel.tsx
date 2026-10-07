"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import {
  restoreCodebookVersionAction,
  saveCodeMetaAction,
  suggestThemesAction,
} from "@/lib/codingAnalysisActions";

// Mirrors CodebookEdit in src/lib/extractThemes.ts. Not imported from there:
// that file pulls in server-only code this client component must not bundle.
export type CodebookEditInput = {
  id: string | null;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
};

export type CodebookCode = {
  id: string;
  name: string;
  definition: string;
  inclusion_criteria: string;
  exclusion_criteria: string;
  reproduced_runs: number | null;
  total_runs: number | null;
  turns: number;
  speakers: number;
  // Added from migration 0055; empty strings until the researcher fills them.
  theme: string;
  note: string;
  keywords: string;
};

export type CodebookView = {
  runId: string;
  documentId: string;
  version: number;
  source: "induced" | "edited" | "imported";
  createdAt: string;
  codes: CodebookCode[];
  participantTurns: number;
  codedTurns: number;
  // Every version, newest first, so an earlier one can be viewed and restored.
  versions: {
    id: string;
    version: number;
    source: "induced" | "edited" | "imported";
    createdAt: string;
    codes: { name: string; definition: string }[];
  }[];
  // Open coding passes, summed. Null when this transcript's passes were
  // recorded before the manifest existed or could not be found.
  passes: {
    count: number;
    themesReturned: number;
    themesKept: number;
    quotesExact: number;
    quotesNear: number;
    quotesNone: number;
    quotesModerator: number;
    inputTruncated: boolean;
    droppedThemes: {
      pass: number;
      theme: string;
      quote: string;
      reason: string;
    }[];
  } | null;
};

type Draft = {
  key: string;
  id: string | null;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  reproduced_runs: number | null;
  total_runs: number | null;
  turns: number | null;
  speakers: number | null;
  theme: string;
  note: string;
  keywords: string;
};

// Boxes grow to fit what is written in them instead of scrolling.
const autoGrow = { fieldSizing: "content" } as CSSProperties;

const inputClass =
  "w-full rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass =
  "mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted";

function reproductionBadge(run: number | null, total: number | null) {
  if (run === null || total === null || total === 0) return null;
  const tone =
    run === total
      ? "bg-success-light text-success"
      : run / total >= 0.67
        ? "bg-slate-100 text-slate-600"
        : "bg-amber-50 text-amber-700";
  return (
    <span
      title={`The open coding was run ${total} times over this transcript. This theme was found in ${run} of them. A theme found in every run is stable; one found once may be an artefact of a single pass.`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone}`}
    >
      Found in {run} of {total} passes
    </span>
  );
}

/**
 * The codebook behind a coded transcript. It shows what the open coding
 * passes produced and how often each theme turned up, lets a researcher
 * rewrite the definitions and criteria, and re-applies the edited codebook to
 * every participant turn as a new version. Re-applying replaces this
 * transcript's coded findings, and one model call is made per batch of turns.
 */
export default function CodebookPanel({
  codebook,
  reapply,
}: {
  codebook: CodebookView;
  reapply: (
    documentId: string,
    codes: CodebookEditInput[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const initial: Draft[] = codebook.codes.map((c) => ({
    key: c.id,
    id: c.id,
    name: c.name,
    definition: c.definition,
    inclusion: c.inclusion_criteria,
    exclusion: c.exclusion_criteria,
    reproduced_runs: c.reproduced_runs,
    total_runs: c.total_runs,
    turns: c.turns,
    speakers: c.speakers,
    theme: c.theme ?? "",
    note: c.note ?? "",
    keywords: c.keywords ?? "",
  }));
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [viewVersion, setViewVersion] = useState<string>("");
  const shown = codebook.versions.find((v) => v.id === viewVersion) ?? null;
  const oldest = codebook.versions[codebook.versions.length - 1];

  function restore(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await restoreCodebookVersionAction(
        codebook.runId,
        codebook.documentId,
        id,
      );
      if (!r.ok) setError(r.error);
    });
  }

  const changed =
    drafts.length !== initial.length ||
    drafts.some((d, i) => {
      const o = initial[i];
      return (
        !o ||
        d.id !== o.id ||
        d.name !== o.name ||
        d.definition !== o.definition ||
        d.inclusion !== o.inclusion ||
        d.exclusion !== o.exclusion
      );
    });
  const metaChanged = drafts.some((d) => {
    const o = initial.find((x) => x.id === d.id);
    return (
      !o ||
      d.name !== o.name ||
      d.theme !== o.theme ||
      d.note !== o.note ||
      d.keywords !== o.keywords
    );
  });
  const themeNames = [
    ...new Set(drafts.map((d) => d.theme.trim()).filter(Boolean)),
  ];
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Saving changes the panel's key, which remounts it. Keep it open and keep
  // the confirmation message across that remount.
  const reopenKey = `codebook-reopen-${codebook.documentId}`;
  useEffect(() => {
    try {
      const m = window.sessionStorage.getItem(reopenKey);
      if (m) {
        window.sessionStorage.removeItem(reopenKey);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOpen(true);
        setSaved(m);
      }
    } catch {
      /* storage unavailable */
    }
  }, [reopenKey]);
  function rememberReopen(message: string) {
    try {
      window.sessionStorage.setItem(reopenKey, message);
    } catch {
      /* storage unavailable */
    }
  }
  function forgetReopen() {
    try {
      window.sessionStorage.removeItem(reopenKey);
    } catch {
      /* storage unavailable */
    }
  }
  function saveMeta() {
    setError(null);
    setSaved(null);
    rememberReopen("Saved");
    startTransition(async () => {
      const r = await saveCodeMetaAction(
        codebook.runId,
        codebook.documentId,
        drafts
          .filter((d) => d.name.trim())
          .map((d) => ({
            name: d.name,
            theme: d.theme,
            note: d.note,
            keywords: d.keywords,
          })),
      );
      if (!r.ok) {
        forgetReopen();
        setError(r.error);
      } else setSaved("Saved");
    });
  }
  function suggest() {
    setError(null);
    setSaved(null);
    rememberReopen("Themes suggested. Check the Theme box on each code below.");
    startTransition(async () => {
      const r = await suggestThemesAction(codebook.runId, codebook.documentId);
      if (!r.ok) {
        forgetReopen();
        setError(r.error);
      } else setSaved(r.message ?? "Themes suggested");
    });
  }
  const valid =
    drafts.length > 0 &&
    drafts.every((d) => d.name.trim() && d.definition.trim());

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((list) =>
      list.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await reapply(
        codebook.documentId,
        drafts.map((d) => ({
          id: d.id,
          name: d.name,
          definition: d.definition,
          inclusion: d.inclusion,
          exclusion: d.exclusion,
        })),
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Themes, notes and keywords follow the codes by name; save them for
      // any code that was renamed or added in this edit.
      const r = await saveCodeMetaAction(
        codebook.runId,
        codebook.documentId,
        drafts
          .filter((d) => d.name.trim())
          .map((d) => ({
            name: d.name,
            theme: d.theme,
            note: d.note,
            keywords: d.keywords,
          })),
      );
      if (!r.ok) setError(r.error);
    });
  }

  const p = codebook.passes;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-lg border border-border bg-slate-50 p-2 text-xs"
    >
      <summary className="cursor-pointer select-none font-medium text-muted">
        Codebook, version {codebook.version}
        {codebook.source === "edited"
          ? " (edited)"
          : codebook.source === "imported"
            ? " (your coding, imported)"
            : ""} &middot;{" "}
        {codebook.codes.length} code
        {codebook.codes.length === 1 ? "" : "s"}
        {themeNames.length > 0
          ? ` in ${themeNames.length} theme${themeNames.length === 1 ? "" : "s"}`
          : ""}
      </summary>

      <div className="mt-3 space-y-3">
        <div className="space-y-1 text-[11px] text-muted">
          {p && (
            <p>
              Open coding ran {p.count} time{p.count === 1 ? "" : "s"} and
              proposed {p.themesReturned} theme
              {p.themesReturned === 1 ? "" : "s"}. {p.quotesExact} quote
              {p.quotesExact === 1 ? " was" : "s were"} verbatim from a
              participant
              {p.quotesNear > 0
                ? `, ${p.quotesNear} close but not verbatim`
                : ""}
              {p.quotesNone > 0
                ? `, ${p.quotesNone} not found in the transcript`
                : ""}
              {p.quotesModerator > 0
                ? `, ${p.quotesModerator} taken from the moderator`
                : ""}
              .{" "}
              {p.themesReturned - p.themesKept > 0
                ? `${p.themesReturned - p.themesKept} theme${p.themesReturned - p.themesKept === 1 ? "" : "s"} without a verbatim participant quote ${p.themesReturned - p.themesKept === 1 ? "was" : "were"} dropped before merging.`
                : "No theme was dropped."}
            </p>
          )}
          {p && p.droppedThemes.length > 0 && (
            <details className="rounded border border-border bg-white p-2">
              <summary className="cursor-pointer font-medium text-foreground">
                Dropped themes ({p.droppedThemes.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {p.droppedThemes.map((d, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">
                      {d.theme}
                    </span>{" "}
                    (pass {d.pass}): {d.reason}.
                    <br />
                    <span className="italic">Model&apos;s quote: {d.quote}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p>
            The codebook was applied to the whole transcript:{" "}
            {codebook.codedTurns} of {codebook.participantTurns} participant
            turns carry at least one code. A code needs at least two turns to
            become a finding.
          </p>
          {p?.inputTruncated && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800">
              This transcript is longer than the open coding passes could read,
              so the themes were drawn from its opening stretch. The codebook
              was still applied to all of it.
            </p>
          )}
        </div>

        <datalist id={`themes-${codebook.documentId}`}>
          {themeNames.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div
              key={d.key}
              className="space-y-2 rounded-lg border border-border bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {reproductionBadge(d.reproduced_runs, d.total_runs)}
                  {d.turns !== null && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {d.turns} turn{d.turns === 1 ? "" : "s"}
                      {d.speakers
                        ? ` · ${d.speakers} speaker${d.speakers === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  )}
                  {d.turns !== null && d.turns < 2 && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      Too thin for a finding
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    setDrafts((list) => list.filter((x) => x.key !== d.key))
                  }
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-danger-light hover:text-danger"
                >
                  Remove code
                </button>
              </div>
              <div>
                <label className={labelClass}>Name</label>
                <input
                  value={d.name}
                  disabled={isPending}
                  onChange={(e) => update(d.key, { name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Definition</label>
                <textarea
                  rows={2}
                  style={autoGrow}
                  value={d.definition}
                  disabled={isPending}
                  onChange={(e) =>
                    update(d.key, { definition: e.target.value })
                  }
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Code when</label>
                  <textarea
                    rows={2}
                  style={autoGrow}
                    value={d.inclusion}
                    disabled={isPending}
                    onChange={(e) =>
                      update(d.key, { inclusion: e.target.value })
                    }
                    className={`${inputClass} resize-none`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Do not code when</label>
                  <textarea
                    rows={2}
                  style={autoGrow}
                    value={d.exclusion}
                    disabled={isPending}
                    onChange={(e) =>
                      update(d.key, { exclusion: e.target.value })
                    }
                    className={`${inputClass} resize-none`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    Theme this code sits under (optional)
                  </label>
                  <input
                    list={`themes-${codebook.documentId}`}
                    value={d.theme}
                    disabled={isPending}
                    onChange={(e) => update(d.key, { theme: e.target.value })}
                    placeholder="Leave empty if this code is a theme on its own"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    Keywords to count (optional)
                  </label>
                  <input
                    value={d.keywords}
                    disabled={isPending}
                    onChange={(e) =>
                      update(d.key, { keywords: e.target.value })
                    }
                    placeholder='e.g. "team", "colleague"'
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Your note on this code</label>
                <textarea
                  rows={2}
                  style={autoGrow}
                  value={d.note}
                  disabled={isPending}
                  onChange={(e) => update(d.key, { note: e.target.value })}
                  className={`${inputClass} resize-none`}
                />
              </div>
              <span className="sr-only">Code {i + 1}</span>
            </div>
          ))}
        </div>

        {codebook.versions.length > 1 && (
          <div className="space-y-2 rounded-lg border border-border bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium" htmlFor="codebook-version">
                Codebook versions
              </label>
              <select
                id="codebook-version"
                value={viewVersion}
                onChange={(e) => setViewVersion(e.target.value)}
                className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
              >
                <option value="">
                  Current (version {codebook.version})
                </option>
                {codebook.versions.slice(1).map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version}
                    {v === oldest ? " (original)" : ""} -{" "}
                    {new Date(v.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
              {shown && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => restore(shown.id)}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition hover:border-slate-400 disabled:opacity-50"
                >
                  {isPending ? "Restoring..." : "Restore this version"}
                </button>
              )}
            </div>
            {shown ? (
              <div className="space-y-1.5 text-xs">
                <p className="text-muted">
                  Read only. Restoring makes a new version with these themes and
                  their coding. Findings are not regenerated until you save and
                  re-apply.
                </p>
                <ul className="space-y-1">
                  {shown.codes.map((c) => (
                    <li key={c.name}>
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted"> - {c.definition}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] text-muted">
                Pick an earlier version to look at it or bring it back. Nothing
                is lost when you save a new version.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              setDrafts((list) => [
                ...list,
                {
                  key: `new-${Date.now()}-${list.length}`,
                  id: null,
                  name: "",
                  definition: "",
                  inclusion: "",
                  exclusion: "",
                  reproduced_runs: null,
                  total_runs: null,
                  turns: null,
                  speakers: null,
                  theme: "",
                  note: "",
                  keywords: "",
                },
              ])
            }
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-slate-400 hover:text-foreground"
          >
            Add a code
          </button>
          <button
            type="button"
            disabled={isPending || !changed || !valid}
            onClick={save}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-50"
          >
            {isPending ? "Applying..." : "Save as new version and re-apply"}
          </button>
          <span className="text-[11px] text-muted">
            Replaces this transcript&apos;s coded findings. The previous version
            is kept.
          </span>
          <button
            type="button"
            disabled={isPending || changed || drafts.length < 4}
            onClick={suggest}
            title="Asks the model to group these codes under broader themes. This replaces the themes shown here."
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50"
          >
            {isPending ? "Working..." : "Suggest themes"}
          </button>
          <button
            type="button"
            disabled={isPending || changed || !metaChanged}
            onClick={saveMeta}
            title={
              changed
                ? "You have edited names or definitions: use Save as new version, which also saves these."
                : undefined
            }
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save themes, keywords and notes"}
          </button>
          {saved && (
            <span className="text-[11px] text-success">{saved}</span>
          )}
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-3 py-2 text-danger">
            <span>Couldn&apos;t finish that: {error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

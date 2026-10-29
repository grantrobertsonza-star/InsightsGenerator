"use client";

// D3 (Grant's previews, 28 October 2026): the automatic tracker dashboard for one wave file. Figures come from
// loadBrandOverviewAction (the Cross tab engine, the NPS tool and driver analysis through src/lib); this screen
// formats them and never computes a figure itself.
//
// Every standard tile is always shown (Grant, 29 October 2026): a tile with no question in the file, or with two
// questions claiming it, is blank with "Choose a question", which opens Customise at that choice. Choices (the
// client's brand, weighting, funnel stages, CSM roles) are saved for the whole programme with the scope and
// revision this screen read; "Saved" shows only after the save succeeds, and a conflicting or moved save reloads
// what is stored instead of overwriting it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadBrandOverviewAction, resetTrackerChoicesAction, saveTrackerChoicesAction } from "@/lib/trackerDashboardActions";
import type { BrandOverview } from "@/lib/trackerOverview";
import type { TrackerChoices } from "@/lib/trackerDashboard";
import type { CsmTile, CsmTileId } from "@/lib/trackerCsmFigures";
import type { FunnelStage } from "@/lib/trackerRoles";

const STAGE_LABEL: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  shortlist: "Shortlist",
  first_choice: "First choice",
  trial: "Trial",
  usage: "Usage",
  frequent_usage: "Frequent usage",
};
type CsmRole = "overallSatisfaction" | "recommend0to10" | "likelyToStay" | "likelyToSwitch";
const CSM_TILE: Record<CsmTileId, { title: string; role: CsmRole | "drivers" }> = {
  satisfaction: { title: "Overall satisfaction", role: "overallSatisfaction" },
  recommend: { title: "Net Promoter Score", role: "recommend0to10" },
  stay: { title: "Likely to stay", role: "likelyToStay" },
  switch: { title: "Likely to switch", role: "likelyToSwitch" },
  drivers: { title: "Driver priority", role: "drivers" },
};
const CSM_ROLES: { role: CsmRole; label: string }[] = [
  { role: "overallSatisfaction", label: "Overall satisfaction" },
  { role: "recommend0to10", label: "Likelihood to recommend (0 to 10)" },
  { role: "likelyToStay", label: "Likely to stay" },
  { role: "likelyToSwitch", label: "Likely to switch" },
];

const pct = (v: number | null) => (v === null ? "Not available" : `${v.toFixed(1)}%`);
// A change shown to one decimal: one that rounds to zero is "±0.0", never "−0.0".
const pp = (v: number | null) => {
  if (v === null) return null;
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)} pts`;
};
const NONE = "__none";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; overview: BrandOverview };
type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "message"; tone: "error" | "warn"; text: string };

function BlankTile({ title, text, onChoose, onHide, testId }: { title: string; text: string; onChoose: () => void; onHide: () => void; testId: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-dashed border-slate-300 bg-white/60 p-3" data-testid={testId} data-blank="true">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 flex-1 text-xs text-muted">{text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onChoose} className="rounded border border-border bg-white px-2 py-1 text-[11px] hover:bg-slate-50">
          Choose a question
        </button>
        <button type="button" onClick={onHide} aria-label={`Hide the ${title} tile`} className="rounded px-2 py-1 text-[11px] text-muted hover:bg-slate-100">
          Hide
        </button>
      </div>
    </div>
  );
}

export default function TrackerDashboardPanel({
  runId,
  documentId,
  filename,
  onClose,
  closeLabel = "Close",
}: {
  runId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // null until the researcher picks a tab: a customer satisfaction file opens on that tab, any other on Brand.
  const [tabChoice, setTab] = useState<"brand" | "csm" | null>(null);
  const [comparators, setComparators] = useState<string[] | null>(null);
  const [customising, setCustomising] = useState(false);
  const [draft, setDraft] = useState<TrackerChoices>({});
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  // Only the latest request may update the screen: a slow earlier load (or one for another file) is ignored.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ state: "loading" });
    const r = await loadBrandOverviewAction(runId, documentId);
    if (id !== latest.current) return;
    if (!r.ok) return setLoad({ state: "failed", error: r.error });
    setLoad({ state: "ready", overview: r.overview });
    setDraft(r.overview.view.choices);
  }, [runId, documentId]);

  useEffect(() => {
    // The first load of this file; reload() sets state only after the server answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  const overview = load.state === "ready" ? load.overview : null;
  const dashboard = overview?.view.dashboard ?? null;
  const shown = comparators ?? overview?.suggestedComparators ?? [];
  const brandLabel = useMemo(() => new Map((dashboard?.brands ?? []).map((b) => [b.code, b.label])), [dashboard]);
  const focal = dashboard?.focalBrand ?? null;
  const tab = tabChoice ?? (dashboard?.type === "csm" ? "csm" : "brand");

  /** Opens Customise at one choice (a blank tile's "Choose a question"). */
  function chooseAt(anchor: string) {
    setCustomising(true);
    requestAnimationFrame(() => document.getElementById(`tracker-choice-${anchor}`)?.scrollIntoView({ block: "center" }));
  }

  // An edit in Customise is not saved until Apply: a "Saved" note from an earlier save must not sit beside it.
  const editDraft = (change: (d: TrackerChoices) => TrackerChoices) => {
    setDraft(change);
    setSave({ state: "idle" });
  };

  // A group's stage as it would be saved: the draft's choice when it makes one, else the stage now in effect.
  const stageOfGroup = (group: string): FunnelStage | null => {
    if (draft.stages && Object.prototype.hasOwnProperty.call(draft.stages, group)) return draft.stages[group];
    return overview?.stageCandidates.find((c) => c.group === group)?.stage ?? null;
  };
  function setStage(stage: FunnelStage, group: string) {
    const next = { ...(draft.stages ?? {}) };
    // The stage is now this question's alone: any other question holding it is set to "not a funnel stage".
    for (const c of overview?.stageCandidates ?? []) if (c.group !== group && stageOfGroup(c.group) === stage) next[c.group] = null;
    if (group) next[group] = stage;
    editDraft((d) => ({ ...d, stages: next }));
  }
  const roleValue = (role: CsmRole): string => {
    if (draft.csm && Object.prototype.hasOwnProperty.call(draft.csm, role)) return draft.csm[role] ?? NONE;
    return dashboard?.csm[role].variable ?? NONE;
  };
  const drivers = draft.csm?.drivers ?? dashboard?.csm.drivers.variables ?? [];

  // Hidden tiles (Grant, 29 October 2026: a blank tile can be hidden so the dashboard reads cleanly in a report) are
  // saved at once with the stored choices, not with an unapplied draft, so hiding never applies other edits by stealth.
  const hidden = new Set(overview?.view.dashboard.hidden ?? []);
  const setHidden = (id: string, hide: boolean) => {
    if (!overview) return;
    const current = overview.view.choices.hidden ?? [];
    const next = hide ? [...current.filter((h) => h !== id), id] : current.filter((h) => h !== id);
    void apply({ ...overview.view.choices, hidden: next }, false);
  };

  async function apply(choices: TrackerChoices = draft, closeCustomise = true) {
    if (!overview) return;
    setSave({ state: "saving" });
    const r = await saveTrackerChoicesAction(runId, documentId, { scope: overview.view.scopeKey, revision: overview.view.revision }, choices);
    if (!r.ok) return setSave({ state: "message", tone: "error", text: r.error });
    if (r.saved) {
      setSave({ state: "saved" });
      if (closeCustomise) setCustomising(false);
      return void reload();
    }
    if (r.reason === "conflict") {
      setSave({
        state: "message",
        tone: "warn",
        text: r.moved
          ? "This project has moved to another programme since you opened the dashboard, so nothing was saved. The dashboard now shows that programme's choices."
          : "Someone else changed these choices since you opened the dashboard, so nothing was saved. The dashboard now shows their choices; make your change again if it is still needed.",
      });
      return void reload();
    }
    setSave({ state: "message", tone: "error", text: r.reason === "invalid" ? r.problems.join(" ") : r.message });
  }

  async function reset() {
    if (!overview || overview.view.revision === null) return;
    setSave({ state: "saving" });
    const r = await resetTrackerChoicesAction(runId, { scope: overview.view.scopeKey, revision: overview.view.revision });
    if (!r.ok) return setSave({ state: "message", tone: "error", text: r.error });
    if (r.saved) {
      setSave({ state: "saved" });
      return void reload();
    }
    setSave({ state: "message", tone: "warn", text: r.reason === "conflict" ? "These choices changed since you opened the dashboard, so nothing was reset. The dashboard now shows the current choices." : r.reason === "invalid" ? r.problems.join(" ") : r.message });
    void reload();
  }

  const stageChange = (stage: string, code: string) => overview?.changes.find((c) => c.stage === stage && c.code === code) ?? null;

  const customise = overview && dashboard && (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs" aria-label="Customise dashboard" data-testid="tracker-customise">
      <p className="text-sm font-semibold text-foreground">Customise dashboard</p>
      <p className="mt-1 text-muted">
        These choices apply to every wave of this {overview.view.scope}. Nothing changes until you apply them.
        {!overview.view.storageAvailable && " They cannot be saved yet: the database needs migration 0132."}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1" id="tracker-choice-brand">
            <span className="font-medium text-foreground">Which brand is yours?</span>
            <select
              value={draft.focalBrandCode ?? ""}
              onChange={(e) => editDraft((d) => ({ ...d, focalBrandCode: e.target.value || undefined }))}
              className="rounded border border-border bg-white px-2 py-1.5"
              disabled={dashboard.brands.length === 0}
            >
              <option value="">{dashboard.brands.length === 0 ? "No brand list was found in this file" : focal?.source === "prefilled" ? `Not chosen (suggested: ${focal.label})` : "Not chosen"}</option>
              {dashboard.brands.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!dashboard.weightVar}
              checked={dashboard.weightVar ? draft.weighted !== false : false}
              onChange={(e) => editDraft((d) => ({ ...d, weighted: e.target.checked ? undefined : false }))}
            />
            <span>
              <span className="font-medium text-foreground">Weighted</span>
              <span className="block text-muted">{dashboard.weightVar ? `By ${dashboard.weightVar}, the file's weight.` : "This file has no weight variable."}</span>
            </span>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="font-medium text-foreground">Funnel stages</legend>
            {overview.stageCandidates.length === 0 && <p className="text-muted">No per-brand yes/no questions were found in this file.</p>}
            {overview.stageCandidates.length > 0 &&
              overview.stageTiles.map((t) => {
                const holders = overview.stageCandidates.filter((c) => stageOfGroup(c.group) === t.stage);
                return (
                  <label key={t.stage} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2" id={`tracker-choice-stage-${t.stage}`}>
                    <span>{STAGE_LABEL[t.stage]}</span>
                    <select
                      aria-label={`Question for ${STAGE_LABEL[t.stage]}`}
                      value={holders.length === 1 ? holders[0].group : ""}
                      onChange={(e) => setStage(t.stage, e.target.value)}
                      className="min-w-0 rounded border border-border bg-white px-2 py-1"
                    >
                      <option value="">{holders.length > 1 ? "Two questions: choose one" : "None"}</option>
                      {overview.stageCandidates.map((c) => (
                        <option key={c.group} value={c.group}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
          </fieldset>
        </div>
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="font-medium text-foreground">Customer satisfaction</legend>
            {CSM_ROLES.map(({ role, label }) => (
              <label key={role} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2" id={`tracker-choice-${role}`}>
                <span>{label}</span>
                <select
                  aria-label={`Question for ${label}`}
                  value={roleValue(role)}
                  onChange={(e) => editDraft((d) => ({ ...d, csm: { ...(d.csm ?? {}), [role]: e.target.value === NONE ? null : e.target.value } }))}
                  className="min-w-0 rounded border border-border bg-white px-2 py-1"
                >
                  <option value={NONE}>None in this file</option>
                  {overview.csmCandidates.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label === c.name ? c.name : `${c.label} (${c.name})`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1" id="tracker-choice-drivers">
            <legend className="font-medium text-foreground">Drivers of satisfaction</legend>
            <div className="max-h-40 overflow-y-auto rounded border border-border bg-white p-2">
              {overview.csmCandidates.map((c) => (
                <label key={c.name} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={drivers.includes(c.name)}
                    onChange={(e) => editDraft((d) => ({ ...d, csm: { ...(d.csm ?? {}), drivers: e.target.checked ? [...drivers, c.name] : drivers.filter((x) => x !== c.name) } }))}
                  />
                  <span className="truncate">{c.label === c.name ? c.name : `${c.label} (${c.name})`}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={save.state === "saving" || !overview.view.storageAvailable}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {save.state === "saving" ? "Saving..." : "Apply changes"}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={save.state === "saving" || overview.view.revision === null}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Reset to suggested
        </button>
      </div>
    </section>
  );

  const brandTab = overview && dashboard && (
    <>
      <p className="text-[11px] text-muted" data-testid="tracker-basis">
        {overview.figures.weighted ? `Weighted by ${overview.figures.weightVar}` : "Unweighted"}
        {overview.figures.effectiveBase !== null ? `, effective base ${Math.round(overview.figures.effectiveBase)}` : ""}.{" "}
        {overview.previous.status === "ok"
          ? `Change is against ${overview.previous.wave} (${overview.previous.filename}), in percentage points, with no significance test yet.`
          : overview.previous.status === "failed"
            ? `The previous wave (${overview.previous.wave}) could not be read, so no change is shown: ${overview.previous.error}`
            : overview.previous.reason}
      </p>
      {!focal && dashboard.brands.length > 0 && <p className="text-xs text-muted">Choose your brand under Customise dashboard to see its figures in the tiles.</p>}
      <section aria-label="Your brand" className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="tracker-kpis">
        {overview.stageTiles.map((t) => {
          const s = overview.figures.stages.find((x) => x.stage === t.stage);
          if (t.status !== "shown" || !s) {
            if (hidden.has(`stage:${t.stage}`)) return null;
            return (
              <BlankTile
                key={t.stage}
                testId="tracker-kpi"
                title={STAGE_LABEL[t.stage]}
                text={t.status === "choose" ? "Two questions could be this stage. Choose which one." : "No question for this stage was found in this file."}
                onChoose={() => chooseAt(`stage-${t.stage}`)}
                onHide={() => setHidden(`stage:${t.stage}`, true)}
              />
            );
          }
          const b = focal ? s.byBrand.find((x) => x.code === focal.code) : undefined;
          const c = focal ? stageChange(s.stage, focal.code) : null;
          const delta = pp(c?.changePp ?? null);
          return (
            <div key={t.stage} className="rounded-xl border border-border bg-white p-3" data-testid="tracker-kpi">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{STAGE_LABEL[t.stage]}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{focal ? pct(b?.share ?? null) : "-"}</p>
              <p className={`text-[11px] ${delta && c!.changePp! > 0 ? "text-emerald-700" : delta && c!.changePp! < 0 ? "text-red-700" : "text-muted"}`}>{focal ? (delta ?? c?.reason ?? "") : s.label}</p>
              {focal && <p className="text-[10px] text-muted">{b?.reason ?? (b?.base !== null && b?.base !== undefined ? `Base ${b.base}` : "")}</p>}
            </div>
          );
        })}
      </section>

      {overview.figures.stages.length > 0 && (
        <section className="rounded-xl border border-border bg-white p-4" aria-label="Compare brands" data-testid="tracker-compare">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Compare brands through the funnel</p>
            <p className="text-[11px] text-muted">{comparators ? "Your selection" : "Suggested: five brands, yours first, in the file's list order"}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Brands compared">
            {dashboard.brands.map((b) => {
              const on = shown.includes(b.code);
              return (
                <button
                  key={b.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setComparators(on ? shown.filter((c) => c !== b.code) : [...shown, b.code])}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-white text-muted"}`}
                >
                  {b.label}
                  {focal?.code === b.code ? " (yours)" : ""}
                </button>
              );
            })}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-500">
                  <th className="py-1 pr-3 font-medium">Brand</th>
                  {overview.figures.stages.map((s) => (
                    <th key={s.stage} className="py-1 pr-3 font-medium">
                      {STAGE_LABEL[s.stage]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((code) => (
                  <tr key={code} className={`border-t border-border ${focal?.code === code ? "bg-primary/5 font-medium" : ""}`} data-testid="tracker-compare-row">
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium text-foreground">
                      {brandLabel.get(code) ?? code}
                    </th>
                    {overview.figures.stages.map((s) => {
                      const b = s.byBrand.find((x) => x.code === code);
                      const delta = pp(stageChange(s.stage, code)?.changePp ?? null);
                      return (
                        <td key={s.stage} className="py-1.5 pr-3 align-top" title={b?.reason}>
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 rounded bg-primary/60" style={{ width: `${Math.max(0, Math.min(100, b?.share ?? 0)) * 0.6}px` }} aria-hidden />
                            <span className="tabular-nums">{b?.share === null || b?.share === undefined ? "n/a" : `${b.share.toFixed(1)}%`}</span>
                          </div>
                          {delta && <span className="text-[10px] text-muted">{delta}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );

  const csmTile = (t: CsmTile) => {
    const meta = CSM_TILE[t.id];
    const anchor = meta.role === "drivers" ? "drivers" : meta.role;
    if (t.status === "missing")
      return hidden.has(`csm:${t.id}`) ? null : (
        <BlankTile key={t.id} testId="tracker-csm-tile" title={meta.title} text={t.reason} onChoose={() => chooseAt(anchor)} onHide={() => setHidden(`csm:${t.id}`, true)} />
      );
    if (t.status === "failed")
      return (
        <div key={t.id} className="rounded-xl border border-red-200 bg-red-50 p-3" data-testid="tracker-csm-tile" data-failed="true">
          <p className="text-[11px] font-medium uppercase tracking-wide text-red-800">{meta.title}</p>
          <p className="mt-1 text-xs text-red-800">Could not be calculated from {t.variable}: {t.error}</p>
          <button type="button" onClick={() => chooseAt(anchor)} className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-[11px]">
            Choose a different question
          </button>
        </div>
      );
    if (t.id === "drivers") return null;
    return (
      <div key={t.id} className="rounded-xl border border-border bg-white p-3" data-testid="tracker-csm-tile">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{meta.title}</p>
        {t.id === "recommend" ? (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{t.nps.toFixed(1)}</p>
            <p className="text-[11px] text-muted">
              95% interval {t.lo.toFixed(1)} to {t.hi.toFixed(1)}; promoters {t.promoters.toFixed(1)}%, detractors {t.detractors.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted">{t.label}, base {t.base}</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{t.box === null ? "Not available" : `${t.box.toFixed(1)}%`}</p>
            <p className="text-[11px] text-muted">
              {t.boxCodes === "8 to 10" ? "Answering 8 to 10" : "Top two answers"}
              {t.mean !== null ? `; mean ${t.mean.toFixed(2)}` : ""}
            </p>
            <p className="text-[10px] text-muted">
              {t.label}, {overview?.figures.weighted ? "effective base" : "base"} {t.effectiveBase}
            </p>
          </>
        )}
      </div>
    );
  };

  const csmTab = overview && (
    <>
      <section aria-label="Customer satisfaction" className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="tracker-csm">
        {overview.csm.filter((t) => t.id !== "drivers").map(csmTile)}
      </section>
      {(() => {
        const d = overview.csm.find((t) => t.id === "drivers");
        if (!d) return null;
        if (d.status !== "ok" || d.id !== "drivers") return <div className="max-w-md">{csmTile(d)}</div>;
        return (
          <section className="rounded-xl border border-border bg-white p-4" aria-label="Driver priority" data-testid="tracker-drivers">
            <p className="text-sm font-semibold text-foreground">Driver priority</p>
            <p className="text-[11px] text-muted">
              Share of {d.label} explained by each driver ({d.method === "shapley" ? "Shapley" : d.method === "relative_weights" ? "relative weights" : "standardised coefficients"}, R² {d.rSquared.toFixed(2)}, {d.n} cases).
            </p>
            <ol className="mt-2 flex flex-col gap-1 text-xs">
              {d.rows.map((r) => (
                <li key={r.variable} className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,16rem)_3.5rem] items-center gap-2">
                  <span className="truncate">{r.label}</span>
                  {/* Bars are drawn against the largest share, so the ranking reads at a glance; the figure is the share. */}
                  <span className="h-2 rounded bg-primary/60" style={{ width: `${Math.round((r.share / Math.max(...d.rows.map((x) => x.share), 1e-9)) * 100)}%` }} aria-hidden />
                  <span className="text-right tabular-nums">{(r.share * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ol>
          </section>
        );
      })()}
    </>
  );

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50" role="dialog" aria-label="Tracker dashboard">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-white px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Tracker dashboard</p>
          <p className="truncate text-[11px] text-muted">
            {filename}
            {overview?.wave ? ` · ${overview.wave}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overview && (
            <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              Customise dashboard
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
            {closeLabel === "Close" ? "Close" : `← ${closeLabel}`}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {load.state === "loading" && (
          <p className="text-sm text-muted" role="status">
            Calculating the dashboard from this file...
          </p>
        )}
        {load.state === "failed" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <p>The dashboard could not be calculated: {load.error}</p>
            <button type="button" onClick={() => void reload()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        )}
        {save.state === "saved" && (
          <p className="mb-3 text-xs text-emerald-700" role="status">
            Saved for this {overview?.view.scope === "programme" ? "programme" : "project"}.
          </p>
        )}
        {save.state === "message" && (
          <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${save.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="alert">
            {save.text}
          </p>
        )}

        {overview && dashboard && (
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            {customising && customise}
            {dashboard.needsChoice.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" aria-label="Still to decide">
                <p className="font-medium">Still to decide for this wave</p>
                <ul className="mt-1 list-disc pl-4">
                  {dashboard.needsChoice.map((n) => (
                    <li key={n.id}>{n.text}</li>
                  ))}
                </ul>
              </section>
            )}
            <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 border-b border-border">
              {(
                [
                  ["brand", "Brand"],
                  ["csm", "Customer satisfaction"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {(() => {
              // A hidden tile that has a figure again (a question was chosen, or a later wave has one) shows anyway:
              // only blank tiles can be hidden.
              const blank =
                tab === "brand"
                  ? overview.stageTiles.filter((t) => t.status !== "shown").map((t) => `stage:${t.stage}`)
                  : overview.csm.filter((t) => t.status === "missing").map((t) => `csm:${t.id}`);
              const ids = blank.filter((id) => hidden.has(id));
              return ids.length > 0 ? (
                <p className="text-[11px] text-muted" data-testid="tracker-hidden">
                  {ids.length} empty tile{ids.length === 1 ? " is" : "s are"} hidden.{" "}
                  <button type="button" className="underline" onClick={() => void apply({ ...overview.view.choices, hidden: (overview.view.choices.hidden ?? []).filter((h) => !ids.includes(h)) }, false)}>
                    Show hidden tiles
                  </button>
                </p>
              ) : null;
            })()}
            {tab === "brand" ? brandTab : csmTab}
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

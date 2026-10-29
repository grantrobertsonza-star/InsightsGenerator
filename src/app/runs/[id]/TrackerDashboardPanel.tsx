"use client";

// D3 automatic tracker dashboards for one wave file, laid out after Grant's previews of 28 October 2026
// (docs/design/preview-brand-overview-2026-10-28.png and preview-csm-customer-experience-2026-10-28.png). The brand
// tracking dashboard and the CSM dashboard are separate tools (Grant, 29 October: "hardly ever analysed together"),
// one component with a `kind`. Figures come from loadBrandOverviewAction (the Cross tab engine, the NPS tool and
// driver analysis through src/lib); this screen formats them and never computes a figure itself.
//
// Every standard tile is always shown: a tile with no question in the file, or with two questions claiming it, is
// blank with "Choose a question" (opens Customise at that choice) and Hide. Choices are saved for the whole programme
// with the scope and revision this screen read; "Saved" shows only after the save succeeds, and a conflicting or
// moved save reloads what is stored instead of overwriting it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { loadBrandOverviewAction, resetTrackerChoicesAction, saveTrackerChoicesAction } from "@/lib/trackerDashboardActions";
import type { BrandOverview, TimelinePoint } from "@/lib/trackerOverview";
import type { TrackerChoices } from "@/lib/trackerDashboard";
import type { CompanyBox, CompanyNps, CsmTile, CsmTileId } from "@/lib/trackerCsmFigures";
import type { FunnelStage } from "@/lib/trackerRoles";
import { searchVariables } from "@/lib/variableSearch";
import { QuestionPicker, variableText } from "./QuestionPicker";

export type TrackerDashboardKind = "brand" | "csm";

const STAGE_LABEL: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  shortlist: "Shortlist",
  first_choice: "First choice",
  trial: "Trial",
  usage: "Usage",
  frequent_usage: "Frequent usage",
};
/** One colour per funnel stage, as in the brand preview (blue, sky, teal, violet), carried through bars and lines. */
const STAGE_COLOUR: Record<string, string> = {
  awareness: "#2563eb",
  consideration: "#38a3d9",
  shortlist: "#14b8a6",
  first_choice: "#8b5cf6",
  trial: "#f59e0b",
  usage: "#0ea5e9",
  frequent_usage: "#64748b",
};
const HEADLINE_STAGES = ["awareness", "consideration", "shortlist", "first_choice"];

type CsmRole = "overallSatisfaction" | "recommend0to10" | "likelyToStay" | "likelyToSwitch" | "company";
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
  { role: "company", label: "Company each customer rates" },
];
const BRAND_SECTIONS = ["Brand overview", "Moments & needs", "Brand associations", "Advertising & WOM", "Audience & media", "Category overview"];

// A change shown to one decimal: one that rounds to zero is "±0.0", never "−0.0".
const signed = (v: number, digits = 1) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(digits)}`;
};
const pp = (v: number | null) => (v === null ? null : `${signed(v)} pts`);
const NONE = "__none";
/** A wave's short name for an axis: its fieldwork month when known ("Oct 2026" → "Oct"), else its label. */
const waveTick = (p: Pick<TimelinePoint, "wave" | "waveDate">) => {
  if (p.waveDate && /^\d{4}-\d{2}/.test(p.waveDate)) return new Date(`${p.waveDate.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return p.wave;
};

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; overview: BrandOverview };
type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "message"; tone: "error" | "warn"; text: string };

function Card({ title, subtitle, children, testId, className = "" }: { title?: string; subtitle?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`} data-testid={testId} aria-label={title}>
      {title && <h3 className="text-lg font-semibold text-slate-900">{title}</h3>}
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** A selector chip, as in the previews' filter row ("Brand  BMW"). */
function Chip({ label, children, onClick, testId }: { label: string; children: ReactNode; onClick?: () => void; testId?: string }) {
  const inner = (
    <>
      <span className="text-slate-500">{label}</span> <span className="font-medium text-slate-900">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-left text-sm hover:border-blue-300" data-testid={testId}>
      {inner}
    </button>
  ) : (
    <span className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm" data-testid={testId}>
      {inner}
    </span>
  );
}

function BlankTile({ title, text, onChoose, onHide, testId }: { title: string; text: string; onChoose: () => void; onHide: () => void; testId: string }) {
  return (
    <div className="flex min-h-[7.5rem] flex-col rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4" data-testid={testId} data-blank="true">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 flex-1 text-xs text-slate-500">{text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onChoose} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50">
          Choose a question
        </button>
        <button type="button" onClick={onHide} aria-label={`Hide the ${title} tile`} className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
          Hide
        </button>
      </div>
    </div>
  );
}

/** A small line across waves with each point labelled (the previews' trend charts). Draws only the points it has. */
function WaveLine({ points, colour, yMax, format, height = 130, width = 300, testId }: { points: { tick: string; value: number | null }[]; colour: string; yMax?: number; format: (v: number) => string; height?: number; width?: number; testId?: string }) {
  // The drawing keeps its proportions; `width` is its natural width, so text stays the size it was drawn at.
  const W = width;
  const padX = 28;
  const top = 26;
  const bottom = 26;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = yMax ?? (values.length ? Math.max(...values) * 1.15 : 1);
  const min = yMax !== undefined ? 0 : values.length ? Math.max(0, Math.min(...values) * 0.8) : 0;
  const x = (i: number) => (points.length <= 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (points.length - 1));
  const y = (v: number) => top + (1 - (v - min) / (max - min || 1)) * (height - top - bottom);
  const drawn = points.map((p, i) => (p.value === null ? null : { x: x(i), y: y(p.value), v: p.value })).filter(Boolean) as { x: number; y: number; v: number }[];
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" style={{ maxWidth: W }} role="img" aria-label={points.map((p) => `${p.tick}: ${p.value === null ? "not available" : format(p.value)}`).join(", ")} data-testid={testId}>
      {drawn.length > 1 && <polyline points={drawn.map((d) => `${d.x},${d.y}`).join(" ")} fill="none" stroke={colour} strokeWidth={2.5} />}
      {drawn.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={4.5} fill={colour} />
          <text x={d.x} y={d.y - 9} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
            {format(d.v)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="#64748b">
          {p.tick}
        </text>
      ))}
    </svg>
  );
}

export default function TrackerDashboardPanel({
  kind,
  runId,
  documentId,
  filename,
  onClose,
  closeLabel = "Close",
}: {
  kind: TrackerDashboardKind;
  runId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [csmTab, setCsmTab] = useState<"company" | "nps" | "drivers">("company");
  const [comparators, setComparators] = useState<string[] | null>(null);
  const [pickingComparators, setPickingComparators] = useState(false);
  // The CSM tiles' scope: all customers, or one company by code; null until the researcher picks, which shows the
  // client's company when there is one (D3b).
  const [companyScope, setCompanyScope] = useState<string | null>(null);
  const [customising, setCustomising] = useState(false);
  const [driverQuery, setDriverQuery] = useState("");
  const [draft, setDraft] = useState<TrackerChoices>({});
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  // Only the latest request may update the screen: a slow earlier load (or one for another file) is ignored.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ state: "loading" });
    const r = await loadBrandOverviewAction(runId, documentId, kind);
    if (id !== latest.current) return;
    if (!r.ok) return setLoad({ state: "failed", error: r.error });
    setLoad({ state: "ready", overview: r.overview });
    setDraft(r.overview.view.choices);
  }, [runId, documentId, kind]);

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

  /** Opens Customise at one choice (a blank tile's "Choose a question"). */
  function chooseAt(anchor: string) {
    setCustomising(true);
    // The choice is scrolled into view and its search box focused, so the researcher can type at once.
    requestAnimationFrame(() => {
      const at = document.getElementById(`tracker-choice-${anchor}`);
      at?.scrollIntoView({ block: "center" });
      at?.querySelector<HTMLElement>("[role=combobox], select, input")?.focus();
    });
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
  const driverMatches = useMemo(() => searchVariables(driverQuery, overview?.csmCandidates ?? []), [driverQuery, overview]);
  const stageOptions = useMemo(() => (overview?.stageCandidates ?? []).map((c) => ({ name: c.group, label: c.label })), [overview]);

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
  const previousName = overview?.previous.status === "ok" ? waveTick({ wave: overview.previous.wave, waveDate: overview.timeline.find((t) => t.documentId === (overview.previous as { documentId: string }).documentId)?.waveDate ?? null }) : null;

  const customise = overview && dashboard && (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 text-xs" aria-label="Customise dashboard" data-testid="tracker-customise">
      <p className="text-sm font-semibold text-slate-900">Customise dashboard</p>
      <p className="mt-1 text-slate-500">
        These choices apply to every wave of this {overview.view.scope}. Nothing changes until you apply them.
        {!overview.view.storageAvailable && " They cannot be saved yet: the database needs migration 0132."}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {kind === "brand" && (
            <label className="flex flex-col gap-1" id="tracker-choice-brand">
              <span className="font-medium text-slate-900">Which brand is yours?</span>
              <select
                value={draft.focalBrandCode ?? ""}
                onChange={(e) => editDraft((d) => ({ ...d, focalBrandCode: e.target.value || undefined }))}
                className="rounded border border-slate-200 bg-white px-2 py-1.5"
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
          )}
          {kind === "csm" && overview.csmCompany && "companies" in overview.csmCompany && (
            <label className="flex flex-col gap-1" id="tracker-choice-focal-company">
              <span className="font-medium text-slate-900">Which company is yours?</span>
              <select
                value={draft.focalCompanyCode ?? ""}
                onChange={(e) => editDraft((d) => ({ ...d, focalCompanyCode: e.target.value || undefined }))}
                className="rounded border border-slate-200 bg-white px-2 py-1.5"
              >
                <option value="">{overview.csmCompany.focal?.source === "prefilled" ? `Not chosen (suggested: ${overview.csmCompany.focal.label})` : "Not chosen"}</option>
                {overview.csmCompany.companies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!dashboard.weightVar}
              checked={dashboard.weightVar ? draft.weighted !== false : false}
              onChange={(e) => editDraft((d) => ({ ...d, weighted: e.target.checked ? undefined : false }))}
            />
            <span>
              <span className="font-medium text-slate-900">Weighted</span>
              <span className="block text-slate-500">{dashboard.weightVar ? `By ${dashboard.weightVar}, the file's weight.` : "This file has no weight variable."}</span>
            </span>
          </label>
          {kind === "csm" && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="font-medium text-slate-900">Questions</legend>
              {CSM_ROLES.map(({ role, label }) => (
                <label key={role} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-2" id={`tracker-choice-${role}`}>
                  <span>{label}</span>
                  <QuestionPicker
                    ariaLabel={`Question for ${label}`}
                    value={roleValue(role) === NONE ? null : roleValue(role)}
                    options={overview.csmCandidates}
                    noneLabel="None in this file"
                    onChange={(name) => editDraft((d) => ({ ...d, csm: { ...(d.csm ?? {}), [role]: name } }))}
                  />
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {kind === "brand" && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="font-medium text-slate-900">Funnel stages</legend>
              {overview.stageCandidates.length === 0 && <p className="text-slate-500">No per-brand yes/no questions were found in this file.</p>}
              {overview.stageCandidates.length > 0 &&
                overview.stageTiles.map((t) => {
                  const holders = overview.stageCandidates.filter((c) => stageOfGroup(c.group) === t.stage);
                  return (
                    <label key={t.stage} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2" id={`tracker-choice-stage-${t.stage}`}>
                      <span>{STAGE_LABEL[t.stage]}</span>
                      <QuestionPicker
                        ariaLabel={`Question for ${STAGE_LABEL[t.stage]}`}
                        value={holders.length === 1 ? holders[0].group : null}
                        options={stageOptions}
                        noneLabel={holders.length > 1 ? "Two questions: choose one" : "None"}
                        onChange={(group) => setStage(t.stage, group ?? "")}
                      />
                    </label>
                  );
                })}
            </fieldset>
          )}
          {kind === "csm" && (
            <fieldset className="flex flex-col gap-1" id="tracker-choice-drivers">
              <legend className="font-medium text-slate-900">Service attributes (drivers of satisfaction)</legend>
              <input
                type="search"
                aria-label="Search driver questions"
                placeholder={`Search ${overview.csmCandidates.length} questions (${drivers.length} chosen)`}
                value={driverQuery}
                onChange={(e) => setDriverQuery(e.target.value)}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              />
              <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white p-2">
                {driverMatches.length === 0 && <p className="text-slate-500">No question matches &ldquo;{driverQuery}&rdquo;.</p>}
                {driverMatches.map((c) => (
                  <label key={c.name} className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={drivers.includes(c.name)}
                      onChange={(e) => editDraft((d) => ({ ...d, csm: { ...(d.csm ?? {}), drivers: e.target.checked ? [...drivers, c.name] : drivers.filter((x) => x !== c.name) } }))}
                    />
                    <span className="truncate">{variableText(c)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={save.state === "saving" || !overview.view.storageAvailable}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {save.state === "saving" ? "Saving..." : "Apply changes"}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={save.state === "saving" || overview.view.revision === null}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Reset to suggested
        </button>
      </div>
    </section>
  );

  const hiddenNote = (ids: string[]) =>
    ids.length > 0 ? (
      <p className="text-[11px] text-slate-500" data-testid="tracker-hidden">
        {ids.length} empty tile{ids.length === 1 ? " is" : "s are"} hidden.{" "}
        <button type="button" className="underline" onClick={() => void apply({ ...overview!.view.choices, hidden: (overview!.view.choices.hidden ?? []).filter((h) => !ids.includes(h)) }, false)}>
          Show hidden tiles
        </button>
      </p>
    ) : null;

  const statusLine = (
    <>
      {save.state === "saved" && (
        <p className="text-xs text-emerald-700" role="status">
          Saved for this {overview?.view.scope === "programme" ? "programme" : "project"}.
        </p>
      )}
      {save.state === "message" && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${save.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="alert">
          {save.text}
        </p>
      )}
      {dashboard && dashboard.needsChoice.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" aria-label="Still to decide">
          <p className="font-medium">Still to decide for this wave</p>
          <ul className="mt-1 list-disc pl-4">
            {dashboard.needsChoice.map((n) => (
              <li key={n.id}>{n.text}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  // ---- Brand tracking dashboard (preview: "Brand overview") ----------------------------------------------------
  const brandView = overview && dashboard && (() => {
    const blankStages = overview.stageTiles.filter((t) => t.status !== "shown").map((t) => `stage:${t.stage}`);
    const shownStages = overview.figures.stages;
    const focalName = focal?.label ?? null;
    const base = overview.figures.stages[0]?.byBrand[0]?.base ?? null;
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Brand overview</h2>
            <p className="mt-1 text-[15px] text-slate-500">A familiar dashboard, created from the recognised brand-tracker structure.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5" data-testid="tracker-chips">
          <Chip label="Brand" onClick={() => chooseAt("brand")}>{focalName ?? "Choose"}</Chip>
          <Chip label="Wave">{overview.wave ?? "Not labelled"}</Chip>
          <Chip label="Compare" onClick={() => setPickingComparators((v) => !v)}>{comparators ? "Selected brands" : "Suggested brands"}</Chip>
          <Chip label="Weighting" onClick={() => chooseAt("brand")}>{overview.figures.weighted ? "On" : "Off"}</Chip>
          <Chip label="Segment">All eligible</Chip>
        </div>
        {customising && customise}
        {statusLine}
        <p className="text-xs text-slate-500" data-testid="tracker-basis">
          {overview.figures.weighted ? `Weighted by ${overview.figures.weightVar}` : "Unweighted"}
          {overview.figures.effectiveBase !== null ? `, effective base ${Math.round(overview.figures.effectiveBase)}` : ""}.{" "}
          {overview.previous.status === "ok"
            ? `Change is against ${overview.previous.wave} (${overview.previous.filename}), in percentage points, with no significance test yet.`
            : overview.previous.status === "failed"
              ? `The previous wave (${overview.previous.wave}) could not be read, so no change is shown: ${overview.previous.error}`
              : overview.previous.reason}
        </p>
        {hiddenNote(blankStages.filter((id) => hidden.has(id)))}
        {!focal && dashboard.brands.length > 0 && <p className="text-xs text-slate-500">Choose your brand (the Brand chip) to see its figures in the tiles.</p>}
        <section aria-label="Your brand" className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="tracker-kpis">
          {overview.stageTiles.map((t) => {
            const s = shownStages.find((x) => x.stage === t.stage);
            if (t.status !== "shown" || !s) {
              if (hidden.has(`stage:${t.stage}`)) return null;
              return (
                <BlankTile
                  key={t.stage}
                  testId="tracker-kpi"
                  title={STAGE_LABEL[t.stage]}
                  text={
                    t.status === "choose"
                      ? "Two questions could be this stage. Choose which one."
                      : t.status === "shown"
                        ? (overview.figures.noFigures ?? "A question is chosen for this stage, but its figures could not be calculated.")
                        : "No question for this stage was found in this file."
                  }
                  onChoose={() => chooseAt(`stage-${t.stage}`)}
                  onHide={() => setHidden(`stage:${t.stage}`, true)}
                />
              );
            }
            const b = focal ? s.byBrand.find((x) => x.code === focal.code) : undefined;
            const c = focal ? stageChange(s.stage, focal.code) : null;
            return (
              <div key={t.stage} className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="tracker-kpi">
                <p className="text-sm text-slate-500">{STAGE_LABEL[t.stage]}</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <p className="text-[2rem] font-bold tabular-nums leading-none text-slate-900">{!focal ? "-" : b?.share === null || b?.share === undefined ? "n/a" : `${b.share.toFixed(1)}%`}</p>
                  {focal && (
                    <p className="text-sm text-blue-600" data-testid="tracker-kpi-change">
                      {c?.changePp !== null && c?.changePp !== undefined ? `${signed(c.changePp)} pp vs ${previousName ?? "previous wave"}` : (c?.reason ?? "")}
                    </p>
                  )}
                </div>
                {focal && b?.reason && <p className="mt-1 text-[11px] text-slate-500">{b.reason}</p>}
              </div>
            );
          })}
        </section>

        {shownStages.length > 0 && (
          <Card
            title="Compare the brand funnel"
            subtitle={`${overview.figures.weighted ? "Weighted" : "Unweighted"}, all eligible respondents${base !== null ? `, n=${base.toLocaleString()} per brand` : ""}. Selected comparators, not a ranking.`}
            testId="tracker-compare"
          >
            {pickingComparators && (
              <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Brands compared">
                {dashboard.brands.map((b) => {
                  const on = shown.includes(b.code);
                  return (
                    <button
                      key={b.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setComparators(on ? shown.filter((c) => c !== b.code) : [...shown, b.code])}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-blue-500 bg-blue-50 text-slate-900" : "border-slate-200 bg-white text-slate-500"}`}
                    >
                      {b.label}
                      {focal?.code === b.code ? " (yours)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {shown.map((code) => {
                const isFocal = focal?.code === code;
                return (
                  <div key={code} className={`rounded-xl p-3.5 ${isFocal ? "bg-blue-50" : ""}`} data-testid="tracker-compare-row">
                    <p className={`text-base font-bold ${isFocal ? "text-blue-600" : "text-slate-900"}`}>{brandLabel.get(code) ?? code}</p>
                    <div className="mt-3 flex flex-col gap-3">
                      {shownStages.map((s) => {
                        const b = s.byBrand.find((x) => x.code === code);
                        const v = b?.share ?? null;
                        const d = pp(stageChange(s.stage, code)?.changePp ?? null);
                        return (
                          <div key={s.stage} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.6rem] items-center gap-2 text-xs" title={b?.reason ?? (d ? `${d} vs ${previousName ?? "previous wave"}` : undefined)}>
                            <span className="truncate text-slate-500">{STAGE_LABEL[s.stage]}</span>
                            <span className="h-3.5 rounded bg-slate-100">
                              <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%`, background: STAGE_COLOUR[s.stage] }} />
                            </span>
                            <span className="text-right font-semibold tabular-nums text-slate-900">{v === null ? "n/a" : v.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {focal && overview.timeline.length > 1 && (
          <Card
            title={`${focal.label} across ${overview.timeline.length === 2 ? "two" : overview.timeline.length === 3 ? "three" : overview.timeline.length} waves`}
            subtitle="Independent samples. Changes use unrounded values; no significance claims."
            testId="tracker-timeline"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {shownStages
                .filter((s) => HEADLINE_STAGES.includes(s.stage))
                .map((s) => (
                  <div key={s.stage}>
                    <p className="text-sm font-semibold text-slate-900">{STAGE_LABEL[s.stage]}</p>
                    <WaveLine
                      colour={STAGE_COLOUR[s.stage]}
                      format={(v) => `${v.toFixed(1)}%`}
                      points={overview.timeline.map((p) => ({ tick: waveTick(p), value: p.status === "ok" ? (p.stages?.find((x) => x.stage === s.stage)?.byBrand.find((x) => x.code === focal.code)?.share ?? null) : null }))}
                    />
                  </div>
                ))}
            </div>
            {overview.timeline.some((p) => p.status === "failed") && (
              <p className="mt-2 text-[11px] text-amber-800">
                {overview.timeline
                  .filter((p) => p.status === "failed")
                  .map((p) => `${p.wave} could not be read: ${p.error}`)
                  .join(" ")}
              </p>
            )}
          </Card>
        )}
      </>
    );
  })();

  // ---- CSM dashboard (preview: "Customer experience dashboard") ------------------------------------------------
  const companyInfo = overview?.csmCompany && "companies" in overview.csmCompany ? overview.csmCompany : null;
  const scope = companyScope ?? companyInfo?.focal?.code ?? "all";
  const scopeLabel = scope === "all" ? "All customers" : (companyInfo?.companies.find((c) => c.code === scope)?.label ?? scope);
  const csmChange = (id: CsmTileId, code: string | null) => overview?.csmChanges.find((c) => c.id === id && c.code === code) ?? null;
  const companyOf = (t: CsmTile, code: string): CompanyBox | CompanyNps | null =>
    t.status === "ok" && t.id !== "drivers" && Array.isArray(t.byCompany) ? ((t.byCompany as (CompanyBox | CompanyNps)[]).find((c) => c.code === code) ?? null) : null;
  const tileOf = (id: CsmTileId) => overview?.csm.find((t) => t.id === id) ?? null;
  const prevLabel = overview?.previous.status === "ok" ? overview.previous.wave : null;

  const csmTileView = (t: CsmTile) => {
    const meta = CSM_TILE[t.id];
    const anchor = meta.role === "drivers" ? "drivers" : meta.role;
    if (t.status === "missing")
      return hidden.has(`csm:${t.id}`) ? null : (
        <BlankTile key={t.id} testId="tracker-csm-tile" title={meta.title} text={t.reason} onChoose={() => chooseAt(anchor)} onHide={() => setHidden(`csm:${t.id}`, true)} />
      );
    if (t.status === "failed")
      return (
        <div key={t.id} className="rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="tracker-csm-tile" data-failed="true">
          <p className="text-sm text-red-800">{meta.title}</p>
          <p className="mt-1 text-xs text-red-800">Could not be calculated from {t.variable}: {t.error}</p>
          <button type="button" onClick={() => chooseAt(anchor)} className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-[11px]">
            Choose a different question
          </button>
        </div>
      );
    if (t.id === "drivers") return null;
    const one = scope === "all" ? null : companyOf(t, scope);
    const splitFailed = scope !== "all" && !Array.isArray(t.byCompany) && t.byCompany !== null ? t.byCompany.failed : null;
    const change = csmChange(t.id, scope === "all" ? null : scope);
    let big: string;
    let changeText: string;
    let foot: string;
    let direction = 0;
    if (t.id === "recommend") {
      const nps = one as CompanyNps | null;
      const v = scope === "all" ? t.nps : (nps?.nps ?? null);
      big = v === null ? "Not available" : signed(v, 0).replace("±", "");
      direction = change?.changePp ?? 0;
      changeText = change?.changePp !== null && change?.changePp !== undefined ? `${change.changePp >= 0 ? "↑" : "↓"} ${Math.abs(change.changePp).toFixed(1)} points vs ${prevLabel}` : (change?.reason ?? "");
      foot = `Valid n = ${(scope === "all" ? t.base : (nps?.base ?? "-")).toLocaleString()}`;
    } else if (t.id === "satisfaction") {
      const box = one as CompanyBox | null;
      const mean = scope === "all" ? t.mean : (box?.mean ?? null);
      big = mean === null ? "Not available" : `${mean.toFixed(1)}${t.scaleTop ? ` / ${t.scaleTop}` : ""}`;
      direction = change?.meanChange ?? 0;
      changeText = change?.meanChange !== null && change?.meanChange !== undefined ? `${change.meanChange >= 0 ? "↑" : "↓"} ${Math.abs(change.meanChange).toFixed(2)} vs ${prevLabel}` : (change?.reason ?? "");
      const tb = scope === "all" ? t.box : (box?.box ?? null);
      foot = `Mean · top two ${tb === null ? "n/a" : `${tb.toFixed(1)}%`} · ${overview?.figures.weighted ? "effective" : "valid"} n = ${scope === "all" ? t.effectiveBase : (box?.effectiveBase ?? "-")}`;
    } else {
      const box = one as CompanyBox | null;
      const v = scope === "all" ? t.box : (box?.box ?? null);
      big = v === null ? "Not available" : `${v.toFixed(0)}%`;
      direction = change?.changePp ?? 0;
      changeText = change?.changePp !== null && change?.changePp !== undefined ? `${change.changePp >= 0 ? "↑" : "↓"} ${Math.abs(change.changePp).toFixed(1)} pp vs ${prevLabel}` : (change?.reason ?? "");
      foot = `${t.boxCodes === "8 to 10" ? "Answering 8 to 10" : "Top two box"} · ${v === null ? "" : `${v.toFixed(1)}% · `}${overview?.figures.weighted ? "effective" : "valid"} n = ${scope === "all" ? t.effectiveBase : (box?.effectiveBase ?? "-")}`;
    }
    // Good news is green: up for satisfaction, NPS and staying, down for switching.
    const good = t.id === "switch" ? direction < 0 : direction > 0;
    return (
      <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="tracker-csm-tile">
        <p className="text-sm text-slate-500">{meta.title}</p>
        <p className="mt-3 text-[2.25rem] font-bold tabular-nums leading-none text-slate-900">{big}</p>
        <p className={`mt-3 text-xs ${direction === 0 ? "text-slate-500" : good ? "text-emerald-700" : "text-red-700"}`} data-testid="tracker-csm-change">
          {changeText.replace(" vs null", "")}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {foot}
          {splitFailed ? `. ${splitFailed}` : ""}
        </p>
      </div>
    );
  };

  /** Every company side by side: each headline and its change since the previous wave (D3b). */
  const companyTable = companyInfo && overview && (
    <Card title="By company" subtitle={`${companyInfo.label}. Change since the previous wave in points, no significance test yet.`} testId="tracker-csm-companies">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500">
              <th className="py-1 pr-3 font-medium">Company</th>
              {overview.csm
                .filter((t) => t.id !== "drivers" && t.status === "ok")
                .map((t) => (
                  <th key={t.id} className="py-1 pr-3 font-medium">
                    {CSM_TILE[t.id].title}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {companyInfo.companies.map((c) => (
              <tr key={c.code} className={`border-t border-slate-100 ${companyInfo.focal?.code === c.code ? "bg-blue-50 font-medium" : ""}`} data-testid="tracker-csm-company-row">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-900">
                  {c.label}
                  {companyInfo.focal?.code === c.code ? " (yours)" : ""}
                </th>
                {overview.csm
                  .filter((t) => t.id !== "drivers" && t.status === "ok")
                  .map((t) => {
                    const x = companyOf(t, c.code);
                    const v = x === null ? null : "nps" in x ? x.nps : x.box;
                    const d = pp(csmChange(t.id, c.code)?.changePp ?? null);
                    return (
                      <td key={t.id} className="py-1.5 pr-3 align-top tabular-nums">
                        {v === null ? "n/a" : t.id === "recommend" ? v.toFixed(1) : `${v.toFixed(1)}%`}
                        {d && <span className="block text-[10px] text-slate-500">{d}</span>}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const csmView = overview && dashboard && (() => {
    const blankCsm = overview.csm.filter((t) => t.status === "missing").map((t) => `csm:${t.id}`);
    const sat = tileOf("satisfaction");
    const nps = tileOf("recommend");
    const drv = tileOf("drivers");
    const npsReady = nps?.status === "ok";
    const driversReady = drv?.status === "ok";
    const scaleTop = sat && sat.status === "ok" && sat.id === "satisfaction" ? sat.scaleTop : null;
    const attrs = overview.attributes.filter((a) => a.mean !== null);
    const lowest = attrs.length ? attrs.reduce((a, b) => ((b.mean as number) / (b.scaleTop || 1) < (a.mean as number) / (a.scaleTop || 1) ? b : a)) : null;
    const satScoped = sat && sat.status === "ok" && sat.id === "satisfaction" ? (scope === "all" ? sat.effectiveBase : (companyOf(sat, scope) as CompanyBox | null)?.effectiveBase ?? null) : null;
    const baseN = satScoped;
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Customer experience dashboard</h2>
            <p className="mt-1 text-sm text-slate-500">Company tracker · generated from recognised questions and connected analytics</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-semibold">
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700">Auto-generated</span>
              <span className={`rounded-md px-2.5 py-1 ${npsReady ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{npsReady ? "NPS ready" : "NPS not available"}</span>
              <span className={`rounded-md px-2.5 py-1 ${driversReady ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{driversReady ? "Drivers ready" : "Drivers not available"}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
              Customise dashboard
            </button>
            <p className="text-[11px] text-slate-500">Choices saved for the {overview.view.scope} · kept for new waves</p>
          </div>
        </div>
        <div role="tablist" aria-label="Dashboard sections" className="flex gap-10 border-b border-slate-200">
          {(
            [
              ["company", "Company"],
              ["channels", "Channels"],
              ["nps", "NPS & loyalty"],
              ["drivers", "Drivers"],
            ] as const
          ).map(([id, label]) =>
            id === "channels" ? (
              <span key={id} className="-mb-px border-b-2 border-transparent pb-3 text-[15px] text-slate-400" title="No channel questions are recognised yet">
                {label}
              </span>
            ) : (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={csmTab === id}
                onClick={() => setCsmTab(id)}
                className={`-mb-px border-b-[3px] pb-3 text-[15px] ${csmTab === id ? "border-blue-600 font-semibold text-blue-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {companyInfo ? (
            <label className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
              <span className="sr-only">Show figures for</span>
              <select aria-label="Show figures for" value={scope} onChange={(e) => setCompanyScope(e.target.value)} className="bg-transparent font-medium text-slate-900 outline-none">
                <option value="all">All customers</option>
                {companyInfo.companies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                    {companyInfo.focal?.code === c.code ? (companyInfo.focal.source === "chosen" ? " (yours)" : " (suggested as yours)") : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Chip label="Company">All customers</Chip>
          )}
          <Chip label="Wave">{overview.wave ?? "Not labelled"}</Chip>
          <Chip label="Segment">All segments</Chip>
          <Chip label="" onClick={() => chooseAt("overallSatisfaction")}>{overview.figures.weighted ? "Weighted" : "Unweighted"}</Chip>
          <span className="ml-auto text-xs text-slate-500">{baseN !== null ? `${scopeLabel} base n = ${baseN.toLocaleString()}` : ""}</span>
        </div>
        {overview.csmCompany && "note" in overview.csmCompany && <p className="text-xs text-amber-900">{overview.csmCompany.note}</p>}
        {customising && customise}
        {statusLine}
        {hiddenNote(blankCsm.filter((id) => hidden.has(id)))}
        {csmTab === "company" && (
          <>
            <section aria-label="Customer satisfaction" className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="tracker-csm" data-scope={scope}>
              {overview.csm.filter((t) => t.id !== "drivers").map(csmTileView)}
            </section>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
              <Card
                title="Overall satisfaction trend"
                subtitle={`Mean${scaleTop ? ` on its ${scaleTop}-point scale` : ""} · all customers · ${overview.figures.weighted ? "weighted" : "unweighted"}`}
                testId="tracker-csm-trend"
              >
                {overview.timeline.length > 0 ? (
                  <>
                    <WaveLine height={210} width={620} colour="#2563eb" yMax={scaleTop ?? undefined} format={(v) => v.toFixed(1)} points={overview.timeline.map((p) => ({ tick: waveTick(p), value: p.satisfaction?.mean ?? null }))} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Wave bases: {overview.timeline.map((p) => (p.satisfaction?.effectiveBase ?? "-").toLocaleString()).join(" / ")}
                      {overview.timeline.some((p) => p.status === "failed") ? `. ${overview.timeline.filter((p) => p.status === "failed").map((p) => `${p.wave}: ${p.error}`).join(" ")}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">This file is not labelled as a wave, so there is no trend to draw.</p>
                )}
              </Card>
              <Card title="Service attributes" subtitle={`Mean on each attribute's own scale · ${scopeLabel === "All customers" ? "all customers" : "all customers (not split by company yet)"}`} testId="tracker-csm-attributes">
                {overview.attributes.length === 0 ? (
                  <BlankTile title="Service attributes" text="No driver ratings were found in this file." onChoose={() => chooseAt("drivers")} onHide={() => setHidden("csm:drivers", true)} testId="tracker-csm-attributes-blank" />
                ) : (
                  <ul className="flex flex-col gap-3 text-sm">
                    {overview.attributes.map((a) => (
                      <li key={a.variable} className="grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)_2.5rem] items-center gap-3" title={a.error ?? a.label}>
                        <span className="truncate text-slate-700">{a.label}</span>
                        <span className="h-2.5 rounded-full bg-slate-100">
                          <span className="block h-full rounded-full" style={{ width: `${a.mean !== null && a.scaleTop ? Math.min(100, (a.mean / a.scaleTop) * 100) : 0}%`, background: lowest && a.variable === lowest.variable ? "#e9a94b" : "#5b8def" }} />
                        </span>
                        <span className="text-right font-semibold tabular-nums text-slate-900">{a.mean === null ? "n/a" : a.mean.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
              {npsSummary()}
              {driverPriority(false)}
            </div>
            {companyTable}
          </>
        )}
        {csmTab === "nps" && (
          <div className="grid grid-cols-1 gap-4">
            {npsSummary()}
            {companyTable}
          </div>
        )}
        {csmTab === "drivers" && driverPriority(true)}
      </>
    );

    function npsSummary() {
      if (!nps || nps.status !== "ok" || nps.id !== "recommend")
        return nps && hidden.has("csm:recommend") ? null : <Card title="NPS summary">{nps ? csmTileView(nps) : null}</Card>;
      const det = nps.detractors;
      const pas = nps.passives;
      const pro = nps.promoters;
      return (
        <Card title="NPS summary" subtitle={`From the NPS module · valid n = ${nps.base.toLocaleString()} · all customers`} testId="tracker-csm-nps">
          <div className="flex h-9 w-full overflow-hidden rounded text-sm font-semibold text-white" role="img" aria-label={`${det.toFixed(0)}% detractors, ${pas.toFixed(0)}% passives, ${pro.toFixed(0)}% promoters`}>
            <span className="flex items-center justify-center bg-[#d9887a]" style={{ width: `${det}%` }}>{det >= 6 ? det.toFixed(0) : ""}</span>
            <span className="flex items-center justify-center bg-[#a9b8cb]" style={{ width: `${pas}%` }}>{pas >= 6 ? pas.toFixed(0) : ""}</span>
            <span className="flex items-center justify-center bg-[#2563eb]" style={{ width: `${pro}%` }}>{pro >= 6 ? pro.toFixed(0) : ""}</span>
          </div>
          <p className="mt-3 flex gap-5 text-xs text-slate-500">
            <span>{det.toFixed(0)}% detractors</span>
            <span>{pas.toFixed(0)}% passives</span>
            <span>{pro.toFixed(0)}% promoters</span>
          </p>
          <p className="mt-5 text-sm font-semibold text-slate-900">
            NPS = {pro.toFixed(0)} − {det.toFixed(0)} = {signed(nps.nps, 0).replace("±", "")}
          </p>
        </Card>
      );
    }

    function driverPriority(full: boolean) {
      if (!drv || drv.status !== "ok" || drv.id !== "drivers") return drv && drv.status !== "missing" ? <Card title="Driver priority">{csmTileView(drv)}</Card> : hidden.has("csm:drivers") ? null : <Card title="Driver priority"><BlankTile title="Driver priority" text={drv?.status === "missing" ? drv.reason : "Not available."} onChoose={() => chooseAt("drivers")} onHide={() => setHidden("csm:drivers", true)} testId="tracker-csm-tile" /></Card>;
      const top = drv.rows[0];
      const topMean = overview!.attributes.find((a) => a.variable === top?.variable);
      return (
        <Card title="Driver priority" subtitle={`Driver analysis · target: ${drv.label} · ${drv.method === "shapley" ? "Shapley" : drv.method === "relative_weights" ? "relative weights" : "standardised coefficients"}, R² ${drv.rSquared.toFixed(2)}, ${drv.n} cases`} testId="tracker-drivers">
          {top && (
            <>
              <p className="text-2xl font-bold text-slate-900">{top.label}</p>
              <p className="mt-2 text-xs text-slate-500">
                {(top.share * 100).toFixed(0)}% relative importance
                {topMean?.mean !== null && topMean?.mean !== undefined ? ` · ${topMean.mean.toFixed(1)}${topMean.scaleTop ? ` / ${topMean.scaleTop}` : ""} mean` : ""}
              </p>
              <p className="mt-4 text-xs text-slate-500">Investigate first. Association does not establish cause.</p>
            </>
          )}
          {(full || drv.rows.length > 1) && (
            <ol className={`${full ? "mt-4" : "mt-4"} flex flex-col gap-1.5 text-xs`}>
              {(full ? drv.rows : drv.rows.slice(0, 6)).map((r, i) => (
                <li key={r.variable} className="grid grid-cols-[1.6rem_minmax(0,1fr)_minmax(5rem,12rem)_3rem] items-center gap-2">
                  <span className="font-semibold text-blue-600">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate text-slate-700">{r.label}</span>
                  {/* Bars are drawn against the largest share, so the ranking reads at a glance; the figure is the share. */}
                  <span className="h-2 rounded bg-blue-500/70" style={{ width: `${Math.round((r.share / Math.max(...drv.rows.map((x) => x.share), 1e-9)) * 100)}%` }} aria-hidden />
                  <span className="text-right tabular-nums text-slate-900">{(r.share * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ol>
          )}
          {!full && (
            <button type="button" onClick={() => setCsmTab("drivers")} className="mt-3 text-xs text-blue-600 hover:underline">
              All drivers ↗
            </button>
          )}
        </Card>
      );
    }
  })();

  const title = kind === "brand" ? "Brand tracking dashboard" : "CSM dashboard";
  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f7fb]" role="dialog" aria-label={title}>
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">{kind === "brand" ? "Brand tracking" : "CSM Analytics"}</p>
          <p className="truncate text-[11px] text-slate-500">
            {filename}
            {overview?.wave ? ` / ${overview.wave}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
          {closeLabel === "Close" ? "Close" : `← ${closeLabel}`}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {kind === "brand" && (
          <nav aria-label="Brand tracking sections" className="hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white px-3 py-5 lg:flex">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Workspace</p>
            <p className="px-2 text-lg font-bold text-slate-900">Brand tracking</p>
            <p className="mb-4 truncate px-2 text-xs text-slate-500">{focal ? `${focal.label} / ${overview?.wave ?? ""}` : filename}</p>
            {BRAND_SECTIONS.map((s, i) => (
              <span
                key={s}
                aria-current={i === 0 ? "page" : undefined}
                title={i === 0 ? undefined : "Coming next"}
                className={`flex items-baseline gap-3 rounded-lg px-3 py-2.5 text-sm ${i === 0 ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-400"}`}
              >
                <span className="text-xs font-semibold">{String(i + 1).padStart(2, "0")}</span>
                {s}
              </span>
            ))}
          </nav>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-5 px-6 py-6">
            {load.state === "loading" && (
              <p className="text-sm text-slate-500" role="status">
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
            {kind === "brand" ? brandView : csmView}
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

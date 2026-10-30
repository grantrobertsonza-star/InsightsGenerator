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
import { loadBrandAdvertisingAction, loadBrandAssociationsAction, loadBrandAudienceAction, loadCategoryOverviewAction, loadBrandMomentsAction, loadBrandOverviewAction, resetTrackerChoicesAction, saveTrackerChoicesAction } from "@/lib/trackerDashboardActions";
import type { BrandMoments } from "@/lib/trackerMoments";
import type { BrandAssociations } from "@/lib/trackerAssociations";
import type { BrandAdvertising } from "@/lib/trackerAdvertising";
import type { BrandAudience, ProfileRow } from "@/lib/trackerAudience";
import type { CategoryOverview, Distribution } from "@/lib/trackerCategory";
import type { BrandOverview, TimelinePoint } from "@/lib/trackerOverview";
import type { TrackerChoices } from "@/lib/trackerDashboard";
import type { CompanyBox, CompanyNps, CsmTile, CsmTileId } from "@/lib/trackerCsmFigures";
import type { FunnelStage } from "@/lib/trackerRoles";
import { searchVariables } from "@/lib/variableSearch";
import { QuestionPicker, variableText } from "./QuestionPicker";
import { CardSegmentBase, SegmentBaseContext, SegmentChip, useStoredSegment } from "./SegmentPicker";
import type { SegmentQuestion } from "@/lib/trackerSegment";

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
/** The brand dashboard's pages, all built (batch M4); a page's number in the menu is its place here. */
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
/** Page 02's figures, loaded when the page is first opened and again after any reload of the dashboard ("idle"). */
type MomentsLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; moments: BrandMoments };
/** Page 03's figures, loaded the same way as page 02's. */
type AssociationsLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; associations: BrandAssociations };
/** Page 04's figures, loaded the same way as page 02's. */
type AdvertisingLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; advertising: BrandAdvertising };
/** Page 05's figures, loaded the same way as page 02's. */
type AudienceLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; audience: BrandAudience };
/** The Category overview page's figures, loaded the same way as page 02's. */
type CategoryLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; category: CategoryOverview };
/** A word of mouth group's colour, from its wording (presentation only; the group's identity is its code). */
function womColour(key: string, label: string): string {
  if (key === "unaware") return "#e2e8f0";
  if (/\bpositive\b/i.test(label)) return "#059669";
  if (/\bnegative\b/i.test(label)) return "#dc2626";
  if (/\bmixed\b/i.test(label)) return "#d97706";
  if (/\bneutral\b/i.test(label)) return "#64748b";
  if (/\bnot heard\b|\bnothing\b/i.test(label)) return "#cbd5e1";
  return COMPARATOR_COLOURS[Math.abs([...key].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % COMPARATOR_COLOURS.length];
}
/** The compared brands' dot colours on page 03, by their place among the brands compared; the client's brand is blue. */
const COMPARATOR_COLOURS = ["#d97706", "#059669", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#475569", "#ea580c"];
const FOCAL_COLOUR = "#2563eb";
type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "message"; tone: "error" | "warn"; text: string };

function Card({ title, subtitle, children, testId, className = "" }: { title?: string; subtitle?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`} data-testid={testId} aria-label={title}>
      {title && <h3 className="text-lg font-semibold text-slate-900">{title}</h3>}
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      {/* R5: under a segment every card names it with the page's segment base. */}
      <CardSegmentBase />
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** A part of the page the file does not have, or that cannot be told: said in place of the card's figures, never as
 * zeros (Grant's design: "Not measured", "Mapping needed"). */
function UnavailableNote({ state, testId }: { state: { status: "not_measured" | "mapping_needed"; reason: string }; testId: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid={testId} data-status={state.status}>
      <p className="text-sm font-semibold text-slate-700">{state.status === "not_measured" ? "Not measured" : "Mapping needed"}</p>
      <p className="mt-1 text-xs text-slate-500">{state.reason}</p>
    </div>
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
  // The brand dashboard's page, by its place in BRAND_SECTIONS: 0 Brand overview (the default), 1 Moments & needs,
  // 2 Brand associations, 3 Advertising & WOM, 4 Audience & media, 5 Category overview.
  const [section, setSection] = useState(0);
  const [moments, setMoments] = useState<MomentsLoad>({ state: "idle" });
  const [associations, setAssociations] = useState<AssociationsLoad>({ state: "idle" });
  const [advertising, setAdvertising] = useState<AdvertisingLoad>({ state: "idle" });
  const [audience, setAudience] = useState<AudienceLoad>({ state: "idle" });
  const [category, setCategory] = useState<CategoryLoad>({ state: "idle" });
  // R5: the segment every page is computed on (SegmentPicker.tsx; remembered in this browser). A change reloads every
  // page through reload() below, whose request counters drop any answer computed for an earlier segment.
  const [segment, setSegment] = useStoredSegment(runId, kind);
  // The file's profile questions from the last load, so the Segment chip stays usable while a segment is calculated
  // or after one was refused.
  const [segmentQuestions, setSegmentQuestions] = useState<SegmentQuestion[]>([]);
  // Only the latest request may update the screen: a slow earlier load (or one for another file) is ignored.
  const latest = useRef(0);
  const latestMoments = useRef(0);
  const latestAssociations = useRef(0);
  const latestAdvertising = useRef(0);
  const latestAudience = useRef(0);
  const latestCategory = useRef(0);

  const loadMoments = useCallback(async () => {
    const id = ++latestMoments.current;
    setMoments({ state: "loading" });
    const r = await loadBrandMomentsAction(runId, documentId, segment);
    if (id !== latestMoments.current) return;
    setMoments(r.ok ? { state: "ready", moments: r.moments } : { state: "failed", error: r.error });
  }, [runId, documentId, segment]);

  const loadAssociations = useCallback(async () => {
    const id = ++latestAssociations.current;
    setAssociations({ state: "loading" });
    const r = await loadBrandAssociationsAction(runId, documentId, segment);
    if (id !== latestAssociations.current) return;
    setAssociations(r.ok ? { state: "ready", associations: r.associations } : { state: "failed", error: r.error });
  }, [runId, documentId, segment]);

  const loadAdvertising = useCallback(async () => {
    const id = ++latestAdvertising.current;
    setAdvertising({ state: "loading" });
    const r = await loadBrandAdvertisingAction(runId, documentId, segment);
    if (id !== latestAdvertising.current) return;
    setAdvertising(r.ok ? { state: "ready", advertising: r.advertising } : { state: "failed", error: r.error });
  }, [runId, documentId, segment]);

  const loadAudience = useCallback(async () => {
    const id = ++latestAudience.current;
    setAudience({ state: "loading" });
    const r = await loadBrandAudienceAction(runId, documentId, segment);
    if (id !== latestAudience.current) return;
    setAudience(r.ok ? { state: "ready", audience: r.audience } : { state: "failed", error: r.error });
  }, [runId, documentId, segment]);

  const loadCategory = useCallback(async () => {
    const id = ++latestCategory.current;
    setCategory({ state: "loading" });
    const r = await loadCategoryOverviewAction(runId, documentId, segment);
    if (id !== latestCategory.current) return;
    setCategory(r.ok ? { state: "ready", category: r.category } : { state: "failed", error: r.error });
  }, [runId, documentId, segment]);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ state: "loading" });
    // Pages 02 to 06 depend on the same choices (weighting, brands, the stage questions): any answer still on
    // its way is dropped, and each page loads again when shown.
    latestMoments.current += 1;
    setMoments({ state: "idle" });
    latestAssociations.current += 1;
    setAssociations({ state: "idle" });
    latestAdvertising.current += 1;
    setAdvertising({ state: "idle" });
    latestAudience.current += 1;
    setAudience({ state: "idle" });
    latestCategory.current += 1;
    setCategory({ state: "idle" });
    const r = await loadBrandOverviewAction(runId, documentId, kind, segment);
    if (id !== latest.current) return;
    if (!r.ok) return setLoad({ state: "failed", error: r.error });
    setLoad({ state: "ready", overview: r.overview });
    setSegmentQuestions(r.overview.segmentQuestions);
    setDraft(r.overview.view.choices);
  }, [runId, documentId, kind, segment]);

  useEffect(() => {
    // The first load of this file; reload() sets state only after the server answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      latest.current += 1;
      latestMoments.current += 1;
      latestAssociations.current += 1;
      latestAdvertising.current += 1;
      latestAudience.current += 1;
      latestCategory.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    // Page 02 is calculated only when it is shown, once per load of the dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (kind === "brand" && section === 1 && moments.state === "idle") void loadMoments();
  }, [kind, section, moments.state, loadMoments]);

  useEffect(() => {
    // Page 03 likewise: calculated only when shown, once per load of the dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (kind === "brand" && section === 2 && associations.state === "idle") void loadAssociations();
  }, [kind, section, associations.state, loadAssociations]);

  useEffect(() => {
    // Page 04 likewise: calculated only when shown, once per load of the dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (kind === "brand" && section === 3 && advertising.state === "idle") void loadAdvertising();
  }, [kind, section, advertising.state, loadAdvertising]);

  useEffect(() => {
    // Page 05 likewise: calculated only when shown, once per load of the dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (kind === "brand" && section === 4 && audience.state === "idle") void loadAudience();
  }, [kind, section, audience.state, loadAudience]);

  useEffect(() => {
    // The Category overview likewise: calculated only when shown, once per load of the dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (kind === "brand" && section === 5 && category.state === "idle") void loadCategory();
  }, [kind, section, category.state, loadCategory]);

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

  // The brand dashboard's chips row, the same on every page (Grant's design). `weighted` is the page's own figures'.
  const brandChips = (weighted: boolean) => (
    <div className="flex flex-wrap gap-2.5" data-testid="tracker-chips">
      <Chip label="Brand" onClick={() => chooseAt("brand")}>{focal?.label ?? "Choose"}</Chip>
      <Chip label="Wave">{overview?.wave ?? "Not labelled"}</Chip>
      <Chip label="Compare" onClick={() => setPickingComparators((v) => !v)}>{comparators ? "Selected brands" : "Suggested brands"}</Chip>
      <Chip label="Weighting" onClick={() => chooseAt("brand")}>{weighted ? "On" : "Off"}</Chip>
      <SegmentChip questions={segmentQuestions} segment={segment} onApply={setSegment} />
    </div>
  );
  // The brands compared (the Compare chip): one selection for every page, not saved yet.
  const comparatorPicker = pickingComparators && dashboard && (
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
  );

  // ---- Brand tracking dashboard (preview: "Brand overview") ----------------------------------------------------
  const brandView = overview && dashboard && (() => {
    const blankStages = overview.stageTiles.filter((t) => t.status !== "shown").map((t) => `stage:${t.stage}`);
    const shownStages = overview.figures.stages;
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
        {brandChips(overview.figures.weighted)}
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
          {overview.segment && overview.previous.status === "ok" ? ` Within the segment ${overview.segment.text}, applied in both waves.` : ""}
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
            {comparatorPicker}
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

  // ---- Brand tracking dashboard, page 02 "Moments & needs" (Grant's design, 29 October 2026) ------------------
  const momentsView = overview && dashboard && (() => {
    const m = moments.state === "ready" ? moments.moments : null;
    // Columns: the client's brand, then the brands compared (the Compare chip), by code.
    const columns = [...(focal ? [focal.code] : []), ...shown.filter((c) => c !== focal?.code)];
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const nText = (bases: (number | null)[]) => {
      const known = [...new Set(bases.filter((b): b is number => b !== null))];
      return known.length === 0 ? "" : known.length === 1 ? `n=${known[0].toLocaleString()}` : `n=${Math.min(...known).toLocaleString()} to ${Math.max(...known).toLocaleString()}`;
    };
    const weighting = m ? (m.weighted ? `Weighted by ${m.weightVar}${m.effectiveBase !== null ? `, effective base ${Math.round(m.effectiveBase)}` : ""}` : "Unweighted") : "";
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Moments &amp; needs</h2>
            <p className="mt-1 text-[15px] text-slate-500">Understand category needs, then see which brands come to mind for each.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        {brandChips(m ? m.weighted : overview.figures.weighted)}
        {customising && customise}
        {statusLine}
        {moments.state === "loading" || moments.state === "idle" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating moments and brand recall from this file...
          </p>
        ) : moments.state === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-moments-failed">
            <p>Moments and brand recall could not be calculated: {moments.error}</p>
            <button type="button" onClick={() => void loadMoments()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        ) : (
          m && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <Card
                title="Category moments"
                subtitle={m.relevance.status === "ok" ? `Personal relevance, multiple response; ${nText(m.relevance.moments.map((x) => x.base))}. ${weighting}.` : "Personal relevance, multiple response."}
                testId="tracker-moments-relevance"
              >
                {m.relevance.status !== "ok" ? (
                  <UnavailableNote state={m.relevance} testId="tracker-moments-relevance-unavailable" />
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {m.relevance.moments.map((x) => (
                      <li key={x.variable} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm" data-testid="tracker-moment" title={x.reason}>
                        <span className="truncate text-slate-700">{x.item}</span>
                        <span className="h-3 rounded bg-slate-100">
                          <span className="block h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, x.share ?? 0))}%` }} />
                        </span>
                        <span className="text-right font-semibold tabular-nums text-slate-900" data-testid="tracker-moment-share">
                          {x.share === null ? "n/a" : pct(x.share)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
              <Card
                title="Moment x brand recall"
                subtitle={
                  m.recall.status === "ok"
                    ? `Cue-specific recall, not personal relevance. All eligible, ${nText(m.recall.rows.flatMap((r) => r.cells.filter((c) => columns.includes(c.code)).map((c) => c.base)))}. ${weighting}.`
                    : "Cue-specific recall, not personal relevance."
                }
                testId="tracker-moments-recall"
              >
                {comparatorPicker}
                {m.recall.status !== "ok" ? (
                  <UnavailableNote state={m.recall} testId="tracker-moments-recall-unavailable" />
                ) : (
                  (() => {
                    const rows = m.recall.rows;
                    const values = rows.flatMap((r) => r.cells.filter((c) => columns.includes(c.code)).map((c) => c.share)).filter((v): v is number => v !== null);
                    const top = values.length ? Math.max(...values) : 0;
                    return (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full border-separate border-spacing-1 text-sm" data-testid="tracker-recall-table">
                            <thead>
                              <tr>
                                <th scope="col" className="text-left text-xs font-medium text-slate-500">
                                  Moment
                                </th>
                                {columns.map((code) => (
                                  <th key={code} scope="col" className={`px-1 text-center text-xs font-semibold ${code === focal?.code ? "text-blue-700" : "text-slate-700"}`}>
                                    {brandLabel.get(code) ?? code}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.variable} data-testid="tracker-recall-row">
                                  <th scope="row" className="max-w-[14rem] truncate pr-2 text-left font-normal text-slate-700" title={`${r.item}: ${pct(r.relevance)} find it relevant`}>
                                    {r.item}
                                  </th>
                                  {columns.map((code) => {
                                    const c = r.cells.find((x) => x.code === code);
                                    const v = c?.share ?? null;
                                    const depth = v === null || top === 0 ? 0 : v / top;
                                    return (
                                      <td
                                        key={code}
                                        className="rounded-md px-2 py-2 text-center tabular-nums"
                                        style={v === null ? undefined : { background: `rgba(37, 99, 235, ${(0.08 + 0.82 * depth).toFixed(3)})`, color: depth > 0.55 ? "#ffffff" : "#0f172a" }}
                                        title={c?.reason ?? `${brandLabel.get(code) ?? code}, ${r.item}`}
                                        data-testid="tracker-recall-cell"
                                        data-code={code}
                                      >
                                        {v === null ? <span className="text-slate-400">n/a</span> : pct(v)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-3 text-[11px] text-slate-500">
                          {rows.length === 6 ? "Six moments" : `${rows.length} moment${rows.length === 1 ? "" : "s"}`} selected by highest category relevance. Darker blue = greater cue-specific brand recall; no statistical comparison implied.
                          {m.recall.withoutRecall.length > 0 && ` Not shown, as no brand recall was asked for them: ${m.recall.withoutRecall.join(", ")}.`}
                        </p>
                      </>
                    );
                  })()
                )}
              </Card>
            </div>
          )
        )}
      </>
    );
  })();

  // ---- Brand tracking dashboard, page 03 "Brand associations" (Grant's design, 29 October 2026) --------------
  const associationsView = overview && dashboard && (() => {
    const a = associations.state === "ready" ? associations.associations : null;
    // Dots: the client's brand, then the brands compared (the Compare chip), by code; each compared brand keeps its
    // colour by its place in that selection.
    const others = shown.filter((c) => c !== focal?.code);
    const plotted = [...(focal ? [focal.code] : []), ...others];
    const colourOf = (code: string) => (code === focal?.code ? FOCAL_COLOUR : COMPARATOR_COLOURS[others.indexOf(code) % COMPARATOR_COLOURS.length]);
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const weighting = a ? (a.weighted ? `Weighted by ${a.weightVar}` : "Unweighted") : "";
    const profile = a?.profile.status === "ok" ? a.profile : null;
    const values = profile ? profile.attributes.flatMap((r) => r.cells.filter((c) => plotted.includes(c.code)).map((c) => c.share)).filter((v): v is number => v !== null) : [];
    // The axis runs to 80% (Grant's design) unless a figure shown is higher; then to the next 20 above it.
    const axisMax = Math.min(100, Math.max(80, Math.ceil(Math.max(0, ...values) / 20) * 20));
    const ticks = Array.from({ length: axisMax / 20 + 1 }, (_, i) => i * 20);
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Brand associations</h2>
            <p className="mt-1 text-[15px] text-slate-500">Compare what aware respondents associate with each brand.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        {brandChips(a ? a.weighted : overview.figures.weighted)}
        {customising && customise}
        {statusLine}
        {associations.state === "loading" || associations.state === "idle" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating brand associations from this file...
          </p>
        ) : associations.state === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-associations-failed">
            <p>Brand associations could not be calculated: {associations.error}</p>
            <button type="button" onClick={() => void loadAssociations()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        ) : (
          a && (
            <Card
              title="Association profile"
              subtitle={`Pick-any associations. Each brand uses its own awareness base; these are not agreement scores.${profile ? ` ${weighting}.` : ""}`}
              testId="tracker-associations-profile"
            >
              {comparatorPicker}
              {a.profile.status !== "ok" ? (
                <UnavailableNote state={a.profile} testId="tracker-associations-unavailable" />
              ) : (
                <>
                  <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700" aria-label="Legend" data-testid="tracker-associations-legend">
                    {plotted.map((code) => (
                      <li key={code} className="flex items-center gap-1.5">
                        <span className={`inline-block rounded-full ${code === focal?.code ? "h-3 w-3" : "h-2.5 w-2.5"}`} style={{ background: colourOf(code) }} aria-hidden="true" />
                        <span className={code === focal?.code ? "font-semibold text-slate-900" : ""}>{brandLabel.get(code) ?? code}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] gap-x-3 text-sm">
                    <span />
                    <div className="relative h-5 text-[11px] text-slate-400" aria-hidden="true">
                      {ticks.map((t) => (
                        <span key={t} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: `${(t / axisMax) * 100}%` }}>
                          {t}%
                        </span>
                      ))}
                    </div>
                    <span className="text-right text-[11px] font-medium text-slate-500">{focal ? (brandLabel.get(focal.code) ?? focal.code) : ""}</span>
                    {a.profile.attributes.map((r) => {
                      const cells = plotted.map((code) => ({ code, cell: r.cells.find((c) => c.code === code) }));
                      const mine = focal ? r.cells.find((c) => c.code === focal.code) : undefined;
                      const described = cells.map(({ code, cell }) => `${brandLabel.get(code) ?? code} ${cell?.share === null || cell?.share === undefined ? "n/a" : pct(cell.share)}`).join(", ");
                      return (
                        <div key={r.group} className="contents" data-testid="tracker-association-row">
                          <span className="truncate py-2 text-slate-700" title={r.item}>
                            {r.item}
                          </span>
                          <div className="relative my-auto h-6" role="img" aria-label={`${r.item}: ${described}`}>
                            <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
                            {ticks.slice(1, -1).map((t) => (
                              <span key={t} className="absolute inset-y-1 w-px bg-slate-100" style={{ left: `${(t / axisMax) * 100}%` }} />
                            ))}
                            {/* Compared brands first, so the client's dot is drawn on top. */}
                            {[...cells].reverse().map(({ code, cell }) =>
                              cell?.share === null || cell?.share === undefined ? null : (
                                <span
                                  key={code}
                                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${code === focal?.code ? "h-3.5 w-3.5" : "h-2.5 w-2.5"}`}
                                  style={{ left: `${(Math.min(cell.share, axisMax) / axisMax) * 100}%`, background: colourOf(code) }}
                                  title={`${brandLabel.get(code) ?? code}: ${pct(cell.share)} of ${cell.base?.toLocaleString() ?? "?"} aware`}
                                  data-testid="tracker-association-dot"
                                  data-code={code}
                                />
                              ),
                            )}
                          </div>
                          <span className="py-2 text-right font-semibold tabular-nums text-slate-900" data-testid="tracker-association-focal" title={mine?.reason}>
                            {!mine ? "-" : mine.share === null ? <span className="text-slate-400">n/a</span> : pct(mine.share)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const missing = plotted.flatMap((code) => {
                      const reasons = [...new Set(a.profile.status === "ok" ? a.profile.attributes.map((r) => r.cells.find((c) => c.code === code)).filter((c) => c && c.share === null).map((c) => c!.reason ?? "Not available.") : [])];
                      return reasons.length ? [`${brandLabel.get(code) ?? code}: ${reasons.join(" ")}`] : [];
                    });
                    return missing.length > 0 && <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-associations-na">n/a: {missing.join(" ")}</p>;
                  })()}
                  <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-associations-bases">
                    Aware bases:{" "}
                    {plotted
                      .map((code) => {
                        const b = profile!.bases.find((x) => x.code === code);
                        return `${brandLabel.get(code) ?? code} ${b?.n === null || b?.n === undefined ? "n/a" : b.n.toLocaleString()}`;
                      })
                      .join(" | ")}
                    . Positioning model appears only when a supported analysis has completed.
                  </p>
                </>
              )}
            </Card>
          )
        )}
      </>
    );
  })();

  // ---- Brand tracking dashboard, page 04 "Advertising & WOM" (Grant's design, 29 October 2026) --------------
  const advertisingView = overview && dashboard && (() => {
    const a = advertising.state === "ready" ? advertising.advertising : null;
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const weighting = a ? (a.weighted ? `Weighted by ${a.weightVar}${a.effectiveBase !== null ? `, effective base ${Math.round(a.effectiveBase)}` : ""}` : "Unweighted") : "";
    const nText = (bases: (number | null)[]) => {
      const known = [...new Set(bases.filter((b): b is number => b !== null))];
      return known.length === 0 ? "" : known.length === 1 ? `n=${known[0].toLocaleString()}` : `n=${Math.min(...known).toLocaleString()} to ${Math.max(...known).toLocaleString()}`;
    };
    const recall = a?.recall.status === "ok" ? a.recall : null;
    const wom = a?.wom.status === "ok" ? a.wom : null;
    const focalRecall = recall && focal ? recall.brands.find((b) => b.code === focal.code) : undefined;
    // Word of mouth bars: the client's brand first, then the list's order.
    const womBrands = wom ? [...wom.brands].sort((x, y) => Number(y.code === focal?.code) - Number(x.code === focal?.code)) : [];
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Advertising &amp; WOM</h2>
            <p className="mt-1 text-[15px] text-slate-500">See which brands people recall advertising for, and what they have heard about each brand.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        {brandChips(a ? a.weighted : overview.figures.weighted)}
        {customising && customise}
        {statusLine}
        {advertising.state === "loading" || advertising.state === "idle" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating advertising recall and word of mouth from this file...
          </p>
        ) : advertising.state === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-advertising-failed">
            <p>Advertising recall and word of mouth could not be calculated: {advertising.error}</p>
            <button type="button" onClick={() => void loadAdvertising()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        ) : (
          a && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Card
                title="Advertising recall"
                subtitle={
                  recall
                    ? `Prompted recall among those asked about each brand; ${focalRecall?.base !== null && focalRecall?.base !== undefined ? `${brandLabel.get(focalRecall.code) ?? focalRecall.code} n=${focalRecall.base.toLocaleString()}, all brands ${nText(recall.brands.map((b) => b.base))}` : nText(recall.brands.map((b) => b.base))}. ${weighting}.`
                    : "Prompted recall."
                }
                testId="tracker-ad-recall"
              >
                {a.recall.status !== "ok" ? (
                  <UnavailableNote state={a.recall} testId="tracker-ad-recall-unavailable" />
                ) : (
                  <>
                    <ol className="flex flex-col gap-2.5">
                      {a.recall.brands.map((b) => {
                        const isFocal = b.code === focal?.code;
                        return (
                          <li key={b.code} className={`grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem_5.5rem] items-center gap-3 rounded-md text-sm ${isFocal ? "bg-blue-50 font-semibold" : ""}`} data-testid="tracker-ad-recall-row" data-code={b.code} title={b.reason}>
                            <span className={`truncate ${isFocal ? "text-blue-700" : "text-slate-700"}`}>{brandLabel.get(b.code) ?? b.code}</span>
                            <span className="h-3 rounded bg-slate-100">
                              <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, b.yes ?? 0))}%`, background: isFocal ? FOCAL_COLOUR : "#94a3b8" }} />
                            </span>
                            <span className="text-right tabular-nums text-slate-900" data-testid="tracker-ad-recall-yes">
                              {b.yes === null ? <span className="text-slate-400">n/a</span> : pct(b.yes)}
                            </span>
                            <span className="text-right text-[11px] font-normal tabular-nums text-slate-500" data-testid="tracker-ad-recall-not-sure">
                              {a.recall.status === "ok" && a.recall.keepsNotSure ? (b.notSure === null ? "" : `not sure ${pct(b.notSure)}`) : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    {a.recall.brands.some((b) => b.yes === null) && (
                      <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-ad-recall-na">
                        n/a: {a.recall.brands.filter((b) => b.yes === null).map((b) => `${brandLabel.get(b.code) ?? b.code}: ${b.reason ?? "Not available."}`).join(" ")}
                      </p>
                    )}
                    <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-ad-recall-note">
                      Share answering yes to &ldquo;{a.recall.label}&rdquo;.{" "}
                      {a.recall.keepsNotSure ? "Not sure answers stay in the base and are shown apart, never counted as yes or no." : "This question has no not sure answer."} Self-reported recall is not verified ad exposure or an estimate of media effectiveness.
                    </p>
                  </>
                )}
              </Card>
              <Card
                title="Word of mouth"
                subtitle={wom ? `Exclusive groups; all eligible respondents; ${nText(wom.brands.map((b) => b.base))}. ${weighting}.` : "Exclusive groups; all eligible respondents."}
                testId="tracker-wom"
              >
                {a.wom.status !== "ok" ? (
                  <UnavailableNote state={a.wom} testId="tracker-wom-unavailable" />
                ) : (
                  <>
                    <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700" aria-label="Legend" data-testid="tracker-wom-legend">
                      {a.wom.groups.map((g) => (
                        <li key={g.key} className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: womColour(g.key, g.label) }} aria-hidden="true" />
                          {g.label}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-2.5">
                      {womBrands.map((b) => {
                        const isFocal = b.code === focal?.code;
                        const name = brandLabel.get(b.code) ?? b.code;
                        return (
                          <div key={b.code} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 text-sm" data-testid="tracker-wom-row" data-code={b.code}>
                            <span className={`truncate ${isFocal ? "font-semibold text-blue-700" : "text-slate-700"}`}>{name}</span>
                            {b.groups === null ? (
                              <span className="text-xs text-slate-400" title={b.reason}>
                                n/a
                              </span>
                            ) : (
                              <span className="flex h-5 overflow-hidden rounded" role="img" aria-label={`${name}: ${b.groups.map((g) => `${g.label} ${pct(g.share)}`).join(", ")}`}>
                                {b.groups.map((g) =>
                                  g.share <= 0 ? null : (
                                    <span key={g.key} className="block h-full" style={{ width: `${g.share}%`, background: womColour(g.key, g.label) }} title={`${g.label}: ${pct(g.share)}`} data-testid="tracker-wom-segment" data-key={g.key} />
                                  ),
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {a.wom.brands.some((b) => b.groups === null) && (
                      <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-wom-na">
                        n/a: {a.wom.brands.filter((b) => b.groups === null).map((b) => `${brandLabel.get(b.code) ?? b.code}: ${b.reason ?? "Not available."}`).join(" ")}
                      </p>
                    )}
                    {(() => {
                      const mine = focal ? a.wom.brands.find((b) => b.code === focal.code) : undefined;
                      return mine?.groups ? (
                        <p className="mt-3 text-xs text-slate-700" data-testid="tracker-wom-focal">
                          <span className="font-semibold text-blue-700">{focal!.label}:</span> {mine.groups.map((g) => `${g.label} ${pct(g.share)}`).join(" | ")}
                        </p>
                      ) : null;
                    })()}
                    <p className="mt-3 text-[11px] text-slate-500">
                      Each respondent is in one group per brand: the answer to &ldquo;{a.wom.label}&rdquo;, or Unaware of the brand. The groups add to 100%. Hover a segment for its share.
                    </p>
                  </>
                )}
              </Card>
            </div>
          )
        )}
      </>
    );
  })();

  // ---- Brand tracking dashboard, page 05 "Audience & media" (Grant's design, 29 October 2026) ---------------
  const audienceView = overview && dashboard && (() => {
    const a = audience.state === "ready" ? audience.audience : null;
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const weighting = a ? (a.weighted ? `Weighted by ${a.weightVar}` : "Unweighted") : "";
    const acq = a?.acquirers.status === "ok" ? a.acquirers : null;
    const brandName = acq?.brand.label ?? focal?.label ?? "your brand";
    const groupsText = acq
      ? `${brandName} recent acquirers ("${acq.label}", n=${acq.n === null ? "n/a" : acq.n.toLocaleString()}) vs all eligible category respondents (n=${a?.categoryN?.toLocaleString() ?? "n/a"})`
      : `All eligible category respondents (n=${a?.categoryN?.toLocaleString() ?? "n/a"})`;
    // Paired bars: the acquirers (the client's colour) and the category (grey), each with its value.
    const paired = (rows: ProfileRow[], testId: string) => (
      <ol className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 text-sm" data-testid={testId} data-key={r.key}>
            <span className="truncate text-slate-700" title={r.label}>
              {r.label}
            </span>
            <span className="flex flex-col gap-1">
              {(
                [
                  ["acquirers", r.acquirers, FOCAL_COLOUR],
                  ["category", r.category, "#94a3b8"],
                ] as const
              ).map(([which, g, colour]) => (
                <span key={which} className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-2" title={g.reason}>
                  <span className="h-2.5 rounded bg-slate-100">
                    <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, g.share ?? 0))}%`, background: colour }} />
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-900" data-testid={`${testId}-${which}`}>
                    {g.share === null ? <span className="text-slate-400">n/a</span> : pct(g.share)}
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    );
    const legend = (
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FOCAL_COLOUR }} aria-hidden="true" />
          {brandName} recent acquirers
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" aria-hidden="true" />
          All eligible category respondents
        </li>
      </ul>
    );
    const naNote = (rows: ProfileRow[], testId: string) => {
      const reasons = [...new Set(rows.filter((r) => r.acquirers.share === null).map((r) => r.acquirers.reason ?? "Not available."))];
      return reasons.length > 0 ? (
        <p className="mt-3 text-[11px] text-slate-500" data-testid={testId}>
          Acquirers n/a: {reasons.join(" ")}
        </p>
      ) : null;
    };
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Audience &amp; media</h2>
            <p className="mt-1 text-[15px] text-slate-500">Compare who recently acquired your brand with everyone in the category.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        {brandChips(a ? a.weighted : overview.figures.weighted)}
        {customising && customise}
        {statusLine}
        {audience.state === "loading" || audience.state === "idle" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating the audience profile and media use from this file...
          </p>
        ) : audience.state === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-audience-failed">
            <p>The audience profile and media use could not be calculated: {audience.error}</p>
            <button type="button" onClick={() => void loadAudience()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        ) : (
          a && (
            <>
              {a.acquirers.status !== "ok" ? (
                <UnavailableNote state={a.acquirers} testId="tracker-audience-acquirers-unavailable" />
              ) : a.acquirers.n === null || a.acquirers.n === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700" data-testid="tracker-audience-no-acquirers">
                  {a.acquirers.reason ?? `No recent acquirers of ${brandName} could be counted.`}
                </p>
              ) : a.acquirers.level === "very_small" ? (
                <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900" role="note" data-testid="tracker-audience-small-base" data-level="very_small">
                  VERY SMALL BASE: {brandName} recent acquirers n={a.acquirers.n.toLocaleString()}. Descriptive illustration only. No significance, targeting or market inference.
                </p>
              ) : a.acquirers.level === "small" ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note" data-testid="tracker-audience-small-base" data-level="small">
                  SMALL BASE: {brandName} recent acquirers n={a.acquirers.n.toLocaleString()}. Read with caution; no significance test is applied.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Card title="Age profile" subtitle={`${groupsText}. ${weighting}.`} testId="tracker-audience-age">
                  {a.age.status !== "ok" ? (
                    <UnavailableNote state={a.age} testId="tracker-audience-age-unavailable" />
                  ) : (
                    <>
                      {legend}
                      {paired(a.age.rows, "tracker-audience-age-row")}
                      {naNote(a.age.rows, "tracker-audience-age-na")}
                      <p className="mt-3 text-[11px] text-slate-500">Share of each group with an answer to &ldquo;{a.age.label}&rdquo;; every answer is shown. A profile of the respondents, not of the market.</p>
                    </>
                  )}
                </Card>
                <Card title="Media use" subtitle={`Multiple response; media habits, not advertising effectiveness. ${groupsText}. ${weighting}.`} testId="tracker-audience-media">
                  {a.media.status !== "ok" ? (
                    <UnavailableNote state={a.media} testId="tracker-audience-media-unavailable" />
                  ) : (
                    <>
                      {legend}
                      {paired(a.media.rows, "tracker-audience-media-row")}
                      {naNote(a.media.rows, "tracker-audience-media-na")}
                      <p className="mt-3 text-[11px] text-slate-500">Ordered by use among all eligible respondents. Respondents who use none of the listed media stay in the base.</p>
                    </>
                  )}
                </Card>
              </div>
            </>
          )
        )}
      </>
    );
  })();

  // ---- Brand tracking dashboard, "Category overview" (Grant's design, page 08, 29 October 2026) --------------
  const categoryView = overview && dashboard && (() => {
    const c = category.state === "ready" ? category.category : null;
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const weighting = c ? (c.weighted ? `Weighted by ${c.weightVar}` : "Unweighted") : "";
    const STAGE_WORD: Record<string, string> = { awareness: "Recognised", consideration: "Considered", acquisition: "Acquired" };
    const shares = (d: Distribution, testId: string) =>
      d.status !== "ok" ? (
        <UnavailableNote state={d} testId={`${testId}-unavailable`} />
      ) : d.answers.length === 0 ? (
        <p className="text-xs text-slate-500">{d.reason ?? "No answers."}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {d.answers.map((a) => (
            <li key={a.code} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm" data-testid={`${testId}-row`} data-code={a.code}>
              <span className="truncate text-slate-700" title={a.label}>
                {a.label}
              </span>
              <span className="h-2.5 rounded bg-slate-100">
                <span className="block h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, a.share ?? 0))}%` }} />
              </span>
              <span className="text-right text-xs font-semibold tabular-nums text-slate-900" data-testid={`${testId}-share`}>
                {a.share === null ? <span className="text-slate-400">n/a</span> : pct(a.share)}
              </span>
            </li>
          ))}
        </ol>
      );
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Category overview</h2>
            <p className="mt-1 text-[15px] text-slate-500">How many brands people hold in mind, how they decide, and where recent acquirers acquired.</p>
          </div>
          <button type="button" onClick={() => setCustomising((v) => !v)} aria-expanded={customising} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            Customise dashboard
          </button>
        </div>
        {brandChips(c ? c.weighted : overview.figures.weighted)}
        {customising && customise}
        {statusLine}
        {category.state === "loading" || category.state === "idle" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating the category overview from this file...
          </p>
        ) : category.state === "failed" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-category-failed">
            <p>The category overview could not be calculated: {category.error}</p>
            <button type="button" onClick={() => void loadCategory()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
              Try again
            </button>
          </div>
        ) : (
          c && (
            <section aria-label="Category" className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Card title="Brand repertoire" subtitle={`Brands recognised, considered and acquired: mean per respondent, tracked brands only (Other excluded). ${weighting}.`} testId="tracker-category-repertoire">
                <dl className="flex flex-col gap-3">
                  {c.repertoire.map((r) => (
                    <div key={r.stage} className="flex items-baseline justify-between gap-3" data-testid="tracker-category-repertoire-row" data-stage={r.stage}>
                      <dt className="min-w-0 text-sm text-slate-600">
                        {STAGE_WORD[r.stage]}
                        {r.status === "ok" && <span className="block truncate text-[11px] text-slate-400" title={r.label}>{`${r.label}, ${r.brands} brands${r.base !== null ? `, n=${r.base.toLocaleString()}` : ""}`}</span>}
                      </dt>
                      <dd className="shrink-0 text-right">
                        {r.status !== "ok" ? (
                          <span className="text-xs font-semibold text-slate-500" title={r.reason} data-testid="tracker-category-repertoire-state">
                            {r.status === "not_measured" ? "Not measured" : "Mapping needed"}
                          </span>
                        ) : r.mean === null ? (
                          <span className="text-sm text-slate-400" title={r.reason}>
                            n/a
                          </span>
                        ) : (
                          <span className="text-[1.75rem] font-bold tabular-nums leading-none text-slate-900" data-testid="tracker-category-repertoire-mean">
                            {r.mean.toFixed(1)}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {c.repertoire.some((r) => r.status !== "ok" || r.mean === null) && (
                  <p className="mt-3 text-[11px] text-slate-500" data-testid="tracker-category-repertoire-na">
                    {c.repertoire.filter((r) => r.status !== "ok" || r.mean === null).map((r) => `${STAGE_WORD[r.stage]}: ${r.reason ?? "Not available."}`).join(" ")}
                  </p>
                )}
              </Card>
              <Card
                title="How decisions are made"
                subtitle={c.decisionStyle.status === "ok" ? `Single response; all who answered "${c.decisionStyle.label}"${c.decisionStyle.base !== null ? `, n=${c.decisionStyle.base.toLocaleString()}` : ""}. ${weighting}.` : "Single response."}
                testId="tracker-category-decision"
              >
                {shares(c.decisionStyle, "tracker-category-decision")}
              </Card>
              <Card
                title="Most recent acquisition channel"
                subtitle={c.acquisitionChannel.status === "ok" ? `Single response among those who answered "${c.acquisitionChannel.label}" (the question's own routing decides who was asked)${c.acquisitionChannel.base !== null ? `, n=${c.acquisitionChannel.base.toLocaleString()}` : ""}. ${weighting}.` : "Single response."}
                testId="tracker-category-channel"
              >
                {shares(c.acquisitionChannel, "tracker-category-channel")}
              </Card>
            </section>
          )
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
          <CardSegmentBase />
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
    // Weighted: the number answering too (R5 CSM segment, raw beside effective), for all customers or the segment.
    const rawOf = (x: CsmTile) => (scope === "all" && overview?.figures.weighted && x.status === "ok" && "rawBase" in x && x.rawBase != null ? `, answering ${x.rawBase.toLocaleString()}` : "");
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
      foot = `Mean · top two ${tb === null ? "n/a" : `${tb.toFixed(1)}%`} · ${overview?.figures.weighted ? "effective" : "valid"} n = ${scope === "all" ? t.effectiveBase : (box?.effectiveBase ?? "-")}${rawOf(t)}`;
    } else {
      const box = one as CompanyBox | null;
      const v = scope === "all" ? t.box : (box?.box ?? null);
      big = v === null ? "Not available" : `${v.toFixed(0)}%`;
      direction = change?.changePp ?? 0;
      changeText = change?.changePp !== null && change?.changePp !== undefined ? `${change.changePp >= 0 ? "↑" : "↓"} ${Math.abs(change.changePp).toFixed(1)} pp vs ${prevLabel}` : (change?.reason ?? "");
      foot = `${t.boxCodes === "8 to 10" ? "Answering 8 to 10" : "Top two box"} · ${v === null ? "" : `${v.toFixed(1)}% · `}${overview?.figures.weighted ? "effective" : "valid"} n = ${scope === "all" ? t.effectiveBase : (box?.effectiveBase ?? "-")}${rawOf(t)}`;
    }
    // Good news is green: up for satisfaction, NPS and staying, down for switching.
    const good = t.id === "switch" ? direction < 0 : direction > 0;
    return (
      <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="tracker-csm-tile">
        <p className="text-sm text-slate-500">{meta.title}</p>
        <CardSegmentBase />
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
    // R5 CSM segment: under a segment the figures are about the customers in it, never "all customers".
    const everyone = overview.segment ? "customers in the segment" : "all customers";
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
          {/* R5 CSM segment: the same picker as the brand dashboard's; every figure below is computed in it. */}
          <SegmentChip questions={segmentQuestions} segment={segment} onApply={setSegment} />
          <Chip label="" onClick={() => chooseAt("overallSatisfaction")}>{overview.figures.weighted ? "Weighted" : "Unweighted"}</Chip>
          {/* Under a segment this base is the segment's (the satisfaction tile's), so it is never labelled as all
              customers alone (R5 CSM segment). */}
          <span className="ml-auto text-xs text-slate-500" data-testid="tracker-csm-scope-base">{baseN !== null ? `${scopeLabel}${overview.segment ? " in the segment" : ""} base n = ${baseN.toLocaleString()}` : ""}</span>
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
                subtitle={`Mean${scaleTop ? ` on its ${scaleTop}-point scale` : ""} · ${everyone} · ${overview.figures.weighted ? "weighted" : "unweighted"}${overview.segment ? " · the segment applied in each wave" : ""}`}
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
              <Card title="Service attributes" subtitle={`Mean on each attribute's own scale · ${scopeLabel === "All customers" ? everyone : `${everyone} (not split by company yet)`}`} testId="tracker-csm-attributes">
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
        <Card title="NPS summary" subtitle={`From the NPS module · valid n = ${nps.base.toLocaleString()}${overview!.figures.weighted && nps.effectiveBase !== undefined ? `, effective base ${nps.effectiveBase.toLocaleString()}` : ""} · ${everyone}`} testId="tracker-csm-nps">
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
        <Card title="Driver priority" subtitle={`Driver analysis · target: ${drv.label} · ${drv.method === "shapley" ? "Shapley" : drv.method === "relative_weights" ? "relative weights" : "standardised coefficients"}, R² ${drv.rSquared.toFixed(2)}, ${drv.n} complete cases${overview!.segment && drv.cases !== undefined ? ` of ${drv.cases} in the segment` : ""}`} testId="tracker-drivers">
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

  // R5: the segment reading of the page shown, for every card's base line (null on all eligible respondents).
  const pageReading =
    kind !== "brand"
      ? (overview?.segment ?? null)
      : section === 1
        ? moments.state === "ready" ? moments.moments.segment : null
        : section === 2
          ? associations.state === "ready" ? associations.associations.segment : null
          : section === 3
            ? advertising.state === "ready" ? advertising.advertising.segment : null
            : section === 4
              ? audience.state === "ready" ? audience.audience.segment : null
              : section === 5
                ? category.state === "ready" ? category.category.segment : null
                : (overview?.segment ?? null);
  const pageSegment = pageReading ? { text: pageReading.text, n: pageReading.n, effectiveBase: pageReading.effectiveBase } : null;
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
              <button
                key={s}
                type="button"
                onClick={() => setSection(i)}
                aria-current={i === section ? "page" : undefined}
                className={`flex items-baseline gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${i === section ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="text-xs font-semibold">{String(i + 1).padStart(2, "0")}</span>
                {s}
              </button>
            ))}
          </nav>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[84rem] flex-col gap-5 px-6 py-6">
            {load.state !== "ready" && segmentQuestions.length > 0 && <SegmentChip questions={segmentQuestions} segment={segment} onApply={setSegment} />}
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
                {segment && (
                  <button type="button" onClick={() => setSegment(null)} className="ml-2 mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs" data-testid="tracker-segment-clear-failed">
                    Clear the segment
                  </button>
                )}
              </div>
            )}
            {kind === "brand" && (
              // The section menu is beside the page on a wide screen; on a narrow one the pages are tabs here (they wrap).
              <div className="flex flex-wrap gap-1.5 lg:hidden" role="group" aria-label="Brand tracking pages">
                {BRAND_SECTIONS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSection(i)}
                    aria-pressed={i === section}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${i === section ? "border-blue-500 bg-blue-50 font-semibold text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <SegmentBaseContext.Provider value={pageSegment}>
              {kind === "brand" ? (section === 1 ? momentsView : section === 2 ? associationsView : section === 3 ? advertisingView : section === 4 ? audienceView : section === 5 ? categoryView : brandView) : csmView}
            </SegmentBaseContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

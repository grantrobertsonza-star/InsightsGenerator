"use client";

// The brand tracking dashboard's Audience and Media pages (Grant, 30 October 2026: "this view only shows age ... Should
// we not include age, gender, income automatically and then have an option to add more?"; the page split in two with
// the Media page's comparison controls). The figures, the profile list and the significance decisions come from
// src/lib (trackerAudience.ts through its server actions, trackerDashboard.ts for the saved list,
// trackerAudienceFigures.ts for the index, sort and headline); these components only show them. The researcher's
// profile list is saved by the dashboard's own save (`onSave`: saveTrackerChoices, with its revision check), which
// reports "Saved" only after the server confirms it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadBrandAudienceAction, loadBrandMediaAction } from "@/lib/trackerDashboardActions";
import { DEFAULT_PROFILES, PROFILE_ROLE_TEXT, type ProfileChoice, type ResolvedProfile } from "@/lib/trackerDashboard";
import { mediaHeadline, mediaIndex, sortMediaRows, smallBaseLevel, type GroupShare, type MediaRow, type MediaSort, type ProfileRow } from "@/lib/trackerAudienceFigures";
import type { AcquirerGroup, BrandAudience, BrandMedia, Unavailable } from "@/lib/trackerAudience";
import { QuestionPicker } from "./QuestionPicker";

const FOCAL = "#2563eb";
const COMPARISON = "#94a3b8";
const pct = (v: number) => `${v.toFixed(1)}%`;
const count = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : n.toLocaleString("en-GB"));

type Load<T> = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: T };

/** Loads a page's figures; only the latest request may update the screen (a slower earlier answer, for an earlier
 * choice or another file, is ignored). `deps` are what the figures depend on. */
function useFigures<T>(fetcher: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, deps: unknown[]): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const latest = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const id = ++latest.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad({ state: "loading" });
    void fetcher().then(
      (r) => {
        if (id === latest.current) setLoad(r.ok ? { state: "ready", data: r.data } : { state: "failed", error: r.error });
      },
      (e: unknown) => {
        if (id === latest.current) setLoad({ state: "failed", error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      latest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return [load, () => setAttempt((a) => a + 1)];
}

function Card({ title, subtitle, children, testId, data, actions }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; testId: string; data?: Record<string, string>; actions?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId} {...data}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function UnavailableNote({ state, testId }: { state: Unavailable; testId: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3" data-testid={testId} data-status={state.status}>
      <p className="text-sm font-semibold text-slate-700">{state.status === "not_measured" ? "Not measured" : "Mapping needed"}</p>
      <p className="mt-1 text-xs text-slate-500">{state.reason}</p>
    </div>
  );
}

/** The client's brand's recent acquirers: unavailable, none, or the small-base banner (the plan's rule). */
function AcquirersBanner({ acquirers, brandName, testPrefix = "tracker-audience" }: { acquirers: AcquirerGroup | Unavailable; brandName: string; testPrefix?: string }) {
  if (acquirers.status !== "ok") return <UnavailableNote state={acquirers} testId={`${testPrefix}-acquirers-unavailable`} />;
  if (acquirers.n === null || acquirers.n === 0)
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700" data-testid={`${testPrefix}-no-acquirers`}>
        {acquirers.reason ?? `No recent acquirers of ${brandName} could be counted.`}
      </p>
    );
  if (acquirers.level === "very_small")
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900" role="note" data-testid={`${testPrefix}-small-base`} data-level="very_small">
        VERY SMALL BASE: {brandName} recent acquirers n={acquirers.n.toLocaleString("en-GB")}. Descriptive illustration only. No significance, targeting or market inference.
      </p>
    );
  if (acquirers.level === "small")
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note" data-testid={`${testPrefix}-small-base`} data-level="small">
        SMALL BASE: {brandName} recent acquirers n={acquirers.n.toLocaleString("en-GB")}. Read with caution; no significance test is applied.
      </p>
    );
  return null;
}

function Legend({ focal, comparison }: { focal: string; comparison: string }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-700" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FOCAL }} aria-hidden="true" />
        {focal}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COMPARISON }} aria-hidden="true" />
        {comparison}
      </li>
    </ul>
  );
}

/** One compact two-series row: a label (wrapping onto further lines, never cut) and the two groups' bars with their
 * values. */
function PairRow({ label, a, b, testId, rowKey, marker }: { label: string; a: GroupShare; b: GroupShare; testId: string; rowKey: string; marker?: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-2 text-xs" data-testid={testId} data-key={rowKey}>
      <span className="flex min-w-0 items-center gap-1 leading-tight text-slate-700">
        <span className="min-w-0 [overflow-wrap:anywhere]" data-testid={`${testId}-label`}>
          {label}
        </span>
        {marker}
      </span>
      <span className="flex flex-col gap-0.5">
        {(
          [
            ["focal", a, FOCAL],
            ["comparison", b, COMPARISON],
          ] as const
        ).map(([which, g, colour]) => (
          <span key={which} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-1.5" title={g.reason}>
            <span className="h-1.5 rounded bg-slate-100">
              <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, g.share ?? 0))}%`, background: colour }} />
            </span>
            <span className="text-right text-[11px] tabular-nums text-slate-900" data-testid={`${testId}-${which}`}>
              {g.share === null ? <span className="text-slate-400">n/a</span> : pct(g.share)}
            </span>
          </span>
        ))}
      </span>
    </li>
  );
}

const naReasons = (shares: GroupShare[]) => [...new Set(shares.filter((s) => s.share === null).map((s) => s.reason ?? "Not available."))];

// ---- Audience page -------------------------------------------------------------------------------------------

export function AudiencePage({
  runId,
  documentId,
  loadKey,
  chrome,
  profiles,
  saved,
  saving,
  canSave,
  onSave,
}: {
  runId: string;
  documentId: string;
  /** Changes whenever the dashboard is loaded again (after a save, a reset, a reload): the figures load again. */
  loadKey: unknown;
  /** The page's chips row, Customise panel and status line, from the dashboard (`weighted`: the figures' own). */
  chrome: (weighted: boolean | null) => ReactNode;
  /** This wave's cards in order (trackerDashboard.resolveProfiles), from the same read as `saved`. */
  profiles: ResolvedProfile[];
  /** The programme's saved list; undefined: the defaults. */
  saved: ProfileChoice[] | undefined;
  saving: boolean;
  /** False before migration 0132 (choices cannot be saved). */
  canSave: boolean;
  onSave: (next: ProfileChoice[]) => Promise<void>;
}) {
  const [load, retry] = useFigures<BrandAudience>(async () => {
    const r = await loadBrandAudienceAction(runId, documentId);
    return r.ok ? { ok: true, data: r.audience } : r;
  }, [runId, documentId, loadKey]);
  const [adding, setAdding] = useState(false);
  const [choosingFor, setChoosingFor] = useState<number | null>(null);
  const a = load.state === "ready" ? load.data : null;
  const acq = a?.acquirers.status === "ok" ? a.acquirers : null;
  const brandName = acq?.brand.label ?? a?.dashboard.focalBrand?.label ?? "your brand";
  const list = saved ?? DEFAULT_PROFILES;
  // What "Add a profile question" offers: this file's single-choice questions asked once (from the latest load).
  const profileQuestions = a?.profileQuestions ?? [];
  const shownVariables = new Set(profiles.flatMap((p) => (p.status === "ok" || p.status === "not_in_file" ? [p.variable] : [])));
  const addable = profileQuestions.filter((q) => !shownVariables.has(q.variable)).map((q) => ({ name: q.variable, label: q.label }));
  // Figures by variable, from the latest load (cards and controls come from the dashboard's read, figures join by identity).
  const figures = new Map((a?.profiles ?? []).flatMap((p) => (p.status === "ok" ? [[p.variable, p.rows] as const] : [])));
  const disabled = saving || !canSave;

  const save = (next: ProfileChoice[]) => {
    setAdding(false);
    setChoosingFor(null);
    void onSave(next);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save(next);
  };
  const labelOf = (variable: string) => profileQuestions.find((q) => q.variable === variable)?.label ?? variable;

  const cardTitle = (p: ResolvedProfile) => (p.status === "ok" ? p.label : p.status === "not_in_file" ? (p.label ?? p.variable) : PROFILE_ROLE_TEXT[p.role]);
  const controls = (i: number, p: ResolvedProfile) => (
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`Arrange ${cardTitle(p)}`}>
      <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${cardTitle(p)} up`} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">
        ↑
      </button>
      <button type="button" disabled={disabled || i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${cardTitle(p)} down`} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">
        ↓
      </button>
      <button type="button" disabled={disabled} onClick={() => save(list.filter((_, j) => j !== i))} aria-label={`Hide ${cardTitle(p)}`} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">
        Hide
      </button>
    </div>
  );

  return (
    <>
      <div>
        <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Audience</h2>
        <p className="mt-1 text-[15px] text-slate-500">Who recently acquired your brand, compared with everyone in the category.</p>
      </div>
      {chrome(a ? a.weighted : null)}
      {load.state === "loading" ? (
        <p className="text-sm text-slate-500" role="status">
          Calculating the audience profile from this file...
        </p>
      ) : load.state === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-audience-failed">
          <p>The audience profile could not be calculated: {load.error}</p>
          <button type="button" onClick={retry} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
            Try again
          </button>
        </div>
      ) : (
        a && (
          <>
            <AcquirersBanner acquirers={a.acquirers} brandName={brandName} />
            <p className="text-xs text-slate-500" data-testid="tracker-audience-groups">
              {acq ? `${brandName} recent acquirers ("${acq.label}", n=${count(acq.n)}) vs all eligible category respondents (n=${count(a.categoryN)})` : `All eligible category respondents (n=${count(a.categoryN)})`}. {a.weighted ? `Weighted by ${a.weightVar}` : "Unweighted"}.
            </p>
            {profiles.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">Every profile question is hidden. Add one below, or use Reset to suggested under Customise for age, gender and income.</p>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" data-testid="tracker-audience-profiles">
              {profiles.map((p, i) => {
                const key = p.status === "ok" || p.status === "not_in_file" ? `v:${p.variable}` : `r:${p.role}`;
                const data = { "data-variable": p.status === "ok" || p.status === "not_in_file" ? p.variable : "", "data-role": p.role ?? "", "data-status": p.status };
                if (p.status === "not_in_file")
                  return (
                    <Card key={key} title={cardTitle(p)} subtitle={p.variable} testId="tracker-audience-profile" data={data} actions={controls(i, p)}>
                      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-600" data-testid="tracker-audience-profile-missing">
                        Not in this wave&rsquo;s file. Kept in the programme&rsquo;s choice; shown again for a wave that has it.
                      </p>
                    </Card>
                  );
                if (p.status !== "ok")
                  return (
                    <Card key={key} title={PROFILE_ROLE_TEXT[p.role]} testId="tracker-audience-profile" data={data} actions={controls(i, p)}>
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-600" data-testid="tracker-audience-profile-not-found">
                        <p>
                          {p.status === "ambiguous" ? "Two questions could be this." : "Not found in this file."}{" "}
                          <span className="text-slate-500">{p.reason}</span>
                        </p>
                        {choosingFor === i ? (
                          <div className="mt-2">
                            <QuestionPicker value={null} options={addable} noneLabel="Choose a question" ariaLabel={`Question for ${PROFILE_ROLE_TEXT[p.role].toLowerCase()}`} onChange={(name) => name && save(list.map((x, j) => (j === i ? { role: p.role, variable: name, label: labelOf(name) } : x)))} />
                          </div>
                        ) : (
                          <button type="button" disabled={disabled} onClick={() => setChoosingFor(i)} className="mt-2 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-blue-300 disabled:opacity-40">
                            Choose a question
                          </button>
                        )}
                      </div>
                    </Card>
                  );
                const rows: ProfileRow[] | undefined = figures.get(p.variable);
                const accBase = rows?.find((r) => r.acquirers.base !== null)?.acquirers.base ?? null;
                const catBase = rows?.find((r) => r.category.base !== null)?.category.base ?? null;
                const reasons = naReasons((rows ?? []).map((r) => r.acquirers));
                return (
                  <Card key={key} title={p.label} subtitle={<>{p.variable} · answered: acquirers n={count(accBase)}, all eligible n={count(catBase)}</>} testId="tracker-audience-profile" data={data} actions={controls(i, p)}>
                    {!rows ? (
                      <p className="text-xs text-slate-500">Calculating...</p>
                    ) : (
                      <>
                        <ol className="flex flex-col gap-1.5">
                          {rows.map((r) => (
                            <PairRow key={r.key} label={r.label} a={r.acquirers} b={r.category} testId="tracker-audience-profile-row" rowKey={r.key} />
                          ))}
                        </ol>
                        {reasons.length > 0 && (
                          <p className="mt-2 text-[11px] text-slate-500" data-testid="tracker-audience-profile-na">
                            Acquirers n/a: {reasons.join(" ")}
                          </p>
                        )}
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3" data-testid="tracker-audience-add">
              {adding ? (
                <div className="w-full max-w-md">
                  <QuestionPicker value={null} options={addable} noneLabel="Choose a question to add" ariaLabel="Add a profile question" onChange={(name) => (name ? save([...list, { role: null, variable: name, label: labelOf(name) }]) : setAdding(false))} />
                </div>
              ) : (
                <button type="button" disabled={disabled || addable.length === 0} onClick={() => setAdding(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 disabled:opacity-40">
                  + Add a profile question
                </button>
              )}
              {saving && (
                <span className="text-xs text-slate-500" role="status">
                  Saving...
                </span>
              )}
              {!canSave && <span className="text-xs text-amber-800">Profile questions cannot be saved until the database has migration 0132.</span>}
            </div>
            <p className="text-[11px] text-slate-500" data-testid="tracker-audience-method">
              Each card: the share of each group giving each answer, among those with an answer to the question; every answer is shown in the file&rsquo;s code order. Don&rsquo;t know, refused and prefer not to say are answers of their own and stay in the base; a blank answer is outside it. Profile questions are saved for the programme. A profile of the respondents, not of the market.
            </p>
          </>
        )
      )}
    </>
  );
}

// ---- Media page ----------------------------------------------------------------------------------------------

export function MediaPage({ runId, documentId, loadKey, chrome }: { runId: string; documentId: string; loadKey: unknown; chrome: (weighted: boolean | null) => ReactNode }) {
  const [compare, setCompare] = useState<string | null>(null);
  const [sort, setSort] = useState<MediaSort>("focal");
  const [show, setShow] = useState<"shares" | "index">("shares");
  const [load, retry] = useFigures<BrandMedia>(async () => {
    const r = await loadBrandMediaAction(runId, documentId, compare);
    return r.ok ? { ok: true, data: r.media } : r;
  }, [runId, documentId, loadKey, compare]);
  // The brand list stays while a new comparison loads.
  const [brands, setBrands] = useState<{ code: string; label: string }[]>([]);
  const m = load.state === "ready" ? load.data : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m) setBrands(m.comparisonBrands);
  }, [m]);
  const acq = m?.acquirers.status === "ok" ? m.acquirers : null;
  const brandName = acq?.brand.label ?? m?.dashboard.focalBrand?.label ?? "your brand";
  const focalName = `${brandName} recent acquirers`;
  const comparisonGroup = m?.comparison.kind === "brand" ? m.comparison.group : null;
  const comparisonName = m?.comparison.kind === "brand" ? `${comparisonGroup?.status === "ok" ? comparisonGroup.brand.label : "the other brand's"} recent acquirers` : "all eligible category respondents";
  const focalLevel = acq?.level ?? null;
  const comparisonLevel = m ? (m.comparison.kind === "brand" ? (comparisonGroup?.status === "ok" ? comparisonGroup.level : null) : m.categoryN === null ? null : smallBaseLevel(m.categoryN)) : null;
  const media = m?.media.status === "ok" ? m.media : null;
  const rows = media ? sortMediaRows(media.rows, sort) : [];
  const headline = media ? mediaHeadline(media.rows, focalName, comparisonName, focalLevel, comparisonLevel, media.test.ran) : null;
  const maxIndex = Math.max(200, ...rows.map((r) => mediaIndex(r, focalLevel, comparisonLevel).index ?? 0));

  const select = "rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900";
  const marker = (r: MediaRow) =>
    r.test.status === "higher" ? (
      <span className="text-[10px] font-semibold text-emerald-700" title="Clearly higher (engine test, 5%)" aria-label="clearly higher">
        ▲
      </span>
    ) : r.test.status === "lower" ? (
      <span className="text-[10px] font-semibold text-red-700" title="Clearly lower (engine test, 5%)" aria-label="clearly lower">
        ▼
      </span>
    ) : null;

  return (
    <>
      <div>
        <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">Media</h2>
        <p className="mt-1 text-[15px] text-slate-500">Media use of your brand&rsquo;s recent acquirers. Media habits, not advertising effectiveness.</p>
      </div>
      {chrome(m ? m.weighted : null)}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600" role="group" aria-label="Media view" data-testid="tracker-media-controls">
        <label className="flex items-center gap-1.5">
          Compare to
          <select className={select} value={compare ?? ""} onChange={(e) => setCompare(e.target.value === "" ? null : e.target.value)} data-testid="tracker-media-compare">
            <option value="">All eligible category respondents</option>
            {brands.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label} recent acquirers
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Sort
          <select className={select} value={sort} onChange={(e) => setSort(e.target.value as MediaSort)} data-testid="tracker-media-sort">
            <option value="focal">By {brandName} share</option>
            <option value="difference">By difference</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Show
          <select className={select} value={show} onChange={(e) => setShow(e.target.value as "shares" | "index")} data-testid="tracker-media-show">
            <option value="shares">Shares</option>
            <option value="index">Index</option>
          </select>
        </label>
      </div>
      {load.state === "loading" ? (
        <p className="text-sm text-slate-500" role="status">
          Calculating media use from this file...
        </p>
      ) : load.state === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="tracker-audience-failed">
          <p>Media use could not be calculated: {load.error}</p>
          <button type="button" onClick={retry} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
            Try again
          </button>
        </div>
      ) : (
        m && (
          <>
            <AcquirersBanner acquirers={m.acquirers} brandName={brandName} />
            {m.comparison.kind === "brand" && comparisonGroup && comparisonGroup.status === "ok" && comparisonGroup.level !== "ok" && <AcquirersBanner acquirers={comparisonGroup} brandName={comparisonGroup.brand.label} testPrefix="tracker-media-comparison" />}
            {m.comparison.kind === "brand" && comparisonGroup && comparisonGroup.status !== "ok" && <UnavailableNote state={comparisonGroup} testId="tracker-media-comparison-unavailable" />}
            {headline && (
              <p className="text-lg font-semibold leading-snug text-slate-900" data-testid="tracker-media-headline">
                {headline.text}
              </p>
            )}
            <Card
              title="Media use"
              subtitle={
                <span data-testid="tracker-media-groups">
                  Multiple response; media habits, not advertising effectiveness. {focalName} (n={count(acq?.n)}) vs {comparisonName} (n=
                  {count(m.comparison.kind === "brand" ? (comparisonGroup?.status === "ok" ? comparisonGroup.n : null) : m.categoryN)}). {m.weighted ? `Weighted by ${m.weightVar}` : "Unweighted"}.
                </span>
              }
              testId="tracker-audience-media"
            >
              {m.media.status !== "ok" ? (
                <UnavailableNote state={m.media} testId="tracker-audience-media-unavailable" />
              ) : show === "shares" ? (
                <>
                  <Legend focal={focalName} comparison={comparisonName} />
                  <ol className="grid grid-cols-1 gap-x-8 gap-y-1.5 lg:grid-cols-2">
                    {rows.map((r) => (
                      <PairRow key={r.key} label={r.label} a={r.focal} b={r.comparison} testId="tracker-audience-media-row" rowKey={r.key} marker={marker(r)} />
                    ))}
                  </ol>
                </>
              ) : (
                <ol className="grid grid-cols-1 gap-x-8 gap-y-1.5 lg:grid-cols-2" data-testid="tracker-media-index">
                  {rows.map((r) => {
                    const ix = mediaIndex(r, focalLevel, comparisonLevel);
                    return (
                      <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3rem] items-center gap-2 text-xs" data-testid="tracker-audience-media-row" data-key={r.key} title={ix.reason}>
                        <span className="flex min-w-0 items-center gap-1 leading-tight text-slate-700">
                          <span className="min-w-0 [overflow-wrap:anywhere]" data-testid="tracker-audience-media-row-label">
                            {r.label}
                          </span>
                          {marker(r)}
                        </span>
                        <span className="relative h-2 rounded bg-slate-100">
                          {ix.index !== null && <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(ix.index / maxIndex) * 100}%`, background: ix.index >= 100 ? FOCAL : COMPARISON }} />}
                          <span className="absolute inset-y-[-2px] w-px bg-slate-500" style={{ left: `${(100 / maxIndex) * 100}%` }} aria-hidden="true" />
                        </span>
                        <span className="text-right tabular-nums text-slate-900" data-testid="tracker-audience-media-row-index">
                          {ix.index === null ? <span className="text-slate-400">n/a</span> : Math.round(ix.index)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {media && naReasons(media.rows.flatMap((r) => [r.focal, r.comparison])).length > 0 && (
                <p className="mt-2 text-[11px] text-slate-500" data-testid="tracker-audience-media-na">
                  n/a: {naReasons(media.rows.flatMap((r) => [r.focal, r.comparison])).join(" ")}
                </p>
              )}
              {media && (
                <p className="mt-2 text-[11px] text-slate-500" data-testid="tracker-media-method">
                  {show === "index" ? `Index: ${focalName}' share / ${comparisonName}' share x 100 (100 = the same); withheld where a base is below 50 or the comparison share is 0% or unknown. ` : ""}
                  Respondents who use none of the listed media stay in the base. {media.test.ran ? `▲ ▼ ${media.test.method}` : media.test.reason}
                </p>
              )}
            </Card>
          </>
        )
      )}
    </>
  );
}

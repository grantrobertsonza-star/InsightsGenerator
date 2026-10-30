"use client";

// The brand dashboard extension's pages (Grant's guide of 30 October 2026), added to the brand tracking dashboard as
// their own group of pages: "Needs, difference & price" (E1 to E3, three separate rating modules, never one score)
// and "Ideal vs actual choice" (E4/E5 same-episode shares, gap and fulfilment, E6 reasons). Figures come from
// loadBrandExtensionAction (src/lib/brandExtension.ts, the Cross tab engine); this screen formats them and never
// computes a figure. Every chart says its numerator, denominator, filters, units and question; unknown states are
// words ("Not measured", "Needs review", "Not available"), never zeros. Only the latest request may update the page:
// an earlier answer (another file, another weighting or audience) is dropped. "Saved" shows only after a
// confirmation is saved; a conflicting save reloads what is stored.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadBrandExtensionAction, loadBrandExtensionTrendAction, saveBrandExtensionConfirmationAction } from "@/lib/brandExtensionActions";
import type { BrandExtension, BrandRating, EpisodeModule, ReasonFigures, ReasonsModule, RatingModule, SmallBase, TrendWave } from "@/lib/brandExtension";
import type { ExtensionConstruct, RatingConstruct } from "@/lib/brandExtensionRoles";
import VariablesSelector, { type SelectorSave } from "./VariablesSelector";

export const BRAND_EXTENSION_PAGES = ["Needs, difference & price", "Ideal vs actual choice"] as const;
export type BrandExtensionPageName = "ratings" | "choice";

const RATING_TITLE: Record<RatingConstruct, string> = { needs_fit: "Needs fit", differentiation: "Differentiation", price_justification: "Price justification" };
/** The five agreement points, strongly disagree to strongly agree: red to slate to the dashboard's blue. */
const SCALE_COLOURS = ["#dc2626", "#f59e0b", "#cbd5e1", "#60a5fa", "#2563eb"];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "Not available" : `${v.toFixed(1)}%`);
const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "n/a" : v.toFixed(digits));
const smallNote = (s: SmallBase) => (s === "very_small" ? "Base below 30: descriptive only" : s === "small" ? "Base below 50: read with care" : s === "none" ? "No base" : null);

/** The extension's page buttons, grouped apart from the dashboard's own pages (sidebar on wide screens, tabs on narrow). */
export function BrandExtensionMenu({ section, first, onOpen, variant }: { section: number; first: number; onOpen: (i: number) => void; variant: "sidebar" | "tabs" }) {
  if (variant === "tabs")
    return (
      <div className="flex flex-wrap gap-1.5 lg:hidden" role="group" aria-label="Brand extension pages">
        {BRAND_EXTENSION_PAGES.map((s, k) => (
          <button key={s} type="button" onClick={() => onOpen(first + k)} aria-pressed={section === first + k} className={`rounded-lg border px-3 py-1.5 text-sm ${section === first + k ? "border-blue-500 bg-blue-50 font-semibold text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}>
            {s}
          </button>
        ))}
      </div>
    );
  return (
    <nav aria-label="Brand extension sections" className="mt-5 flex flex-col gap-1 border-t border-slate-200 pt-4">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Extension</p>
      {BRAND_EXTENSION_PAGES.map((s, k) => (
        <button
          key={s}
          type="button"
          onClick={() => onOpen(first + k)}
          aria-current={section === first + k ? "page" : undefined}
          className={`flex items-baseline gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${section === first + k ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
        >
          <span className="text-xs font-semibold">{String(first + k + 1).padStart(2, "0")}</span>
          {s}
        </button>
      ))}
    </nav>
  );
}

function Card({ title, subtitle, children, testId }: { title: string; subtitle?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId} aria-label={title}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Unavailable({ state, testId }: { state: { status: string; reason: string }; testId: string }) {
  const title = state.status === "not_measured" ? "Not measured" : state.status === "needs_review" ? "Needs review" : "Mapping needed";
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid={testId} data-status={state.status}>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{state.reason}</p>
    </div>
  );
}

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; extension: BrandExtension };
type TrendLoad = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; waves: TrendWave[] };

export default function BrandExtensionPage({
  runId,
  documentId,
  page,
  reloadToken,
  initialBrands,
}: {
  runId: string;
  documentId: string;
  page: BrandExtensionPageName;
  /** Changes when the dashboard reloads (choices saved, weighting changed): the page loads again. */
  reloadToken: unknown;
  /** The brands shown at first: the client's brand and the brands compared on the dashboard. */
  initialBrands: string[];
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [weighted, setWeighted] = useState<boolean | null>(null);
  const [audience, setAudience] = useState<{ variable: string; code: string } | null>(null);
  const [shown, setShown] = useState<string[] | null>(null);
  const [construct, setConstruct] = useState<RatingConstruct>("needs_fit");
  const [save, setSave] = useState<SelectorSave>({ state: "idle" });
  const [trend, setTrend] = useState<TrendLoad>({ state: "idle" });
  const [reasonBrand, setReasonBrand] = useState<string>("");
  const latest = useRef(0);
  const latestTrend = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    latestTrend.current += 1;
    setTrend({ state: "idle" });
    setLoad({ state: "loading" });
    const r = await loadBrandExtensionAction(runId, documentId, { weighted, audience });
    if (id !== latest.current) return;
    setLoad(r.ok ? { state: "ready", extension: r.extension } : { state: "failed", error: r.error });
  }, [runId, documentId, weighted, audience]);

  useEffect(() => {
    // Loads on first view, on another file, another weighting or audience, and when the dashboard reloads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      latest.current += 1;
      latestTrend.current += 1;
    };
  }, [reload, reloadToken]);

  const ext = load.state === "ready" ? load.extension : null;
  const brands = useMemo(() => ext?.brands ?? [], [ext]);
  const shownCodes = useMemo(() => {
    if (shown) return shown;
    const first = initialBrands.filter((c) => brands.some((b) => b.code === c));
    return first.length ? first : brands.slice(0, 5).map((b) => b.code);
  }, [shown, initialBrands, brands]);

  const confirm = useCallback(
    async (change: { kind: "construct"; construct: ExtensionConstruct; choice: string } | { kind: "alias"; name: string; brandCode: string | null; otherName: string | null }) => {
      if (!ext) return;
      setSave(change.kind === "construct" ? { state: "saving", construct: change.construct } : { state: "saving", construct: "episode" });
      const r = await saveBrandExtensionConfirmationAction(runId, documentId, { scope: ext.confirmations.scopeKey, revision: ext.confirmations.revision }, change);
      if (!r.ok) return setSave({ state: "error", text: r.error });
      if (r.saved) {
        setSave({ state: "saved", construct: change.kind === "construct" ? change.construct : "episode" });
        return void reload();
      }
      if (r.reason === "conflict") {
        setSave({ state: "error", text: "Another confirmation was saved meanwhile. The page has been reloaded with what is stored; confirm again if still needed." });
        return void reload();
      }
      setSave({ state: "error", text: r.reason === "invalid" ? r.problem : r.message });
    },
    [ext, runId, documentId, reload],
  );

  const loadTrend = useCallback(async () => {
    const id = ++latestTrend.current;
    setTrend({ state: "loading" });
    const r = await loadBrandExtensionTrendAction(runId, documentId, { weighted, audience: null });
    if (id !== latestTrend.current) return;
    setTrend(r.ok ? { state: "ready", waves: r.waves } : { state: "failed", error: r.error });
  }, [runId, documentId, weighted]);

  const header = (
    <div>
      <h2 className="text-[2rem] font-bold leading-tight tracking-tight text-slate-900">{page === "ratings" ? "Needs, difference & price" : "Ideal vs actual choice"}</h2>
      <p className="mt-1 text-[15px] text-slate-500">
        {page === "ratings"
          ? "Separate five-point agreement ratings among respondents aware of each brand. Never combined into one score."
          : "The brand actually chosen and the brand ideally preferred for the same most recent event, and the reasons given when they differ."}
      </p>
    </div>
  );
  const context = ext && (
    <p className="text-xs text-slate-500" data-testid="ext-context">
      {ext.weightNote} Filter: {ext.audience ? `${ext.audience.label} = ${ext.audience.codeLabel}` : "all respondents"}. Synthetic demonstration data in the supplied packs; reference values check arithmetic, not market validity.
    </p>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="brand-extension-page" data-page={page}>
      {header}
      {load.state === "loading" && (
        <p className="text-sm text-slate-500" role="status">
          Calculating from this file...
        </p>
      )}
      {load.state === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="ext-failed">
          <p>The extension could not be calculated: {load.error}</p>
          <button type="button" onClick={() => void reload()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
            Try again
          </button>
        </div>
      )}
      {ext && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <VariablesSelector
            diagnostics={ext.diagnostics}
            brands={brands}
            shownBrands={shownCodes}
            onBrands={setShown}
            weighted={ext.weighted}
            canWeight={ext.weightAvailable}
            onWeighted={setWeighted}
            audienceOptions={ext.audienceOptions}
            audience={audience}
            onAudience={setAudience}
            storageAvailable={ext.confirmations.storageAvailable}
            save={save}
            onConfirm={(c, choice) => void confirm({ kind: "construct", construct: c, choice })}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {context}
            {page === "ratings" ? (
              <RatingsView ext={ext} construct={construct} onConstruct={setConstruct} shown={shownCodes} trend={trend} onTrend={() => void loadTrend()} />
            ) : (
              <ChoiceView ext={ext} shown={shownCodes} reasonBrand={reasonBrand} onReasonBrand={setReasonBrand} onAlias={(name, brandCode) => void confirm({ kind: "alias", name, brandCode, otherName: null })} saving={save.state === "saving"} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DistributionBar({ r }: { r: BrandRating }) {
  if (r.topTwo === null) return <span className="text-xs text-slate-400">Not available</span>;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded" role="img" aria-label={r.distribution.map((d) => `${d.label} ${pct(d.share)}`).join(", ")}>
      {r.distribution.map((d, i) => (
        <span key={d.code} style={{ width: `${d.share ?? 0}%`, background: SCALE_COLOURS[i] }} title={`${d.code} ${d.label}: ${pct(d.share)} (n=${d.n})`} />
      ))}
    </div>
  );
}

export function RatingsView({ ext, construct, onConstruct, shown, trend, onTrend }: { ext: BrandExtension; construct: RatingConstruct; onConstruct: (c: RatingConstruct) => void; shown: string[]; trend: TrendLoad; onTrend: () => void }) {
  const m: RatingModule = ext.ratings[construct];
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Rating">
        {(Object.keys(RATING_TITLE) as RatingConstruct[]).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === construct} onClick={() => onConstruct(c)} data-testid="ext-construct-tab" data-status={ext.ratings[c].status} className={`rounded-lg border px-3 py-1.5 text-sm ${c === construct ? "border-blue-500 bg-blue-50 font-semibold text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}>
            {RATING_TITLE[c]}
          </button>
        ))}
      </div>
      <Card
        title={RATING_TITLE[construct]}
        testId="ext-rating-card"
        subtitle={
          m.status === "ok" ? (
            <>
              Question: &quot;[Brand] {m.family.wording}&quot; (agreement, 1 Strongly disagree to 5 Strongly agree). Top-two-box: weighted ratings 4 or 5 / weighted ratings 1 to 5, %. Cannot judge ({m.family.cannotJudge.map((c) => `${c.code} ${c.label}`).join("; ")}): share of all respondents aware of the brand. Base: aware of each brand by &quot;{m.awareness.label}&quot;. Within-wave brand differences come from the same respondents and are not tested here.
            </>
          ) : undefined
        }
      >
        {m.status !== "ok" ? (
          <Unavailable state={m} testId="ext-rating-unavailable" />
        ) : (
          <>
            {construct === "price_justification" && (
              <p className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                Worth its price compared with alternatives that meet similar needs. This is not pricing power, willingness to pay a premium or price elasticity. Good value for money remains a separate pick-any association.
              </p>
            )}
            <ul className="mb-3 flex flex-wrap gap-3 text-[11px] text-slate-600" aria-label="Scale">
              {m.family.scale.map((s, i) => (
                <li key={s.code} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SCALE_COLOURS[i] }} aria-hidden="true" />
                  {s.code} {s.label}
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2 font-semibold">Brand</th>
                    <th className="py-1 pr-2 font-semibold">Distribution (valid 1 to 5)</th>
                    <th className="py-1 pr-2 text-right font-semibold">Top two</th>
                    <th className="py-1 pr-2 text-right font-semibold">Mean (1 to 5)</th>
                    <th className="py-1 pr-2 text-right font-semibold">Cannot judge</th>
                    <th className="py-1 font-semibold">Bases</th>
                  </tr>
                </thead>
                <tbody>
                  {m.brands
                    .filter((b) => shown.includes(b.code))
                    .map((b) => (
                      <tr key={b.code} className="border-t border-slate-100 align-middle" data-testid="ext-rating-row" data-code={b.code} title={b.reason}>
                        <td className="py-2 pr-2 font-medium text-slate-800">{b.label}</td>
                        <td className="w-[30%] py-2 pr-2">
                          <DistributionBar r={b} />
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums" data-testid="ext-top2">
                          {pct(b.topTwo)}
                          {b.topTwoInterval && <span className="block text-[10px] text-slate-400">{`${b.topTwoInterval[0].toFixed(1)} to ${b.topTwoInterval[1].toFixed(1)}`}</span>}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{b.mean === null ? "Not available" : b.mean.toFixed(2)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums" data-testid="ext-cannot-judge">
                          {pct(b.cannotJudge.share)}
                        </td>
                        <td className="py-2 text-[11px] text-slate-500" data-testid="ext-bases">
                          aware n={num(b.aware.n)}; valid n={num(b.valid.n)}, weighted {num(b.valid.weighted, 1)}, effective {num(b.valid.effective, 1)}
                          {b.missing.n > 0 && `; missing ${b.missing.n}`}
                          {(b.answeredNotAware ?? 0) > 0 && `; answered while not aware ${b.answeredNotAware}`}
                          {b.otherCodes.length > 0 && `; other codes ${b.otherCodes.map((o) => `${o.code} (${o.n})`).join(", ")}`}
                          {smallNote(b.smallBase) && <span className="block text-amber-700">{smallNote(b.smallBase)}</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Interval: 95%, weights-only approximation p ± 1.96√(p(1−p)/effective base), shown from 30 valid ratings; no survey design or clustering beyond it. Missing: aware respondents with no answer, never counted as a rating.
            </p>
          </>
        )}
      </Card>
      <Card title="Wave trend" subtitle="Top-two-box by wave. Waves are independent samples; a wave is joined only when its question has the same wording and codes." testId="ext-trend">
        {trend.state === "idle" ? (
          <button type="button" onClick={onTrend} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="ext-trend-load">
            Show wave trend
          </button>
        ) : trend.state === "loading" ? (
          <p className="text-sm text-slate-500" role="status">
            Calculating every wave...
          </p>
        ) : trend.state === "failed" ? (
          <p className="text-sm text-red-700" role="alert">
            The trend could not be calculated: {trend.error}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="ext-trend-table">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2">Brand</th>
                  {trend.waves.map((w) => (
                    <th key={w.documentId} className="py-1 pr-2 text-right">
                      {w.wave}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ext.brands
                  .filter((b) => shown.includes(b.code))
                  .map((b) => (
                    <tr key={b.code} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2">{b.label}</td>
                      {trend.waves.map((w) => {
                        const v = w.values[construct]?.find((x) => x.code === b.code);
                        return (
                          <td key={w.documentId} className="py-1.5 pr-2 text-right tabular-nums" title={w.error ?? (w.comparable[construct] ? `n=${v?.n ?? 0}` : "Not comparable with this wave's question")}>
                            {w.error ? "Error" : !w.comparable[construct] ? "Not comparable" : pct(v?.topTwo ?? null)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ReasonList({ f, testId }: { f: ReasonFigures; testId: string }) {
  const rows = [...f.reasons];
  return (
    <div data-testid={testId}>
      <p className="mb-2 text-[11px] text-slate-500" data-testid="ext-reasons-bases">
        Eligible (different brands) n={f.eligible.n}; completed answer n={f.completed.n} (weighted {num(f.completed.weighted, 1)}); no answer n={f.missing.n}. Percent of completed answers; several reasons can be chosen, so they may add to more than 100%.
        {smallNote(f.smallBase) && <span className="ml-1 text-amber-700">{smallNote(f.smallBase)}</span>}
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.variable} className="grid grid-cols-[minmax(0,1fr)_8rem_3.5rem] items-center gap-3 text-sm" data-testid="ext-reason-row" data-variable={r.variable}>
            <span className="text-slate-700">{r.label}</span>
            <span className="h-2.5 rounded bg-slate-100">
              <span className="block h-2.5 rounded bg-[#2563eb]" style={{ width: `${Math.min(100, r.share ?? 0)}%` }} />
            </span>
            <span className="text-right tabular-nums">{pct(r.share)}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-2 text-sm" aria-label="Exclusive answers">
        {[f.none, f.cannotRecall].filter((x): x is NonNullable<typeof x> => !!x).map((r) => (
          <li key={r.variable} className="grid grid-cols-[minmax(0,1fr)_3.5rem] gap-3 text-slate-600" data-testid="ext-reason-exclusive" data-variable={r.variable}>
            <span>{r.label} (exclusive)</span>
            <span className="text-right tabular-nums">{pct(r.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChoiceView({ ext, shown, reasonBrand, onReasonBrand, onAlias, saving }: { ext: BrandExtension; shown: string[]; reasonBrand: string; onReasonBrand: (c: string) => void; onAlias: (name: string, brandCode: string) => void; saving: boolean }) {
  const e: EpisodeModule = ext.episode;
  const r: ReasonsModule = ext.reasons;
  if (e.status !== "ok")
    return (
      <Card title="Ideal versus actual brand" testId="ext-choice-card">
        <Unavailable state={e} testId="ext-choice-unavailable" />
        {r.status !== "ok" && <div className="mt-3"><Unavailable state={r} testId="ext-reasons-unavailable" /></div>}
      </Card>
    );
  const rows = e.shares.filter((s) => s.kind === "other" || (s.code !== null && shown.includes(s.code)));
  const max = Math.max(10, ...rows.flatMap((s) => [s.actual.share ?? 0, s.ideal.share ?? 0]));
  const brandReasons = r.status === "ok" ? r.byBrand.find((b) => b.code === reasonBrand) : undefined;
  return (
    <>
      <Card
        title="Ideal versus actual brand"
        testId="ext-choice-card"
        subtitle={`Same event: ${e.questions.event}. Both shares on the identical paired base: respondents whose actual and ideal brands are both known (n=${e.paired.n}, weighted ${num(e.paired.weighted, 1)}, effective ${num(e.paired.effective, 1)}). Ideal minus actual is a descriptive net share gap, not the number of people who missed their preference.`}
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div>
            <ul className="mb-2 flex gap-4 text-[11px] text-slate-600" aria-label="Legend">
              <li className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2563eb]" aria-hidden="true" />Ideal</li>
              <li className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" aria-hidden="true" />Actual</li>
            </ul>
            <ul className="flex flex-col gap-2">
              {rows.map((s) => (
                <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_7rem] items-center gap-3 text-sm" data-testid="ext-share-row" data-key={s.key} title={s.members?.map((x) => x.name).join(", ")}>
                  <span className="truncate text-slate-800">{s.label}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="h-2.5 rounded bg-[#2563eb]" style={{ width: `${((s.ideal.share ?? 0) / max) * 100}%` }} />
                    <span className="h-2.5 rounded bg-slate-400" style={{ width: `${((s.actual.share ?? 0) / max) * 100}%` }} />
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    {pct(s.ideal.share)} / {pct(s.actual.share)}
                    <span className="block text-[10px] text-slate-400">net {s.netGap === null ? "n/a" : `${s.netGap > 0 ? "+" : ""}${s.netGap.toFixed(1)} pts`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600" data-testid="ext-choice-statuses">
            <p className="font-semibold text-slate-700">Outside the paired base</p>
            <p className="mt-1">Event respondents: {e.episodeBase ? `n=${e.episodeBase.n}` : "route flag not in file"}; answered: n={e.asked.n}.</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {e.statuses.map((st) => (
                <li key={st.key} className="flex justify-between gap-2" data-testid="ext-status" data-key={st.key}>
                  <span>{st.label}</span>
                  <span className="tabular-nums">n={st.n}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <Card title="Different brand" subtitle="Weighted pairs whose ideal and actual brands differ / weighted paired base." testId="ext-gap">
          <p className="text-3xl font-bold text-slate-900" data-testid="ext-gap-rate">{pct(e.gap.rate)}</p>
          <p className="mt-1 text-xs text-slate-500">n={e.gap.n} of {e.paired.n}</p>
          {e.storedGap && <p className={`mt-2 text-[11px] ${e.storedGap.agrees ? "text-slate-500" : "text-amber-800"}`}>{e.storedGap.note}</p>}
        </Card>
        <Card title="Preference fulfilment" subtitle="Among each brand's ideal preferrers with a known actual brand: the share who chose it. Not market conversion." testId="ext-fulfilment">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2">Ideal brand</th>
                  <th className="py-1 pr-2 text-right">Preferrers</th>
                  <th className="py-1 pr-2 text-right">Fulfilled</th>
                  <th className="py-1">Actually chose instead</th>
                </tr>
              </thead>
              <tbody>
                {e.fulfilment
                  .filter((f) => shown.includes(f.code))
                  .map((f) => (
                    <tr key={f.code} className="border-t border-slate-100" data-testid="ext-fulfilment-row" data-code={f.code}>
                      <td className="py-1.5 pr-2">{f.label}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        n={f.preferrers.n} <span className="text-[10px] text-slate-400">({f.preferrers.weighted.toFixed(1)})</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {pct(f.rate)}
                        {smallNote(f.smallBase) && <span className="block text-[10px] text-amber-700">{smallNote(f.smallBase)}</span>}
                      </td>
                      <td className="py-1.5 text-xs text-slate-600">
                        {f.destinations
                          .filter((d) => d.key !== `brand:${f.code}`)
                          .slice(0, 3)
                          .map((d) => `${d.label} ${pct(d.share)}`)
                          .join("; ") || "None"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title="Reasons for a different choice" subtitle="Self-reported reasons, asked only when the ideal and actual brands differed. They do not prove that a restriction, rather than the brand, decided the choice." testId="ext-reasons">
        {r.status !== "ok" ? (
          <Unavailable state={r} testId="ext-reasons-unavailable" />
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-800">All respondents with a different brand</p>
              <ReasonList f={r.overall} testId="ext-reasons-overall" />
              {r.exclusiveConflicts > 0 && <p className="mt-2 text-xs text-amber-800">{r.exclusiveConflicts} respondents selected an exclusive answer together with another one.</p>}
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                Ideal preferrers of
                <select value={reasonBrand} onChange={(x) => onReasonBrand(x.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm font-normal" data-testid="ext-reasons-brand">
                  <option value="">Choose a brand</option>
                  {r.byBrand.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              {brandReasons ? (
                <>
                  <p className="mb-1 text-[11px] text-slate-500">Respondents whose ideal brand was {brandReasons.label}, whose actual brand is known and different. Not {brandReasons.label}&apos;s actual buyers.</p>
                  <ReasonList f={brandReasons} testId="ext-reasons-brand-list" />
                </>
              ) : (
                <p className="text-xs text-slate-500">Choose a brand to see the reasons given by those who ideally preferred it.</p>
              )}
            </div>
          </div>
        )}
      </Card>
      {(e.otherNames.length > 0 || e.aliasSuggestions.length > 0) && (
        <Card title="Other brand names" subtitle="Compared after trimming, case-folding and collapsing spaces; two Other answers match only when their names do. A name typed as a tracked brand is matched only once confirmed." testId="ext-other-names">
          <ul className="flex flex-col gap-1 text-sm">
            {e.otherNames.map((o) => (
              <li key={o.name} className="flex flex-wrap justify-between gap-2" data-testid="ext-other-name">
                <span>{o.verbatim.map((v) => `"${v}"`).join(", ")}</span>
                <span className="text-xs text-slate-500">resolved as {o.resolvedTo}</span>
              </li>
            ))}
          </ul>
          {e.aliasSuggestions.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs" data-testid="ext-alias-suggestions">
              {e.aliasSuggestions.map((a) => (
                <li key={a.name} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    &quot;{a.verbatim[0]}&quot; may be {a.label}. Needs review.
                  </span>
                  <button type="button" disabled={saving || !ext.confirmations.storageAvailable} onClick={() => onAlias(a.name, a.code)} className="rounded-md bg-[#2563eb] px-2.5 py-1 text-white disabled:opacity-50">
                    Confirm as {a.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

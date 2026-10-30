"use client";

// Page 02 "Moments & needs": the moment by brand card with two views (Grant, 30 October 2026): "Recall table" (the
// card as it was, the default) and "Moment profile": for each brand, among respondents aware of it, the share linking
// the brand to each moment, one line per brand so the shapes of brands' profiles can be compared. Figures come from
// loadMomentProfileAction (src/lib/trackerMomentProfile.ts, contract in claude/d2-design-2026-10-29.md, D3c); this
// screen chooses what to draw (src/lib/momentProfileView.ts) and never computes a figure.
//
// Drawing: moments on the x axis in category relevance order, dots joined by straight segments (moments are separate
// categories; a smoothed curve would invent values between them), an n/a value breaks its line and is never drawn as
// 0. The chosen view is remembered per browser and per data file; the card works when storage cannot be used.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadMomentProfileAction } from "@/lib/trackerDashboardActions";
import type { BrandMoments } from "@/lib/trackerMoments";
import type { MomentProfile } from "@/lib/trackerMomentProfile";
import {
  PROFILE_MAX_BRANDS,
  PROFILE_TOP_MOMENTS,
  browserStorage,
  defaultProfileBrands,
  orderProfileMoments,
  profileAxisMax,
  profileSegments,
  readMomentCardView,
  selectProfileMoments,
  toggleProfileBrand,
  writeMomentCardView,
  type MomentCardView,
  type MomentChoice,
} from "@/lib/momentProfileView";

const FOCAL_COLOUR = "#2563eb";
/** The other brands' line colours, by their place among the brands drawn (presentation only; identity is the code). */
const OTHER_COLOURS = ["#d97706", "#059669", "#dc2626", "#7c3aed"];
const pct = (v: number) => `${v.toFixed(1)}%`;

type Load = { doc: string; source: BrandMoments } & ({ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; profile: MomentProfile });

export function MomentByBrandCard({
  runId,
  documentId,
  moments,
  brands,
  focal,
  compared,
  recallSubtitle,
  recallBody,
  frame,
}: {
  runId: string;
  documentId: string;
  /** Page 02's figures: the relevance order of the moments, and the identity of the load (a new load reloads the profile). */
  moments: BrandMoments;
  brands: { code: string; label: string }[];
  focal: string | null;
  /** The brands compared (page 02's Compare chip), the profile's first brands after the client's. */
  compared: string[];
  recallSubtitle: ReactNode;
  recallBody: ReactNode;
  /** The page's card: the subtitle and the body for the view shown. */
  frame: (subtitle: ReactNode, body: ReactNode) => ReactNode;
}) {
  const [chosen, setChosen] = useState<{ doc: string; view: MomentCardView }>(() => ({ doc: documentId, view: readMomentCardView(browserStorage(), documentId) }));
  const view = chosen.doc === documentId ? chosen.view : readMomentCardView(browserStorage(), documentId);
  const choose = (v: MomentCardView) => {
    setChosen({ doc: documentId, view: v });
    writeMomentCardView(browserStorage(), documentId, v);
  };

  // The profile is calculated only when its view is shown, again for each file and each new load of page 02 (a
  // weighting or mapping change reloads page 02). An answer for an earlier request never replaces a later one.
  const [load, setLoad] = useState<Load | null>(null);
  const latest = useRef(0);
  const current = load && load.doc === documentId && load.source === moments ? load : null;
  const start = useCallback(async () => {
    const id = ++latest.current;
    setLoad({ doc: documentId, source: moments, state: "loading" });
    void loadMomentProfileAction(runId, documentId).then(
      (r) => {
        if (id !== latest.current) return;
        setLoad(r.ok ? { doc: documentId, source: moments, state: "ready", profile: r.profile } : { doc: documentId, source: moments, state: "failed", error: r.error });
      },
      (e: unknown) => {
        if (id !== latest.current) return;
        setLoad({ doc: documentId, source: moments, state: "failed", error: e instanceof Error ? e.message : String(e) });
      },
    );
  }, [runId, documentId, moments]);
  const needsLoad = view === "profile" && current === null;
  useEffect(() => {
    // Calculated when shown, once per file and per load of page 02 (the panel's pattern for its pages).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsLoad) void start();
  }, [needsLoad, start]);

  const toggle = (
    <div role="group" aria-label="Moment by brand view" className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs" data-testid="moment-card-view">
      {(
        [
          ["recall", "Recall table"],
          ["profile", "Moment profile"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => choose(v)}
          className={`rounded-md px-3 py-1 font-medium ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "recall")
    return frame(
      recallSubtitle,
      <>
        {toggle}
        {recallBody}
      </>,
    );

  const profile = current?.state === "ready" ? current.profile : null;
  const weighting = profile ? (profile.weighted ? `Weighted by ${profile.weightVar}` : "Unweighted") : "";
  return frame(
    `Cue-specific recall among those aware of each brand; pick-any. ${weighting}${weighting ? "." : ""}`,
    <>
      {toggle}
      {current === null || current.state === "loading" ? (
        <p className="text-sm text-slate-500" role="status">
          Calculating each brand&apos;s moment profile from this file...
        </p>
      ) : current.state === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="moment-profile-failed">
          <p>The moment profile could not be calculated: {current.error}</p>
          <button type="button" onClick={() => void start()} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
            Try again
          </button>
        </div>
      ) : current.profile.profile.status !== "ok" ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid="moment-profile-unavailable" data-status={current.profile.profile.status}>
          <p className="text-sm font-semibold text-slate-700">{current.profile.profile.status === "not_measured" ? "Not measured" : "Mapping needed"}</p>
          <p className="mt-1 text-xs text-slate-500">{current.profile.profile.reason}</p>
        </div>
      ) : (
        <ProfileChart
          key={documentId}
          profile={current.profile.profile}
          relevance={moments.relevance.status === "ok" ? moments.relevance.moments : null}
          brands={brands}
          focal={focal}
          compared={compared}
        />
      )}
    </>,
  );
}

type OkProfile = Extract<MomentProfile["profile"], { status: "ok" }>;

function ProfileChart({
  profile,
  relevance,
  brands,
  focal,
  compared,
}: {
  profile: OkProfile;
  relevance: { gridGroup: string | null; share: number | null }[] | null;
  brands: { code: string; label: string }[];
  focal: string | null;
  compared: string[];
}) {
  const brandCodes = brands.map((b) => b.code);
  const labelOf = new Map(brands.map((b) => [b.code, b.label]));
  const [drawn, setDrawn] = useState<string[]>(() => defaultProfileBrands(focal, compared, brandCodes));
  const [note, setNote] = useState<string | null>(null);
  const [choice, setChoice] = useState<MomentChoice>({ kind: "all" });
  const [active, setActive] = useState<{ code: string; group: string } | null>(null);

  const { moments: ordered, byRelevance } = orderProfileMoments(
    profile.moments.map((m) => ({ group: m.group, item: m.item })),
    relevance,
  );
  const shownMoments = selectProfileMoments(ordered, choice);
  const cellOf = (code: string, group: string) => profile.moments.find((m) => m.group === group)?.cells.find((c) => c.code === code);
  const baseOf = new Map(profile.bases.map((b) => [b.code, b]));
  const others = drawn.filter((c) => c !== focal);
  const colourOf = (code: string) => (code === focal ? FOCAL_COLOUR : OTHER_COLOURS[others.indexOf(code) % OTHER_COLOURS.length]);
  const valuesOf = (code: string) => shownMoments.map((m) => cellOf(code, m.group)?.share ?? null);
  const yMax = profileAxisMax(drawn.flatMap(valuesOf));

  // Geometry (viewBox units): one band per moment, the value axis from 0 to yMax.
  const W = 760;
  const H = 330;
  const L = 44;
  const R = 12;
  const T = 14;
  const B = 104;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const n = Math.max(1, shownMoments.length);
  const x = (i: number) => L + ((i + 0.5) * plotW) / n;
  const y = (v: number) => T + plotH - (v / yMax) * plotH;
  const ticks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10).filter((t) => yMax <= 50 || t % 20 === 0);
  const short = (s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s);

  const pick = (code: string) => {
    const r = toggleProfileBrand(drawn, code, focal, brandCodes);
    setDrawn(r.brands);
    setNote(r.refused ?? null);
  };
  const chooseMoments = (kind: MomentChoice["kind"]) => setChoice(kind === "chosen" ? { kind: "chosen", groups: shownMoments.map((m) => m.group) } : { kind });
  const tickMoment = (group: string) => {
    if (choice.kind !== "chosen") return;
    const has = choice.groups.includes(group);
    if (has && choice.groups.length === 1) return;
    setChoice({ kind: "chosen", groups: has ? choice.groups.filter((g) => g !== group) : [...choice.groups, group] });
  };

  const tip = active ? { cell: cellOf(active.code, active.group), i: shownMoments.findIndex((m) => m.group === active.group) } : null;
  const naCells = drawn.flatMap((code) =>
    shownMoments
      .map((m) => ({ m, c: cellOf(code, m.group) }))
      .filter(({ c }) => !c || c.share === null)
      .map(({ m, c }) => `${labelOf.get(code) ?? code}, ${m.item}: ${c?.reason ?? "Not available."}${c?.base !== null && c?.base !== undefined ? ` (n=${c.base.toLocaleString()})` : ""}`),
  );

  return (
    <div data-testid="moment-profile">
      <div className="mb-3 flex flex-wrap items-start gap-x-6 gap-y-2 text-xs">
        <div role="group" aria-label={`Brands (up to ${PROFILE_MAX_BRANDS})`} className="flex flex-wrap items-center gap-1.5" data-testid="moment-profile-brands">
          <span className="mr-1 text-slate-500">
            Brands ({drawn.length} of {PROFILE_MAX_BRANDS})
          </span>
          {brands.map((b) => {
            const on = drawn.includes(b.code);
            const full = !on && drawn.length >= PROFILE_MAX_BRANDS;
            return (
              <button
                key={b.code}
                type="button"
                aria-pressed={on}
                disabled={b.code === focal || full}
                title={b.code === focal ? "Your brand is always shown." : full ? `Up to ${PROFILE_MAX_BRANDS} brands at a time. Remove one to add another.` : undefined}
                onClick={() => pick(b.code)}
                className={`rounded-full border px-2.5 py-0.5 ${on ? "border-slate-300 bg-white font-medium text-slate-900" : "border-transparent bg-slate-100 text-slate-500"} disabled:cursor-not-allowed ${full ? "opacity-50" : ""}`}
              >
                {on && <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colourOf(b.code) }} aria-hidden="true" />}
                {b.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Moments</span>
          <select value={choice.kind} onChange={(e) => chooseMoments(e.target.value as MomentChoice["kind"])} className="rounded-md border border-slate-200 bg-white px-2 py-1" data-testid="moment-profile-moments">
            <option value="all">All moments ({ordered.length})</option>
            {byRelevance && <option value="top">The {PROFILE_TOP_MOMENTS === 6 ? "six" : PROFILE_TOP_MOMENTS} most relevant</option>}
            <option value="chosen">Choose moments</option>
          </select>
        </label>
      </div>
      {note && (
        <p className="mb-2 text-xs text-amber-700" role="status">
          {note}
        </p>
      )}
      {choice.kind === "chosen" && (
        <fieldset className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" data-testid="moment-profile-choose">
          <legend className="sr-only">Moments shown</legend>
          {ordered.map((m) => {
            const on = choice.groups.includes(m.group);
            return (
              <label key={m.group} className="flex items-center gap-1">
                <input type="checkbox" checked={on} disabled={on && choice.groups.length === 1} onChange={() => tickMoment(m.group)} />
                {m.item}
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={`Moment profile: share of each brand's aware respondents linking it to each moment, ${drawn.map((c) => labelOf.get(c) ?? c).join(", ")}`} data-testid="moment-profile-chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">
                {t}%
              </text>
            </g>
          ))}
          {shownMoments.map((m, i) => (
            <text key={m.group} x={x(i)} y={T + plotH + 12} fontSize={10} fill="#334155" textAnchor="end" transform={`rotate(-35 ${x(i)} ${T + plotH + 12})`}>
              <title>{m.item}</title>
              {short(m.item)}
            </text>
          ))}
          {/* Other brands first, the client's brand last so its line is on top. */}
          {[...others, ...(focal && drawn.includes(focal) ? [focal] : [])].map((code) => {
            const values = valuesOf(code);
            const isFocal = code === focal;
            return (
              <g key={code} data-testid="moment-profile-line" data-code={code}>
                {profileSegments(values).map(([a, b]) => (
                  <line key={a} x1={x(a)} y1={y(values[a]!)} x2={x(b)} y2={y(values[b]!)} stroke={colourOf(code)} strokeWidth={isFocal ? 2.75 : 1.75} strokeLinecap="round" />
                ))}
                {values.map((v, i) =>
                  v === null ? null : (
                    <circle
                      key={shownMoments[i].group}
                      cx={x(i)}
                      cy={y(v)}
                      r={isFocal ? 5 : 4}
                      fill={colourOf(code)}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      tabIndex={0}
                      role="img"
                      aria-label={`${labelOf.get(code) ?? code}, ${shownMoments[i].item}: ${pct(v)} of those aware (n=${(cellOf(code, shownMoments[i].group)?.base ?? 0).toLocaleString()})`}
                      data-testid="moment-profile-point"
                      data-code={code}
                      data-group={shownMoments[i].group}
                      onMouseEnter={() => setActive({ code, group: shownMoments[i].group })}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive({ code, group: shownMoments[i].group })}
                      onBlur={() => setActive(null)}
                      className="cursor-default outline-none focus:stroke-slate-900"
                    />
                  ),
                )}
              </g>
            );
          })}
          {active && tip && tip.cell && tip.cell.share !== null && tip.i >= 0 && (
            <g pointerEvents="none" data-testid="moment-profile-tip">
              {(() => {
                const tx = Math.min(x(tip.i) + 8, W - R - 190);
                const ty = Math.max(T, y(tip.cell.share) - 46);
                return (
                  <>
                    <rect x={tx} y={ty} width={190} height={38} rx={6} fill="#0f172a" opacity={0.92} />
                    <text x={tx + 8} y={ty + 15} fontSize={11} fill="#ffffff" fontWeight={600}>
                      {labelOf.get(active.code) ?? active.code}: {pct(tip.cell.share)}
                    </text>
                    <text x={tx + 8} y={ty + 30} fontSize={10} fill="#cbd5e1">
                      {short(shownMoments[tip.i].item)} (n={tip.cell.base?.toLocaleString()})
                    </text>
                  </>
                );
              })()}
            </g>
          )}
        </svg>
      </div>

      <p className="mt-2 text-[11px] text-slate-500" data-testid="moment-profile-bases">
        Aware bases:{" "}
        {drawn
          .map((code) => {
            const b = baseOf.get(code);
            const name = labelOf.get(code) ?? code;
            if (!b || b.n === null) return `${name} n/a${b?.reason ? ` (${b.reason})` : ""}`;
            return `${name} n=${b.n.toLocaleString()}${b.effectiveBase !== null ? ` (effective ${Math.round(b.effectiveBase).toLocaleString()})` : ""}`;
          })
          .join(" | ")}
        . Awareness: {profile.awareness.label}.
      </p>
      {naCells.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500" data-testid="moment-profile-na">
          n/a: {naCells.join(" ")}
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-500" data-testid="moment-profile-note">
        {byRelevance ? "Moments ordered by category relevance, highest first." : "Category relevance is not available, so moments are in the question's order."} Each brand uses its own
        awareness base. Pick-any: a brand&apos;s values across moments do not add up to 100 and are not a share of its mentions. Lines only join the moments to show each
        brand&apos;s shape; there are no values between them. No statistical comparison implied.
      </p>
      <details className="mt-2 text-xs" data-testid="moment-profile-table">
        <summary className="cursor-pointer text-slate-600">Show the figures as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Moment profile: share of each brand&apos;s aware respondents linking it to each moment</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium text-slate-500">
                  Moment
                </th>
                {drawn.map((code) => (
                  <th key={code} scope="col" className={`px-2 py-1 text-right font-semibold ${code === focal ? "text-blue-700" : "text-slate-700"}`}>
                    {labelOf.get(code) ?? code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownMoments.map((m) => (
                <tr key={m.group} className="border-t border-slate-100">
                  <th scope="row" className="py-1 pr-2 font-normal text-slate-700">
                    {m.item}
                  </th>
                  {drawn.map((code) => {
                    const c = cellOf(code, m.group);
                    return (
                      <td key={code} className="px-2 py-1 text-right tabular-nums" title={c?.reason} data-testid="moment-profile-cell" data-code={code} data-group={m.group}>
                        {c && c.share !== null ? pct(c.share) : "n/a"}
                        <span className="ml-1 text-[10px] text-slate-400">n={c?.base === null || c?.base === undefined ? "n/a" : c.base.toLocaleString()}</span>
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

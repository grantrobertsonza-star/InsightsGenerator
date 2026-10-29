"use client";

import { useEffect, useMemo, useState } from "react";
import { setChoicesToCheck } from "@/lib/variableSetKeys";
import { createPortal } from "react-dom";

import type { VariableInfo, VariableSet } from "@/lib/parseStatsFile";
import type { WaveFile } from "@/lib/waveTrackingActions";
import {
  loadBrandHealthCandidatesAction,
  loadBrandCategoriesAction,
  loadBrandSetMembersAction,
  buildBrandHealthDashboardAction,
  buildBrandHealthWaveDashboardsAction,
  loadBrandHealthModuleAction,
  saveBrandHealthModuleAction,
  addBrandHealthFindingAction,
  removeBrandHealthFindingAction,
  brandHealthFindingStatusAction,
  type BrandHealthDashboard,
  type BrandHealthMapping,
  type BrandHealthScore,
  type BrandHealthSource,
  type BrandHealthFindingSection,
  type CsmMetric,
} from "@/lib/brandHealthActions";
import { defaultMetricForScale, metricLabel } from "@/lib/csmMetrics";
import {
  bandVerdict,
  bandColors,
  brandGroupsOverlapNote,
  brandHealthFindingKey,
  categoryAverageExact,
  sectionSplitsByBrandGroups,
} from "@/lib/brandHealthMetrics";

const METRICS: CsmMetric[] = ["mean", "top1", "top2", "top3"];
const FUNNEL_FIELDS: { key: "awareness" | "consideration" | "usage" | "frequent"; label: string }[] = [
  { key: "awareness", label: "Awareness" },
  { key: "consideration", label: "Consideration" },
  { key: "usage", label: "Past-period usage" },
  { key: "frequent", label: "Frequent / repeat usage" },
];

/**
 * A mapped source (attributes, moments, a funnel stage) is either a plain shared variable or a
 * multi-response set with one member column per brand. The UI tracks both kinds in the same
 * picker and Map, keyed "var:<name>" or "set:<key>" so a set can sit next to plain variables in
 * one checklist/select without a name collision.
 */
function sourceKey(source: BrandHealthSource | undefined): string {
  if (!source) return "";
  return "setKey" in source ? `set:${source.setKey}` : `var:${source.variable}`;
}
function sourceFromKey(key: string, metric?: CsmMetric): BrandHealthSource | undefined {
  if (!key) return undefined;
  if (key.startsWith("set:")) return { setKey: key.slice(4), metric };
  if (key.startsWith("var:")) return { variable: key.slice(4), metric };
  return undefined;
}

function usableFor(v: VariableInfo): boolean {
  return !v.weightLike && !v.text && v.nDistinct >= 2;
}

function brandCandidate(v: VariableInfo): boolean {
  return usableFor(v) && v.nDistinct >= 2 && v.nDistinct <= 20;
}

/** A set the brand source can name: a multiple-response set (a dictionary without set kinds lists every set; the
 * server refuses one that is not multiple-response, with the reason). */
function brandSetCandidate(set: VariableSet): boolean {
  return set.kind === undefined || set.kind === "multi";
}

function emptyMapping(): BrandHealthMapping {
  return { brandVar: null, brandSet: null, ourBrand: null, funnel: {}, attributes: [], loyaltyVar: null, moments: [], positioning: { xVar: null, yVar: null } };
}

/**
 * The Brand Health module: name the brand variable and which coded brand is "ours", map the
 * funnel stages, the attribute battery, loyalty and category entry points once, then get a
 * dashboard benchmarked against every other brand in the file, on this file or across its waves.
 */
export default function BrandHealthAnalyticsPanel({
  runId,
  documentId,
  filename,
  waveFiles,
  onClose,
  closeLabel = "Close",
}: {
  runId: string;
  documentId: string;
  filename: string;
  waveFiles?: WaveFile[];
  onClose: () => void;
  /** "All analytics" when opened from the Analytics tool grid, which it returns to. */
  closeLabel?: string;
}) {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [sets, setSets] = useState<VariableSet[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mapping, setMapping] = useState<BrandHealthMapping>(emptyMapping());
  // value: what is saved as ourBrand (a brand variable's category label, or a brand set's member variable);
  // label: what the researcher reads.
  const [ourBrandOptions, setOurBrandOptions] = useState<{ value: string; label: string }[]>([]);
  const [brandOptionsError, setBrandOptionsError] = useState<string | null>(null);
  const [brandSetLabel, setBrandSetLabel] = useState<string | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Map<string, CsmMetric | "">>(new Map());
  const [moments, setMoments] = useState<Map<string, CsmMetric | "">>(new Map());
  const [filter, setFilter] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [acrossWaves, setAcrossWaves] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [dashboards, setDashboards] = useState<BrandHealthDashboard[] | null>(null);
  const [activeWave, setActiveWave] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const [vars, saved] = await Promise.all([loadBrandHealthCandidatesAction(runId, documentId), loadBrandHealthModuleAction(runId, documentId)]);
      if (!active) return;
      if (!vars.ok) {
        setLoadError(vars.error);
        return;
      }
      setVariables(vars.variables);
      setSets(vars.sets);
      if (!saved.ok) setSavedError(`The saved mapping could not be loaded: ${saved.error}`);
      if (saved.ok && saved.mapping) {
        const m = saved.mapping;
        setMapping(m);
        setAttributes(new Map(m.attributes.map((a) => [sourceKey(a), a.metric ?? ""])));
        setMoments(new Map(m.moments.map((a) => [sourceKey(a), a.metric ?? ""])));
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, documentId]);

  // The "our brand" choices follow the brand source. `active` drops a late answer for a source the researcher has
  // since changed, so an earlier source's brands never replace the current one's.
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrandOptionsError(null);
    if (mapping.brandSet) {
      const setKey = mapping.brandSet;
      (async () => {
        const res = await loadBrandSetMembersAction(runId, documentId, setKey);
        if (!active) return;
        if (res.ok) {
          setOurBrandOptions(res.members.map((m) => ({ value: m.variable, label: m.brand })));
          setBrandSetLabel(res.setLabel);
        } else {
          setOurBrandOptions([]);
          setBrandSetLabel(null);
          setBrandOptionsError(res.error);
        }
      })();
      return () => {
        active = false;
      };
    }
    setBrandSetLabel(null);
    if (!mapping.brandVar) {
      setOurBrandOptions([]);
      return;
    }
    const brandVar = mapping.brandVar;
    (async () => {
      const res = await loadBrandCategoriesAction(runId, documentId, brandVar, null);
      if (!active) return;
      if (res.ok) setOurBrandOptions(res.brands.map((b) => ({ value: b, label: b })));
      else {
        setOurBrandOptions([]);
        setBrandOptionsError(res.error);
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, documentId, mapping.brandVar, mapping.brandSet]);

  const byName = useMemo(() => new Map(variables.map((v) => [v.name, v])), [variables]);
  const candidates = useMemo(
    () => variables.filter((v) => usableFor(v) && (!filter || `${v.name} ${v.label}`.toLowerCase().includes(filter.toLowerCase()))),
    [variables, filter],
  );
  const brandCandidates = useMemo(() => variables.filter(brandCandidate), [variables]);
  const brandSetCandidates = useMemo(() => sets.filter(brandSetCandidate), [sets]);
  const setsByKey = useMemo(() => new Map(sets.map((s) => [s.key, s])), [sets]);
  const filteredSets = useMemo(
    () => sets.filter((s) => !filter || `${s.key} ${s.label}`.toLowerCase().includes(filter.toLowerCase())),
    [sets, filter],
  );
  /** A mapped source's display label, whether it's a plain variable or a multi-response set. */
  function labelForKey(key: string): string {
    if (key.startsWith("set:")) return setsByKey.get(key.slice(4))?.label || key.slice(4);
    if (key.startsWith("var:")) return byName.get(key.slice(4))?.label || key.slice(4);
    return key;
  }
  const attributeVars = [...attributes.keys()];
  // Set choices whose stem now also names a battery or grid keyed apart (variableSetKeys.ts): the
  // choice was computed with the multiple-response set, but the screen may have labelled it with the
  // other, so it is pointed out rather than silently assumed.
  const setChoices = [...Object.values(mapping.funnel).map((x) => sourceKey(x)), ...attributes.keys(), ...moments.keys()]
    .filter((k) => k.startsWith("set:"))
    .map((k) => k.slice(4));
  const toCheck = setChoicesToCheck(setChoices, sets);

  function toggleIn(map: Map<string, CsmMetric | "">, setMap: (m: Map<string, CsmMetric | "">) => void, name: string) {
    const next = new Map(map);
    if (next.has(name)) next.delete(name);
    else next.set(name, "");
    setMap(next);
  }

  function currentMapping(): BrandHealthMapping {
    return {
      ...mapping,
      attributes: [...attributes.entries()]
        .map(([key, metric]) => sourceFromKey(key, metric || undefined))
        .filter((s): s is BrandHealthSource => !!s),
      moments: [...moments.entries()]
        .map(([key, metric]) => sourceFromKey(key, metric || undefined))
        .filter((s): s is BrandHealthSource => !!s),
    };
  }

  async function save() {
    setSaveStatus("saving");
    setSaveError(null);
    const res = await saveBrandHealthModuleAction(runId, documentId, currentMapping());
    setSaveStatus(res.ok ? "saved" : "idle");
    if (res.ok) setTimeout(() => setSaveStatus("idle"), 1800);
    else setSaveError(`The mapping was not saved: ${res.error}`);
  }

  async function build() {
    setBusy(true);
    setBuildError(null);
    setDashboards(null);
    const m = currentMapping();
    if ((!m.brandVar && !m.brandSet) || !m.ourBrand) {
      setBuildError("Map the brand variable and pick which brand is \"ours\" first.");
      setBusy(false);
      return;
    }
    const res =
      acrossWaves && (waveFiles?.length ?? 0) >= 2
        ? await buildBrandHealthWaveDashboardsAction(runId, waveFiles!.map((w) => ({ documentId: w.documentId, label: w.wave })), m)
        : await buildBrandHealthDashboardAction(runId, documentId, m);
    if (!res.ok) {
      setBuildError(res.error);
      setBusy(false);
      return;
    }
    setDashboards("dashboard" in res ? [res.dashboard] : res.dashboards);
    setActiveWave(0);
    setBusy(false);
    void save();
  }

  const active = dashboards?.[activeWave] ?? null;

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Brand Health Analytics">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">Brand Health Analytics</p>
          <p className="text-[11px] text-muted">{filename}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
          {closeLabel === "Close" ? "Close" : `← ${closeLabel}`}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r-2 border-sky-200 bg-sky-50 p-4 text-xs">
          {loadError && <p className="text-red-600">{loadError}</p>}
          {savedError && <p className="text-red-600">{savedError}</p>}
          {!variables.length && !loadError && <p className="text-muted">Loading the variable list...</p>}
          {toCheck.length > 0 && (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900" data-testid="brand-health-set-check">
              {`Check ${toCheck.length === 1 ? "this choice" : "these choices"}: ${toCheck
                .map((k) => `"${setsByKey.get(k)?.label || k}" (${k})`)
                .join(", ")}. Two question sets in this file used to share ${toCheck.length === 1 ? "this name" : "these names"}; the name now means the multiple-response set, which the results were calculated with, and the other set is listed separately with "(battery)" or "(grid)" after it.`}
            </p>
          )}

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Brand variable</p>
            <p className="text-[11px] text-muted">
              The question in this file that holds the brand values (eg &ldquo;which brand do you use most often&rdquo;), or a multiple-response question with one member per brand (eg household ownership).
            </p>
            <select
              aria-label="Brand variable"
              value={mapping.brandSet ? `set:${mapping.brandSet}` : (mapping.brandVar ?? "")}
              onChange={(e) => {
                const value = e.target.value;
                // Changing the brand source clears our brand: a brand of one source means nothing in another.
                setMapping((m) =>
                  value.startsWith("set:")
                    ? { ...m, brandVar: null, brandSet: value.slice(4), ourBrand: null }
                    : { ...m, brandVar: value || null, brandSet: null, ourBrand: null },
                );
              }}
              className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="">None</option>
              {brandSetCandidates.length > 0 && (
                <optgroup label="Multiple-response sets (one member per brand)">
                  {brandSetCandidates.map((set) => (
                    <option key={set.key} value={`set:${set.key}`}>
                      {set.label || set.key} ({set.vars.length} brands)
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Plain variables">
                {brandCandidates.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.label || v.name}
                  </option>
                ))}
              </optgroup>
            </select>
            {mapping.brandSet && brandSetLabel && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900" data-testid="brand-health-overlap-note">
                {brandGroupsOverlapNote(brandSetLabel)}
              </p>
            )}
            {brandOptionsError && (
              <p className="text-[11px] text-red-600" data-testid="brand-health-brand-error">
                {brandOptionsError}
              </p>
            )}
            {(mapping.brandVar || mapping.brandSet) && (
              <>
                <p className="font-medium text-foreground">Our brand</p>
                <select
                  aria-label="Our brand"
                  value={mapping.ourBrand ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, ourBrand: e.target.value || null }))}
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">Pick the brand to compare against the rest</option>
                  {ourBrandOptions.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Funnel stages (optional)</p>
            <p className="text-[11px] text-muted">One variable per stage. The ratio between stages is computed automatically (each stage measured independently, not a same-respondent conversion).</p>
            {FUNNEL_FIELDS.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">{label}</label>
                <select
                  value={sourceKey(mapping.funnel[key])}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      funnel: { ...m.funnel, [key]: sourceFromKey(e.target.value) },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">None</option>
                  {sets.length > 0 && (
                    <optgroup label="Multiple-response sets (one column per brand)">
                      {sets.map((set) => (
                        <option key={set.key} value={`set:${set.key}`}>
                          {set.label} ({set.vars.length} brands)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Plain variables">
                    {candidates.map((v) => (
                      <option key={v.name} value={`var:${v.name}`}>
                        {v.label || v.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            ))}
          </section>

          <section className="flex flex-col space-y-1.5">
            <p className="font-medium text-foreground">Attributes / image battery ({attributes.size})</p>
            <p className="text-[11px] text-muted">The association questions the fingerprint and positioning map read from.</p>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search variables"
              className="w-full rounded-lg border border-border px-2 py-1.5 text-xs"
            />
            <div className="h-72 space-y-1 overflow-y-auto rounded-lg border border-border bg-white p-1.5">
              {filteredSets.length > 0 && (
                <p className="px-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Multiple-response sets</p>
              )}
              {filteredSets.map((set) => {
                const key = `set:${set.key}`;
                const checked = attributes.has(key);
                const metric = attributes.get(key) ?? "";
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleIn(attributes, setAttributes, key)} />
                    <span className="flex-1 truncate" title={`${set.label} - one column per brand (${set.vars.length} brands)`}>
                      {set.label} <span className="text-muted">({set.vars.length} brands)</span>
                    </span>
                    {checked && (
                      <select
                        value={metric}
                        onChange={(e) => {
                          const next = new Map(attributes);
                          next.set(key, e.target.value as CsmMetric | "");
                          setAttributes(next);
                        }}
                        className="rounded border border-border bg-white px-1 py-0.5 text-[11px]"
                        title="Default metric for this set's members"
                      >
                        <option value="">Default</option>
                        {METRICS.map((m) => (
                          <option key={m} value={m}>
                            {metricLabel(m)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
              {filteredSets.length > 0 && candidates.length > 0 && (
                <p className="px-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">Plain variables</p>
              )}
              {candidates.map((v) => {
                const key = `var:${v.name}`;
                const checked = attributes.has(key);
                const metric = attributes.get(key) ?? "";
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleIn(attributes, setAttributes, key)} />
                    <span className="flex-1 truncate" title={v.label || v.name}>
                      {v.label || v.name}
                    </span>
                    {checked && (
                      <select
                        value={metric}
                        onChange={(e) => {
                          const next = new Map(attributes);
                          next.set(key, e.target.value as CsmMetric | "");
                          setAttributes(next);
                        }}
                        className="rounded border border-border bg-white px-1 py-0.5 text-[11px]"
                        title={`Default: ${metricLabel(defaultMetricForScale(v.nDistinct))} for a ${v.nDistinct}-point scale`}
                      >
                        <option value="">Default</option>
                        {METRICS.map((m) => (
                          <option key={m} value={m}>
                            {metricLabel(m)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Loyalty / NPS (optional)</p>
            <select
              aria-label="Loyalty / NPS"
              value={mapping.loyaltyVar ?? ""}
              onChange={(e) => setMapping((m) => ({ ...m, loyaltyVar: e.target.value || null }))}
              className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="">None</option>
              {candidates.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label || v.name}
                </option>
              ))}
            </select>
          </section>

          <section className="space-y-1.5">
            <p className="font-medium text-foreground">Category entry points (optional)</p>
            <p className="text-[11px] text-muted">Which occasions trigger a purchase in this category, eg &ldquo;would consider this brand for...&rdquo;</p>
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-white p-1.5">
              {filteredSets.map((set) => {
                const key = `set:${set.key}`;
                const checked = moments.has(key);
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleIn(moments, setMoments, key)} />
                    <span className="flex-1 truncate" title={`${set.label} - one column per brand (${set.vars.length} brands)`}>
                      {set.label} <span className="text-muted">({set.vars.length} brands)</span>
                    </span>
                  </div>
                );
              })}
              {candidates.map((v) => {
                const key = `var:${v.name}`;
                const checked = moments.has(key);
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleIn(moments, setMoments, key)} />
                    <span className="flex-1 truncate" title={v.label || v.name}>
                      {v.label || v.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {attributeVars.length >= 2 && (
            <section className="space-y-1.5">
              <p className="font-medium text-foreground">Positioning map (optional)</p>
              <p className="text-[11px] text-muted">Pick two mapped attributes to plot every brand on.</p>
              <select
                value={mapping.positioning.xVar ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, positioning: { ...m.positioning, xVar: e.target.value || null } }))}
                className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
              >
                <option value="">X axis: none</option>
                {attributeVars.map((n) => (
                  <option key={n} value={n.slice(n.indexOf(":") + 1)}>
                    {labelForKey(n)}
                  </option>
                ))}
              </select>
              <select
                value={mapping.positioning.yVar ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, positioning: { ...m.positioning, yVar: e.target.value || null } }))}
                className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Y axis: none</option>
                {attributeVars.map((n) => (
                  <option key={n} value={n.slice(n.indexOf(":") + 1)}>
                    {labelForKey(n)}
                  </option>
                ))}
              </select>
            </section>
          )}

          {(waveFiles?.length ?? 0) >= 2 && (
            <section className="space-y-1.5">
              <label className="flex items-center gap-1.5 font-medium text-foreground">
                <input type="checkbox" checked={acrossWaves} onChange={(e) => setAcrossWaves(e.target.checked)} />
                Run across all {waveFiles!.length} waves
              </label>
              <p className="text-[11px] text-muted">Off: just this file ({filename}). On: every file labelled as a wave of this tracking study.</p>
            </section>
          )}

          <div className="mt-auto flex gap-2 pt-2">
            <button
              type="button"
              onClick={build}
              disabled={busy}
              className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? "Building..." : "Build dashboard"}
            </button>
            <button type="button" onClick={save} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-slate-50">
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save mapping"}
            </button>
          </div>
          {saveError && (
            <p className="text-[11px] text-red-600" data-testid="brand-health-save-error">
              {saveError}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {buildError && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{buildError}</p>}
          {!dashboards && !buildError && <p className="text-sm text-muted">Map the brand variable and at least one funnel stage or attribute, then build the dashboard.</p>}
          {dashboards && dashboards.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {dashboards.map((d, i) => (
                <button
                  key={d.documentId}
                  type="button"
                  onClick={() => setActiveWave(i)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    i === activeWave ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-slate-50"
                  }`}
                >
                  {d.waveLabel || `Wave ${i + 1}`}
                </button>
              ))}
            </div>
          )}
          {active && <BrandHealthDashboardView runId={runId} documentId={active.documentId} dashboard={active} />}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/** A small commit toggle for one section of the dashboard, mirroring CsmFindingButton. */
function BrandHealthFindingButton({
  runId,
  documentId,
  dashboard,
  section,
}: {
  runId: string;
  documentId: string;
  dashboard: BrandHealthDashboard;
  section: BrandHealthFindingSection;
}) {
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = brandHealthFindingKey(dashboard, section);

  useEffect(() => {
    let active = true;
    if (!key) return;
    (async () => {
      const res = await brandHealthFindingStatusAction(runId, documentId, section, key);
      if (active && res.ok) setCommitted(res.committed);
    })();
    return () => {
      active = false;
    };
  }, [runId, documentId, section, key]);

  if (!key) return null;

  async function toggle() {
    setBusy(true);
    const res = committed
      ? await removeBrandHealthFindingAction(runId, documentId, section, key!)
      : await addBrandHealthFindingAction(runId, documentId, dashboard, section);
    if (res.ok) setCommitted(!committed);
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60 ${
        committed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border text-muted hover:bg-slate-50"
      }`}
    >
      {committed ? "In findings" : "Post to findings"}
    </button>
  );
}

function ScoreRow({ score, ourBrand }: { score: BrandHealthScore; ourBrand: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{score.label}</span>
        <span className="text-[11px] text-muted">{metricLabel(score.metric)} &middot; category avg {score.categoryAvg === null ? "-" : `${score.categoryAvg}${score.metric !== "mean" ? "%" : ""}`}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {score.byBrand.map((b) => {
          // Compared unrounded (CT5K-F01), so a brand on the 5-point band edge is not placed by display rounding.
          const verdict = bandVerdict(b.exact !== undefined ? b.exact : b.value, categoryAverageExact(score.byBrand));
          const colors = bandColors(verdict);
          const ours = b.brand === ourBrand;
          return (
            <div
              key={b.brand}
              className="flex flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5"
              style={{ background: colors.bg, color: colors.fg, outline: ours ? "2px solid #2563eb" : undefined }}
            >
              <span className="text-[10px] font-medium">{b.brand}{ours ? " (ours)" : ""}</span>
              <span className="text-sm font-bold">{b.value === null ? "-" : b.value}{score.metric !== "mean" ? "%" : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The overlap note on a card whose figures split respondents by overlapping brand groups (a brand set). */
function OverlapNote({ dashboard, section }: { dashboard: BrandHealthDashboard; section: BrandHealthFindingSection }) {
  if (!dashboard.groupsOverlap || !dashboard.overlapNote || !sectionSplitsByBrandGroups(dashboard, section)) return null;
  return (
    <p className="mb-2 text-[10.5px] text-amber-800" data-testid="brand-health-card-overlap">
      {dashboard.overlapNote}
    </p>
  );
}

function BrandHealthDashboardView({ runId, documentId, dashboard }: { runId: string; documentId: string; dashboard: BrandHealthDashboard }) {
  return (
    <div className="space-y-4">
      {dashboard.groupsOverlap && dashboard.overlapNote && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="brand-health-dashboard-overlap">
          {dashboard.overlapNote}
        </p>
      )}
      {dashboard.withheld.length > 0 && (
        <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs text-foreground" data-testid="brand-health-withheld">
          <p className="font-medium">Not shown</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {dashboard.withheld.map((w, i) => (
              <li key={`${i}-${w.figure}`}>
                {w.figure}: {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dashboard.funnel.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Funnel &middot; {dashboard.ourBrand} vs. {dashboard.brands.length - 1} other brand{dashboard.brands.length - 1 === 1 ? "" : "s"}</p>
            <BrandHealthFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="funnel" />
          </div>
          <OverlapNote dashboard={dashboard} section="funnel" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {dashboard.funnel.map((f) => (
              <ScoreRow key={f.variable} score={f} ourBrand={dashboard.ourBrand} />
            ))}
          </div>
          {dashboard.conversions.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {dashboard.conversions.length === 1 && dashboard.conversions[0].fromKey === "consideration" && dashboard.conversions[0].toKey === "usage"
                  ? "Purchase-to-consideration ratio"
                  : "Stage-to-stage ratio"}, {dashboard.ourBrand}
              </p>
              <p className="text-[10.5px] text-muted">
                Each stage is its own measurement; this is the ratio between them, not the share of the same respondents who went from one stage to the next. Similar answered bases are not proof the two stages asked an equivalent population &mdash; this app has no case-level link between stages, so routing, screening or missing-response differences can sit behind matching numbers.
              </p>
              {dashboard.conversions.map((c) => {
                const ours = c.byBrand.find((b) => b.brand === dashboard.ourBrand);
                const label = c.fromKey === "consideration" && c.toKey === "usage" ? "Purchase-to-consideration ratio" : `${c.fromStage} → ${c.toStage}`;
                return (
                  <div key={`${c.fromStage}-${c.toStage}`} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">{label}</span>
                      <span className="font-semibold text-foreground">
                        {ours && !ours.basesSimilarSize
                          ? "Not shown"
                          : ours?.pct === null || ours?.pct === undefined
                            ? "-"
                            : `${ours.pct}%`}
                      </span>
                    </div>
                    {ours && !ours.basesSimilarSize && (
                      <p className="text-[10px] text-red-700">
                        Suppressed: answered bases differ too much ({c.fromStage} n={ours.fromN}, {c.toStage} n={ours.toN}) to treat as the same population, so the ratio isn&apos;t shown.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {dashboard.attributes.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Attribute fingerprint</p>
            <BrandHealthFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="attributes" />
          </div>
          <OverlapNote dashboard={dashboard} section="attributes" />
          <div className="space-y-2">
            {dashboard.attributes.map((a) => (
              <ScoreRow key={a.variable} score={a} ourBrand={dashboard.ourBrand} />
            ))}
          </div>
        </div>
      )}

      {dashboard.loyalty && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Loyalty &middot; Net Promoter Score</p>
            <BrandHealthFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="loyalty" />
          </div>
          <OverlapNote dashboard={dashboard} section="loyalty" />
          <div className="flex flex-wrap gap-2">
            {dashboard.loyalty.byBrand.map((b) => (
              <div
                key={b.brand}
                className="flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2"
                style={{ borderColor: b.brand === dashboard.ourBrand ? "#2563eb" : "#e2e8f0" }}
              >
                <span className="text-[10px] font-medium text-muted">{b.brand}{b.brand === dashboard.ourBrand ? " (ours)" : ""}</span>
                <span className="text-lg font-bold text-foreground">{Math.round(b.nps)}</span>
                <span className="text-[10px] text-muted">{Math.round(b.promoters)}% / {Math.round(b.detractors)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dashboard.moments.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Category entry points</p>
            <BrandHealthFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="moments" />
          </div>
          <OverlapNote dashboard={dashboard} section="moments" />
          <div className="space-y-2">
            {dashboard.moments.map((m) => (
              <ScoreRow key={m.variable} score={m} ourBrand={dashboard.ourBrand} />
            ))}
          </div>
        </div>
      )}

      {dashboard.positioning && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              Positioning map &middot; {dashboard.positioning.xLabel} vs. {dashboard.positioning.yLabel}
            </p>
            <BrandHealthFindingButton runId={runId} documentId={documentId} dashboard={dashboard} section="positioning" />
          </div>
          <OverlapNote dashboard={dashboard} section="positioning" />
          <PositioningScatter positioning={dashboard.positioning} ourBrand={dashboard.ourBrand} />
        </div>
      )}
    </div>
  );
}

function PositioningScatter({
  positioning,
  ourBrand,
}: {
  positioning: { xLabel: string; yLabel: string; points: { brand: string; x: number | null; y: number | null }[] };
  ourBrand: string;
}) {
  const pts = positioning.points.filter((p) => p.x !== null && p.y !== null) as { brand: string; x: number; y: number }[];
  if (pts.length === 0) return <p className="text-xs text-muted">No brand has both axes to plot yet.</p>;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMin = Math.min(...xs) - 5;
  const xMax = Math.max(...xs) + 5;
  const yMin = Math.min(...ys) - 5;
  const yMax = Math.max(...ys) + 5;
  const W = 480;
  const H = 320;
  const pad = 36;
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - yMin) / (yMax - yMin || 1)) * (H - pad * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 520, height: "auto" }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e2e8f0" strokeWidth={1} />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#e2e8f0" strokeWidth={1} />
      <text x={W / 2} y={H - 8} fontSize={11} fill="#64748b" textAnchor="middle">
        {positioning.xLabel}
      </text>
      <text x={12} y={H / 2} fontSize={11} fill="#64748b" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
        {positioning.yLabel}
      </text>
      {pts.map((p) => {
        const ours = p.brand === ourBrand;
        return (
          <g key={p.brand}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={ours ? 7 : 5} fill={ours ? "#2563eb" : "#94a3b8"} />
            <text x={sx(p.x) + 9} y={sy(p.y) + 4} fontSize={11} fontWeight={ours ? 700 : 500} fill="#0f172a">
              {p.brand}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// The brand tracking dashboard as a self-contained story (Grant, 30 October 2026: "the entire module can be put
// straight into slides ... all self-contained from input to report. Then it can also go the usual route to
// findings, insights etc."). This is the one registry of the dashboard's pages and cards for the three things that
// leave the screen: a card posted as a finding, a page's figures given to the model for AI insights, and a page's
// slide in the exported deck.
//
// A page registers itself with ONE call, registerDashboardPage({ id, title, load, cards }):
//   - `load(tenantId, runId, documentId)` is the page's own loader (the same one the screen calls, through
//     trackerDashboardActions.ts), so the figures here are always the screen's figures, recomputed on the server;
//     nothing the browser sends is taken as a figure;
//   - each card's `figures(data, ctx)` reads that page's result into structured figures (value unrounded, unit,
//     unweighted base, identity by brand code or variable, never by label or position), and `sentence(card, ctx)`
//     writes the one plain sentence a posted finding carries, from those figures only.
// The screen only names a card by its page and card ids; a new view plugs in by registering its page here and
// placing <DashboardFindingButton page=... card=...> on its cards (claude/batchR5story-handover-2026-10-30.md).
//
// Rules every card follows (Grant's dashboard rules, claude/d2-design-2026-10-29.md):
//   - unknown is never 0: a figure the page could not compute is kept with value null and its reason, and a card
//     whose part is "Not measured" or "Mapping needed" has that status and no sentence;
//   - bases are the unweighted counts the page reports; a weighted figure says what it is weighted by;
//   - small bases follow the audience page's owner (trackerAudience.smallBaseLevel: below 50 small, below 30
//     descriptive only) and are named in the sentence and carried as caveats (stats.checkBaseSize tags);
//   - no page computes a significance test, so no card carries a significance flag and no sentence claims one; a
//     change against the previous wave is in points, untested, and says so;
//   - "rank" is the focal brand's place among the listed brands with a figure for that measure, highest first, ties
//     sharing the better place; it is a description of this sample, not a test.
import { checkBaseSize } from "./stats";
import { smallBaseLevel } from "./trackerAudience";
import { loadBrandOverview, type BrandOverview } from "./trackerOverview";
import { loadBrandMoments, type BrandMoments } from "./trackerMoments";
import { loadBrandAssociations, type BrandAssociations } from "./trackerAssociations";
import { loadBrandAdvertising, type BrandAdvertising } from "./trackerAdvertising";
import { loadBrandAudience, type BrandAudience, type ProfileRow } from "./trackerAudience";
import { loadCategoryOverview, type CategoryOverview, type Distribution } from "./trackerCategory";
import type { ResolvedDashboard } from "./trackerDashboard";

export type FigureUnit = "percent" | "points" | "brands";

/** One computed figure of a card. `key` is its identity (stage or variable and brand code); `label` is wording. */
export type DashboardFigure = {
  key: string;
  label: string;
  /** Unrounded; null when the page could not compute it (see `reason`). */
  value: number | null;
  unit: FigureUnit;
  /** Unweighted count of the figure's base; null when not known. */
  base: number | null;
  /** Who the base is, in words ("all eligible respondents", "aware of BMW"). */
  baseLabel: string;
  brandCode?: string;
  focal?: boolean;
  smallBase?: "small" | "very_small";
  /** A significance test of this figure's comparison, when the page ran one. No current page runs one. */
  significant?: boolean;
  reason?: string;
};

export type CardStatus = "ok" | "not_measured" | "mapping_needed" | "needs_brand";

export type CardFigures = {
  page: string;
  card: string;
  title: string;
  status: CardStatus;
  reason?: string;
  figures: DashboardFigure[];
  /** The method in words: the measure, its base and weighting. */
  method: string;
  /** Caveat tags (caveatLabels.ts) a posted finding carries. */
  caveats: string[];
  /** Plain qualifications for a slide's footnote and the AI prompt. */
  notes: string[];
  /** Every data file the card's figures read (the wave, and earlier waves for a change or trend). */
  sourceDocumentIds: string[];
  /** Bars for the exported slide, in display order; `highlight` marks the client's brand. */
  chart?: { title: string; unit: FigureUnit; rows: { label: string; value: number | null; highlight?: boolean }[] };
};

export type PageContext = {
  documentId: string;
  wave: string | null;
  brands: { code: string; label: string }[];
  focal: { code: string; label: string } | null;
  weighted: boolean;
  weightVar: string | null;
  effectiveBase: number | null;
};

export type DashboardCardDef<D> = {
  id: string;
  title: string;
  figures: (data: D, ctx: PageContext) => CardFigures;
  /** The finding's one sentence; null when the card has nothing to post (unavailable, or no client brand). */
  sentence: (card: CardFigures, ctx: PageContext) => string | null;
};

export type DashboardPageDef<D> = {
  id: string;
  title: string;
  /** The page's own loader; also returns the context (wave, brands, client brand, weighting). */
  load: (tenantId: string, runId: string, documentId: string) => Promise<{ data: D; ctx: PageContext }>;
  cards: DashboardCardDef<D>[];
};

export type PageFigures = {
  page: string;
  title: string;
  ctx: PageContext;
  cards: CardFigures[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PAGES: DashboardPageDef<any>[] = [];

/** Registers one dashboard page and its cards: the one call a new view makes. Ids are unique. */
export function registerDashboardPage<D>(def: DashboardPageDef<D>): void {
  if (PAGES.some((p) => p.id === def.id)) throw new Error(`Dashboard page ${def.id} is registered twice.`);
  const ids = new Set<string>();
  for (const c of def.cards) {
    if (ids.has(c.id)) throw new Error(`Dashboard card ${def.id}.${c.id} is registered twice.`);
    ids.add(c.id);
  }
  PAGES.push(def);
}

/** The registered pages, in registration order (the dashboard's menu order). */
export function dashboardPages(): { id: string; title: string; cards: { id: string; title: string }[] }[] {
  return PAGES.map((p) => ({ id: p.id, title: p.title, cards: p.cards.map((c) => ({ id: c.id, title: c.title })) }));
}

/** A page and card by id, checked at the action boundary: an unknown id is refused, never guessed. */
export function dashboardCardDef(pageId: unknown, cardId?: unknown) {
  const page = typeof pageId === "string" ? PAGES.find((p) => p.id === pageId) : undefined;
  if (!page) return null;
  if (cardId === undefined) return { page, card: null };
  const card = typeof cardId === "string" ? page.cards.find((c) => c.id === cardId) : undefined;
  return card ? { page, card } : null;
}

/** Every card of one page, computed from one load of the page. */
export async function loadPageFigures(tenantId: string, runId: string, documentId: string, pageId: string): Promise<PageFigures & { sentences: Map<string, string | null> }> {
  const found = dashboardCardDef(pageId);
  if (!found) throw new Error(`There is no dashboard page "${String(pageId)}".`);
  const { data, ctx } = await found.page.load(tenantId, runId, documentId);
  const cards = found.page.cards.map((c) => c.figures(data, ctx));
  const sentences = new Map(found.page.cards.map((c, i) => [c.id, cards[i].status === "ok" ? c.sentence(cards[i], ctx) : null]));
  return { page: found.page.id, title: found.page.title, ctx, cards, sentences };
}

// ---------------------------------------------------------------------------------------------- formatting

/** A share as the dashboard shows it: one decimal. */
export const pct = (v: number) => `${v.toFixed(1)}%`;
/** A change in points, one decimal, signed; a change that rounds to zero is "0.0". */
export function pts(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(1)} pts`;
}
export const nText = (n: number) => `n=${n.toLocaleString("en-GB")}`;
export function figureText(f: Pick<DashboardFigure, "value" | "unit">): string {
  if (f.value === null) return "n/a";
  return f.unit === "percent" ? pct(f.value) : f.unit === "points" ? pts(f.value) : f.value.toFixed(1);
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
function weightingText(ctx: Pick<PageContext, "weighted" | "weightVar">): string {
  return ctx.weighted && ctx.weightVar ? `weighted by ${ctx.weightVar}` : "unweighted";
}
function basesText(bases: (number | null)[]): string {
  const known = [...new Set(bases.filter((b): b is number => b !== null))];
  if (known.length === 0) return "base not known";
  return known.length === 1 ? nText(known[0]) : `n=${Math.min(...known).toLocaleString("en-GB")} to ${Math.max(...known).toLocaleString("en-GB")}`;
}
function smallOf(n: number | null): DashboardFigure["smallBase"] {
  if (n === null) return undefined;
  const level = smallBaseLevel(n);
  return level === "ok" ? undefined : level;
}
/** Caveat tags for a card's bases (the shared base-size owner); unknown bases are their own caveat. */
function baseCaveats(figures: DashboardFigure[]): string[] {
  const tags = new Set<string>();
  for (const f of figures) {
    if (f.value === null) continue;
    if (f.base === null) tags.add("base_size_unknown");
    else {
      const tag = checkBaseSize(f.base, f.label).tag;
      if (tag) tags.add(tag);
    }
  }
  return [...tags];
}
/** Plain words naming every small base among the card's figures. */
function smallBaseNotes(figures: DashboardFigure[]): string[] {
  const small = figures.filter((f) => f.value !== null && f.smallBase);
  if (small.length === 0) return [];
  const veryList = small.filter((f) => f.smallBase === "very_small");
  const words = (list: DashboardFigure[]) => [...new Map(list.map((f) => [`${f.baseLabel}|${f.base}`, `${f.baseLabel} (${nText(f.base!)})`])).values()].join(", ");
  const out: string[] = [];
  if (veryList.length) out.push(`Very small base, descriptive only: ${words(veryList)}.`);
  const smallList = small.filter((f) => f.smallBase === "small");
  if (smallList.length) out.push(`Small base, read with caution: ${words(smallList)}.`);
  return out;
}
/** The focal brand's place among the brands with a value, highest first; ties share the better place. */
export function rankOf(figures: DashboardFigure[], focalCode: string): { rank: number; of: number } | null {
  const valued = figures.filter((f) => f.value !== null && f.brandCode !== undefined);
  const mine = valued.find((f) => f.brandCode === focalCode);
  if (!mine) return null;
  return { rank: 1 + valued.filter((f) => f.value! > mine.value!).length, of: valued.length };
}
const weightNote = (ctx: PageContext) => (ctx.weighted && ctx.weightVar ? `Weighted by ${ctx.weightVar}${ctx.effectiveBase !== null ? `, effective base ${Math.round(ctx.effectiveBase)}` : ""}.` : "Unweighted.");
const NO_TEST = "No significance test is run on this page; differences are descriptive.";

function card(page: string, id: string, title: string, ctx: PageContext, part: Partial<CardFigures> & Pick<CardFigures, "status" | "method">): CardFigures {
  const figures = part.figures ?? [];
  return {
    page,
    card: id,
    title,
    status: part.status,
    ...(part.reason ? { reason: part.reason } : {}),
    figures,
    method: part.method,
    caveats: [...new Set(["descriptive_reading", ...(ctx.weighted ? ["weighted_effective_base"] : []), ...baseCaveats(figures), ...(part.caveats ?? [])])],
    notes: [weightNote(ctx), ...smallBaseNotes(figures), ...(part.notes ?? [])],
    sourceDocumentIds: [...new Set(part.sourceDocumentIds ?? [ctx.documentId])],
    ...(part.chart ? { chart: part.chart } : {}),
  };
}
function unavailable(page: string, id: string, title: string, ctx: PageContext, state: { status: "not_measured" | "mapping_needed"; reason: string }): CardFigures {
  return { page, card: id, title, status: state.status, reason: state.reason, figures: [], method: "", caveats: [], notes: [], sourceDocumentIds: [ctx.documentId] };
}
function needsBrand(page: string, id: string, title: string, ctx: PageContext): CardFigures {
  return { page, card: id, title, status: "needs_brand", reason: "Choose your brand first (the Brand chip), so the figures can be said for it.", figures: [], method: "", caveats: [], notes: [], sourceDocumentIds: [ctx.documentId] };
}
function contextOf(documentId: string, wave: string | null, dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">, weighted: boolean, weightVar: string | null, effectiveBase: number | null): PageContext {
  return {
    documentId,
    wave,
    brands: dashboard.brands,
    focal: dashboard.focalBrand ? { code: dashboard.focalBrand.code, label: dashboard.focalBrand.label } : null,
    weighted,
    weightVar: weighted ? weightVar : null,
    effectiveBase,
  };
}
const labelOf = (ctx: PageContext, code: string) => ctx.brands.find((b) => b.code === code)?.label ?? code;
const waveWords = (ctx: PageContext) => (ctx.wave ? `${ctx.wave}, ` : "");

// The wave label comes from the page loads that do not return it (all but the overview); it is the project's
// wave list's label for this file, read once per load by the overview loader. Pages other than the overview read
// the label through the overview's wave list only when exporting; here they say the file's wave when known.
async function waveOf(tenantId: string, runId: string, documentId: string): Promise<string | null> {
  const { loadProjectWaves } = await import("./waveFiles");
  const waves = await loadProjectWaves(tenantId, runId);
  return waves.included.find((w) => w.documentId === documentId)?.wave ?? null;
}

// ---------------------------------------------------------------------------------------------- 01 Brand overview

const STAGE_WORD: Record<string, string> = {
  awareness: "awareness",
  consideration: "consideration",
  shortlist: "shortlist",
  first_choice: "first choice",
  trial: "trial",
  usage: "usage",
  frequent_usage: "frequent usage",
};
const HEADLINE = ["awareness", "consideration", "shortlist", "first_choice"];

registerDashboardPage<BrandOverview>({
  id: "overview",
  title: "Brand overview",
  load: async (tenantId, runId, documentId) => {
    const o = await loadBrandOverview(tenantId, runId, documentId, "brand");
    return { data: o, ctx: contextOf(documentId, o.wave, o.view.dashboard, o.figures.weighted, o.figures.weightVar, o.figures.effectiveBase) };
  },
  cards: [
    {
      id: "kpis",
      title: "Your brand",
      figures: (o, ctx) => {
        const title = "Your brand";
        if (!ctx.focal) return needsBrand("overview", "kpis", title, ctx);
        if (o.figures.stages.length === 0) return unavailable("overview", "kpis", title, ctx, { status: "not_measured", reason: o.figures.noFigures ?? "No funnel stage has figures in this file." });
        const focal = ctx.focal;
        const figures: DashboardFigure[] = [];
        for (const s of o.figures.stages) {
          const b = s.byBrand.find((x) => x.code === focal.code);
          figures.push({ key: `${s.stage}:${focal.code}`, label: `${focal.label} ${STAGE_WORD[s.stage] ?? s.stage}`, value: b?.share ?? null, unit: "percent", base: b?.base ?? null, baseLabel: "all eligible respondents", brandCode: focal.code, focal: true, smallBase: smallOf(b?.base ?? null), ...(b?.reason ? { reason: b.reason } : !b ? { reason: "Not asked about this brand." } : {}) });
          const c = o.changes.find((x) => x.stage === s.stage && x.code === focal.code);
          if (c && o.previous.status === "ok")
            figures.push({ key: `${s.stage}:${focal.code}:change`, label: `${focal.label} ${STAGE_WORD[s.stage] ?? s.stage} change against ${o.previous.wave}`, value: c.changePp, unit: "points", base: b?.base ?? null, baseLabel: "all eligible respondents", brandCode: focal.code, focal: true, ...(c.reason ? { reason: c.reason } : {}) });
        }
        const prev = o.previous.status === "ok" ? [o.previous.documentId] : [];
        return card("overview", "kpis", title, ctx, {
          status: "ok",
          figures,
          method: `Share selecting each stage among valid answers, ${weightingText(ctx)}.`,
          caveats: prev.length ? ["wave_change_untested"] : [],
          notes: [
            o.previous.status === "ok"
              ? `Change is against ${o.previous.wave} in percentage points, independent samples, with no significance test.`
              : o.previous.status === "failed"
                ? `The previous wave (${o.previous.wave}) could not be read, so no change is shown.`
                : o.previous.reason,
          ],
          sourceDocumentIds: [ctx.documentId, ...prev],
          chart: { title: `${focal.label}: funnel`, unit: "percent", rows: figures.filter((f) => f.unit === "percent").map((f) => ({ label: f.label.slice(focal.label.length + 1), value: f.value, highlight: true })) },
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const levels = c.figures.filter((f) => f.unit === "percent" && f.value !== null);
        if (levels.length === 0) return null;
        const parts = levels.map((f) => {
          const change = c.figures.find((x) => x.key === `${f.key}:change` && x.value !== null);
          return `${f.label.slice(ctx.focal!.label.length + 1)} ${pct(f.value!)}${change ? ` (${pts(change.value!)} against ${change.label.split(" against ")[1]})` : ""}`;
        });
        const untested = c.figures.some((f) => f.unit === "points" && f.value !== null) ? " Changes are between independent samples and not tested for significance." : "";
        return `${ctx.focal.label} (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(levels.map((f) => f.base))}): ${parts.join(", ")}.${untested}`;
      },
    },
    {
      id: "funnel",
      title: "Compare the brand funnel",
      figures: (o, ctx) => {
        const title = "Compare the brand funnel";
        if (o.figures.stages.length === 0) return unavailable("overview", "funnel", title, ctx, { status: "not_measured", reason: o.figures.noFigures ?? "No funnel stage has figures in this file." });
        const figures: DashboardFigure[] = o.figures.stages.flatMap((s) =>
          s.byBrand.map((b) => ({ key: `${s.stage}:${b.code}`, label: `${labelOf(ctx, b.code)} ${STAGE_WORD[s.stage] ?? s.stage}`, value: b.share, unit: "percent" as const, base: b.base, baseLabel: "all eligible respondents", brandCode: b.code, focal: b.code === ctx.focal?.code, smallBase: smallOf(b.base), ...(b.reason ? { reason: b.reason } : {}) })),
        );
        const first = o.figures.stages.find((s) => s.stage === "awareness") ?? o.figures.stages[0];
        return card("overview", "funnel", title, ctx, {
          status: "ok",
          figures,
          method: `Each listed brand's share at each stage among valid answers, ${weightingText(ctx)}. Ranks are places among the listed brands, not tests.`,
          notes: [NO_TEST],
          chart: {
            title: `${STAGE_WORD[first.stage] ? STAGE_WORD[first.stage][0].toUpperCase() + STAGE_WORD[first.stage].slice(1) : first.stage} by brand`,
            unit: "percent",
            rows: [...first.byBrand].sort((a, b) => (b.share ?? -1) - (a.share ?? -1)).map((b) => ({ label: labelOf(ctx, b.code), value: b.share, highlight: b.code === ctx.focal?.code })),
          },
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const focal = ctx.focal;
        const stages = [...new Set(c.figures.map((f) => f.key.split(":")[0]))];
        const parts = stages
          .map((stage) => {
            const fs = c.figures.filter((f) => f.key.startsWith(`${stage}:`));
            const r = rankOf(fs, focal.code);
            const mine = fs.find((f) => f.brandCode === focal.code);
            return r && mine?.value !== null && mine ? `${ordinal(r.rank)} of ${r.of} on ${STAGE_WORD[stage] ?? stage} (${pct(mine.value!)})` : null;
          })
          .filter(Boolean);
        if (parts.length === 0) return null;
        return `Among the listed brands (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(c.figures.map((f) => f.base))} per brand), ${focal.label} ranks ${parts.join(", ")}. Ranks describe this sample and are not tested.`;
      },
    },
    {
      id: "trend",
      title: "Across waves",
      figures: (o, ctx) => {
        const title = "Across waves";
        if (!ctx.focal) return needsBrand("overview", "trend", title, ctx);
        const focal = ctx.focal;
        if (o.timeline.length < 2) return unavailable("overview", "trend", title, ctx, { status: "not_measured", reason: "There is only one wave of this project, so there is no trend." });
        const figures: DashboardFigure[] = [];
        for (const stage of HEADLINE) {
          for (const p of o.timeline) {
            const s = p.status === "ok" ? p.stages?.find((x) => x.stage === stage) : undefined;
            if (p.status === "ok" && !s) continue;
            const b = s?.byBrand.find((x) => x.code === focal.code);
            figures.push({ key: `${stage}:${focal.code}:${p.documentId}`, label: `${focal.label} ${STAGE_WORD[stage]} in ${p.wave}`, value: b?.share ?? null, unit: "percent", base: b?.base ?? null, baseLabel: `all eligible respondents in ${p.wave}`, brandCode: focal.code, focal: true, smallBase: smallOf(b?.base ?? null), ...(p.status === "failed" ? { reason: `${p.wave} could not be read: ${p.error ?? ""}` } : b?.reason ? { reason: b.reason } : !b ? { reason: "Not asked about this brand." } : {}) });
          }
        }
        if (figures.length === 0) return unavailable("overview", "trend", title, ctx, { status: "not_measured", reason: "No headline stage has figures across waves." });
        const aware = figures.filter((f) => f.key.startsWith("awareness:"));
        return card("overview", "trend", title, ctx, {
          status: "ok",
          figures,
          method: `${focal.label}'s share at each headline stage in each wave, ${weightingText(ctx)}, each wave with its own resolved choices.`,
          caveats: ["wave_change_untested"],
          notes: ["Independent samples. Changes use unrounded values and are not tested for significance."],
          sourceDocumentIds: o.timeline.map((p) => p.documentId),
          chart: aware.length ? { title: `${focal.label} awareness by wave`, unit: "percent", rows: aware.map((f) => ({ label: f.label.split(" in ").pop()!, value: f.value, highlight: true })) } : undefined,
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const stages = HEADLINE.filter((s) => c.figures.some((f) => f.key.startsWith(`${s}:`) && f.value !== null));
        if (stages.length === 0) return null;
        const parts = stages.map((s) => `${STAGE_WORD[s]} ${c.figures.filter((f) => f.key.startsWith(`${s}:`)).map((f) => `${f.label.split(" in ").pop()} ${figureText(f)}`).join(", ")}`);
        return `${ctx.focal.label} across waves (${weightingText(ctx)}, ${basesText(c.figures.map((f) => f.base))} per wave): ${parts.join("; ")}. Independent samples; changes are not tested for significance.`;
      },
    },
  ],
});

// ---------------------------------------------------------------------------------------------- 02 Moments & needs

registerDashboardPage<BrandMoments & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }>({
  id: "moments",
  title: "Moments & needs",
  load: async (tenantId, runId, documentId) => {
    const [m, wave] = await Promise.all([loadBrandMoments(tenantId, runId, documentId), waveOf(tenantId, runId, documentId)]);
    return { data: m, ctx: contextOf(documentId, wave, m.dashboard, m.weighted, m.weightVar, m.effectiveBase) };
  },
  cards: [
    {
      id: "relevance",
      title: "Category moments",
      figures: (m, ctx) => {
        const title = "Category moments";
        if (m.relevance.status !== "ok") return unavailable("moments", "relevance", title, ctx, m.relevance);
        const figures = m.relevance.moments.map((x): DashboardFigure => ({ key: x.variable, label: x.item, value: x.share, unit: "percent", base: x.base, baseLabel: "all eligible respondents", smallBase: smallOf(x.base), ...(x.reason ? { reason: x.reason } : {}) }));
        return card("moments", "relevance", title, ctx, {
          status: "ok",
          figures,
          method: `Share selecting each moment as personally relevant among valid answers (multiple response), ${weightingText(ctx)}.`,
          notes: [NO_TEST],
          chart: { title: "Category moments: personal relevance", unit: "percent", rows: figures.slice(0, 8).map((f) => ({ label: f.label, value: f.value })) },
        });
      },
      sentence: (c, ctx) => {
        const top = c.figures.filter((f) => f.value !== null).slice(0, 3);
        if (top.length === 0) return null;
        return `The most personally relevant category moments (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(top.map((f) => f.base))}) are ${top.map((f) => `${f.label} ${pct(f.value!)}`).join(", ")}.`;
      },
    },
    {
      id: "recall",
      title: "Moment x brand recall",
      figures: (m, ctx) => {
        const title = "Moment x brand recall";
        if (m.recall.status !== "ok") return unavailable("moments", "recall", title, ctx, m.recall);
        const figures = m.recall.rows.flatMap((r) => r.cells.map((cell): DashboardFigure => ({ key: `${r.variable}:${cell.code}`, label: `${labelOf(ctx, cell.code)} recalled for ${r.item}`, value: cell.share, unit: "percent", base: cell.base, baseLabel: "all eligible respondents", brandCode: cell.code, focal: cell.code === ctx.focal?.code, smallBase: smallOf(cell.base), ...(cell.reason ? { reason: cell.reason } : {}) })));
        const focal = ctx.focal;
        return card("moments", "recall", title, ctx, {
          status: "ok",
          figures,
          method: `Cue-specific recall: share recalling each brand for each moment among valid answers, ${weightingText(ctx)}. Moments are the most relevant ones with a recall question.`,
          notes: [NO_TEST, ...(m.recall.withoutRecall.length ? [`Not shown, as no brand recall was asked for them: ${m.recall.withoutRecall.join(", ")}.`] : [])],
          chart: focal ? { title: `${focal.label}: recall by moment`, unit: "percent", rows: m.recall.rows.map((r) => ({ label: r.item, value: r.cells.find((x) => x.code === focal.code)?.share ?? null, highlight: true })) } : undefined,
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const focal = ctx.focal;
        const moments = [...new Set(c.figures.map((f) => f.key.split(":")[0]))];
        const parts = moments
          .map((mv) => {
            const fs = c.figures.filter((f) => f.key.split(":")[0] === mv);
            const mine = fs.find((f) => f.brandCode === focal.code);
            const r = rankOf(fs, focal.code);
            return mine && mine.value !== null && r ? `${mine.label.slice(`${focal.label} recalled for `.length)} ${pct(mine.value)} (${ordinal(r.rank)} of ${r.of})` : null;
          })
          .filter(Boolean)
          .slice(0, 4);
        if (parts.length === 0) return null;
        return `${focal.label}'s cue-specific recall for the most relevant moments (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(c.figures.map((f) => f.base))}): ${parts.join(", ")}, ranked among the listed brands without a test.`;
      },
    },
  ],
});

// ---------------------------------------------------------------------------------------------- 03 Brand associations

registerDashboardPage<BrandAssociations & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }>({
  id: "associations",
  title: "Brand associations",
  load: async (tenantId, runId, documentId) => {
    const [a, wave] = await Promise.all([loadBrandAssociations(tenantId, runId, documentId), waveOf(tenantId, runId, documentId)]);
    return { data: a, ctx: contextOf(documentId, wave, a.dashboard, a.weighted, a.weightVar, null) };
  },
  cards: [
    {
      id: "profile",
      title: "Brand associations",
      figures: (a, ctx) => {
        const title = "Brand associations";
        if (a.profile.status !== "ok") return unavailable("associations", "profile", title, ctx, a.profile);
        const bases = new Map(a.profile.bases.map((b) => [b.code, b]));
        const figures = a.profile.attributes.flatMap((at) =>
          at.cells.map((cell): DashboardFigure => {
            const aware = bases.get(cell.code)?.n ?? null;
            return { key: `${at.group}:${cell.code}`, label: `${labelOf(ctx, cell.code)} ${at.item}`, value: cell.share, unit: "percent", base: cell.base, baseLabel: `aware of ${labelOf(ctx, cell.code)}`, brandCode: cell.code, focal: cell.code === ctx.focal?.code, smallBase: smallOf(cell.base ?? aware), ...(cell.reason ? { reason: cell.reason } : {}) };
          }),
        );
        const focal = ctx.focal;
        const profile = a.profile;
        return card("associations", "profile", title, ctx, {
          status: "ok",
          figures,
          method: `Share associating each attribute with a brand among respondents aware of that brand (each brand its own base; don't know kept in the base), ${weightingText(ctx)}.`,
          notes: ["Each brand is read among those aware of it, so bases differ by brand.", NO_TEST],
          chart: focal ? { title: `${focal.label}: associations among the aware`, unit: "percent", rows: profile.attributes.map((at) => ({ label: at.item, value: at.cells.find((x) => x.code === focal.code)?.share ?? null, highlight: true })).sort((x, y) => (y.value ?? -1) - (x.value ?? -1)) } : undefined,
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const focal = ctx.focal;
        const groups = [...new Set(c.figures.map((f) => f.key.split(":")[0]))];
        const mine = groups
          .map((g) => {
            const fs = c.figures.filter((f) => f.key.split(":")[0] === g);
            const f = fs.find((x) => x.brandCode === focal.code);
            const r = rankOf(fs, focal.code);
            return f && f.value !== null && r ? { f, r } : null;
          })
          .filter((x): x is { f: DashboardFigure; r: { rank: number; of: number } } => x !== null)
          .sort((x, y) => y.f.value! - x.f.value!)
          .slice(0, 3);
        if (mine.length === 0) return null;
        return `Among respondents aware of ${focal.label} (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(mine.map((x) => x.f.base))}), ${focal.label} is most associated with ${mine.map((x) => `${x.f.label.slice(focal.label.length + 1)} ${pct(x.f.value!)} (${ordinal(x.r.rank)} of ${x.r.of} brands)`).join(", ")}.`;
      },
    },
  ],
});

// ---------------------------------------------------------------------------------------------- 04 Advertising & WOM

registerDashboardPage<BrandAdvertising & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }>({
  id: "advertising",
  title: "Advertising & WOM",
  load: async (tenantId, runId, documentId) => {
    const [a, wave] = await Promise.all([loadBrandAdvertising(tenantId, runId, documentId), waveOf(tenantId, runId, documentId)]);
    return { data: a, ctx: contextOf(documentId, wave, a.dashboard, a.weighted, a.weightVar, a.effectiveBase) };
  },
  cards: [
    {
      id: "recall",
      title: "Advertising recall",
      figures: (a, ctx) => {
        const title = "Advertising recall";
        if (a.recall.status !== "ok") return unavailable("advertising", "recall", title, ctx, a.recall);
        const figures = a.recall.brands.map((b): DashboardFigure => ({ key: `${b.variable ?? "none"}:${b.code}`, label: `${labelOf(ctx, b.code)} advertising recall`, value: b.yes, unit: "percent", base: b.base, baseLabel: "asked about the brand", brandCode: b.code, focal: b.code === ctx.focal?.code, smallBase: smallOf(b.base), ...(b.reason ? { reason: b.reason } : {}) }));
        return card("advertising", "recall", title, ctx, {
          status: "ok",
          figures,
          method: `Share answering yes to prompted advertising recall among valid answers (not sure kept in the base), ${weightingText(ctx)}.`,
          notes: [NO_TEST],
          chart: { title: "Prompted advertising recall", unit: "percent", rows: figures.map((f) => ({ label: labelOf(ctx, f.brandCode!), value: f.value, highlight: f.focal })) },
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const mine = c.figures.find((f) => f.brandCode === ctx.focal!.code);
        const r = rankOf(c.figures, ctx.focal.code);
        if (!mine || mine.value === null || !r) return null;
        return `${ctx.focal.label}'s prompted advertising recall is ${pct(mine.value)} (${waveWords(ctx)}${weightingText(ctx)}, ${mine.base !== null ? nText(mine.base) : "base not known"}), ${ordinal(r.rank)} of ${r.of} listed brands; ranks are not tested.`;
      },
    },
    {
      id: "wom",
      title: "Word of mouth",
      figures: (a, ctx) => {
        const title = "Word of mouth";
        if (a.wom.status !== "ok") return unavailable("advertising", "wom", title, ctx, a.wom);
        const figures = a.wom.brands.flatMap((b) =>
          b.groups === null
            ? [{ key: `${b.code}:all`, label: `${labelOf(ctx, b.code)} word of mouth`, value: null, unit: "percent" as const, base: b.base, baseLabel: "all eligible respondents", brandCode: b.code, focal: b.code === ctx.focal?.code, reason: b.reason ?? "Not available." }]
            : b.groups.map((g): DashboardFigure => ({ key: `${b.code}:${g.key}`, label: `${labelOf(ctx, b.code)} ${g.label}`, value: g.share, unit: "percent", base: b.base, baseLabel: "all eligible respondents", brandCode: b.code, focal: b.code === ctx.focal?.code, smallBase: smallOf(b.base) })),
        );
        const focal = ctx.focal;
        const mine = focal ? a.wom.brands.find((b) => b.code === focal.code) : undefined;
        return card("advertising", "wom", title, ctx, {
          status: "ok",
          figures,
          method: `Word of mouth heard about each brand as exclusive groups adding to 100% of all eligible respondents (Unaware from the awareness question), ${weightingText(ctx)}.`,
          notes: [NO_TEST],
          chart: focal && mine?.groups ? { title: `${focal.label}: word of mouth`, unit: "percent", rows: mine.groups.map((g) => ({ label: g.label, value: g.share, highlight: true })) } : undefined,
        });
      },
      sentence: (c, ctx) => {
        if (!ctx.focal) return null;
        const focal = ctx.focal;
        const mine = c.figures.filter((f) => f.brandCode === focal.code && f.value !== null);
        if (mine.length === 0) return null;
        return `Word of mouth about ${focal.label} (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(mine.map((f) => f.base))}, all eligible respondents): ${mine.map((f) => `${f.label.slice(focal.label.length + 1)} ${pct(f.value!)}`).join(", ")}.`;
      },
    },
  ],
});

// ---------------------------------------------------------------------------------------------- 05 Audience & media

function profileCard(id: "age" | "media", title: string, a: BrandAudience, ctx: PageContext): CardFigures {
  const part = a[id];
  if (part.status !== "ok") return unavailable("audience", id, title, ctx, part);
  if (a.acquirers.status !== "ok") return unavailable("audience", id, title, ctx, a.acquirers);
  const who = `recent ${a.acquirers.brand.label} acquirers`;
  const level = a.acquirers.level;
  const rows: ProfileRow[] = part.rows;
  const figures = rows.flatMap((r): DashboardFigure[] => [
    { key: `${r.key}:acquirers`, label: `${r.label} among ${who}`, value: r.acquirers.share, unit: "percent", base: r.acquirers.base, baseLabel: who, smallBase: smallOf(r.acquirers.base), ...(r.acquirers.reason ? { reason: r.acquirers.reason } : {}) },
    { key: `${r.key}:category`, label: `${r.label} among all eligible respondents`, value: r.category.share, unit: "percent", base: r.category.base, baseLabel: "all eligible respondents", smallBase: smallOf(r.category.base), ...(r.category.reason ? { reason: r.category.reason } : {}) },
  ]);
  return card("audience", id, title, ctx, {
    status: "ok",
    figures,
    method: `${id === "age" ? "Age group" : "Media used"} share among ${who} and among all eligible respondents, each among valid answers, ${weightingText(ctx)}. No difference or significance is computed.`,
    caveats: level === "very_small" ? ["insufficient_n_for_test"] : [],
    notes: [a.acquirers.n === null ? "The number of recent acquirers is not known." : `Recent acquirers: ${nText(a.acquirers.n)}.`, "No difference or significance is computed between the two groups."],
    chart: { title: `${title}: ${who}`, unit: "percent", rows: rows.map((r) => ({ label: r.label, value: r.acquirers.share, highlight: true })) },
  });
}
function profileSentence(c: CardFigures, ctx: PageContext): string | null {
  const acq = c.figures.filter((f) => f.key.endsWith(":acquirers") && f.value !== null).sort((x, y) => y.value! - x.value!).slice(0, 3);
  if (acq.length === 0) return null;
  const who = acq[0].baseLabel;
  const n = acq[0].base;
  const small = acq[0].smallBase === "very_small" ? ", very small base, descriptive only" : acq[0].smallBase === "small" ? ", small base" : "";
  const parts = acq.map((f) => {
    const cat = c.figures.find((x) => x.key === f.key.replace(/:acquirers$/, ":category"));
    return `${f.label.split(" among ")[0]} ${pct(f.value!)}${cat && cat.value !== null ? ` (all eligible respondents ${pct(cat.value)})` : ""}`;
  });
  return `Among ${who} (${waveWords(ctx)}${weightingText(ctx)}, ${n !== null ? nText(n) : "base not known"}${small}): ${parts.join(", ")}. No difference is tested.`;
}

registerDashboardPage<BrandAudience & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }>({
  id: "audience",
  title: "Audience & media",
  load: async (tenantId, runId, documentId) => {
    const [a, wave] = await Promise.all([loadBrandAudience(tenantId, runId, documentId), waveOf(tenantId, runId, documentId)]);
    return { data: a, ctx: contextOf(documentId, wave, a.dashboard, a.weighted, a.weightVar, a.effectiveBase) };
  },
  cards: [
    { id: "age", title: "Age profile", figures: (a, ctx) => profileCard("age", "Age profile", a, ctx), sentence: profileSentence },
    { id: "media", title: "Media used", figures: (a, ctx) => profileCard("media", "Media used", a, ctx), sentence: profileSentence },
  ],
});

// ---------------------------------------------------------------------------------------------- Category overview

function distributionCard(id: "decision" | "channel", title: string, d: Distribution, ctx: PageContext): CardFigures {
  if (d.status !== "ok") return unavailable("category", id, title, ctx, d);
  const figures = d.answers.map((x): DashboardFigure => ({ key: `${d.variable}:${x.code}`, label: x.label, value: x.share, unit: "percent", base: d.base, baseLabel: "all eligible respondents", smallBase: smallOf(d.base), ...(x.share === null ? { reason: "Suppressed or not available." } : {}) }));
  return card("category", id, title, ctx, {
    status: "ok",
    figures,
    method: `Each answer's share of valid answers to "${d.label}", ${weightingText(ctx)}.`,
    notes: [NO_TEST],
    chart: { title, unit: "percent", rows: [...figures].sort((x, y) => (y.value ?? -1) - (x.value ?? -1)).map((f) => ({ label: f.label, value: f.value })) },
  });
}
function distributionSentence(c: CardFigures, ctx: PageContext): string | null {
  const top = c.figures.filter((f) => f.value !== null).sort((x, y) => y.value! - x.value!).slice(0, 3);
  if (top.length === 0) return null;
  return `${c.title} (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(top.map((f) => f.base))}): ${top.map((f) => `${f.label} ${pct(f.value!)}`).join(", ")}.`;
}

registerDashboardPage<CategoryOverview & { dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand"> }>({
  id: "category",
  title: "Category overview",
  load: async (tenantId, runId, documentId) => {
    const [c, wave] = await Promise.all([loadCategoryOverview(tenantId, runId, documentId), waveOf(tenantId, runId, documentId)]);
    return { data: c, ctx: contextOf(documentId, wave, c.dashboard, c.weighted, c.weightVar, c.effectiveBase) };
  },
  cards: [
    {
      id: "repertoire",
      title: "Brand repertoire",
      figures: (c, ctx) => {
        const title = "Brand repertoire";
        const ok = c.repertoire.filter((r): r is Extract<typeof r, { status: "ok" }> => r.status === "ok");
        if (ok.length === 0) {
          const first = c.repertoire[0];
          return unavailable("category", "repertoire", title, ctx, first && first.status !== "ok" ? first : { status: "not_measured", reason: "No repertoire stage in this file." });
        }
        const figures = ok.map((r): DashboardFigure => ({ key: `${r.stage}`, label: `Brands at ${STAGE_WORD[r.stage] ?? r.stage}`, value: r.mean, unit: "brands", base: r.base, baseLabel: "all eligible respondents", smallBase: smallOf(r.base), ...(r.reason ? { reason: r.reason } : {}) }));
        return card("category", "repertoire", title, ctx, {
          status: "ok",
          figures,
          method: `Mean number of the listed brands selected per respondent at each stage (Other excluded), ${weightingText(ctx)}.`,
          notes: [`Out of ${ok[0].brands} listed brands.`],
          chart: { title: "Average number of brands", unit: "brands", rows: figures.map((f) => ({ label: f.label.replace(/^Brands at /, ""), value: f.value })) },
        });
      },
      sentence: (c, ctx) => {
        const known = c.figures.filter((f) => f.value !== null);
        if (known.length === 0) return null;
        return `On average respondents name ${known.map((f) => `${f.value!.toFixed(1)} brands at ${f.label.replace(/^Brands at /, "")}`).join(", ")} (${waveWords(ctx)}${weightingText(ctx)}, ${basesText(known.map((f) => f.base))}).`;
      },
    },
    { id: "decision", title: "Decision style", figures: (c, ctx) => distributionCard("decision", "Decision style", c.decisionStyle, ctx), sentence: distributionSentence },
    { id: "channel", title: "Acquisition channel", figures: (c, ctx) => distributionCard("channel", "Acquisition channel", c.acquisitionChannel, ctx), sentence: distributionSentence },
  ],
});

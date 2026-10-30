// Wave-on-wave change for pages 02 to 06 of the brand tracking dashboard (R5 waves, Grant 30 October 2026), and the
// trend views across waves (the client's brand's associations; category relevance of each moment, for the Moment
// profile). Each page is computed for this wave and for the compared wave by its own loader, each with its own wave's
// context (trackerWaveChange.pagesToCompare); the pure functions here match the two by identity and work out the
// changes; trackerWaveChange.testedComparison tests them in the engine. The contract is in claude/wave-change.md.
//
// Identity, never label or position: a brand by its code naming the same brand in both waves (codeNamesDiffer), a
// question by its variable with the same wording and answer codes (questionDiffers), an answer by its code naming the
// same answer (answerDiffers). A figure whose base is defined by another question (an association's aware base, word
// of mouth's Unaware group, the recent acquirers) also needs that question to be the same.
import { answerDiffers, codeNamesDiffer, questionDiffers, type AnswerShare } from "./trackerFigures";
import { loadBrandMoments, type BrandMoments } from "./trackerMoments";
import { loadBrandAssociations, type BrandAssociations } from "./trackerAssociations";
import { loadBrandAdvertising, womParts, type BrandAdvertising } from "./trackerAdvertising";
import { acquirerParts, loadBrandAudience, type BrandAudience, type ProfileRow } from "./trackerAudience";
import { loadCategoryOverview, repertoireParts, type CategoryOverview } from "./trackerCategory";
import { loadWaveContext, type WaveContext } from "./trackerWaveContext";
import { pagesToCompare, shareChange, testedComparison, type CompareChoice, type ShareChange, type ShareSide, type TestJob, type WaveComparison } from "./trackerWaveChange";
import type { ProjectWaves } from "./waves";

type Changes<C> = { changes: C; jobs: TestJob[] };

/** The identity checks of one pair of waves. */
function identity(cur: WaveContext, prev: WaveContext) {
  const curVars = new Map(cur.input.variables.map((v) => [v.name, v]));
  const prevVars = new Map(prev.input.variables.map((v) => [v.name, v]));
  return {
    brand: (code: string) => codeNamesDiffer(code, cur.view.dashboard.brands, prev.view.dashboard.brands, "Brand", "brand list"),
    question: (variable: string) => questionDiffers(variable, curVars.get(variable), prevVars.get(variable)),
    answer: (variable: string, code: string) => answerDiffers(code, curVars.get(variable), prevVars.get(variable)),
  };
}
const first = (...reasons: (string | null | undefined)[]) => reasons.find((r) => !!r) ?? null;

/** A change keyed by a figure's identity, with its test job collected. */
function collect() {
  const jobs: TestJob[] = [];
  return {
    jobs,
    add(current: ShareSide, previous: ShareSide | undefined, withheld: string | null, untestable?: string): ShareChange {
      const { change, job } = shareChange(current, previous, withheld, untestable);
      if (job) jobs.push(job);
      return change;
    },
  };
}

// ---- Page 02, Moments & needs ----

export type MomentChanges = {
  /** Category relevance by the relevance question's variable. */
  relevance: Record<string, ShareChange>;
  /** Moment by brand recall by `${cell variable}|${brand code}`. */
  recall: Record<string, ShareChange>;
};

export function momentChanges(cur: BrandMoments, prev: BrandMoments, curCtx: WaveContext, prevCtx: WaveContext): Changes<MomentChanges> {
  const id = identity(curCtx, prevCtx);
  const c = collect();
  const relevance: MomentChanges["relevance"] = {};
  const recall: MomentChanges["recall"] = {};
  if (cur.relevance.status === "ok") {
    const before = prev.relevance.status === "ok" ? new Map(prev.relevance.moments.map((m) => [m.variable, m])) : null;
    for (const m of cur.relevance.moments) relevance[m.variable] = c.add(m, before?.get(m.variable), before ? id.question(m.variable) : `The compared wave has no category relevance figures: ${(prev.relevance as { reason: string }).reason}`);
  }
  if (cur.recall.status === "ok") {
    const before = new Map(prev.recall.status === "ok" ? prev.recall.rows.flatMap((r) => r.cells.filter((x) => x.variable).map((x) => [String(`${x.variable}|${x.code}`), x] as const)) : []);
    for (const row of cur.recall.rows)
      for (const cell of row.cells) {
        if (!cell.variable) continue;
        const key = `${cell.variable}|${cell.code}`;
        recall[key] = c.add(cell, before.get(key), first(id.brand(cell.code), id.question(cell.variable), prev.recall.status !== "ok" ? `The compared wave has no recall figures: ${prev.recall.reason}` : null));
      }
  }
  return { changes: { relevance, recall }, jobs: c.jobs };
}

/** One wave's category relevance of each moment, by variable (the Moment profile across waves reads these). */
export type RelevancePoint = { documentId: string; wave: string; waveDate: string | null; status: "ok" | "failed"; error?: string; shares: Record<string, { share: number | null; base: number | null; reason?: string }> };

// ---- Page 03, Brand associations ----

/** Association cells by `${attribute variable}|${brand code}`. */
export type AssociationChanges = Record<string, ShareChange>;

export function associationChanges(cur: BrandAssociations, prev: BrandAssociations, curCtx: WaveContext, prevCtx: WaveContext): Changes<AssociationChanges> {
  const id = identity(curCtx, prevCtx);
  const c = collect();
  const out: AssociationChanges = {};
  if (cur.profile.status !== "ok") return { changes: out, jobs: [] };
  const prevProfile = prev.profile;
  const before = new Map(prevProfile.status === "ok" ? prevProfile.attributes.flatMap((a) => a.cells.filter((x) => x.variable).map((x) => [String(`${x.variable}|${x.code}`), x] as const)) : []);
  const awareVar = new Map(cur.profile.bases.map((b) => [b.code, b.variable]));
  const prevAware = new Map(prevProfile.status === "ok" ? prevProfile.bases.map((b) => [b.code, b.variable]) : []);
  for (const a of cur.profile.attributes)
    for (const cell of a.cells) {
      if (!cell.variable) continue;
      const key = `${cell.variable}|${cell.code}`;
      const aware = awareVar.get(cell.code);
      out[key] = c.add(
        cell,
        before.get(key),
        first(
          prevProfile.status !== "ok" ? `The compared wave has no association figures: ${prevProfile.reason}` : null,
          id.brand(cell.code),
          id.question(cell.variable),
          // Each cell's base is those aware of the brand: the awareness question must be the same one too.
          aware && prevAware.get(cell.code) !== aware ? "The brand's awareness question (its aware base) is not the same in the compared wave." : null,
          aware ? id.question(aware) : null,
        ),
      );
    }
  return { changes: out, jobs: c.jobs };
}

/** The client's brand's association share of each attribute in one wave, by attribute variable (this wave's). */
export type AssociationPoint = { documentId: string; wave: string; waveDate: string | null; status: "ok" | "failed"; error?: string; cells: Record<string, { share: number | null; base: number | null; reason?: string }> };
export type AssociationTrend = { brand: { code: string; label: string }; attributes: { variable: string; item: string }[]; waves: AssociationPoint[] } | null;

/** The client's brand's cells in another wave, matched to this wave's attributes by identity. Pure. */
export function associationPoint(cur: BrandAssociations, other: BrandAssociations, curCtx: WaveContext, otherCtx: WaveContext, code: string): AssociationPoint["cells"] {
  const out: AssociationPoint["cells"] = {};
  if (cur.profile.status !== "ok") return out;
  const sameCtx = curCtx === otherCtx;
  const id = identity(curCtx, otherCtx);
  const cells = new Map(other.profile.status === "ok" ? other.profile.attributes.flatMap((a) => a.cells.filter((x) => x.code === code && x.variable).map((x) => [x.variable, x] as const)) : []);
  const aware = cur.profile.bases.find((b) => b.code === code)?.variable ?? null;
  for (const a of cur.profile.attributes) {
    const cell = a.cells.find((x) => x.code === code);
    if (!cell?.variable) continue;
    const withheld = sameCtx ? null : first(other.profile.status !== "ok" ? other.profile.reason : null, id.brand(code), id.question(cell.variable), aware ? id.question(aware) : null);
    const o = cells.get(cell.variable);
    out[cell.variable] = withheld ? { share: null, base: null, reason: withheld } : o ? { share: o.share, base: o.base, ...(o.reason ? { reason: o.reason } : {}) } : { share: null, base: null, reason: "Not asked in this wave." };
  }
  return out;
}

// ---- Page 04, Advertising & WOM ----

export type AdvertisingChanges = {
  /** Prompted recall (yes) by brand code. */
  recall: Record<string, ShareChange>;
  /** Word of mouth groups by `${brand code}|${group key}` (an answer code, or "unaware"). */
  wom: Record<string, ShareChange>;
};

export function advertisingChanges(cur: BrandAdvertising, prev: BrandAdvertising, curCtx: WaveContext, prevCtx: WaveContext): Changes<AdvertisingChanges> {
  const id = identity(curCtx, prevCtx);
  const c = collect();
  const recall: AdvertisingChanges["recall"] = {};
  const wom: AdvertisingChanges["wom"] = {};
  if (cur.recall.status === "ok") {
    const before = new Map(prev.recall.status === "ok" ? prev.recall.brands.map((b) => [b.code, b]) : []);
    for (const b of cur.recall.brands) {
      if (!b.variable) continue;
      const p = before.get(b.code);
      recall[b.code] = c.add(
        { share: b.yes, base: b.base, reason: b.reason, stat: b.stat },
        p ? { share: p.yes, base: p.base, reason: p.reason, stat: p.stat } : undefined,
        first(prev.recall.status !== "ok" ? `The compared wave has no recall figures: ${prev.recall.reason}` : null, id.brand(b.code), p && p.variable !== b.variable ? "Asked as a different question in the compared wave." : null, id.question(b.variable)),
      );
    }
  }
  const curParts = womParts(curCtx.view.recognition, curCtx.view.dashboard);
  const prevParts = womParts(prevCtx.view.recognition, prevCtx.view.dashboard);
  if (cur.wom.status === "ok" && curParts.status === "ok") {
    const before = new Map(prev.wom.status === "ok" ? prev.wom.brands.map((b) => [b.code, b]) : []);
    for (const b of cur.wom.brands) {
      if (!b.groups) continue;
      const womVar = curParts.wom.byBrand.find((x) => x.code === b.code)?.variable;
      const awareVar = curParts.awareness.byBrand.find((x) => x.code === b.code)?.variable;
      const prevWom = prevParts.status === "ok" ? prevParts.wom.byBrand.find((x) => x.code === b.code)?.variable : undefined;
      const prevAware = prevParts.status === "ok" ? prevParts.awareness.byBrand.find((x) => x.code === b.code)?.variable : undefined;
      const p = before.get(b.code);
      const brandWithheld = first(
        prev.wom.status !== "ok" ? `The compared wave has no word of mouth figures: ${prev.wom.reason}` : null,
        id.brand(b.code),
        !womVar || womVar !== prevWom ? "Word of mouth is asked as a different question in the compared wave." : null,
        womVar ? id.question(womVar) : null,
        // The Unaware group and the base come from the awareness question.
        !awareVar || awareVar !== prevAware ? "Awareness is asked as a different question in the compared wave." : null,
        awareVar ? id.question(awareVar) : null,
      );
      for (const g of b.groups) {
        const pg = p?.groups?.find((x) => x.key === g.key);
        wom[`${b.code}|${g.key}`] = c.add(
          { share: g.share, base: b.base, stat: g.stat },
          p ? (pg ? { share: pg.share, base: p.base, stat: pg.stat } : { share: null, base: null, reason: p.reason ?? "This group is not in the compared wave." }) : undefined,
          first(brandWithheld, g.key !== "unaware" && womVar ? id.answer(womVar, g.key) : null),
        );
      }
    }
  }
  return { changes: { recall, wom }, jobs: c.jobs };
}

// ---- Page 05, Audience & media ----

export type AudienceChanges = {
  /** Age groups by answer code, for the recent acquirers and for all eligible respondents. */
  age: { acquirers: Record<string, ShareChange>; category: Record<string, ShareChange> };
  /** Media options by variable. */
  media: { acquirers: Record<string, ShareChange>; category: Record<string, ShareChange> };
};

export function audienceChanges(cur: BrandAudience, prev: BrandAudience, curCtx: WaveContext, prevCtx: WaveContext): Changes<AudienceChanges> {
  const id = identity(curCtx, prevCtx);
  const c = collect();
  const out: AudienceChanges = { age: { acquirers: {}, category: {} }, media: { acquirers: {}, category: {} } };
  const curAcq = acquirerParts(curCtx.view.recognition, curCtx.view.dashboard);
  const prevAcq = acquirerParts(prevCtx.view.recognition, prevCtx.view.dashboard);
  // The acquirers are the same group only when they are the same brand's acquirers by the same question.
  const acquirersWithheld = first(
    curAcq.status !== "ok" || prevAcq.status !== "ok" ? "The recent acquirers cannot be told in both waves." : null,
    curAcq.status === "ok" && prevAcq.status === "ok" && curAcq.brand.code !== prevAcq.brand.code ? "The client's brand is not the same in the compared wave." : null,
    curAcq.status === "ok" ? id.brand(curAcq.brand.code) : null,
    curAcq.status === "ok" && prevAcq.status === "ok" && curAcq.variable !== prevAcq.variable ? "Recent acquisition is asked as a different question in the compared wave." : null,
    curAcq.status === "ok" ? id.question(curAcq.variable) : null,
  );
  // The page's small-base rule (D3f): below 50 recent acquirers, no significance test.
  const level = (a: BrandAudience["acquirers"]) => (a.status === "ok" ? a.level : null);
  const acquirersUntestable = level(cur.acquirers) !== "ok" || level(prev.acquirers) !== "ok" ? "Fewer than 50 recent acquirers in one of the two waves: described only, not tested." : undefined;
  const rows = (curRows: ProfileRow[], prevRows: ProfileRow[] | null, group: "acquirers" | "category", withheld: (key: string) => string | null, target: Record<string, ShareChange>) => {
    const before = new Map((prevRows ?? []).map((r) => [r.key, r]));
    for (const r of curRows) {
      const p = before.get(r.key);
      target[r.key] = c.add(r[group], p?.[group], first(group === "acquirers" ? acquirersWithheld : null, withheld(r.key)), group === "acquirers" ? acquirersUntestable : undefined);
    }
  };
  if (cur.age.status === "ok") {
    const ageVar = cur.age.variable;
    const prevRows = prev.age.status === "ok" && prev.age.variable === ageVar ? prev.age.rows : null;
    const ageWithheld = (code: string) => first(prevRows ? null : "The compared wave has no age groups question of the same name.", id.question(ageVar), id.answer(ageVar, code));
    rows(cur.age.rows, prevRows, "acquirers", ageWithheld, out.age.acquirers);
    rows(cur.age.rows, prevRows, "category", ageWithheld, out.age.category);
  }
  if (cur.media.status === "ok") {
    const prevRows = prev.media.status === "ok" ? prev.media.rows : null;
    const mediaWithheld = (variable: string) => first(prevRows ? null : `The compared wave has no media use figures: ${(prev.media as { reason: string }).reason}`, id.question(variable));
    rows(cur.media.rows, prevRows, "acquirers", mediaWithheld, out.media.acquirers);
    rows(cur.media.rows, prevRows, "category", mediaWithheld, out.media.category);
  }
  return { changes: out, jobs: c.jobs };
}

// ---- Category overview ----

/** A mean's change (brand repertoire): shown without a significance test (two-sample tests of means are not offered). */
export type MeanChange = { current: number | null; previous: number | null; change: number | null; reason?: string };

export type CategoryChanges = {
  repertoire: Record<string, MeanChange>;
  decisionStyle: Record<string, ShareChange>;
  acquisitionChannel: Record<string, ShareChange>;
};

export function categoryChanges(cur: CategoryOverview, prev: CategoryOverview, curCtx: WaveContext, prevCtx: WaveContext): Changes<CategoryChanges> {
  const id = identity(curCtx, prevCtx);
  const c = collect();
  const out: CategoryChanges = { repertoire: {}, decisionStyle: {}, acquisitionChannel: {} };
  const curParts = repertoireParts(curCtx.view.recognition, curCtx.view.dashboard);
  const prevParts = repertoireParts(prevCtx.view.recognition, prevCtx.view.dashboard);
  for (const r of cur.repertoire) {
    if (r.status !== "ok") continue;
    const p = prev.repertoire.find((x) => x.stage === r.stage);
    // A mean over the listed brands is the same measure only when the same brands are counted by the same questions:
    // the same variables, each the same question, each brand code naming the same brand.
    const vars = (parts: typeof curParts) => {
      const part = parts.find((x) => x.stage === r.stage);
      return part && "variables" in part ? part.variables : [];
    };
    const now = vars(curParts);
    const then = vars(prevParts);
    const brands = curCtx.view.dashboard.brands;
    const withheld = first(
      !p || p.status !== "ok" ? "The compared wave has no figure for this stage." : null,
      brands.length !== prevCtx.view.dashboard.brands.length ? "The brand list is not the same in the compared wave." : null,
      ...brands.map((b) => id.brand(b.code)),
      [...now].sort().join("|") !== [...then].sort().join("|") ? "The stage's question is not asked about the same brands in the compared wave." : null,
      ...now.map((v) => id.question(v)),
    );
    const pm = p && p.status === "ok" ? p.mean : null;
    out.repertoire[r.stage] = withheld
      ? { current: r.mean, previous: null, change: null, reason: withheld }
      : r.mean !== null && pm !== null
        ? { current: r.mean, previous: pm, change: r.mean - pm }
        : { current: r.mean, previous: pm, change: null, reason: "Not available in one of the two waves." };
  }
  const dist = (curD: CategoryOverview["decisionStyle"], prevD: CategoryOverview["decisionStyle"], target: Record<string, ShareChange>) => {
    if (curD.status !== "ok") return;
    const prevOk = prevD.status === "ok" && prevD.variable === curD.variable ? prevD : null;
    const side = (a: AnswerShare | undefined, base: number | null): ShareSide | undefined => (a ? { share: a.share, base, stat: a.stat } : undefined);
    for (const a of curD.answers)
      target[a.code] = c.add(
        side(a, curD.base)!,
        prevOk ? (side(prevOk.answers.find((x) => x.code === a.code), prevOk.base) ?? undefined) : undefined,
        first(prevOk ? null : "The compared wave does not ask this question.", id.question(curD.variable), id.answer(curD.variable, a.code)),
      );
  };
  dist(cur.decisionStyle, prev.decisionStyle, out.decisionStyle);
  dist(cur.acquisitionChannel, prev.acquisitionChannel, out.acquisitionChannel);
  return { changes: out, jobs: c.jobs };
}

// ---- Loaders with change ----

type PageWith<P, C, Extra = object> = P & { waveChange: WaveComparison<C> } & Extra;

/** The included waves up to and including this one, in order: the trend views' waves. */
const wavesUpTo = (waves: ProjectWaves, documentId: string) => {
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  return at < 0 ? [] : waves.included.slice(0, at + 1);
};

export async function loadBrandMomentsWithChange(tenantId: string, runId: string, documentId: string, choice: CompareChoice) {
  const r = await pagesToCompare(tenantId, runId, documentId, choice, (doc, ctx) => loadBrandMoments(tenantId, runId, doc, { ctx, allRecallRows: doc !== documentId }));
  const diff = r.previous ? momentChanges(r.page, r.previous.page, r.ctx, r.previous.ctx) : null;
  const waveChange = await testedComparison(tenantId, runId, documentId, r.waves, r.compared, diff?.changes ?? null, diff?.jobs ?? []);
  // Category relevance in every included wave up to this one (the Moment profile across waves): one table per wave,
  // each wave's moments matched to this wave's by variable and wording.
  const relevanceTrend: RelevancePoint[] = await Promise.all(
    wavesUpTo(r.waves, documentId).map(async (w): Promise<RelevancePoint> => {
      const head = { documentId: w.documentId, wave: w.wave, waveDate: w.waveDate };
      try {
        const known = w.documentId === documentId ? { page: r.page, ctx: r.ctx } : r.previous && r.compared.status === "ok" && r.compared.documentId === w.documentId ? r.previous : null;
        const ctx = known?.ctx ?? (await loadWaveContext(tenantId, runId, w.documentId));
        const page = known?.page ?? (await loadBrandMoments(tenantId, runId, w.documentId, { ctx }));
        const shares: RelevancePoint["shares"] = {};
        if (r.page.relevance.status === "ok") {
          const id = identity(r.ctx, ctx);
          const theirs = new Map(page.relevance.status === "ok" ? page.relevance.moments.map((m) => [m.variable, m]) : []);
          for (const m of r.page.relevance.moments) {
            const withheld = ctx === r.ctx ? null : first(page.relevance.status !== "ok" ? page.relevance.reason : null, id.question(m.variable));
            const o = theirs.get(m.variable);
            shares[m.variable] = withheld ? { share: null, base: null, reason: withheld } : o ? { share: o.share, base: o.base, ...(o.reason ? { reason: o.reason } : {}) } : { share: null, base: null, reason: "Not asked in this wave." };
          }
        }
        return { ...head, status: "ok", shares };
      } catch (e) {
        return { ...head, status: "failed", error: e instanceof Error ? e.message : String(e), shares: {} };
      }
    }),
  );
  return { ...r.page, waveChange, relevanceTrend } satisfies PageWith<typeof r.page, MomentChanges, { relevanceTrend: RelevancePoint[] }>;
}

export async function loadBrandAssociationsWithChange(tenantId: string, runId: string, documentId: string, choice: CompareChoice) {
  const r = await pagesToCompare(tenantId, runId, documentId, choice, (doc, ctx) => loadBrandAssociations(tenantId, runId, doc, { ctx }));
  const diff = r.previous ? associationChanges(r.page, r.previous.page, r.ctx, r.previous.ctx) : null;
  const waveChange = await testedComparison(tenantId, runId, documentId, r.waves, r.compared, diff?.changes ?? null, diff?.jobs ?? []);
  // The client's brand across the included waves up to this one: the trend reads only that brand's table in waves other
  // than this one and the compared one.
  const focal = r.page.dashboard.focalBrand;
  let trend: AssociationTrend = null;
  if (focal && r.page.profile.status === "ok") {
    const attributes = r.page.profile.attributes.flatMap((a) => {
      const v = a.cells.find((x) => x.code === focal.code)?.variable;
      return v ? [{ variable: v, item: a.item }] : [];
    });
    const waves = await Promise.all(
      wavesUpTo(r.waves, documentId).map(async (w): Promise<AssociationPoint> => {
        const head = { documentId: w.documentId, wave: w.wave, waveDate: w.waveDate };
        try {
          const known = w.documentId === documentId ? { page: r.page, ctx: r.ctx } : r.previous && r.compared.status === "ok" && r.compared.documentId === w.documentId ? r.previous : null;
          const ctx = known?.ctx ?? (await loadWaveContext(tenantId, runId, w.documentId));
          const page = known?.page ?? (await loadBrandAssociations(tenantId, runId, w.documentId, { ctx, onlyBrands: [focal.code] }));
          return { ...head, status: "ok", cells: associationPoint(r.page, page, r.ctx, ctx, focal.code) };
        } catch (e) {
          return { ...head, status: "failed", error: e instanceof Error ? e.message : String(e), cells: {} };
        }
      }),
    );
    trend = { brand: { code: focal.code, label: focal.label }, attributes, waves };
  }
  return { ...r.page, waveChange, trend } satisfies PageWith<typeof r.page, AssociationChanges, { trend: AssociationTrend }>;
}

export async function loadBrandAdvertisingWithChange(tenantId: string, runId: string, documentId: string, choice: CompareChoice) {
  const r = await pagesToCompare(tenantId, runId, documentId, choice, (doc, ctx) => loadBrandAdvertising(tenantId, runId, doc, { ctx }));
  const diff = r.previous ? advertisingChanges(r.page, r.previous.page, r.ctx, r.previous.ctx) : null;
  return { ...r.page, waveChange: await testedComparison(tenantId, runId, documentId, r.waves, r.compared, diff?.changes ?? null, diff?.jobs ?? []) };
}

export async function loadBrandAudienceWithChange(tenantId: string, runId: string, documentId: string, choice: CompareChoice) {
  const r = await pagesToCompare(tenantId, runId, documentId, choice, (doc, ctx) => loadBrandAudience(tenantId, runId, doc, { ctx }));
  const diff = r.previous ? audienceChanges(r.page, r.previous.page, r.ctx, r.previous.ctx) : null;
  return { ...r.page, waveChange: await testedComparison(tenantId, runId, documentId, r.waves, r.compared, diff?.changes ?? null, diff?.jobs ?? []) };
}

export async function loadCategoryOverviewWithChange(tenantId: string, runId: string, documentId: string, choice: CompareChoice) {
  const r = await pagesToCompare(tenantId, runId, documentId, choice, (doc, ctx) => loadCategoryOverview(tenantId, runId, doc, { ctx }));
  const diff = r.previous ? categoryChanges(r.page, r.previous.page, r.ctx, r.previous.ctx) : null;
  return { ...r.page, waveChange: await testedComparison(tenantId, runId, documentId, r.waves, r.compared, diff?.changes ?? null, diff?.jobs ?? []) };
}


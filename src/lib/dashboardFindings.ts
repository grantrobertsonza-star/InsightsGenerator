// R5story (Grant, 30 October 2026): a brand tracking dashboard card (or an accepted AI insight of a page) posted as
// a finding, and the freshness of what was posted. The approach is the Brand Health tool's
// (brandHealthActions.addBrandHealthFindingAction): a generated, accepted 'level' finding whose stated_stats carry
// the source, the figures and their caveats, recorded as a researcher's tool action (findingProvenance.ts), on the
// tenant-checked project row. From there the finding follows the normal route unchanged: verification
// (verifyFindings.ts reads `readingBase` with the shared base-size owner), insights, recommendations, exports.
//
// Guarantees:
//   - identity: a posted card is (data file, page, card, client brand); an AI insight is its draft's id. Posting
//     the same identity with the same figures (figuresHash) adds nothing; a rejected one is revived by the explicit
//     repost; different figures are a NEW finding, and every earlier finding of that identity is kept with its
//     wording, status and decisions and tagged `dashboard_superseded` (with the new finding's id), never re-pointed;
//   - the figures are computed on the server from the page's own loader (trackerDashboardCards.ts); nothing the
//     browser sends is taken as a figure;
//   - the write is one transaction holding the project row (assertRunOwned with lock), so two posts of one card
//     cannot both insert; the data file is checked as this project's in the same transaction;
//   - freshness: every posted finding records the source state it was computed from (sourceStateOf: the
//     programme's dashboard choices revision, and for each data file it read, the stored file, set-up and
//     corrections, and the confirmed questionnaire and codebook mapping). syncDashboardFindingFreshness compares
//     that with the state now and tags a changed one `dashboard_source_changed` with the reasons, keeping its
//     wording and decisions. Tagging changes stated_stats, which is part of finding_support_parts (0096), so
//     insights and recommendations built on it read as "support changed" through the existing support owner;
//   - a post computes the state before and after loading the figures and refuses when they differ (the source
//     changed while the figures were read), so a finding never records a state its figures do not belong to.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { recordHumanReview } from "./findingProvenance";
import { getConfirmedItemsForData } from "./instruments";
import { assertRunOwned } from "./runOwnership";
import { dashboardCardDef, loadPageFigures, type CardFigures, type DashboardFigure, type PageContext } from "./trackerDashboardCards";

export const DASHBOARD_SOURCE = "tracker_dashboard";
export const SOURCE_CHANGED_TAG = "dashboard_source_changed";
export const SUPERSEDED_TAG = "dashboard_superseded";

/** What a dashboard figure was computed from: the programme's choices and, per data file, its stored state. */
export type DashboardSourceState = {
  /** The dashboard choices' scope and revision; revision null when nothing is saved; null when choices cannot be read
   * (before migration 0132), which compares as unknown, never as unchanged. */
  choices: { scope: string; revision: number | null } | null;
  documents: { id: string; filename: string | null; data: string | null; mapping: string }[];
};

export const sha256Of = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stable JSON: object keys sorted, so equal content hashes equally. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** The hash of what a card or page says: every figure's identity, unrounded value (to 1e-9), unit and base, and the
 * weighting. Labels are included because a renamed answer changes what a sentence says. */
export function figuresHashOf(figures: DashboardFigure[], ctx: Pick<PageContext, "weighted" | "weightVar" | "focal">): string {
  const norm = figures.map((f) => [f.key, f.label, f.value === null ? null : Math.round(f.value * 1e9) / 1e9, f.unit, f.base, f.reason ?? null]);
  return sha256Of(stableJson({ figures: norm, weighted: ctx.weighted, weightVar: ctx.weightVar, focal: ctx.focal?.code ?? null }));
}

async function choicesStateOf(client: PoolClient, tenantId: string, runId: string): Promise<DashboardSourceState["choices"]> {
  const available = (await client.query<{ ok: boolean }>("select to_regclass('tracker_dashboards') is not null as ok")).rows[0]?.ok === true;
  if (!available) return null;
  const run = await client.query<{ program_id: string | null }>("select program_id from runs where id = $1 and tenant_id = $2", [runId, tenantId]);
  if (run.rowCount !== 1) throw new Error("That project is not available.");
  const programId = run.rows[0].program_id;
  const scope = programId ? `programme:${programId}` : `project:${runId}`;
  const r = await client.query<{ revision: number }>(
    `select revision from tracker_dashboards where tenant_id = $1 and ${programId ? "program_id = $2" : "run_id = $2"}`,
    [tenantId, programId ?? runId],
  );
  return { scope, revision: r.rows[0]?.revision ?? null };
}

/** Each data file's stored state: the file, its content hash, set-up and corrections. Null when it is gone. */
async function dataStatesOf(client: PoolClient, tenantId: string, runId: string, documentIds: string[]): Promise<Map<string, { filename: string; data: string }>> {
  const r = await client.query<{ id: string; source_filename: string; state: string }>(
    `select d.id, d.source_filename,
            md5(coalesce(d.storage_path, '') || chr(31) || coalesce(to_jsonb(d)->>'content_sha256', '') || chr(31) ||
                coalesce(d.data_setup::text, '') || chr(31) || coalesce(to_jsonb(d)->>'variable_overrides', '')) as state
       from documents d
      where d.id = any($1::uuid[]) and d.run_id = $2 and d.tenant_id = $3 and (to_jsonb(d)->>'removed_at') is null`,
    [documentIds, runId, tenantId],
  );
  return new Map(r.rows.map((x) => [x.id, { filename: x.source_filename, data: x.state }]));
}

/** The confirmed mapping a data file's dashboard reads (the owner's reader of confirmed items), as a hash. */
async function mappingStateOf(tenantId: string, runId: string, documentId: string): Promise<string> {
  const items = await getConfirmedItemsForData(tenantId, runId, documentId);
  return sha256Of(stableJson(items.map((i) => [i.itemId, i.variable, i.code, i.text, i.options, i.confirmed, i.questionMeta])));
}

/** The source state now, for the given data files. A failed read throws: never an empty state that would compare
 * as unchanged. */
export async function sourceStateOf(tenantId: string, runId: string, documentIds: string[]): Promise<DashboardSourceState> {
  const ids = [...new Set(documentIds)].sort();
  const mappings = await Promise.all(ids.map((id) => mappingStateOf(tenantId, runId, id)));
  return withTenantRead(tenantId, async (client) => {
    const [choices, data] = await Promise.all([choicesStateOf(client, tenantId, runId), dataStatesOf(client, tenantId, runId, ids)]);
    return { choices, documents: ids.map((id, i) => ({ id, filename: data.get(id)?.filename ?? null, data: data.get(id)?.data ?? null, mapping: mappings[i] })) };
  });
}

/** What changed between a recorded source state and the state now, in words; empty when nothing did. */
export function sourceChanges(recorded: DashboardSourceState | null | undefined, now: DashboardSourceState): string[] {
  if (!recorded || !Array.isArray(recorded.documents)) return ["The state these figures were computed from was not recorded, so a change cannot be ruled out."];
  const out: string[] = [];
  if (recorded.choices === null || now.choices === null) out.push("The dashboard choices could not be compared (the database needs migration 0132).");
  else if (recorded.choices.scope !== now.choices.scope) out.push("The project moved to another programme, so other dashboard choices apply.");
  else if (recorded.choices.revision !== now.choices.revision) out.push("The dashboard choices were changed (brand, stages, weighting or other choices).");
  for (const d of recorded.documents) {
    const cur = now.documents.find((x) => x.id === d.id);
    const name = d.filename ?? cur?.filename ?? "a data file";
    if (!cur || cur.data === null) out.push(`${name} is no longer in the project.`);
    else {
      if (cur.data !== d.data) out.push(`${name} was changed (file, set-up or corrections).`);
      if (cur.mapping !== d.mapping) out.push(`The questionnaire or codebook mapping of ${name} was changed.`);
    }
  }
  return out;
}

export type PostResult =
  | { ok: true; added: boolean; findingId: string; superseded: number; figuresHash: string }
  | { ok: false; error: string };

type PostedRow = { id: string; status: string; stated_stats: Record<string, unknown> };

/** The smallest known base among the figures a sentence states (the most cautious one), for verification. */
function readingBaseOf(figures: DashboardFigure[]): { base: number; label: string } | null {
  const known = figures.filter((f) => f.value !== null && f.base !== null);
  if (known.length === 0) return null;
  const min = known.reduce((a, b) => (b.base! < a.base! ? b : a));
  return { base: min.base!, label: min.baseLabel };
}

/** The write shared by a card post and an accepted AI insight post. */
async function writeDashboardFinding(
  tenantId: string,
  runId: string,
  documentId: string,
  input: { identity: string; text: string; theme: string; figuresHash: string; stats: Record<string, unknown>; stateBefore: DashboardSourceState },
): Promise<PostResult> {
  const stateAfter = await sourceStateOf(tenantId, runId, input.stateBefore.documents.map((d) => d.id));
  if (sourceChanges(input.stateBefore, stateAfter).length > 0) return { ok: false, error: "The dashboard's choices or data changed while the figures were read, so nothing was posted. Try again." };
  return withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId, { lock: true });
    const doc = await client.query("select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, tenantId]);
    if (doc.rowCount !== 1) throw new Error("That data file is not in this project. Nothing was posted.");
    // The state again, inside the transaction that holds the project: the data part read here (the choices and
    // files) must still be what the figures were computed from.
    const data = await dataStatesOf(client, tenantId, runId, input.stateBefore.documents.map((d) => d.id));
    const choices = await choicesStateOf(client, tenantId, runId);
    const inTx: DashboardSourceState = { choices, documents: input.stateBefore.documents.map((d) => ({ ...d, filename: data.get(d.id)?.filename ?? null, data: data.get(d.id)?.data ?? null })) };
    if (sourceChanges(input.stateBefore, inTx).length > 0) throw new Error("The dashboard's choices or data changed while the figures were read, so nothing was posted. Try again.");

    const existing = await client.query<PostedRow>(
      `select id, status, stated_stats from findings
        where run_id = $1 and tenant_id = $2 and stated_stats->>'source' = $3 and stated_stats->>'identity' = $4
        order by created_at, id for update`,
      [runId, tenantId, DASHBOARD_SOURCE, input.identity],
    );
    const same = existing.rows.filter((r) => r.stated_stats?.figuresHash === input.figuresHash);
    const live = same.find((r) => r.status !== "rejected");
    if (live) {
      // Already posted with these figures. A finding marked for review whose source is back to what these figures
      // were computed from is brought up to date (its recorded state and the review tag), wording and status kept.
      const caveats = Array.isArray(live.stated_stats.caveats) ? (live.stated_stats.caveats as string[]) : [];
      if (caveats.includes(SOURCE_CHANGED_TAG)) {
        const next = { ...live.stated_stats, sourceState: input.stateBefore, caveats: caveats.filter((c) => c !== SOURCE_CHANGED_TAG), freshness: { status: "current", checkedAt: new Date().toISOString() } };
        await client.query("update findings set stated_stats = $3 where id = $1 and tenant_id = $2", [live.id, tenantId, JSON.stringify(next)]);
      }
      return { ok: true, added: false, findingId: live.id, superseded: 0, figuresHash: input.figuresHash };
    }
    const rejected = same[0];
    let findingId: string;
    let added: boolean;
    if (rejected) {
      // An explicit post of figures the researcher rejected earlier revives that finding (its wording kept).
      await client.query("update findings set status = 'accepted' where id = $1 and tenant_id = $2", [rejected.id, tenantId]);
      findingId = rejected.id;
      added = false;
    } else {
      const r = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'level', $5, 'quantitative', 'accepted', $6) returning id`,
        [tenantId, runId, input.text, input.theme, JSON.stringify(input.stats), documentId],
      );
      findingId = r.rows[0].id;
      added = true;
    }
    await recordHumanReview(client, [findingId], "tool_add");
    // Every other finding of this identity describes figures the dashboard no longer gives: kept as written, tagged.
    let superseded = 0;
    for (const old of existing.rows) {
      if (old.id === findingId || old.stated_stats?.figuresHash === input.figuresHash) continue;
      const caveats = Array.isArray(old.stated_stats.caveats) ? (old.stated_stats.caveats as string[]) : [];
      if (caveats.includes(SUPERSEDED_TAG) && old.stated_stats.supersededByFindingId === findingId) continue;
      const next = { ...old.stated_stats, caveats: [...new Set([...caveats, SUPERSEDED_TAG])], supersededByFindingId: findingId };
      await client.query("update findings set stated_stats = $3 where id = $1 and tenant_id = $2", [old.id, tenantId, JSON.stringify(next)]);
      superseded += 1;
    }
    return { ok: true, added, findingId, superseded, figuresHash: input.figuresHash };
  });
}

/** The data files a page reads: its own, and for the overview (change and trend) every wave of the project up to it. */
export async function dashboardSourceFiles(tenantId: string, runId: string, documentId: string, pageId: string): Promise<string[]> {
  if (pageId !== "overview") return [documentId];
  const { loadProjectWaves } = await import("./waveFiles");
  const waves = await loadProjectWaves(tenantId, runId);
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  return at < 0 ? [documentId] : waves.included.slice(0, at + 1).map((w) => w.documentId);
}

function pageTheme(pageTitle: string): string {
  return `Brand tracking: ${pageTitle}`;
}

/** Posts one dashboard card as a finding (see the file comment). */
export async function postDashboardCard(tenantId: string, runId: string, documentId: string, pageId: unknown, cardId: unknown): Promise<PostResult> {
  const def = dashboardCardDef(pageId, cardId);
  if (!def || !def.card) return { ok: false, error: "That dashboard card is not known. Reload the dashboard and try again." };
  // The state is read before the figures and compared again at the write (writeDashboardFinding), so the recorded
  // state is never newer than the figures. Every card of a page reads the page's own file (and, for a change or a
  // trend, the project's other waves, which the overview lists as its source files).
  const stateBefore = await sourceStateOf(tenantId, runId, await dashboardSourceFiles(tenantId, runId, documentId, def.page.id));
  const page = await loadPageFigures(tenantId, runId, documentId, def.page.id);
  const fresh = page.cards.find((c) => c.card === def.card!.id)!;
  if (fresh.status !== "ok") return { ok: false, error: fresh.reason ?? "This card has no figures to post." };
  const text = page.sentences.get(fresh.card) ?? null;
  if (!text) return { ok: false, error: page.ctx.focal ? "This card has no figures to post yet." : "Choose your brand first (the Brand chip), so the finding can be said for it." };
  if (fresh.sourceDocumentIds.some((id) => !stateBefore.documents.some((d) => d.id === id)))
    return { ok: false, error: "The project's waves changed while the figures were read, so nothing was posted. Try again." };
  const figuresHash = figuresHashOf(fresh.figures, page.ctx);
  // Recorded for the files this card's figures read only, so a change to another wave does not mark it.
  const recorded: DashboardSourceState = { ...stateBefore, documents: stateBefore.documents.filter((d) => fresh.sourceDocumentIds.includes(d.id)) };
  const identity = `card|${documentId}|${page.page}|${fresh.card}|${page.ctx.focal?.code ?? ""}`;
  return writeDashboardFinding(tenantId, runId, documentId, { identity, text, theme: pageTheme(page.title), figuresHash, stateBefore: recorded, stats: cardStats(identity, "card", fresh, page.ctx, page.title, figuresHash, recorded) });
}

function cardStats(identity: string, kind: "card" | "ai_insight", card: Pick<CardFigures, "page" | "card" | "title" | "figures" | "method" | "caveats" | "notes" | "sourceDocumentIds">, ctx: PageContext, pageTitle: string, figuresHash: string, state: DashboardSourceState): Record<string, unknown> {
  const reading = readingBaseOf(card.figures);
  return {
    source: DASHBOARD_SOURCE,
    kind,
    identity,
    page: card.page,
    pageTitle,
    card: card.card,
    cardTitle: card.title,
    documentId: ctx.documentId,
    wave: ctx.wave,
    focalBrand: ctx.focal,
    weighted: ctx.weighted,
    weightVar: ctx.weightVar,
    effectiveBase: ctx.effectiveBase,
    method: card.method,
    figures: card.figures,
    figuresHash,
    notes: card.notes,
    caveats: card.caveats,
    sourceDocumentIds: card.sourceDocumentIds,
    sourceState: state,
    ...(reading ? { readingBase: reading.base, readingBaseLabel: reading.label } : {}),
    postedAt: new Date().toISOString(),
  };
}

/** Posts an accepted AI insight as a finding: its wording, the page's figures it was checked against, and the
 * page's caveats; identity is the draft's id, so a second post adds nothing and an edited draft is a new finding. */
export async function postDashboardInsightFinding(
  tenantId: string,
  runId: string,
  documentId: string,
  insight: { id: string; text: string; figuresHash: string; figureCheck: unknown },
  page: { id: string; title: string; ctx: PageContext; cards: CardFigures[] },
): Promise<PostResult> {
  const okCards = page.cards.filter((c) => c.status === "ok");
  const sourceDocumentIds = [...new Set(okCards.flatMap((c) => c.sourceDocumentIds))];
  const stateBefore = await sourceStateOf(tenantId, runId, sourceDocumentIds.length ? sourceDocumentIds : [documentId]);
  const figures = okCards.flatMap((c) => c.figures);
  const merged = {
    page: page.id,
    card: "ai_insight",
    title: "AI insight",
    figures,
    method: "Wording drafted by AI from this page's computed figures only, every number checked against them, and accepted by the researcher.",
    caveats: [...new Set([...okCards.flatMap((c) => c.caveats), "ai_drafted_wording"])],
    notes: [...new Set(okCards.flatMap((c) => c.notes))],
    sourceDocumentIds,
  };
  const identity = `ai|${insight.id}|${sha256Of(insight.text).slice(0, 16)}`;
  const stats = { ...cardStats(identity, "ai_insight", merged, page.ctx, page.title, insight.figuresHash, stateBefore), aiInsightId: insight.id, figureCheck: insight.figureCheck };
  return writeDashboardFinding(tenantId, runId, documentId, { identity, text: insight.text, theme: pageTheme(page.title), figuresHash: insight.figuresHash, stateBefore, stats });
}

export type DashboardFindingStatus = {
  findingId: string;
  page: string;
  card: string;
  kind: string;
  status: string;
  figuresHash: string;
  stale: boolean;
  superseded: boolean;
  reasons: string[];
  /** The client brand the finding was said for (null when none was chosen). */
  focalCode: string | null;
};

/** Every finding posted from this data file's dashboard (current tags), for the cards' buttons. */
export async function dashboardFindingStatuses(tenantId: string, runId: string, documentId: string): Promise<DashboardFindingStatus[]> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string; status: string; s: Record<string, unknown> }>(
      `select id, status, stated_stats as s from findings
        where run_id = $1 and tenant_id = $2 and stated_stats->>'source' = $3 and stated_stats->>'documentId' = $4
        order by created_at, id`,
      [runId, tenantId, DASHBOARD_SOURCE, documentId],
    );
    return r.rows.map((x) => {
      const caveats = Array.isArray(x.s.caveats) ? (x.s.caveats as string[]) : [];
      const fr = x.s.freshness as { reasons?: string[] } | undefined;
      return {
        findingId: x.id,
        page: String(x.s.page ?? ""),
        card: String(x.s.card ?? ""),
        kind: String(x.s.kind ?? "card"),
        status: x.status,
        figuresHash: String(x.s.figuresHash ?? ""),
        stale: caveats.includes(SOURCE_CHANGED_TAG),
        superseded: caveats.includes(SUPERSEDED_TAG),
        reasons: Array.isArray(fr?.reasons) ? fr!.reasons! : [],
        focalCode: (x.s.focalBrand as { code?: string } | null | undefined)?.code ?? null,
      };
    });
  });
}

/**
 * Marks for review every finding of this project posted from a dashboard whose source changed since it was posted
 * (see the file comment). Wording, status and decisions are kept. A finding already marked keeps its mark until it
 * is posted again with figures from the current state. Returns how many were checked and newly marked. A failed
 * read of the current state throws (a check that could not run is never reported as "nothing changed").
 */
export async function syncDashboardFindingFreshness(tenantId: string, runId: string): Promise<{ checked: number; marked: number }> {
  const posted = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string; s: Record<string, unknown> }>(
      `select id, stated_stats as s from findings
        where run_id = $1 and tenant_id = $2 and stated_stats->>'source' = $3 and status <> 'rejected'`,
      [runId, tenantId, DASHBOARD_SOURCE],
    );
    return r.rows;
  });
  if (posted.length === 0) return { checked: 0, marked: 0 };
  const allDocs = [...new Set(posted.flatMap((p) => ((p.s.sourceState as DashboardSourceState | undefined)?.documents ?? []).map((d) => d.id)))];
  const now = await sourceStateOf(tenantId, runId, allDocs);
  const changed = posted
    .map((p) => ({ id: p.id, reasons: sourceChanges(p.s.sourceState as DashboardSourceState | undefined, now) }))
    .filter((p) => p.reasons.length > 0);
  if (changed.length === 0) return { checked: posted.length, marked: 0 };
  let marked = 0;
  await withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    for (const c of changed) {
      const r = await client.query<{ s: Record<string, unknown> }>(
        "select stated_stats as s from findings where id = $1 and run_id = $2 and tenant_id = $3 and status <> 'rejected' for update",
        [c.id, runId, tenantId],
      );
      const s = r.rows[0]?.s;
      if (!s) continue;
      const caveats = Array.isArray(s.caveats) ? (s.caveats as string[]) : [];
      if (caveats.includes(SOURCE_CHANGED_TAG)) continue;
      const next = { ...s, caveats: [...caveats, SOURCE_CHANGED_TAG], freshness: { status: "changed", reasons: c.reasons, checkedAt: new Date().toISOString() } };
      await client.query("update findings set stated_stats = $4 where id = $1 and run_id = $2 and tenant_id = $3", [c.id, runId, tenantId, JSON.stringify(next)]);
      marked += 1;
    }
  });
  return { checked: posted.length, marked };
}

/** syncDashboardFindingFreshness for every project sharing a dashboard choices scope (a programme's projects, or the
 * one project), after its choices were saved or reset. */
export async function syncDashboardFreshnessForScopeOf(tenantId: string, runId: string): Promise<{ error: string | null }> {
  const runs = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string }>(
      `select r2.id from runs r1 join runs r2 on r2.tenant_id = r1.tenant_id and (r2.id = r1.id or (r1.program_id is not null and r2.program_id = r1.program_id))
        where r1.id = $1 and r1.tenant_id = $2`,
      [runId, tenantId],
    );
    return r.rows.map((x) => x.id);
  });
  // A failed check is traced and returned (the choices themselves were saved); the posted findings are checked again
  // when the dashboard is next opened and before the pipeline's next insight work (verifyFindings.refreshVerdicts).
  const errors: string[] = [];
  for (const id of runs) {
    try {
      await syncDashboardFindingFreshness(tenantId, id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(message);
      // The error is returned whether or not its trace row can be written.
      await withTenant(tenantId, async (client) => {
        await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'dashboard_freshness_error', $3)`, [tenantId, id, JSON.stringify({ message })]);
      }).catch((traceError) => errors.push(`and it could not be traced: ${traceError instanceof Error ? traceError.message : String(traceError)}`));
    }
  }
  return { error: errors.length ? errors.join("; ") : null };
}

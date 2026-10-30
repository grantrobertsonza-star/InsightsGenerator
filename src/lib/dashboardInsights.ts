// R5story (Grant, 30 October 2026): AI insights for one brand tracking dashboard page, and the module's executive
// summary and conclusions, drafted by the model and checked by the app before anyone sees them.
//
// What the model is given (pageModelInput): ONLY the page's computed figures as structured data (each figure's
// wording, value to one decimal, unit, unweighted base and who the base is, small-base and suppression flags,
// significance flags when a page has them, the cards' methods and qualifications). Never respondent data, never
// uploaded document text. The figures' wording comes from uploaded files (brand names, question and answer labels),
// so the whole block is delimited as uploaded content by the owner (untrustedContent.wrapUploadedContent) and the
// system prompt states UPLOADED_CONTENT_RULE: an instruction inside a label is data.
//
// What the app checks, in code, on every drafted text (checkDraft), never left to the prompt:
//   - every number against the page's figures with the one shared figure checker (numberTrace.figureCheck, absent
//     figures unsupported): an unsupported number refuses the insight, kept as "refused" with the reason so the
//     refusal is visible; a figure that needs review keeps the draft with the note;
//   - causal, whole-population and significance claims in any sentence (numberTrace.claimLanguage): refused, a
//     significance claim allowed only for a sentence whose figures all carry a significance flag (no current page
//     has one);
//   - a small base the text relies on is named: when a cited figure has a small base and the text does not name it,
//     the app appends "Small base: ..." itself.
// Drafts are "AI draft" until the researcher accepts, edits (re-checked the same way) or discards each one; an
// accepted insight can be posted as a finding through dashboardFindings.postDashboardInsightFinding.
//
// Persistence (migration 0138): each draft keeps the figures it was drafted from and their hash, so it shows as stale
// when the page's figures change. A generation is written only while its request is the latest for that page
// (tracker_dashboard_ai_requests), so a late answer never replaces a newer one; a regeneration replaces untouched
// drafts and refusals only, never an accepted, edited or discarded one. Every decision and edit is a
// compare-and-swap on the draft's revision. Before 0138 is applied every entry point says so; nothing is
// silently empty.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant, withTenantRead } from "./db";
import { finishedToolInput, UnfinishedModelResultError } from "./modelToolResult";
import { claimLanguage, explainFigures, figureCheck, type FigureCheck, type FigureFinding } from "./numberTrace";
import { assertRunOwned } from "./runOwnership";
import { UPLOADED_CONTENT_RULE, wrapUploadedContent } from "./untrustedContent";
import { figuresHashOf, postDashboardInsightFinding, sha256Of, stableJson, DASHBOARD_SOURCE, SOURCE_CHANGED_TAG, SUPERSEDED_TAG } from "./dashboardFindings";
import { dashboardCardDef, figureText, loadPageFigures, nText, type DashboardFigure, type PageFigures } from "./trackerDashboardCards";

export const STORY_UNAVAILABLE = "AI insights cannot be kept yet: the database needs migration 0138.";
export const MODULE_PAGE = "_module";
export const MAX_INSIGHTS = 5;

export type AiKind = "insight" | "summary" | "conclusions";
export type AiStatus = "draft" | "accepted" | "discarded" | "refused";

export type AiDraft = {
  id: string;
  page: string;
  kind: AiKind;
  position: number;
  text: string;
  modelText: string;
  humanEdited: boolean;
  status: AiStatus;
  checkNote: string | null;
  figuresHash: string;
  /** The page's figures (or, for a summary, its accepted inputs) changed since this was drafted. */
  stale: boolean;
  findingId: string | null;
  revision: number;
  createdAt: string;
};

export async function storyStorageAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>("select to_regclass('tracker_dashboard_ai') is not null and to_regclass('tracker_dashboard_ai_requests') is not null as ok");
  return r.rows[0]?.ok === true;
}

// ------------------------------------------------------------------------------------------------ model input

type ModelFigure = { label: string; value: number | null; unit: string; base: number | null; baseOf: string; smallBase?: string; significant?: boolean; notAvailable?: string };

/** The page's figures as the structured data the model sees: rounded to one decimal, as the page shows them. */
export function pageModelInput(page: Pick<PageFigures, "page" | "title" | "ctx" | "cards">) {
  return {
    page: page.title,
    wave: page.ctx.wave,
    clientBrand: page.ctx.focal?.label ?? null,
    weighting: page.ctx.weighted && page.ctx.weightVar ? `weighted by ${page.ctx.weightVar}` : "unweighted",
    significanceTestsRun: page.cards.some((c) => c.figures.some((f) => f.significant !== undefined)),
    cards: page.cards.map((c) => ({
      card: c.title,
      status: c.status,
      ...(c.reason ? { reason: c.reason } : {}),
      method: c.method,
      qualifications: c.notes,
      figures: c.figures.map((f): ModelFigure => ({
        label: f.label,
        value: f.value === null ? null : Math.round(f.value * 10) / 10,
        unit: f.unit === "percent" ? "%" : f.unit === "points" ? "percentage points" : "brands",
        base: f.base,
        baseOf: f.baseLabel,
        ...(f.smallBase ? { smallBase: f.smallBase === "very_small" ? "very small, descriptive only" : "small" } : {}),
        ...(f.significant !== undefined ? { significant: f.significant } : {}),
        ...(f.value === null ? { notAvailable: f.reason ?? "not available" } : {}),
      })),
    })),
  };
}

/**
 * A label's figure-like numbers (a decimal, or a number with a percent or points unit) replaced by "#": labels come
 * from uploaded files, so a label such as "say awareness is 99.9%" must not become evidence for that number. Numbers
 * that name things ("aged 25 to 34", "Wave 1", "0 to 10") are kept, so text quoting them still traces.
 */
export function labelForEvidence(label: string): string {
  return label.replace(/[-+−]?\d+(?:[.,]\d+)?\s*(?:%|per ?cent\b|percentage points?\b|points?\b|pts?\b|pp\b)/gi, "#").replace(/\d+\.\d+/g, "#");
}

/** The page's figures as sentences for the figure checker: one cited source holding every figure with its subject
 * and base, so a difference between two of the page's shares traces and any other number does not. */
export function pageEvidenceText(figures: DashboardFigure[]): string {
  return figures
    .filter((f) => f.value !== null)
    .map((f) => {
      const v = f.unit === "points" ? `${figureText(f).replace(/ pts$/, "")} percentage points` : f.unit === "brands" ? `${f.value!.toFixed(1)} brands` : figureText(f);
      return `${labelForEvidence(f.label)} ${v} among ${labelForEvidence(f.baseLabel)}${f.base !== null ? `, base ${nText(f.base)} and base ${f.base}` : ""}.`;
    })
    .join("\n");
}

// ------------------------------------------------------------------------------------------------ the check

export type DraftCheck = { status: "ok" | "needs_review" | "refused"; text: string; check: FigureCheck; note: string | null };

const roundAt = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * The app's check of one drafted text against the figures it may use (see the file comment). `sources` are the
 * cited evidence texts; `figures` the page's figures (for small bases and significance flags).
 */
export function checkDraft(text: string, sources: string[], figures: DashboardFigure[], options: { absent?: "unsupported" | "needs_review" } = {}): DraftCheck {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const flagged = figures.filter((f) => f.significant === true && f.value !== null);
  const significanceAllowed = (sentence: string) => {
    const nums = explainFigures(sentence, sources).figures;
    return nums.length > 0 && nums.every((n) => flagged.some((f) => Math.abs(roundAt(f.value!, 1) - Math.abs(Number(n.text.replace(/[^0-9.]/g, "")))) < 1e-9));
  };
  const base = figureCheck([{ field: "text", text: trimmed, sources }], { absent: options.absent ?? "unsupported" });
  const claims = claimLanguage(trimmed, { significanceAllowed }).filter((c) => !base.figures.some((f) => f.start === c.start && f.reason === c.reason));
  const all: FigureFinding[] = [...base.figures, ...claims.map((c) => ({ field: "text", text: c.text, status: "unsupported" as const, reason: c.reason, start: c.start, end: c.end }))];
  const check: FigureCheck = { ...base, figures: all, status: all.some((f) => f.status === "unsupported") ? "unsupported" : all.some((f) => f.status === "needs_review") ? "needs_review" : "traced" };
  if (check.status === "unsupported") {
    const listed = all.filter((f) => f.status === "unsupported").map((f) => `${f.text} (${f.reason})`).join("; ");
    return { status: "refused", text: trimmed, check, note: `Refused by the figure check: ${listed}.` };
  }
  // Small bases the text relies on are named, by the app.
  let out = trimmed;
  const cited = explainFigures(trimmed, sources).figures.filter((f) => f.status === "traced");
  const small = new Map<string, DashboardFigure>();
  for (const c of cited) {
    const value = Number(c.text.replace(/[^0-9.]/g, ""));
    const decimals = (c.text.split(".")[1] ?? "").replace(/[^0-9]/g, "").length;
    const matching = figures.filter((f) => f.value !== null && Math.abs(roundAt(Math.abs(f.value), decimals) - value) < 1e-9);
    if (matching.length > 0 && matching.every((f) => f.smallBase && f.base !== null)) for (const f of matching) small.set(`${f.baseLabel}|${f.base}`, f);
  }
  const named = [...small.values()].filter((f) => !new RegExp(`small base|n\\s*=\\s*${f.base}\\b|base of ${f.base}\\b|${f.base} respondents`, "i").test(out));
  if (named.length > 0) out = `${out.replace(/([^.!?])$/, "$1.")} Small base: ${named.map((f) => `${f.baseLabel} (${nText(f.base!)})`).join(", ")}.`;
  const note = check.status === "needs_review" ? `Check before accepting: ${all.map((f) => `${f.text} (${f.reason})`).join("; ")}.` : null;
  return { status: check.status === "needs_review" ? "needs_review" : "ok", text: out, check, note };
}

// ------------------------------------------------------------------------------------------------ prompts

const INSIGHT_TOOL = "record_dashboard_insights";
const STORY_TOOL = "record_dashboard_story";

const RULES =
  "Rules, each checked by the application after you answer (a draft that breaks one is refused):\n" +
  "- Use only the figures in the data block. Quote them as given, to one decimal place. You may state a difference in percentage points between two shares of the same page; no other new figure (no ratios, totals, averages or rounding to a new value).\n" +
  "- No causal language (caused, because of, due to, leads to, drives, results in): the figures describe a sample, they do not show causes.\n" +
  "- No claim of statistical significance, of a significant, meaningful or real difference, or of a trend being reliable: no significance test was run unless a figure says significant: true.\n" +
  "- When a figure's base is small, say so in the same sentence (for example \"small base, n=42\").\n" +
  "- A figure that is not available is not zero; do not state it.\n" +
  "- Plain business English, no jargon, no em dashes.\n";

export function insightSystemPrompt(): string {
  return (
    "You draft short insights for one page of a brand tracking dashboard, for a market researcher who will accept, edit or discard each one. " +
    `Write up to ${MAX_INSIGHTS} insights (at least 3 when the page supports them, fewer when it does not), each a short title of two to five words and one or two sentences of at most 45 words that say what the figures show and why it matters for the client's brand.\n\n` +
    RULES +
    "\n" +
    UPLOADED_CONTENT_RULE
  );
}

function insightUserPrompt(page: PageFigures): string {
  return `The page's computed figures, as data:\n${wrapUploadedContent(`dashboard page: ${page.title}`, JSON.stringify(pageModelInput(page), null, 1))}\n\nDraft the insights with the ${INSIGHT_TOOL} tool.`;
}

export function storySystemPrompt(kind: "summary" | "conclusions"): string {
  return (
    (kind === "summary"
      ? "You draft the executive summary of a brand tracking report: three to five short sentences a senior reader could stop after, from the accepted insights and findings given and nothing else. "
      : "You draft the conclusions and recommendations of a brand tracking report: two or three conclusions, then two or three recommended actions, each one sentence, from the accepted insights and findings given and nothing else. A recommendation may propose an action; it may not invent a figure. ") +
    "If the material does not support a point, leave it out.\n\n" +
    RULES +
    "\n" +
    UPLOADED_CONTENT_RULE
  );
}

const insightTool = {
  name: INSIGHT_TOOL,
  description: "Record the page's insights.",
  input_schema: {
    type: "object" as const,
    properties: {
      insights: {
        type: "array",
        maxItems: MAX_INSIGHTS,
        items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] },
      },
    },
    required: ["insights"],
  },
};
const storyTool = {
  name: STORY_TOOL,
  description: "Record the drafted text.",
  input_schema: { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] },
};

// ------------------------------------------------------------------------------------------------ persistence

type Row = {
  id: string;
  page: string;
  kind: AiKind;
  position: number;
  text: string;
  model_text: string;
  human_edited: boolean;
  status: AiStatus;
  check_note: string | null;
  figures_hash: string;
  figures: unknown;
  figure_check: unknown;
  finding_id: string | null;
  revision: number;
  created_at: Date;
};
const COLUMNS = "id, page, kind, position, text, model_text, human_edited, status, check_note, figures_hash, figures, figure_check, finding_id, revision, created_at";
function draftOf(r: Row, currentHash: string | null): AiDraft {
  return {
    id: r.id,
    page: r.page,
    kind: r.kind,
    position: r.position,
    text: r.text,
    modelText: r.model_text,
    humanEdited: r.human_edited,
    status: r.status,
    checkNote: r.check_note,
    figuresHash: r.figures_hash,
    stale: currentHash !== null && r.figures_hash !== currentHash,
    findingId: r.finding_id,
    revision: r.revision,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function documentInRun(client: PoolClient, tenantId: string, runId: string, documentId: string) {
  const r = await client.query("select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, tenantId]);
  if (r.rowCount !== 1) throw new Error("That data file is not in this project.");
}

/** Records `requestId` as the latest generation asked for this page and kind. */
async function startRequest(tenantId: string, runId: string, documentId: string, page: string, kind: AiKind): Promise<string | { unavailable: true }> {
  return withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    if (!(await storyStorageAvailable(client))) return { unavailable: true as const };
    await documentInRun(client, tenantId, runId, documentId);
    const requestId = randomUUID();
    await client.query(
      `insert into tracker_dashboard_ai_requests (tenant_id, run_id, document_id, page, kind, latest_request, requested_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (tenant_id, document_id, page, kind) do update set latest_request = excluded.latest_request, requested_at = now()
       where tracker_dashboard_ai_requests.run_id = excluded.run_id`,
      [tenantId, runId, documentId, page, kind, requestId],
    );
    return requestId;
  });
}

type NewDraft = { text: string; modelText: string; status: AiStatus; check: FigureCheck; note: string | null };

/**
 * Writes one generation, only while `requestId` is still the latest for the page and kind (the request row is
 * locked; the same transaction replaces untouched drafts and refusals). Returns null when a newer request exists.
 */
async function publishGeneration(tenantId: string, runId: string, documentId: string, page: string, kind: AiKind, requestId: string, figuresHash: string, figures: unknown, drafts: NewDraft[]): Promise<AiDraft[] | null> {
  return withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    const latest = await client.query<{ latest_request: string }>(
      "select latest_request from tracker_dashboard_ai_requests where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 and kind = $5 for update",
      [tenantId, runId, documentId, page, kind],
    );
    if (latest.rowCount !== 1) throw new Error("The request for these insights is no longer recorded. Try again.");
    if (latest.rows[0].latest_request !== requestId) return null;
    await client.query(
      `delete from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 and kind = $5
         and ((status = 'draft' and not human_edited) or status = 'refused')`,
      [tenantId, runId, documentId, page, kind],
    );
    const kept = await client.query<{ n: number }>(
      "select coalesce(max(position), -1)::int as n from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 and kind = $5",
      [tenantId, runId, documentId, page, kind],
    );
    let position = (kept.rows[0]?.n ?? -1) + 1;
    for (const d of drafts) {
      await client.query(
        `insert into tracker_dashboard_ai (tenant_id, run_id, document_id, page, kind, request_id, position, figures_hash, figures, model_text, text, status, figure_check, check_note, model)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [tenantId, runId, documentId, page, kind, requestId, position++, figuresHash, JSON.stringify(figures), d.modelText, d.text, d.status, JSON.stringify(d.check), d.note, CLAUDE_MODEL],
      );
    }
    const rows = await client.query<Row>(
      `select ${COLUMNS} from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 and kind = $5 order by position, created_at`,
      [tenantId, runId, documentId, page, kind],
    );
    return rows.rows.map((r) => draftOf(r, figuresHash));
  });
}

export type GenerateResult = { ok: true; drafts: AiDraft[]; superseded: false; refused: number } | { ok: true; superseded: true } | { ok: false; error: string };

/** Drafts AI insights for one page (see the file comment). */
export async function generatePageInsights(tenantId: string, runId: string, documentId: string, pageId: unknown): Promise<GenerateResult> {
  const def = dashboardCardDef(pageId);
  if (!def) return { ok: false, error: "That dashboard page is not known." };
  const page = await loadPageFigures(tenantId, runId, documentId, def.page.id);
  const figures = page.cards.filter((c) => c.status === "ok").flatMap((c) => c.figures);
  if (figures.every((f) => f.value === null)) return { ok: false, error: "This page has no figures to draft insights from." };
  const started = await startRequest(tenantId, runId, documentId, page.page, "insight");
  if (typeof started !== "string") return { ok: false, error: STORY_UNAVAILABLE };
  const figuresHash = figuresHashOf(figures, page.ctx);
  let input: Record<string, unknown>;
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: insightSystemPrompt(),
      tools: [insightTool],
      tool_choice: { type: "tool", name: INSIGHT_TOOL },
      messages: [{ role: "user", content: insightUserPrompt(page) }],
    });
    await logApiUsage(tenantId, runId, "dashboard_insights", response.usage);
    input = finishedToolInput(response, INSIGHT_TOOL, "Drafting AI insights");
  } catch (e) {
    return { ok: false, error: e instanceof UnfinishedModelResultError ? e.message : `The AI insights could not be drafted: ${e instanceof Error ? e.message : String(e)}` };
  }
  const items = Array.isArray(input.insights) ? input.insights : null;
  if (!items) return { ok: false, error: "Drafting AI insights returned a result in the wrong shape, so nothing from it was used. Try again." };
  const sources = [pageEvidenceText(figures)];
  const drafts: NewDraft[] = items.slice(0, MAX_INSIGHTS).flatMap((it): NewDraft[] => {
    const title = typeof (it as { title?: unknown })?.title === "string" ? (it as { title: string }).title.trim() : "";
    const body = typeof (it as { text?: unknown })?.text === "string" ? (it as { text: string }).text.trim() : "";
    if (!body) return [];
    const model = title ? `${title.replace(/[.:]+$/, "")}: ${body}` : body;
    const c = checkDraft(model, sources, figures);
    return [{ text: c.text, modelText: model, status: c.status === "refused" ? "refused" : "draft", check: c.check, note: c.note }];
  });
  if (drafts.length === 0) return { ok: false, error: "Drafting AI insights returned no usable insight, so nothing was changed. Try again." };
  const published = await publishGeneration(tenantId, runId, documentId, page.page, "insight", started, figuresHash, pageModelInput(page), drafts);
  if (published === null) return { ok: true, superseded: true };
  return { ok: true, superseded: false, drafts: published, refused: drafts.filter((d) => d.status === "refused").length };
}

/** A page's drafts, each marked stale when the page's figures changed since it was drafted. */
export async function loadPageInsights(tenantId: string, runId: string, documentId: string, pageId: unknown): Promise<{ ok: true; drafts: AiDraft[]; figuresHash: string } | { ok: false; error: string }> {
  const def = dashboardCardDef(pageId);
  if (!def) return { ok: false, error: "That dashboard page is not known." };
  const page = await loadPageFigures(tenantId, runId, documentId, def.page.id);
  const figuresHash = figuresHashOf(page.cards.filter((c) => c.status === "ok").flatMap((c) => c.figures), page.ctx);
  return withTenantRead(tenantId, async (client) => {
    if (!(await storyStorageAvailable(client))) return { ok: false as const, error: STORY_UNAVAILABLE };
    const r = await client.query<Row>(
      `select ${COLUMNS} from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 and kind = 'insight' order by position, created_at`,
      [tenantId, runId, documentId, page.page],
    );
    return { ok: true as const, drafts: r.rows.map((x) => draftOf(x, figuresHash)), figuresHash };
  });
}

export type DecideResult = { ok: true; draft: AiDraft } | { ok: false; error: string; conflict?: true };

/** Accept, discard or reopen one draft; a compare-and-swap on the revision the screen read. A refused draft cannot
 * be accepted, and neither can a stale one (its figures are no longer the page's). */
export async function decideDraft(tenantId: string, runId: string, id: string, action: unknown, revision: unknown, currentHash: string | null): Promise<DecideResult> {
  if (action !== "accept" && action !== "discard" && action !== "reopen") return { ok: false, error: "Choose accept, discard or reopen." };
  if (!Number.isInteger(revision)) return { ok: false, error: "The draft's state is not valid. Reload and try again." };
  return withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    if (!(await storyStorageAvailable(client))) return { ok: false as const, error: STORY_UNAVAILABLE };
    const cur = await client.query<Row>(`select ${COLUMNS} from tracker_dashboard_ai where id = $1 and run_id = $2 and tenant_id = $3 for update`, [id, runId, tenantId]);
    const row = cur.rows[0];
    if (!row) return { ok: false as const, error: "That draft no longer exists. Reload to see the current drafts." };
    if (row.revision !== revision) return { ok: false as const, conflict: true as const, error: "This draft was changed since you opened it, so nothing was changed. The current version is shown." };
    if (action === "accept" && row.status === "refused") return { ok: false as const, error: "A refused draft cannot be accepted. Edit it so every figure is the page's, or discard it." };
    if (action === "accept" && currentHash !== null && row.figures_hash !== currentHash) return { ok: false as const, error: "The page's figures changed since this was drafted, so it cannot be accepted. Draft the insights again." };
    const status: AiStatus = action === "accept" ? "accepted" : action === "discard" ? "discarded" : "draft";
    const r = await client.query<Row>(
      `update tracker_dashboard_ai set status = $4, revision = revision + 1, updated_at = now(), decided_at = now()
        where id = $1 and run_id = $2 and tenant_id = $3 returning ${COLUMNS}`,
      [id, runId, tenantId, status],
    );
    return { ok: true as const, draft: draftOf(r.rows[0], currentHash) };
  });
}

/** The figures a draft may use, from what it was drafted from: a page's model input, or a summary's inputs. */
function sourcesOfStored(figures: unknown): { sources: string[]; figures: DashboardFigure[] } {
  const f = figures as { cards?: { figures?: ModelFigure[] }[]; inputs?: { text: string }[] } | null;
  if (f && Array.isArray(f.inputs)) return { sources: f.inputs.map((i) => i.text), figures: [] };
  const list: DashboardFigure[] = (f?.cards ?? []).flatMap((c) =>
    (c.figures ?? []).map((m, i) => ({
      key: String(i),
      label: m.label,
      value: m.value,
      unit: m.unit === "%" ? ("percent" as const) : m.unit === "percentage points" ? ("points" as const) : ("brands" as const),
      base: m.base,
      baseLabel: m.baseOf,
      ...(m.smallBase ? { smallBase: m.smallBase.startsWith("very") ? ("very_small" as const) : ("small" as const) } : {}),
      ...(m.significant !== undefined ? { significant: m.significant } : {}),
    })),
  );
  return { sources: [pageEvidenceText(list)], figures: list };
}

/** The researcher's wording for a draft, checked like a drafted one against what the draft was drafted from; an
 * unsupported number is refused and nothing is saved. An accepted draft returns to draft, so new wording is accepted
 * explicitly. Compare-and-swap on the revision. */
export async function editDraft(tenantId: string, runId: string, id: string, textRaw: unknown, revision: unknown): Promise<DecideResult> {
  const text = typeof textRaw === "string" ? textRaw.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "Write the insight's wording first." };
  if (text.length > 1200) return { ok: false, error: "That is too long for one insight; keep it to two or three sentences." };
  if (!Number.isInteger(revision)) return { ok: false, error: "The draft's state is not valid. Reload and try again." };
  return withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    if (!(await storyStorageAvailable(client))) return { ok: false as const, error: STORY_UNAVAILABLE };
    const cur = await client.query<Row>(`select ${COLUMNS} from tracker_dashboard_ai where id = $1 and run_id = $2 and tenant_id = $3 for update`, [id, runId, tenantId]);
    const row = cur.rows[0];
    if (!row) return { ok: false as const, error: "That draft no longer exists. Reload to see the current drafts." };
    if (row.revision !== revision) return { ok: false as const, conflict: true as const, error: "This draft was changed since you opened it, so your edit was not saved. The current version is shown; copy your wording from the box." };
    const { sources, figures } = sourcesOfStored(row.figures);
    const c = checkDraft(text, sources, figures, { absent: row.kind === "conclusions" ? "needs_review" : "unsupported" });
    if (c.status === "refused") return { ok: false as const, error: `Not saved. ${c.note}` };
    const r = await client.query<Row>(
      `update tracker_dashboard_ai set text = $4, human_edited = true, status = case when status = 'accepted' or status = 'refused' then 'draft' else status end,
              figure_check = $5, check_note = $6, revision = revision + 1, updated_at = now()
        where id = $1 and run_id = $2 and tenant_id = $3 returning ${COLUMNS}`,
      [id, runId, tenantId, c.text, JSON.stringify(c.check), c.note],
    );
    return { ok: true as const, draft: draftOf(r.rows[0], null) };
  });
}

/** Posts an accepted, current AI insight as a finding (dashboardFindings.ts) and records the finding on the draft. */
export async function postInsightAsFinding(tenantId: string, runId: string, documentId: string, id: string): Promise<{ ok: true; findingId: string; added: boolean } | { ok: false; error: string }> {
  const row = await withTenantRead(tenantId, async (client) => {
    if (!(await storyStorageAvailable(client))) return null;
    const r = await client.query<Row & { document_id: string }>(`select ${COLUMNS}, document_id from tracker_dashboard_ai where id = $1 and run_id = $2 and tenant_id = $3`, [id, runId, tenantId]);
    return r.rows[0] ?? null;
  });
  if (!row) return { ok: false, error: "That AI insight is not available." };
  if (row.document_id !== documentId) return { ok: false, error: "That AI insight belongs to another data file." };
  if (row.kind !== "insight") return { ok: false, error: "Only an AI insight can be posted as a finding." };
  if (row.status !== "accepted") return { ok: false, error: "Accept the insight before posting it as a finding." };
  const page = await loadPageFigures(tenantId, runId, documentId, row.page);
  const current = figuresHashOf(page.cards.filter((c) => c.status === "ok").flatMap((c) => c.figures), page.ctx);
  if (current !== row.figures_hash) return { ok: false, error: "The page's figures changed since this insight was drafted, so it was not posted. Draft the insights again." };
  const posted = await postDashboardInsightFinding(tenantId, runId, documentId, { id: row.id, text: row.text, figuresHash: row.figures_hash, figureCheck: row.figure_check }, { id: page.page, title: page.title, ctx: page.ctx, cards: page.cards });
  if (!posted.ok) return posted;
  await withTenant(tenantId, async (client) => {
    await assertRunOwned(client, tenantId, runId);
    await client.query("update tracker_dashboard_ai set finding_id = $4, updated_at = now() where id = $1 and run_id = $2 and tenant_id = $3", [id, runId, tenantId, posted.findingId]);
  });
  return { ok: true, findingId: posted.findingId, added: posted.added };
}

// ------------------------------------------------------------------------------------------------ summary and conclusions

export type StoryInput = { kind: "insight" | "finding"; id: string; page: string; text: string };

/**
 * What an executive summary or conclusions may be drafted from: this data file's accepted, current AI insights and its
 * accepted dashboard findings that are neither marked for review nor superseded. Never drafts, never stale material.
 */
export async function loadStoryInputs(tenantId: string, runId: string, documentId: string, currentHashes: Map<string, string>): Promise<StoryInput[]> {
  return withTenantRead(tenantId, async (client) => {
    const out: StoryInput[] = [];
    if (await storyStorageAvailable(client)) {
      const r = await client.query<{ id: string; page: string; text: string; figures_hash: string }>(
        `select id, page, text, figures_hash from tracker_dashboard_ai
          where tenant_id = $1 and run_id = $2 and document_id = $3 and kind = 'insight' and status = 'accepted' order by page, position`,
        [tenantId, runId, documentId],
      );
      for (const x of r.rows) if (currentHashes.get(x.page) === x.figures_hash) out.push({ kind: "insight", id: x.id, page: x.page, text: x.text });
    }
    const f = await client.query<{ id: string; page: string; text: string }>(
      `select id, stated_stats->>'page' as page, finding_text as text from findings
        where run_id = $1 and tenant_id = $2 and stated_stats->>'source' = $3 and stated_stats->>'documentId' = $4 and status = 'accepted'
          and stated_stats->>'kind' = 'card'
          and not coalesce(stated_stats->'caveats', '[]'::jsonb) ?| array[$5, $6]
        order by created_at, id`,
      [runId, tenantId, DASHBOARD_SOURCE, documentId, SOURCE_CHANGED_TAG, SUPERSEDED_TAG],
    );
    for (const x of f.rows) out.push({ kind: "finding", id: x.id, page: x.page, text: x.text });
    return out;
  });
}

export function storyInputsHash(inputs: StoryInput[]): string {
  return sha256Of(stableJson(inputs.map((i) => [i.kind, i.id, i.text])));
}

/** Drafts the executive summary or the conclusions; refused, with the reason, when nothing is accepted. */
export async function draftModuleStory(tenantId: string, runId: string, documentId: string, kindRaw: unknown, currentHashes: Map<string, string>): Promise<GenerateResult> {
  if (kindRaw !== "summary" && kindRaw !== "conclusions") return { ok: false, error: "Choose the executive summary or the conclusions." };
  const kind = kindRaw;
  const inputs = await loadStoryInputs(tenantId, runId, documentId, currentHashes);
  if (inputs.length === 0)
    return { ok: false, error: `Nothing is accepted yet, so no ${kind === "summary" ? "executive summary" : "conclusions"} can be drafted. Accept AI insights or post cards as findings first.` };
  const started = await startRequest(tenantId, runId, documentId, MODULE_PAGE, kind);
  if (typeof started !== "string") return { ok: false, error: STORY_UNAVAILABLE };
  const hash = storyInputsHash(inputs);
  let input: Record<string, unknown>;
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: storySystemPrompt(kind),
      tools: [storyTool],
      tool_choice: { type: "tool", name: STORY_TOOL },
      messages: [
        {
          role: "user",
          content: `The accepted insights and findings, as data:\n${wrapUploadedContent("accepted dashboard insights and findings", inputs.map((i, n) => `${n + 1}. ${i.text}`).join("\n"))}\n\nDraft the ${kind === "summary" ? "executive summary" : "conclusions and recommendations"} with the ${STORY_TOOL} tool.`,
        },
      ],
    });
    await logApiUsage(tenantId, runId, "dashboard_story", response.usage);
    input = finishedToolInput(response, STORY_TOOL, kind === "summary" ? "Drafting the executive summary" : "Drafting the conclusions");
  } catch (e) {
    return { ok: false, error: e instanceof UnfinishedModelResultError ? e.message : `The draft could not be written: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return { ok: false, error: "The draft came back empty, so nothing was changed. Try again." };
  // Every number must be one of the accepted inputs' (recommended targets in conclusions need review, not refusal).
  const c = checkDraft(text, inputs.map((i) => i.text), [], { absent: kind === "conclusions" ? "needs_review" : "unsupported" });
  const published = await publishGeneration(tenantId, runId, documentId, MODULE_PAGE, kind, started, hash, { inputs }, [
    { text: c.text, modelText: text, status: c.status === "refused" ? "refused" : "draft", check: c.check, note: c.note },
  ]);
  if (published === null) return { ok: true, superseded: true };
  return { ok: true, superseded: false, drafts: published, refused: c.status === "refused" ? 1 : 0 };
}

/** The module's summary and conclusions drafts, each stale when the accepted inputs changed since drafting. */
export async function loadModuleStory(tenantId: string, runId: string, documentId: string, currentHashes: Map<string, string>): Promise<{ ok: true; drafts: AiDraft[]; inputs: StoryInput[] } | { ok: false; error: string }> {
  const inputs = await loadStoryInputs(tenantId, runId, documentId, currentHashes);
  const hash = storyInputsHash(inputs);
  return withTenantRead(tenantId, async (client) => {
    if (!(await storyStorageAvailable(client))) return { ok: false as const, error: STORY_UNAVAILABLE };
    const r = await client.query<Row>(
      `select ${COLUMNS} from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 and page = $4 order by kind, position, created_at`,
      [tenantId, runId, documentId, MODULE_PAGE],
    );
    return { ok: true as const, drafts: r.rows.map((x) => draftOf(x, hash)), inputs };
  });
}

/** Every page's current figures hash, for the summary's and the export's staleness. */
export function pageHashesOf(pages: PageFigures[]): Map<string, string> {
  return new Map(pages.map((p) => [p.page, figuresHashOf(p.cards.filter((c) => c.status === "ok").flatMap((c) => c.figures), p.ctx)]));
}

/** Every draft of this data file (all pages and the module), for the export. */
export async function loadAllDrafts(tenantId: string, runId: string, documentId: string): Promise<{ available: boolean; rows: (Omit<AiDraft, "stale">)[] }> {
  return withTenantRead(tenantId, async (client) => {
    if (!(await storyStorageAvailable(client))) return { available: false, rows: [] };
    const r = await client.query<Row>(`select ${COLUMNS} from tracker_dashboard_ai where tenant_id = $1 and run_id = $2 and document_id = $3 order by page, kind, position, created_at`, [tenantId, runId, documentId]);
    return { available: true, rows: r.rows.map((x) => { const { stale: _s, ...rest } = draftOf(x, null); void _s; return rest; }) };
  });
}

// Research Quality Review v1: the one view model the screen and the DOCX export both use
// (brief sections 2, 6 and 8). Read-only and model-free.
//
// Freshness: every observation is compared with the CURRENT state of the sources its review
// pinned. A replaced, re-read, removed or purged source, or changed roles, makes the observations
// that rest on it "requires review"; observations resting only on unchanged sources keep their
// recorded currency. When the comparison itself cannot be made, the answer is "could not check",
// never "current" and never "changed".
// Researcher state: acceptance, dismissal and wording belong to one observation VERSION. When a
// newer review produced a new version, the earlier decision and wording are shown as history and
// the new version is "awaiting review"; nothing is carried over silently.
import { DASHBOARDS, reviewDashboards, type DashboardView } from "./researchQualityDashboard";
import { findChecklist, gapRecommendations, scoreChecklist, type ChecklistScore, type ElementResult, type ElementStatus, type GapRecommendation } from "./researchQualityChecklist";
import type { PoolClient } from "pg";
import type { UnverifiedEvidence } from "./researchQualityPresentation";
import { withTenantRead, withTenantRepeatableRead } from "./db";
import { CRITERIA, referenceCatalogue } from "./researchQualityRules";
import { assertModuleTables, assertRunOwned } from "./researchQualityRepository";
import {
  type DocumentedFact,
  type ObservationPayload,
  type ReviewManifest,
  type SourceRole,
  type ReviewKind,
} from "./researchQualityTypes";

export type Freshness = "current" | "requires_review" | "could_not_check";
export type ObservationStatus = "awaiting_review" | "accepted" | "dismissed";

export type ObservationView = {
  observationId: string;
  versionId: string;
  revision: number;
  criterionId: string;
  question: string;
  group: string;
  payload: ObservationPayload;
  freshness: Freshness;
  freshnessReason: string | null;
  status: ObservationStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  wording: { text: string; by: string | null; at: string } | null;
  comments: { text: string; by: string | null; at: string }[];
  previous: { reviewSequence: number; status: ObservationStatus; wording: string | null; generatedImplication: string } | null;
};

export type ReviewSummary = {
  id: string;
  sequence: number;
  /** null for a review made before review kinds (2026-10-19): readable, in the older format. */
  kind: ReviewKind | null;
  /** The documents reviewed, with the role each had (for the document list). */
  sources: { documentId: string | null; filename: string; roles: SourceRole[] }[];
  state: "pending" | "running" | "complete" | "partial" | "failed";
  mode: string;
  studyType: string;
  purpose: string;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number;
  criteriaRelease: string;
  referencesRelease: string;
  syntheticReferences: boolean;
  model: string;
  promptVersion: string;
};

export type ResearchQualityView = {
  available: true;
  documents: { id: string; filename: string; kind: string; source: { sourceId: string; roles: SourceRole[]; revision: number; versions: number; currentVersion: { id: string; ordinal: number; extractor: string; charCount: number; purged: boolean } | null } | null }[];
  detachedSources: { sourceId: string; roles: SourceRole[]; filename: string | null; purged: boolean }[];
  candidates: { decisions: { id: string; text: string }[]; objectives: { id: string; text: string }[] };
  clarifications: { entryId: string; text: string; by: string | null; at: string }[];
  reviews: ReviewSummary[];
  review: null | (ReviewSummary & {
    manifest: ReviewManifest;
    coverage: { facts?: number; coverageComplete?: boolean; tasks?: { key: string; stage: string; status: string; attempts: number; maxAttempts: number; error: string | null; validation: unknown }[] };
    sourceFreshness: { sourceId: string; filename: string; status: "current" | "changed" | "removed" | "purged" | "could_not_check"; detail: string }[];
    newClarifications: number;
    facts: DocumentedFact[];
    observations: ObservationView[];
    referencePassages: { referenceId: string; passageId: string; title: string; text: string; synthetic: boolean }[];
    progress: ReviewProgress;
    checklists: ChecklistView[];
    /** Why no checklist was run, when none was: the migration was missing, or the review predates it. */
    checklistNote: string | null;
    /** Bird's-eye dashboards (researchQualityDashboard.ts), computed from the stored ratings. */
    dashboards: DashboardView[];
    /** Why there is no dashboard, when a document type has one but this review shows none. */
    dashboardNote: string | null;
    /** Codex RQ-F01: per document, quotes left out because they could not be verified (none listed when all were). */
    unverifiedEvidence: UnverifiedEvidence[];
  });
};

/**
 * One document scored against one checklist. Statuses come from the model, validated by code; every
 * number here is computed by researchQualityChecklist.ts from those statuses. `state` follows the
 * checklist task: a failed or unfinished step shows no score rather than a zero.
 */
export type ChecklistView = {
  taskKey: string;
  sourceId: string;
  filename: string;
  checklistId: string;
  label: string;
  basis: string;
  state: "scored" | "failed" | "pending";
  error: string | null;
  score: ChecklistScore | null;
  sections: {
    sectionId: string;
    label: string;
    elements: { elementId: string; label: string; essential: boolean; status: ElementStatus | null; reason: string; notAssessedBecause: string | null; quotes: { factId: string; quote: string; fromBrief: boolean }[] }[];
  }[];
  gaps: GapRecommendation[];
};

/**
 * Live progress of a review's steps, read from the task rows (the stored coverage is written only
 * when a run finishes). `interrupted` is true when the review still says pending or running but no
 * step is being worked on: nothing holds a live lease and nothing has moved for INTERRUPTED_AFTER
 * seconds. That is what a server restart or an unexpected error mid-run leaves behind; the screen
 * says so and offers to continue, instead of showing "reviewing" for ever.
 */
export type ReviewProgress = { total: number; done: number; failed: number; working: number; waiting: number; interrupted: boolean };
export const INTERRUPTED_AFTER_SECONDS = 120;

/** Quotes left out as unverifiable, summed per document over its succeeded extraction steps. */
export function unverifiedEvidenceBySource(
  rows: { result: { input?: { sourceIndex?: number }; facts?: unknown[] } | null; validation: { droppedUnverifiableQuotes?: unknown } | null }[],
  manifest: Pick<ReviewManifest, "sources">,
): UnverifiedEvidence[] {
  const bySource = new Map<number, UnverifiedEvidence>();
  for (const row of rows) {
    const i = row.result?.input?.sourceIndex;
    const src = i === undefined ? undefined : manifest.sources[i];
    if (i === undefined || !src) continue;
    const entry = bySource.get(i) ?? { filename: src.filename, rejected: 0, kept: 0 };
    entry.rejected += Math.max(0, Number(row.validation?.droppedUnverifiableQuotes ?? 0) || 0);
    entry.kept += Array.isArray(row.result?.facts) ? row.result!.facts!.length : 0;
    bySource.set(i, entry);
  }
  return [...bySource.entries()].sort(([a], [b]) => a - b).map(([, e]) => e).filter((e) => e.rejected > 0);
}

function checklistViews(
  tasks: { task_key: string; status: string; error: string | null; result: { input?: { sourceIndex?: number; checklistId?: string }; elements?: ElementResult[] } | null }[],
  manifest: ReviewManifest,
  facts: DocumentedFact[],
): ChecklistView[] {
  const byFact = new Map(facts.map((f) => [f.factId, f]));
  return tasks.flatMap((t) => {
    const input = t.result?.input ?? {};
    const checklist = findChecklist(input.checklistId ?? "");
    const src = manifest.sources[input.sourceIndex ?? -1];
    if (!checklist || !src) return [];
    const results = t.status === "succeeded" ? (t.result?.elements ?? []) : [];
    const byId = new Map(results.map((r) => [r.elementId, r]));
    return [
      {
        taskKey: t.task_key,
        sourceId: src.sourceId,
        filename: src.filename,
        checklistId: checklist.checklistId,
        label: checklist.label,
        basis: checklist.basis,
        state: t.status === "succeeded" ? "scored" : t.status === "failed" ? "failed" : "pending",
        error: t.error,
        score: t.status === "succeeded" ? scoreChecklist(checklist, results) : null,
        sections: checklist.sections.map((sec) => ({
          sectionId: sec.sectionId,
          label: sec.label,
          elements: sec.elements.map((e) => {
            const r = byId.get(e.elementId);
            return {
              elementId: e.elementId,
              label: e.label,
              essential: e.essential,
              status: r?.status ?? null,
              reason: r?.reason ?? "",
              notAssessedBecause: r?.notAssessedBecause ?? null,
              quotes: (r?.factIds ?? []).flatMap((id) => {
                const f = byFact.get(id);
                return f ? [{ factId: id, quote: f.exactQuote, fromBrief: f.sourceVersionId !== src.sourceVersionId }] : [];
              }),
            };
          }),
        })),
        gaps: t.status === "succeeded" ? gapRecommendations(checklist, results) : [],
      } satisfies ChecklistView,
    ];
  });
}

const entryAuthor = (email: string | null) => email ?? "single user (before sign-in)";

/** Loads the module view for a project, optionally for one review (default: the latest). */
export async function loadResearchQualityView(tenantId: string, runId: string, reviewId: string | null): Promise<ResearchQualityView> {
  return withTenantRepeatableRead(tenantId, async (client) => {
    await assertModuleTables(client);
    await assertRunOwned(client, tenantId, runId);
    const docs = (
      await client.query<{ id: string; source_filename: string; kind: string }>(`select id, source_filename, kind from documents where run_id = $1 order by uploaded_at`, [runId])
    ).rows;
    const sources = (
      await client.query<{ id: string; document_id: string | null; roles: SourceRole[]; revision: number; current_version_id: string | null; versions: number; ordinal: number | null; extractor: string | null; char_count: number | null; purged_at: string | null; filename: string | null }>(
        `select s.id, s.document_id, s.roles, s.revision, s.current_version_id,
                (select count(*)::int from research_quality_source_versions v where v.source_id = s.id) as versions,
                cv.ordinal, cv.extractor, cv.char_count, cv.purged_at::text, cv.filename
           from research_quality_sources s
           left join research_quality_source_versions cv on cv.id = s.current_version_id
          where s.run_id = $1`,
        [runId],
      )
    ).rows;
    const decisions = (await client.query<{ id: string; candidate_text: string }>(`select id, candidate_text from decision_candidates where run_id = $1 and status = 'accepted' order by created_at`, [runId])).rows;
    const objectives = (await client.query<{ id: string; candidate_text: string }>(`select id, candidate_text from objective_candidates where run_id = $1 and status = 'accepted' order by created_at`, [runId])).rows;
    const clar = (
      await client.query<{ id: string; body: string; actor_email: string | null; created_at: string }>(
        `select id, body, actor_email, created_at::text from research_quality_researcher_entries where run_id = $1 and kind = 'clarification' order by created_at, id`,
        [runId],
      )
    ).rows;
    const reviewRows = (await client.query(`select * from research_quality_reviews where run_id = $1 order by sequence desc`, [runId])).rows as Record<string, unknown>[];
    const summary = (r: Record<string, unknown>): ReviewSummary => ({
      id: r.id as string,
      sequence: r.sequence as number,
      kind: (r.manifest as ReviewManifest).kind ?? null,
      sources: ((r.manifest as ReviewManifest).sources ?? []).map((x) => ({ documentId: x.documentId, filename: x.filename, roles: x.roles })),
      state: r.state as ReviewSummary["state"],
      mode: r.mode as string,
      studyType: r.study_type as string,
      purpose: r.purpose as string,
      createdAt: String(r.created_at instanceof Date ? (r.created_at as Date).toISOString() : r.created_at),
      completedAt: r.completed_at ? String(r.completed_at instanceof Date ? (r.completed_at as Date).toISOString() : r.completed_at) : null,
      createdBy: (r.created_by_email as string | null) ?? null,
      estimatedCostUsd: r.estimated_cost_usd === null ? null : Number(r.estimated_cost_usd),
      actualCostUsd: Number(r.actual_cost_usd),
      criteriaRelease: r.criteria_release as string,
      referencesRelease: r.references_release as string,
      syntheticReferences: (r.manifest as ReviewManifest).referenceCatalogue?.kind === "synthetic_test",
      model: r.model as string,
      promptVersion: r.prompt_version as string,
    });
    const view: ResearchQualityView = {
      available: true,
      documents: docs.map((d) => {
        const s = sources.find((x) => x.document_id === d.id);
        return {
          id: d.id,
          filename: d.source_filename,
          kind: d.kind,
          source: s
            ? { sourceId: s.id, roles: s.roles, revision: s.revision, versions: s.versions, currentVersion: s.current_version_id ? { id: s.current_version_id, ordinal: s.ordinal!, extractor: s.extractor!, charCount: s.char_count!, purged: !!s.purged_at } : null }
            : null,
        };
      }),
      detachedSources: sources.filter((s) => !s.document_id).map((s) => ({ sourceId: s.id, roles: s.roles, filename: s.filename, purged: !!s.purged_at })),
      candidates: { decisions: decisions.map((d) => ({ id: d.id, text: d.candidate_text })), objectives: objectives.map((o) => ({ id: o.id, text: o.candidate_text })) },
      clarifications: clar.map((c) => ({ entryId: c.id, text: c.body, by: entryAuthor(c.actor_email), at: c.created_at })),
      reviews: reviewRows.map(summary),
      review: null,
    };
    const chosen = reviewId ? reviewRows.find((r) => r.id === reviewId) : reviewRows[0];
    if (!chosen) return view;
    const manifest = chosen.manifest as ReviewManifest;
    const progress = (
      await client.query<{ total: number; done: number; failed: number; working: number; waiting: number; idle: boolean }>(
        `select count(*)::int as total,
                count(*) filter (where status = 'succeeded')::int as done,
                count(*) filter (where status = 'failed')::int as failed,
                count(*) filter (where status = 'running' and lease_expires_at > clock_timestamp())::int as working,
                count(*) filter (where status = 'pending' or (status = 'running' and lease_expires_at <= clock_timestamp()))::int as waiting,
                coalesce(max(updated_at), now()) < clock_timestamp() - make_interval(secs => $2) as idle
           from research_quality_tasks where review_id = $1`,
        [chosen.id, INTERRUPTED_AFTER_SECONDS],
      )
    ).rows[0];
    const active = chosen.state === "pending" || chosen.state === "running";
    view.review = {
      ...summary(chosen),
      manifest,
      coverage: (chosen.coverage ?? {}) as never,
      sourceFreshness: [],
      newClarifications: clar.filter((c) => !manifest.clarificationIds.includes(c.id)).length,
      facts: [],
      observations: [],
      referencePassages: [],
      checklists: [],
      checklistNote: null,
      dashboards: [],
      dashboardNote: null,
      unverifiedEvidence: [],
      progress: { total: progress.total, done: progress.done, failed: progress.failed, working: progress.working, waiting: progress.waiting, interrupted: active && progress.working === 0 && progress.idle },
    };
    view.review.sourceFreshness = await sourceFreshness(client, manifest);
    // Read from the task rows themselves (as `progress` is), so a review saved before RQ-F01, whose
    // all-rejected extraction was published as succeeded, is qualified too.
    const extractRows = (
      await client.query<{ result: { input?: { sourceIndex?: number }; facts?: unknown[] } | null; validation: { droppedUnverifiableQuotes?: unknown } | null }>(
        `select result, validation from research_quality_tasks where review_id = $1 and stage = 'extract' and status = 'succeeded' order by task_key`,
        [chosen.id],
      )
    ).rows;
    view.review.unverifiedEvidence = unverifiedEvidenceBySource(extractRows, manifest);
    view.review.facts = await reviewFacts(client, chosen.id as string, manifest);
    const checklistTasks = (
      await client.query<{ task_key: string; status: string; error: string | null; result: { input?: { sourceIndex?: number; checklistId?: string }; elements?: ElementResult[] } | null }>(
        `select task_key, status, error, result from research_quality_tasks where review_id = $1 and stage = 'checklist' order by task_key`,
        [chosen.id],
      )
    ).rows;
    view.review.checklists = checklistViews(checklistTasks, manifest, view.review.facts);
    view.review.checklistNote =
      checklistTasks.length > 0 || manifest.kind
        ? null
        : checklistTasks.length > 0
        ? null
        : manifest.checklistRelease === undefined
          ? "This review was made before the scored checklist existed. Start a new review version to score the documents."
          : manifest.checklistRelease === null
            ? "The scored checklist needs database migration 0106. Apply it, then start a new review version."
            : "None of the selected documents has a role with a checklist (brief, proposal, questionnaire, methodology, report or fieldwork).";
    view.review.observations = await reviewObservations(client, runId, chosen.id as string, chosen.sequence as number, view.review.sourceFreshness);
    const assessTasks = new Map(
      (await client.query<{ task_key: string; status: string }>(`select task_key, status from research_quality_tasks where review_id = $1 and stage = 'assess'`, [chosen.id])).rows.map((t) => [t.task_key, t.status]),
    );
    const selectedCriteria = manifest.criteria.filter((c) => c.status === "selected").map((c) => c.criterionId);
    view.review.dashboards = reviewDashboards({
      criteriaRelease: view.review.criteriaRelease,
      selectedCriteria,
      observations: view.review.observations,
      assessState: (criterionId) => {
        const group = CRITERIA.criteria.find((c) => c.criterionId === criterionId)?.group;
        const status = group ? assessTasks.get(`assess:${group}`) : undefined;
        return status === "succeeded" ? "done" : status === "failed" ? "failed" : "pending";
      },
    });
    view.review.dashboardNote =
      view.review.dashboards.length === 0 && DASHBOARDS.some((d) => d.criteria.some((c) => selectedCriteria.includes(c)))
        ? `This review was made with criteria release ${view.review.criteriaRelease}, before the dashboard. Start a new review version to see it.`
        : null;
    const cat = referenceCatalogue();
    const usedRefs = new Set(view.review.observations.flatMap((o) => o.payload.methodologicalReferenceRefs.map((r) => `${r.referenceId}:${r.passageId}`)));
    view.review.referencePassages = cat.entries.flatMap((e) =>
      (e.passages as { passageId: string; text: string }[])
        .filter((p) => usedRefs.has(`${e.referenceId}:${p.passageId}`))
        .map((p) => ({ referenceId: e.referenceId, passageId: p.passageId, title: e.title, text: (e.permissions as { reproduceInExport: boolean }).reproduceInExport ? p.text : "(text not reproduced: see the cited source)", synthetic: cat.kind === "synthetic_test" })),
    );
    return view;
  });
}

async function sourceFreshness(client: PoolClient, manifest: ReviewManifest): Promise<NonNullable<ResearchQualityView["review"]>["sourceFreshness"]> {
  try {
    const ids = manifest.sources.map((s) => s.sourceId);
    const rows = (
      await client.query<{ id: string; document_id: string | null; roles: SourceRole[]; current_version_id: string | null; purged: boolean }>(
        `select s.id, s.document_id, s.roles, s.current_version_id,
                exists (select 1 from research_quality_source_versions v where v.source_id = s.id and v.purged_at is not null) as purged
           from research_quality_sources s where s.id = any($1::uuid[])`,
        [ids],
      )
    ).rows;
    return manifest.sources.map((m) => {
      const cur = rows.find((r) => r.id === m.sourceId);
      if (!cur) return { sourceId: m.sourceId, filename: m.filename, status: "removed" as const, detail: "This source no longer exists." };
      if (cur.purged) return { sourceId: m.sourceId, filename: m.filename, status: "purged" as const, detail: "Its retained text was permanently purged." };
      if (!cur.document_id) return { sourceId: m.sourceId, filename: m.filename, status: "removed" as const, detail: "The project document was deleted; the review keeps its snapshot." };
      if (cur.current_version_id !== m.sourceVersionId) return { sourceId: m.sourceId, filename: m.filename, status: "changed" as const, detail: "A newer version of this document was read after this review." };
      if ([...cur.roles].sort().join() !== [...m.roles].sort().join()) return { sourceId: m.sourceId, filename: m.filename, status: "changed" as const, detail: "Its roles were corrected after this review." };
      return { sourceId: m.sourceId, filename: m.filename, status: "current" as const, detail: "Unchanged since this review." };
    });
  } catch (error) {
    console.error("[researchQualityView] freshness check failed:", error);
    return manifest.sources.map((m) => ({ sourceId: m.sourceId, filename: m.filename, status: "could_not_check" as const, detail: "Whether this source changed could not be checked." }));
  }
}

async function reviewFacts(client: PoolClient, reviewId: string, manifest: ReviewManifest): Promise<DocumentedFact[]> {
  const rows = (await client.query<{ task_key: string; result: { facts?: Omit<DocumentedFact, "factId">[] } | null }>(`select task_key, result from research_quality_tasks where review_id = $1 and stage = 'extract' and status = 'succeeded' order by task_key`, [reviewId])).rows;
  const facts: DocumentedFact[] = [];
  for (const r of rows) for (const f of r.result?.facts ?? []) if (manifest.sources.some((s) => s.sourceVersionId === f.sourceVersionId)) facts.push({ ...f, factId: `F${facts.length + 1}` });
  return facts;
}

async function reviewObservations(client: PoolClient, runId: string, reviewId: string, sequence: number, fresh: NonNullable<ResearchQualityView["review"]>["sourceFreshness"]): Promise<ObservationView[]> {
  const rows = (
    await client.query<{ observation_id: string; version_id: string; revision: number; criterion_id: string; payload: ObservationPayload; anchor: { sources: string[]; absence: string[] | null } }>(
      `select o.id as observation_id, v.id as version_id, o.revision, o.criterion_id, v.payload, o.anchor
         from research_quality_observation_versions v join research_quality_observations o on o.id = v.observation_id
        where v.review_id = $1 order by o.criterion_id, v.created_at`,
      [reviewId],
    )
  ).rows;
  if (rows.length === 0) return [];
  const entries = (
    await client.query<{ observation_id: string; observation_version_id: string | null; kind: string; body: string | null; actor_email: string | null; created_at: string }>(
      `select observation_id, observation_version_id, kind, body, actor_email, created_at::text
         from research_quality_researcher_entries where run_id = $1 and observation_id = any($2::uuid[]) order by created_at, id`,
      [runId, rows.map((r) => r.observation_id)],
    )
  ).rows;
  const earlier = (
    await client.query<{ observation_id: string; version_id: string; sequence: number; payload: ObservationPayload }>(
      `select distinct on (v.observation_id) v.observation_id, v.id as version_id, r.sequence, v.payload
         from research_quality_observation_versions v join research_quality_reviews r on r.id = v.review_id
        where v.observation_id = any($1::uuid[]) and r.sequence < $2
        order by v.observation_id, r.sequence desc`,
      [rows.map((r) => r.observation_id), sequence],
    )
  ).rows;
  const decisionFor = (versionId: string) => {
    const d = entries.filter((e) => e.observation_version_id === versionId && ["accept", "dismiss", "reopen"].includes(e.kind)).at(-1);
    const status: ObservationStatus = !d || d.kind === "reopen" ? "awaiting_review" : d.kind === "accept" ? "accepted" : "dismissed";
    const w = entries.filter((e) => e.observation_version_id === versionId && e.kind === "wording").at(-1);
    return { status, by: d ? entryAuthor(d.actor_email) : null, at: d?.created_at ?? null, wording: w && w.body ? { text: w.body, by: entryAuthor(w.actor_email), at: w.created_at } : null };
  };
  return rows.map((r) => {
    const crit = CRITERIA.criteria.find((c) => c.criterionId === r.criterion_id);
    const resting = r.anchor.sources?.length ? fresh.filter((f) => r.anchor.sources.includes(f.sourceId)) : fresh;
    const unknown = resting.some((f) => f.status === "could_not_check");
    const stale = resting.filter((f) => f.status !== "current" && f.status !== "could_not_check");
    const mine = decisionFor(r.version_id);
    const prev = earlier.find((e) => e.observation_id === r.observation_id);
    const prevState = prev ? decisionFor(prev.version_id) : null;
    return {
      observationId: r.observation_id,
      versionId: r.version_id,
      revision: r.revision,
      criterionId: r.criterion_id,
      question: crit?.assessmentQuestion ?? r.criterion_id,
      group: crit?.group ?? "other",
      payload: r.payload,
      freshness: stale.length ? "requires_review" : unknown ? "could_not_check" : "current",
      freshnessReason: stale.length ? stale.map((s) => `${s.filename}: ${s.detail}`).join(" ") : unknown ? "Whether its sources changed could not be checked." : null,
      status: mine.status,
      decidedBy: mine.by,
      decidedAt: mine.at,
      wording: mine.wording,
      comments: entries.filter((e) => e.observation_id === r.observation_id && e.kind === "comment" && e.body).map((e) => ({ text: e.body!, by: entryAuthor(e.actor_email), at: e.created_at })),
      previous: prev && prevState && (prevState.status !== "awaiting_review" || prevState.wording) ? { reviewSequence: prev.sequence, status: prevState.status, wording: prevState.wording?.text ?? null, generatedImplication: prev.payload.implication } : null,
    };
  });
}

/** Small read for the Import link: whether the module tables exist (no write, no model). */
export async function researchQualityAvailable(tenantId: string): Promise<boolean> {
  try {
    return await withTenantRead(tenantId, async (client) => (await client.query<{ ok: boolean }>(`select to_regclass('public.research_quality_reviews') is not null as ok`)).rows[0].ok);
  } catch {
    return false;
  }
}

import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { capWords, parseNumberedItems } from "./text";
import type { ConfidenceTier, QualityTier } from "./tiers";
import { currentItemKey, evidenceDigest } from "./objectiveEvidence";
import { coverageFingerprint, coverageIdentitySchema, readCoverageInputs } from "./objectiveCoverage";

type EvidenceInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
};

export type ValidationStatus = "resolved" | "partial" | "gap";

/** The inputs changed between reading them and saving the result (CE-1); nothing was written. */
export class CoverageInputsChangedError extends Error {}

export type ObjectiveValidation = {
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  status: ValidationStatus;
  conclusion: string;
  synthesized_insight_ids: string[];
  /** True for objectives the app inferred from this project's own evidence. */
  inferred: boolean;
  /** OBJ-REV-012: true when this conclusion was generated while evidenceDigest() reported a
   * real connection/permission failure reading objective_evidence (not the harmless "lane
   * hasn't run yet" case) - a durable, persisted record of degraded evidence retrieval, not
   * just the transient flag passed into that one generation call's own prompt. Always false
   * on a pre-migration-0087 database. */
  evidence_digest_degraded: boolean;
};

type RawItem = { kind: "objective" | "decision"; order: number; text: string; inferred?: boolean; candidateId: string | null };

// OBJ-REV-001/002 Rule B: evidenceDigest's map is keyed by the shared identity rule in
// objectiveEvidence.ts (evidenceIdentity / currentItemKey), so this lookup uses that same exported
// rule rather than a second copy that could drift: a candidate's evidence is found by its own id,
// a free-text line only by an explicitly free-text-origin row with the same kind, position and
// wording, and deleted-candidate or unknown-origin evidence by nothing.

/** Clears this run's objective_validations rows outright, used only when the actual
 * prerequisite they were assessed against (accepted insights, or any objective/decision
 * at all) has gone away - see the two call sites in generateObjectiveValidation. */
/** Appended to a conclusion that drew on direct data evidence (OBJ-REV-005). */
export const DIRECT_EVIDENCE_MULTIPLICITY_NOTE =
  "(Direct data evidence: 95% intervals, not corrected for the number of questions checked; weigh it, do not treat it as a verdict.)";

export async function clearObjectiveValidations(tenantId: string, runId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("delete from objective_validations where run_id = $1", [runId]);
  });
}

/**
 * Standard market-research reporting practice: every research objective and
 * every confirmed decision gets carried through to an explicit conclusion in
 * the final report, resolved, partially answered, or named as a gap, rather
 * than the reader having to infer from a pile of insights whether what the
 * project set out to answer actually got answered. This is that step.
 *
 * Deliberately run once, after synthesis, against the final accepted
 * insight set, not threaded earlier into finding extraction, insight
 * generation, or clustering. Locking those earlier stages to pre-set
 * objectives would be a deductive, framework-first move that risks exactly
 * what thematic-analysis methodology warns against: cross-cutting or
 * emergent patterns get force-fit into the nearest objective bucket, or
 * never surface at all if they don't fit one. Keeping discovery
 * objective-agnostic (as insightGenerator and insightSynthesizer already
 * do -- decision-relevance there is "a tiebreaker, not a strict filter")
 * and mapping against objectives only once, deductively, at the end, is
 * what makes an honest many-to-many mapping possible: one insight can
 * legitimately bear on several objectives, one objective can need several
 * insights, and some insights will bear on none of them, which is itself a
 * finding worth naming rather than silently folding into a pillar as if it
 * always belonged there.
 *
 * research_objective and decision_statement are each free text that may
 * contain one item or several numbered ones (the same shape addTitleSlide's
 * decision-line summary already parses with parseNumberedItems); each is
 * split into its own discrete items here so each one gets its own
 * conclusion rather than one blended verdict standing in for all of them.
 */
export async function generateObjectiveValidation(tenantId: string, runId: string): Promise<ObjectiveValidation[]> {
  // The inputs and their fingerprints come from one read, so the coverage records exactly what it was
  // assessed against (objectiveCoverage.ts, CE-1).
  const inputs = await withTenant(tenantId, (client) =>
    readCoverageInputs<EvidenceInsight>(client, runId, "si.id, si.headline, si.observation, si.tension, si.implication, si.confidence_tier, si.quality_tier"),
  );
  const run = inputs.runFound ? inputs.run : undefined;
  const { insights, objectives: candidates, decisions: decisionCandidates } = inputs;
  const assessedAgainst = coverageFingerprint(inputs);

  if (!run) {
    throw new Error("Project not found");
  }
  if (insights.length === 0) {
    // The prerequisite this lane assesses against is genuinely gone (every insight was
    // un-accepted, or none ever existed), not a transient failure - so the coverage from a
    // past, now-stale prerequisite must not keep being shown as if it were still current
    // (OBJ-REV-007: "missing prerequisites leave old coverage intact"). A model or
    // network failure further down this function leaves these rows alone; only the two
    // genuine prerequisite-gone cases here clear them.
    await clearObjectiveValidations(tenantId, runId);
    throw new Error(
      "No accepted synthesized insights yet. Run synthesis and accept at least one synthesized insight " +
        "before validating against the project's objectives and decisions."
    );
  }

  // Per accepted candidate when there are any, so inferred objectives can be
  // told apart from stated ones; otherwise fall back to the run's own text.
  // Decisions the app proposed from this project's own evidence are inferred
  // in exactly the same sense as inferred objectives: checking them against
  // that evidence is circular, so they get no verdict.
  const decisionRaw: RawItem[] =
    decisionCandidates.length > 0
      ? decisionCandidates.map(
          (c, order): RawItem => ({ kind: "decision", order, text: c.candidate_text, inferred: c.source === "ai_suggested", candidateId: c.id })
        )
      : parseNumberedItems(run.decision_statement).map(
          (text, order): RawItem => ({ kind: "decision", order, text, inferred: false, candidateId: null })
        );
  const objectiveRaw: RawItem[] =
    candidates.length > 0
      ? candidates.map(
          (c, order): RawItem => ({ kind: "objective", order, text: c.candidate_text, inferred: c.source === "ai_suggested", candidateId: c.id })
        )
      : parseNumberedItems(run.research_objective).map(
          (text, order): RawItem => ({ kind: "objective", order, text, inferred: false, candidateId: null })
        );
  const items: RawItem[] = [
    ...objectiveRaw,
    ...decisionRaw,
  ];

  if (items.length === 0) {
    // Same reasoning as the insights check above: the objectives/decisions this run's old
    // coverage was assessed against no longer exist, so that coverage is stale, not current.
    await clearObjectiveValidations(tenantId, runId);
    throw new Error(
      "This project has no research objective or confirmed decision recorded yet, there's nothing to " +
        "validate the insights against."
    );
  }

  // Direct evidence from the data file (objectiveEvidence.ts), when that lane has run:
  // a conclusion can then cite what the numbers show, not only what insights say.
  const { items: digest, degraded: evidenceDigestDegraded } = await evidenceDigest(tenantId, runId);
  const itemsBlock = items
    .map((item, index) => {
      const direct = digest.get(currentItemKey(item));
      return `${index}. [${item.kind}] ${item.text}${direct ? `\n   ${direct}` : ""}`;
    })
    .join("\n");

  const insightsBlock = insights
    .map(
      (insight, index) =>
        `${index}. (confidence: ${insight.confidence_tier ?? "not yet triangulated"}) Headline: ${insight.headline}\n` +
        `   Observation: ${insight.observation}\n   Implication: ${insight.implication}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You check whether a market research project's accepted, synthesized insights actually answer what " +
      "the project set out to answer. Below is a numbered list of this project's research objectives and " +
      "confirmed decisions (each one a separate item to judge on its own), and a numbered list of the " +
      "accepted synthesized insights available as evidence.\n\n" +
      "For every objective/decision item, decide:\n" +
      "- resolved: the evidence gives a clear, well-supported answer.\n" +
      "- partial: some relevant evidence exists, but it doesn't fully settle the question, or rests on " +
      "weaker (moderate/exploratory) confidence.\n" +
      "- gap: no accepted insight actually bears on this item. This is a real, reportable finding, not a " +
      "failure to search harder, say so plainly rather than stretching a loosely-related insight to cover it.\n\n" +
      "For each item write a conclusion: one or two plain-English sentences stating what the evidence " +
      "actually shows about that specific objective or decision (or, for a gap, that nothing accepted " +
      "speaks to it yet). Also give the indices of every insight that genuinely bears on this item -- an " +
      "insight can support more than one item, and some items will have none. Do not stretch a tenuous " +
      "connection just to avoid a gap; an honest gap is more useful to a stakeholder than a padded answer.\n\n" +
      "Some items carry a line of direct data evidence (supports / against / mixed / inconclusive / silent). Cite it in the conclusion when present; 'judged' stances are the model's reading, say so. An item with direct evidence but no insight is partial at most. " +
      (evidenceDigestDegraded
        ? "Direct data-evidence retrieval failed for this run (a connection or permission error, not a migration gap), so no item below carries a data-evidence line even where one might otherwise exist. Do not read that absence as 'the data was checked and found silent' -- treat it as unknown, and do not let it push an item toward gap on its own. " : "") +
      "Judge only against the items and insights given below; don't invent evidence or items beyond what's " +
      "listed.\n\n" +
      `Objectives and decisions:\n${itemsBlock}\n\n` +
      `Accepted synthesized insights:\n${insightsBlock}\n\n` +
      "Cover every item listed above by its index.",
    tool_choice: { type: "tool", name: "record_validations" },
    tools: [
      {
        name: "record_validations",
        description: "Records the disposition of every research objective / decision item against the accepted insights.",
        input_schema: {
          type: "object",
          properties: {
            validations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_index: { type: "integer", description: "The item's index in the numbered objectives/decisions list." },
                  status: { type: "string", enum: ["resolved", "partial", "gap"] },
                  conclusion: { type: "string" },
                  insight_indices: { type: "array", items: { type: "integer" } },
                },
                required: ["item_index", "status", "conclusion", "insight_indices"],
              },
            },
          },
          required: ["validations"],
        },
      },
    ],
    messages: [{ role: "user", content: "Validate the insights against the objectives and decisions now." }],
  });

  await logApiUsage(tenantId, runId, "objective_validator", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  const rawValidations =
    toolUse && toolUse.type === "tool_use" && Array.isArray((toolUse.input as { validations?: unknown }).validations)
      ? ((toolUse.input as { validations: unknown[] }).validations as Record<string, unknown>[])
      : [];

  const byIndex = new Map<number, { status: ValidationStatus; conclusion: string; insightIds: string[] }>();
  const conflicting = new Set<number>();

  for (const raw of rawValidations) {
    // OBJ-REV-008: a fractional index (0.5, 1.5) used to pass this check - `typeof === "number"`
    // is true for any float - and then survive as its own distinct Map key, never colliding
    // with (or ever satisfying) the real integer index it was presumably meant to name. The
    // completeness check below used to count Map SIZE, so two fractional keys could make a
    // 2-item response look like it covered both items while actually covering neither,
    // letting the items.map() fallback below silently write hardcoded "gap" records over
    // whatever was there before. Requiring an actual integer here, not just a number, is
    // what makes an out-of-range or malformed index "not a valid reference", same as it
    // already was for a non-string conclusion or an unrecognised status.
    const itemIndex = typeof raw.item_index === "number" && Number.isInteger(raw.item_index) ? raw.item_index : null;
    const status: ValidationStatus | null =
      raw.status === "resolved" || raw.status === "partial" || raw.status === "gap" ? raw.status : null;
    const conclusion = typeof raw.conclusion === "string" ? raw.conclusion.trim() : "";
    const insightIndices = Array.isArray(raw.insight_indices)
      ? raw.insight_indices.filter(
          (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < insights.length
        )
      : [];

    if (itemIndex === null || itemIndex < 0 || itemIndex >= items.length || !status || !conclusion) continue;
    // A "resolved" or "partial" verdict asserts the accepted evidence settles (or partly
    // settles) this item, which only means something if it names what settled it - a
    // "resolved" with zero cited insights is not a usable result for this item, just a
    // confident-looking label with nothing behind it (OBJ-REV-008: "partial model response
    // yields resolved without links for A"). "gap" is the one status that legitimately has
    // no insights to cite (that's what a gap IS), so only resolved/partial are held to this.
    if (status !== "gap" && insightIndices.length === 0) continue;
    const assessment = {
      status,
      conclusion,
      insightIds: [...new Set(insightIndices)].map((i) => insights[i].id),
    };
    // OBJ-REV-008: two assessments for one item. An identical repeat says nothing new and is kept
    // once; a differing one leaves no way to tell which belongs to the item, so the item is
    // marked conflicting and the whole answer is refused below (the previous batch is kept),
    // rather than silently keeping whichever came last.
    const earlier = byIndex.get(itemIndex);
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(assessment)) conflicting.add(itemIndex);
    byIndex.set(itemIndex, assessment);
  }

  if (conflicting.size > 0) {
    throw new Error(
      `Claude's response gave more than one assessment for ${conflicting.size === 1 ? "an objective or decision" : `${conflicting.size} objectives or decisions`} ` +
        `(item ${[...conflicting].sort((x, y) => x - y).map((i) => i + 1).join(", ")}), so it cannot say which applies. Nothing was changed; try again.`
    );
  }

  if (byIndex.size === 0) {
    throw new Error("Claude did not return a usable validation for any objective or decision; try again.");
  }
  // A response that only covers SOME items is not a safe basis for a full rebuild: items
  // map() below fills in anything missing from byIndex with a hardcoded "gap" status,
  // which would otherwise silently record "the evidence does not answer this" for an item
  // the model simply never got to - a truncated response, say - rather than what actually
  // happened, that it was never assessed this round (OBJ-REV-008: "gap for omitted B").
  // Throwing here leaves the previous objective_validations rows in place (the delete-and-
  // rebuild below never runs) rather than overwriting good data with a wrong "gap".
  // OBJ-REV-008: a plain size comparison is a proxy for "every requested index is covered",
  // not the thing itself - it happened to coincide as long as every valid item_index was
  // also a genuine integer in range, but that was only true because nothing before this
  // point rejected a fractional index. Checking the actual requested index set directly
  // (every i in [0, items.length) present in byIndex) is what "exact coverage" in the
  // acceptance criteria means, and does not depend on byIndex never picking up a stray key
  // that happens to make the size line up by coincidence.
  const missingIndices = Array.from({ length: items.length }, (_, i) => i).filter((i) => !byIndex.has(i));
  if (missingIndices.length > 0) {
    throw new Error(
      `Claude's response only covered ${items.length - missingIndices.length} of ${items.length} objectives and decisions - ` +
        "incomplete, not a finding that the rest are unanswered. Try again."
    );
  }

  // item_text and conclusion are capped here, the same way storyNarrative.ts
  // caps its own framing prose, rather than left to the deck's display-time
  // card truncation alone: a researcher's own objective/decision wording can
  // run long, and the model's conclusion has no word limit in its prompt, so
  // without this cap nearly every card on the objectives/decisions slide was
  // showing a mid-sentence ellipsis cut instead of a clean, complete thought.
  const validations: ObjectiveValidation[] = items.map((item, index) => {
    const result = byIndex.get(index);
    const conclusion = capWords(
      result?.conclusion ?? "Not yet assessed against the accepted evidence; try regenerating.",
      35
    );
    return {
      item_kind: item.kind,
      item_order: item.order,
      item_text: capWords(item.text, 40),
      status: result?.status ?? "gap",
      // OBJ-REV-005: the evidence panel says once that its intervals are not corrected for the
      // number of questions checked. A conclusion that drew on that evidence travels without the
      // panel (the objectives slide, the report), so it carries the same qualification in its own
      // text, added after the word cap so it is never cut. Items with no direct evidence are left
      // unchanged.
      conclusion: digest.has(currentItemKey(item)) ? `${conclusion} ${DIRECT_EVIDENCE_MULTIPLICITY_NOTE}` : conclusion,
      synthesized_insight_ids: result?.insightIds ?? [],
      inferred: item.inferred === true,
      evidence_digest_degraded: evidenceDigestDegraded,
    };
  });

  // OBJ-REV-012: evidence_digest_degraded (migration 0087) is written once for this whole
  // batch, the same evidenceDigestDegraded value already computed above and used in this
  // generation's own prompt - a durable record of whether evidence retrieval was degraded
  // when these conclusions were made, not just a flag that lived inside this one call.
  // Migration-guarded, but NOT with a per-row try/catch: a failed INSERT aborts the rest of
  // the transaction, and this runs inside a loop, so catching and falling back on every row
  // would need a savepoint around every single insert. Instead the column's existence is
  // checked ONCE, with a catalog query that cannot itself fail the transaction, and that one
  // answer picks which insert shape the whole loop uses.
  // CE-1: written only if nothing it was assessed against changed while the model was answering.
  // Saving takes a transaction-scoped lock per project (an advisory lock: it needs no write privilege
  // on runs, and every coverage save takes the same one), then reads the inputs again under it, so two
  // checks that overlap are saved one after the other and the older one's verdicts can never replace
  // the newer one's. A change committed after this save makes the stored fingerprints differ, so
  // readers show the coverage as out of date (objectiveCoverage.ts).
  await withTenant(tenantId, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended('objective_coverage:' || $1::text, 0))", [runId]);
    const found = await client.query("select 1 from runs where id = $1", [runId]);
    if (found.rowCount !== 1) throw new Error("Project not found");
    const now = coverageFingerprint(await readCoverageInputs(client, runId));
    if (JSON.stringify(now) !== JSON.stringify(assessedAgainst)) {
      throw new CoverageInputsChangedError(
        "The insights, objectives or decisions changed while the evidence check was running, so its result was not saved. Update coverage to check again.",
      );
    }
    const colCheck = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_name = 'objective_validations' and column_name = 'evidence_digest_degraded'
       ) as "exists"`,
    );
    const hasDegradedColumn = colCheck.rows[0]?.exists === true;
    const identity = await coverageIdentitySchema(client);
    await client.query("delete from objective_validations where run_id = $1", [runId]);
    for (const [index, validation] of validations.entries()) {
      if (identity) {
        const item = items[index];
        const row = await client.query<{ id: string }>(
          `insert into objective_validations
             (tenant_id, run_id, item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, inferred, generated_at,
              evidence_digest_degraded, objective_candidate_id, decision_candidate_id, inputs)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, $12, $13)
           returning id`,
          [
            tenantId,
            runId,
            validation.item_kind,
            validation.item_order,
            validation.item_text,
            validation.status,
            validation.conclusion,
            validation.synthesized_insight_ids,
            validation.inferred,
            evidenceDigestDegraded,
            item.kind === "objective" ? item.candidateId : null,
            item.kind === "decision" ? item.candidateId : null,
            JSON.stringify(assessedAgainst),
          ]
        );
        for (const [position, insightId] of validation.synthesized_insight_ids.entries()) {
          await client.query(
            "insert into objective_validation_insights (validation_id, synthesized_insight_id, tenant_id, position) values ($1, $2, $3, $4)",
            [row.rows[0].id, insightId, tenantId, position],
          );
        }
      } else if (hasDegradedColumn) {
        await client.query(
          `insert into objective_validations
             (tenant_id, run_id, item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, inferred, generated_at, evidence_digest_degraded)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)`,
          [
            tenantId,
            runId,
            validation.item_kind,
            validation.item_order,
            validation.item_text,
            validation.status,
            validation.conclusion,
            validation.synthesized_insight_ids,
            validation.inferred,
            evidenceDigestDegraded,
          ]
        );
      } else {
        await client.query(
          `insert into objective_validations
             (tenant_id, run_id, item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, inferred, generated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [
            tenantId,
            runId,
            validation.item_kind,
            validation.item_order,
            validation.item_text,
            validation.status,
            validation.conclusion,
            validation.synthesized_insight_ids,
            validation.inferred,
          ]
        );
      }
    }
  });

  return validations;
}

/**
 * Automatic trigger point: re-checks coverage after objectives change. Does
 * nothing when there are no objectives/decisions or no accepted insights yet,
 * and logs (never throws) on failure, so it cannot block the step that
 * triggered it.
 */
export async function refreshObjectiveValidationQuietly(tenantId: string, runId: string): Promise<void> {
  try {
    const ready = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ ok: boolean }>(
        // The same items generateObjectiveValidation judges: accepted candidates, or the project's own
        // text when none is accepted. Checking the text alone (as before CE-1) cleared the coverage of a
        // project whose objectives exist only as accepted candidates.
        `select (
           (coalesce(trim(r.research_objective), '') <> '' or coalesce(trim(r.decision_statement), '') <> ''
            or exists (select 1 from objective_candidates c where c.run_id = r.id and c.status = 'accepted')
            or exists (select 1 from decision_candidates d where d.run_id = r.id and d.status = 'accepted'))
           and exists (select 1 from synthesized_insights si where si.run_id = r.id and si.review_status = 'accepted')
         ) as ok
         from runs r where r.id = $1`,
        [runId]
      );
      return r.rows[0]?.ok === true;
    });
    if (!ready) {
      // OBJ-REV-007 (freshness gap, separate from the atomic-write race fixed in
      // objectiveEvidence.ts): this quick check exists so the expensive
      // generateObjectiveValidation call isn't run on every candidate accept/reject/delete
      // when there's obviously nothing to validate yet - but returning here used to skip
      // clearing, too. generateObjectiveValidation's OWN prerequisite checks clear stale
      // coverage before throwing, but this early return never reached them, so coverage
      // computed against a prerequisite that has since disappeared (the last accepted
      // candidate rejected, the last accepted insight un-accepted) kept being shown as
      // current. Deleting here is a no-op when there's nothing to clear, so it's safe to
      // run unconditionally on this path.
      await clearObjectiveValidations(tenantId, runId);
      return;
    }
    await generateObjectiveValidation(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_validation_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    }).catch(() => {});
  }
}

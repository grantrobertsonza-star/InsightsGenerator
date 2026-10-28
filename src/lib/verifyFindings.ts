import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { checkBaseSize } from "./stats";
import { mapWithConcurrency } from "./concurrency";
import { finishedToolInput, UnfinishedModelResultError } from "./modelToolResult";
import { applyRecordedContradictions } from "./contradictionDetector";
import { verificationBasisFor } from "./discoveryClassification";
import { codeVerdict, findingBasis } from "./findingBasis";
import { checkEvidenceFor } from "./claimTableChecks";
import { getTableGroundingDigest } from "./tableComputation";

// Judged in chunks rather than one call for the whole batch: at 80 findings,
// each needing a rationale, a single call's output can run past its token
// budget and get cut off mid-response, and a cut-off tool call used to mean
// every finding in the batch silently fell back to a fake
// "insufficient_information" verdict, not a real judgment. Chunking keeps
// each call's expected output comfortably inside budget. The overall cap
// bounds how many chunks (API calls) one run of this function makes, so a
// run with hundreds of unverified findings doesn't turn a single
// refreshVerdicts call into dozens of sequential requests; anything past
// the cap is picked up on the next call instead.
const JUDGMENT_CHUNK_SIZE = 20;
const MAX_FINDINGS_FOR_JUDGMENT = 100;
// How many chunk API calls run at once. Kept modest since this can run
// alongside other concurrent work in the same request.
const JUDGMENT_CONCURRENCY = 3;

type FindingRow = {
  id: string;
  origin: "stated" | "generated" | "coded";
  finding_text: string;
  finding_kind: string | null;
  theme: string | null;
  duplicate_group_id: string | null;
  source_document_id: string | null;
  source_table_id: string | null;
  stated_stats: Record<string, unknown> | null;
  pattern_type: string | null;
  grounded_by_finding_id: string | null;
  extraction_caveats: unknown;
  source_quote: string | null;
  supporting_segments: number | null;
  supporting_speakers: number | null;
};

/** Caveat tags extractFindings.ts attached to this finding itself (see
 * 0041_extraction_caveats.sql), independent of anything verification goes
 * on to compute. Defensive about shape since this comes straight off a
 * jsonb column: anything other than an array of strings is treated as
 * none, rather than thrown on.
 */
function extractionCaveatsFor(finding: FindingRow): string[] {
  return Array.isArray(finding.extraction_caveats)
    ? finding.extraction_caveats.filter((c): c is string => typeof c === "string")
    : [];
}

/**
 * Runs the shared base-size caution check against whichever two groups a
 * computed pattern's stated_stats describes. Both segment_difference and
 * segment_split patterns (see tableComputation.ts) carry n1/n2/group1Label/
 * group2Label for exactly this purpose; outlier and relationship patterns
 * don't compare two groups at all, so there's nothing to check and this
 * quietly returns no cautions for those.
 *
 * Besides the base-size checks, this also carries forward any caveats the
 * computation step itself already attached to stated_stats (tableComputation.ts
 * tags every comparison pattern it finds as resting on an uncorrected test,
 * since it always scans more than one column pair without a familywise
 * correction, matching the field's own convention rather than pretending
 * otherwise). For a genuine two-group comparison whose base size wasn't
 * available at all (the future path for a supplied table missing an n),
 * that's flagged explicitly too, rather than looking indistinguishable from
 * a base that was checked and found fine.
 */
function baseSizeCautionsFor(
  stats: Record<string, unknown>
): { checks: Record<string, unknown>; cautions: string[]; caveats: string[] } {
  const checks: Record<string, unknown> = {};
  const cautions: string[] = [];
  const caveats: string[] = Array.isArray(stats.caveats)
    ? stats.caveats.filter((c): c is string => typeof c === "string")
    : [];
  // group1Label/group2Label only ever appear on a two-group comparison
  // (segment_difference, segment_split); outlier and relationship patterns
  // never set either, so this tells apart "no base size to check" from
  // "not the kind of pattern this check applies to" rather than flagging
  // every outlier and relationship finding as missing a base size.
  const isTwoGroupComparison = typeof stats.group1Label === "string" || typeof stats.group2Label === "string";
  const n1 = typeof stats.n1 === "number" ? stats.n1 : null;
  const n2 = typeof stats.n2 === "number" ? stats.n2 : null;
  if (n1 !== null) {
    const check1 = checkBaseSize(n1, String(stats.group1Label ?? "Group 1"));
    checks.group1_base_size = check1;
    if (check1.flag) cautions.push(check1.flag);
    if (check1.tag) caveats.push(check1.tag);
  } else if (isTwoGroupComparison) {
    caveats.push("base_size_unknown");
    cautions.push(`${String(stats.group1Label ?? "Group 1")}'s base size was not available, so its stability could not be checked.`);
  }
  if (n2 !== null) {
    const check2 = checkBaseSize(n2, String(stats.group2Label ?? "Group 2"));
    checks.group2_base_size = check2;
    if (check2.flag) cautions.push(check2.flag);
    if (check2.tag) caveats.push(check2.tag);
  } else if (isTwoGroupComparison) {
    caveats.push("base_size_unknown");
    cautions.push(`${String(stats.group2Label ?? "Group 2")}'s base size was not available, so its stability could not be checked.`);
  }

  // A one-way ANOVA pattern (bannerPlanComputation.ts, for a banner column
  // with more than two categories) has no n1/n2 at all -- it spans however
  // many groups the banner has -- so it gets its own base-size pass across
  // every group the test actually used, same informal n=30/50 bands, rather
  // than silently skipping the check just because the two-group shape above
  // doesn't match.
  if (stats.testType === "one_way_anova" && Array.isArray(stats.groupMeans)) {
    const groupChecks: Record<string, unknown> = {};
    for (const group of stats.groupMeans) {
      if (!group || typeof group !== "object") continue;
      const label = typeof (group as { label?: unknown }).label === "string" ? (group as { label: string }).label : "a group";
      const n = typeof (group as { n?: unknown }).n === "number" ? (group as { n: number }).n : null;
      if (n === null) continue;
      const check = checkBaseSize(n, label);
      groupChecks[label] = check;
      if (check.flag) cautions.push(check.flag);
      if (check.tag) caveats.push(check.tag);
    }
    if (Object.keys(groupChecks).length > 0) checks.anova_group_base_sizes = groupChecks;
  }

  return { checks, cautions, caveats };
}

type VerdictTier = "robust" | "use_with_caution" | "not_supported" | "insufficient_information";
type CorroborationLevel = "cross_source_corroborated" | "single_source" | "contradicted";

/**
 * Red-teams every not-yet-verified finding in a run before it's eligible
 * for insight generation, per Section 4 of the original brief: an insight
 * built on a finding nobody has checked isn't traceable, it's just a
 * restated assumption. Two paths, not one:
 *
 * A "generated" finding (origin = 'generated') already went through
 * deterministic arithmetic when it was created (generateFindingsFromTable.ts
 * calls the shared stats functions itself; the pipeline never trusts a
 * model's arithmetic). Verifying it here means checking base sizes with the
 * same shared stats functions, not asking a model to re-derive numbers it
 * has no business recomputing from a text description.
 *
 * A "stated" or "coded" finding has no computed statistics behind it, a
 * sentence from a report or a coded theme from a transcript, so it goes to
 * a model for judgment instead: is this internally coherent, plausible, and
 * does anything else in this run's evidence support or contradict it. The
 * one exception is a stated finding extractFindings.ts has already tied to
 * a real computed pattern from this same run (grounded_by_finding_id, set
 * when the model's own extracted claim restates something a table's
 * computed statistics already verified): that finding skips the model
 * plausibility judgment too, and gets the same code-computed verdict the
 * grounding finding itself would, since the prose is no longer resting on
 * the report's own wording alone.
 *
 * Corroboration is decided in code either way, from duplicate_group_id (set
 * by the existing near-duplicate detector) or from grounded_by_finding_id,
 * never left to a model's impression of "this seems corroborated."
 */
export async function verifyFindings(tenantId: string, runId: string): Promise<number> {
  const allFindings = await withTenant(tenantId, async (client) => {
    const result = await client.query<FindingRow>(
      `select id, origin, finding_text, finding_kind, theme, duplicate_group_id,
              source_document_id, source_table_id, stated_stats, pattern_type, grounded_by_finding_id,
              extraction_caveats, source_quote, supporting_segments, supporting_speakers
       from findings
       where run_id = $1 and status != 'rejected'`,
      [runId]
    );
    return result.rows;
  });

  const alreadyVerified = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ finding_id: string }>(
      `select v.finding_id from verdicts v
       join findings f on f.id = v.finding_id
       where f.run_id = $1`,
      [runId]
    );
    return new Set(result.rows.map((r) => r.finding_id));
  });

  // stated_insight findings are excluded here on purpose: a report's own
  // interpretive insight claim gets a stricter, dedicated evidence-chain
  // check instead (see validateStatedInsights.ts), not the same plausibility
  // judgment every other stated finding gets. That check writes into this
  // same verdicts table, just via a different code path and
  // verification_method, so everything downstream still just reads a
  // verdict_tier the usual way.
  const unverified = allFindings.filter((f) => !alreadyVerified.has(f.id) && f.finding_kind !== "stated_insight");
  if (unverified.length === 0) return 0;

  // A finding corroborates across sources when it shares a duplicate group
  // with at least one other finding pulled from a different document. Built
  // from the whole run's findings, not just the unverified ones, since an
  // already-verified sibling still counts as corroboration.
  const sourcesByGroup = new Map<string, Set<string>>();
  for (const f of allFindings) {
    if (!f.duplicate_group_id) continue;
    const sourceKey = f.source_document_id ?? f.source_table_id ?? f.id;
    if (!sourcesByGroup.has(f.duplicate_group_id)) sourcesByGroup.set(f.duplicate_group_id, new Set());
    sourcesByGroup.get(f.duplicate_group_id)!.add(sourceKey);
  }
  // Every finding in this run, keyed by id, so a stated finding's
  // grounded_by_finding_id can be resolved to the actual computed-pattern
  // finding it points at -- including one from a table document that was
  // already verified in an earlier pass, which allFindings still covers
  // even though unverified (below) no longer does.
  const findingByIdAll = new Map(allFindings.map((f) => [f.id, f]));

  function corroborationFor(f: FindingRow): CorroborationLevel {
    if (f.duplicate_group_id && (sourcesByGroup.get(f.duplicate_group_id)?.size ?? 0) > 1) {
      return "cross_source_corroborated";
    }
    if (f.grounded_by_finding_id && findingByIdAll.has(f.grounded_by_finding_id)) {
      return "cross_source_corroborated";
    }
    return "single_source";
  }

  // An external citation is a claim the report attributes to someone else's
  // work; this pipeline has no way to check that source itself, so that
  // limitation is recorded rather than silently treated as verified.
  function dueCareFor(f: FindingRow): Record<string, unknown> {
    return f.finding_kind === "external_citation"
      ? { note: "External citation; source not independently verified against the original." }
      : {};
  }

  type PreparedVerdict = {
    findingId: string;
    verdictTier: VerdictTier;
    rationale: string;
    statisticalChecks: Record<string, unknown>;
    verificationMethod: "single_pass";
  };

  const prepared: PreparedVerdict[] = [];
  const needsJudgment: FindingRow[] = [];

  for (const finding of unverified) {
    if (finding.origin === "generated" && finding.stated_stats) {
      const { checks, cautions, caveats } = baseSizeCautionsFor(finding.stated_stats);
      const allCaveats = [...new Set([...caveats, ...extractionCaveatsFor(finding)])];
      // What the finding actually rests on decides the verdict (findingBasis.ts):
      // a passed test, a result that did not pass, statistics read from an
      // uploaded output, or a description / rule of thumb with no test at all.
      // Untested patterns are never described as statistically significant, and
      // results that say nothing was significant never rate as robust.
      const basis = findingBasis({ origin: finding.origin, pattern_type: finding.pattern_type, stated_stats: finding.stated_stats });
      const verdict = codeVerdict(basis, cautions, allCaveats);
      prepared.push({
        findingId: finding.id,
        verdictTier: verdict.tier,
        rationale: verdict.rationale,
        statisticalChecks: { ...checks, caveats: allCaveats, basis },
        verificationMethod: "single_pass",
      });
      continue;
    }

    const groundingFinding = finding.grounded_by_finding_id
      ? findingByIdAll.get(finding.grounded_by_finding_id)
      : undefined;

    if (groundingFinding && groundingFinding.stated_stats) {
      // Same code path as a generated finding's own self-check, run against
      // the computed fact this prose claim was tied to, rather than a
      // model's plausibility judgment. The grounding finding's basis counts:
      // a claim tied to a result that did not pass its test, or to a
      // description with no test, cannot come out robust. Still folds in this
      // stated finding's OWN extraction caveats, since those describe how the
      // prose itself was written.
      const { checks, cautions, caveats } = baseSizeCautionsFor(groundingFinding.stated_stats);
      const allCaveats = [...new Set([...caveats, ...extractionCaveatsFor(finding)])];
      const basis = findingBasis({
        origin: groundingFinding.origin,
        pattern_type: groundingFinding.pattern_type,
        stated_stats: groundingFinding.stated_stats,
      });
      const verdict = codeVerdict(basis, cautions, allCaveats);
      prepared.push({
        findingId: finding.id,
        verdictTier: verdict.tier,
        rationale:
          `This claim restates a pattern computed from data in this same run ("${groundingFinding.finding_text}"). ` +
          verdict.rationale +
          " Judged against that computed data rather than for plausibility alone.",
        statisticalChecks: { groundedByFindingId: groundingFinding.id, ...checks, caveats: allCaveats, basis },
        verificationMethod: "single_pass",
      });
      continue;
    }

    needsJudgment.push(finding);
  }

  const validTiers = new Set(["robust", "use_with_caution", "not_supported", "insufficient_information"]);

  const toJudgeThisPass = needsJudgment.slice(0, MAX_FINDINGS_FOR_JUDGMENT);

  // Evidence the model may weigh besides the sentence itself: what the project's tables said about
  // each claim (checked in code, claimTableChecks.ts), how many segments and speakers back a coded
  // theme, and the strongest computed results to test a claim against. Without these a stated or
  // coded finding could only be judged for plausibility, and "contradicted by another finding"
  // could only mean another finding in the same batch of 20.
  const tableEvidence = await checkEvidenceFor(
    tenantId,
    runId,
    toJudgeThisPass.map((f) => f.id),
  );
  const computedReference = (await getTableGroundingDigest(tenantId, runId, 25).catch(() => []))
    .map((d) => `- ${d.text.slice(0, 220)}`)
    .join("\n");
  const otherClaims = allFindings
    .filter((f) => f.origin !== "generated" && !toJudgeThisPass.some((j) => j.id === f.id))
    .slice(0, 40)
    .map((f) => `- ${f.finding_text.slice(0, 160)}`)
    .join("\n");
  const relianceById = new Map<string, boolean>();
  for (const f of toJudgeThisPass) {
    const ev = tableEvidence.get(f.id);
    relianceById.set(f.id, Boolean(ev && ev.stance !== "silent" && ev.stance !== "inconclusive"));
  }
  const evidenceLines = (f: FindingRow): string => {
    const parts: string[] = [];
    if (f.origin === "stated" && f.source_quote) parts.push(`   Source quote: "${f.source_quote.slice(0, 220)}"`);
    if (f.origin === "coded" && f.supporting_segments !== null) {
      parts.push(
        `   Coded theme: ${f.supporting_segments} participant segment(s)` +
          (f.supporting_speakers !== null ? ` from ${f.supporting_speakers} speaker(s)${f.supporting_speakers <= 1 ? " (a single voice)" : ""}` : "") +
          ".",
      );
    }
    const ev = tableEvidence.get(f.id);
    if (ev) parts.push(`   Checked against the project's tables (${ev.stance}): ${ev.lines.join(" | ")}`);
    return parts.length ? `\n${parts.join("\n")}` : "";
  };

  const chunks: FindingRow[][] = [];
  for (let start = 0; start < toJudgeThisPass.length; start += JUDGMENT_CHUNK_SIZE) {
    chunks.push(toJudgeThisPass.slice(start, start + JUDGMENT_CHUNK_SIZE));
  }

  type ChunkResult =
    | { ok: true; verdicts: PreparedVerdict[] }
    | { ok: false; error: string };

  const chunkResults = await mapWithConcurrency(chunks, JUDGMENT_CONCURRENCY, async (batch): Promise<ChunkResult> => {
    const findingsBlock = batch
      .map(
        (f, index) =>
          `${index}. [${f.theme ?? "Uncategorized"}${f.finding_kind ? ` · ${f.finding_kind}` : ""}] ${f.finding_text}${evidenceLines(f)}`
      )
      .join("\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      // verdict_tier is a repeatable red-team judgment, not creative
      // output: the same finding, checked against the same evidence,
      // should land on the same tier each time this runs. This used to
      // pin the lowest sampling temperature for that reason, but models
      // released after Claude Opus 4.6 (this one included) reject any
      // temperature besides the 1.0 default with a 400, so that lever is
      // gone.
      system:
        "You red-team a list of findings pulled from market research documents. For each, decide a " +
        "verdict_tier:\n" +
        "- robust: internally coherent, plausible, nothing here or elsewhere in the list contradicts it.\n" +
        "- use_with_caution: plausible but has a real caveat, vague methodology, a claim stronger than " +
        "its own wording supports, or language that oversells what was actually observed.\n" +
        "- not_supported: internally inconsistent, or contradicted by another finding in this list.\n" +
        "- insufficient_information: too vague or incomplete to assess at all.\n\n" +
        "Give a short rationale for each naming the specific reason, not a generic restatement of the " +
        "tier definition. Judge each finding on its own merits; do not assume a report's own stated " +
        "insight is correct just because it states it confidently.\n\n" +
        "Some findings carry evidence lines. 'Checked against the project's tables' is computed in code from " +
        "the data tables: if it says against, the claim cannot be robust, and the rationale should quote the " +
        "figures; if it says supports, say what was matched. A claim no table speaks to is not thereby wrong. " +
        "A coded theme backed by a single speaker or very few segments should not be called robust. " +
        "Where a finding conflicts with a computed result or another claim in the reference lists below, " +
        "say which one and mark it not_supported or use_with_caution.\n\n" +
        (computedReference ? `Computed results in this project (reference):\n${computedReference}\n\n` : "") +
        (otherClaims ? `Other claims in this project (reference, not to be judged now):\n${otherClaims}` : ""),
      tool_choice: { type: "tool", name: "record_verdicts" },
      tools: [
        {
          name: "record_verdicts",
          description: "Records a verdict for each finding by its index in the list.",
          input_schema: {
            type: "object",
            properties: {
              verdicts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer", description: "The finding's index in the numbered list." },
                    verdict_tier: {
                      type: "string",
                      enum: ["robust", "use_with_caution", "not_supported", "insufficient_information"],
                    },
                    rationale: { type: "string" },
                  },
                  required: ["index", "verdict_tier", "rationale"],
                },
              },
            },
            required: ["verdicts"],
          },
        },
      ],
      messages: [{ role: "user", content: `Here are the findings:\n\n${findingsBlock}` }],
    });

    await logApiUsage(tenantId, runId, "verify_findings", response.usage);

    // EC10K-F02: only a finished record_verdicts call is used (modelToolResult.ts). A cut-off answer
    // can carry a block holding the first few verdicts, which used to be written as the pass's
    // judgment (and every finding after the cut filled in as insufficient_information). An
    // unfinished answer fails the chunk, so nothing in this pass is written and the previous
    // verdicts stand.
    let finished: Record<string, unknown>;
    try {
      finished = finishedToolInput(response, "record_verdicts", "The verification of the findings");
    } catch (error) {
      if (error instanceof UnfinishedModelResultError) return { ok: false, error: error.message };
      throw error;
    }
    const rawVerdicts = Array.isArray(finished.verdicts) ? (finished.verdicts as Record<string, unknown>[]) : [];

    const batchVerdicts: PreparedVerdict[] = [];
    for (const raw of rawVerdicts) {
      const index = typeof raw.index === "number" ? raw.index : null;
      const verdictTier = typeof raw.verdict_tier === "string" ? raw.verdict_tier : null;
      const rationale = typeof raw.rationale === "string" ? raw.rationale : null;
      if (index === null || index < 0 || index >= batch.length) continue;
      if (!verdictTier || !validTiers.has(verdictTier)) continue;
      if (!rationale) continue;
      const extractionCaveats = extractionCaveatsFor(batch[index]);
      batchVerdicts.push({
        findingId: batch[index].id,
        verdictTier: verdictTier as VerdictTier,
        rationale,
        statisticalChecks: {
          ...(extractionCaveats.length > 0 ? { caveats: extractionCaveats } : {}),
          ...(tableEvidence.has(batch[index].id) ? { tableChecks: tableEvidence.get(batch[index].id) } : {}),
        },
        verificationMethod: "single_pass",
      });
    }

    // A batch that comes back with nothing usable at all (no tool call, a
    // response cut off before any valid entry, every index malformed) is a
    // call that failed outright, not one that judged every finding in it as
    // insufficient. Reporting it as a failed chunk, rather than writing a
    // fake verdict for each one, leaves these findings unverified so the
    // next verification pass picks them back up, instead of permanently
    // mislabeling them with a placeholder that reads like a real judgment.
    if (batchVerdicts.length === 0 && batch.length > 0) {
      return {
        ok: false,
        error:
          `Verification returned nothing usable for a batch of ${batch.length} finding(s) (stop reason: ` +
          `${response.stop_reason ?? "unknown"}).`,
      };
    }

    // A finding this specific batch's response skipped (a single malformed
    // index among otherwise-valid entries) still gets a verdict, rather
    // than silently staying unverified with no record of why. This only
    // runs when the batch as a whole clearly did produce real judgments, so
    // it can't paper over a wholesale failure the way it used to.
    const covered = new Set(batchVerdicts.map((p) => p.findingId));
    for (const finding of batch) {
      if (!covered.has(finding.id)) {
        const extractionCaveats = extractionCaveatsFor(finding);
        batchVerdicts.push({
          findingId: finding.id,
          verdictTier: "insufficient_information",
          rationale: "The verification pass did not return a judgment for this finding; try re-running it.",
          statisticalChecks: extractionCaveats.length > 0 ? { caveats: extractionCaveats } : {},
          verificationMethod: "single_pass",
        });
      }
    }

    return { ok: true, verdicts: batchVerdicts };
  });

  // Mirrors the previous sequential behavior: if any chunk failed outright,
  // nothing from this pass gets written, so the whole pass is retried
  // cleanly rather than leaving a partially-verified, hard-to-reason-about
  // state.
  const failures = chunkResults.filter((r): r is Extract<ChunkResult, { ok: false }> => !r.ok);
  if (failures.length > 0) {
    throw new Error(
      `${failures.map((f) => f.error).join("; ")} Nothing in this pass was marked as verified; try again.`
    );
  }

  for (const result of chunkResults) {
    if (result.ok) prepared.push(...result.verdicts);
  }

  const findingById = new Map(unverified.map((f) => [f.id, f]));

  await withTenant(tenantId, async (client) => {
    for (const verdict of prepared) {
      const finding = findingById.get(verdict.findingId);
      if (!finding) continue;
      // data_backed only when the verdict above really came from computed
      // statistics: a generated finding's own arithmetic, or a stated claim
      // tied to one (the grounding path). The model plausibility path is the
      // report's own wording judged for coherence, so it is report_only,
      // whether the run has tables or not.
      const grounding = finding.grounded_by_finding_id ? findingByIdAll.get(finding.grounded_by_finding_id) : undefined;
      const verificationBasis = verificationBasisFor({
        origin: finding.origin,
        groundedByComputedFinding: Boolean(grounding && grounding.stated_stats),
        reliedOnComputedEvidence: relianceById.get(finding.id) ?? false,
      });
      await client.query(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks,
                                verification_method, corroboration_level, due_care, verification_basis)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          verdict.findingId,
          verdict.verdictTier,
          verdict.rationale,
          JSON.stringify(verdict.statisticalChecks),
          verdict.verificationMethod,
          corroborationFor(finding),
          JSON.stringify(dueCareFor(finding)),
          verificationBasis,
        ]
      );
    }
    // A contradiction recorded earlier is a fact about the evidence, not
    // about one verdict row: if a contradicted claim was just re-verified
    // from scratch, its downgrade is re-applied here rather than lost.
    await applyRecordedContradictions(client, tenantId, runId);
  });
  // Findings past the per-pass cap wait for another pass; the caller can loop on this.
  return needsJudgment.length - toJudgeThisPass.length;
}

/**
 * Safe wrapper for every automatic trigger point: a verification failure
 * (an API hiccup, say) should never block the extraction or processing
 * step the researcher actually clicked, so it's logged to trace and
 * swallowed here instead of thrown.
 */
export async function refreshVerdicts(tenantId: string, runId: string): Promise<number> {
  try {
    return await verifyFindings(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'verify_findings_error', $3)`,
        [tenantId, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
      );
    });
  }
  return 0;
}

/**
 * Wipes every verdict this run already has and re-verifies from scratch.
 * Recovery path for a run stuck with verdicts written before a bug fix
 * here (a batch that returned nothing usable used to silently write a
 * placeholder "insufficient_information" verdict for every finding in it,
 * rather than leaving them unverified to retry): those placeholders read
 * like real judgments and, once written, permanently blocked the findings
 * they attached to from ever being verified again, so simply re-running
 * verification on top of them did nothing. This clears the slate instead.
 *
 * A direct user action, not a background trigger, so a failure is
 * returned rather than swallowed: the caller's own click handler shows it.
 */
export async function reverifyFindings(
  tenantId: string,
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `delete from verdicts where finding_id in (select id from findings where run_id = $1)`,
        [runId]
      );
    });
    await verifyFindings(tenantId, runId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'verify_findings_error', $3)`,
        [tenantId, runId, JSON.stringify({ message })]
      );
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

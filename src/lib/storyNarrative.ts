import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { loadInsightSupportOrUnchecked } from "./supportStatus";
import { capWords } from "./text";
import { finishedToolInput, UnfinishedModelResultError } from "./modelToolResult";
import { NO_INVENTED_EXPLANATIONS_RULE, NO_DERIVED_FIGURES_RULE } from "./groundingRules";
import { figureCheck, type FigureCheck } from "./numberTrace";
import { figureCheckAvailable } from "./figureChecks";
import type { ConfidenceTier, QualityTier } from "./tiers";

type EvidenceInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
  quality_score: number | null;
};

type EvidenceRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  synthesized_insight_headline: string | null;
  /** FND-001: the anchor insight, so a recommendation on an insight with invalid support is left out. */
  synthesized_insight_id: string | null;
};

export type DeckPillar = {
  theme: string;
  headline: string;
  so_what: string;
  insight_ids: string[];
  // How many additional accepted insights the model judged as belonging to
  // this pillar beyond the MAX_INSIGHTS_PER_PILLAR shown on the deck. Lets
  // the deck say "+N more" instead of silently dropping evidence a
  // researcher might expect to see (same spirit as the recommendations cap
  // in the story export route): still reviewable in the Insights section,
  // just not dumped into the client-facing narrative.
  insight_overflow_count: number;
};

export type DeckNarrative = {
  // A short, standalone opening paragraph -- the "page one" a consulting
  // deck leads with so a reader who only sees one slide still gets the
  // answer and the headline action. Distinct from governing_thought, which
  // is the one-sentence apex claim the pillar slides go on to prove.
  executive_summary: string;
  situation: string;
  complication: string;
  question: string;
  governing_thought: string;
  pillars: DeckPillar[];
  recommendations_intro: string;
  caveats: string[];
  generated_at: string;
};

type RawPillar = {
  theme?: unknown;
  headline?: unknown;
  so_what?: unknown;
  insight_indices?: unknown;
};

// A client-ready story deck is a highlight reel, not an audit trail: every
// insight stays reviewable in the app's own Insights section regardless of
// whether it makes the deck. Capping here, in code, means the deck stays
// compact even if a future prompt change or a different model response
// stops respecting the "pick your strongest few" instruction below.
const MAX_INSIGHTS_PER_PILLAR = 3;
const confidenceRank: Record<string, number> = {
  strong: 0,
  moderate: 1,
  exploratory: 2,
};

/**
 * The narrative synthesis step behind the "Insights Report" deck: the one
 * place in this pipeline where a single Claude call is asked to read
 * everything the researcher has accepted and propose how it adds up to one
 * story, structured as a Pyramid Principle / SCQA argument (situation,
 * complication, question, a one-sentence governing thought as the answer,
 * then the pillars of evidence supporting it).
 *
 * Deliberately narrow about what the model is trusted to author. It writes
 * the narrative framing -- the executive summary, the
 * situation/complication/question/governing thought, and which pillar each
 * insight belongs under -- but it never restates insight text itself for
 * the deck to use verbatim: pillars carry insight_ids (resolved here from
 * indices into the exact list given, the same deterministic-matching
 * principle this pipeline applies anywhere a model's own id-tracking can't
 * be trusted (see extractFindings.ts's grounded_pattern_index resolution),
 * rather than trusting the model to copy a uuid correctly), and the deck
 * renderer pulls the actual headline,
 * observation, tension, and implication straight from the database by
 * those ids. That keeps the one genuinely model-authored part of the deck
 * (how the story is framed) separate from the part that must stay exactly
 * what a researcher already reviewed and accepted.
 *
 * Built on the synthesized-insight layer (the funnel's output), not the
 * raw per-finding insights: a run with 60 pre-insights behind 16
 * synthesized insights tells one client-ready story with 16 proof points,
 * not 60. Only draws on synthesized insights with review_status =
 * 'accepted' and recommendations anchored to one of them with status =
 * 'accepted': this document goes to a client, so it uses the conservative,
 * explicitly-reviewed bar, not "anything not yet rejected" the way some
 * internal exports do.
 */
/** What a narrative may take figures from (numerical traceability, numberTrace.ts). */
export type NarrativeEvidence = {
  insights: { id: string; headline: string; observation: string; tension: string; implication: string }[];
  recommendations: { action_text: string; owner_role: string; timeline: string; synthesized_insight_headline: string | null }[];
  /** The project's own stated context and counts the model was given. Never the earlier evidence summary. */
  context: string[];
};

/**
 * Checks every figure of a narrative against its cited evidence: a pillar's headline and "so what"
 * against the insights that pillar cites; the summary, framing, caveats and transition against
 * all accepted insights, recommendations and the stated context. Used by the generator and by the
 * assistant's narrative revisions, so both apply the same rule.
 */
export function narrativeFigureCheck(
  narrative: Pick<DeckNarrative, "executive_summary" | "situation" | "complication" | "question" | "governing_thought" | "recommendations_intro" | "caveats" | "pillars">,
  evidence: NarrativeEvidence,
): FigureCheck {
  const insightText = (i: NarrativeEvidence["insights"][number]) => [i.headline, i.observation, i.tension, i.implication];
  const all = [
    ...evidence.insights.flatMap(insightText),
    ...evidence.recommendations.flatMap((r) => [r.action_text, r.owner_role, r.timeline, r.synthesized_insight_headline ?? ""]),
    ...evidence.context,
  ];
  const byId = new Map(evidence.insights.map((i) => [i.id, i]));
  return figureCheck([
    { field: "executive summary", text: narrative.executive_summary, sources: all },
    { field: "situation", text: narrative.situation, sources: all },
    { field: "complication", text: narrative.complication, sources: all },
    { field: "question", text: narrative.question, sources: all },
    { field: "governing thought", text: narrative.governing_thought, sources: all },
    { field: "recommendations intro", text: narrative.recommendations_intro, sources: all },
    ...narrative.caveats.map((c, i) => ({ field: `caveat ${i + 1}`, text: c, sources: all })),
    ...narrative.pillars.flatMap((p, i) => {
      const cited = p.insight_ids.flatMap((id) => (byId.has(id) ? insightText(byId.get(id)!) : []));
      return [
        { field: `pillar ${i + 1} headline`, text: p.headline, sources: cited },
        { field: `pillar ${i + 1} so what`, text: p.so_what, sources: cited },
      ];
    }),
  ]);
}

/**
 * The evidence a stored narrative may take figures from, read fresh: accepted synthesized insights
 * whose support is not invalid, accepted recommendations not anchored to an invalid insight, and
 * the project's stated context. Used to check the assistant's narrative revisions with the same
 * rule as generation.
 */
export async function loadNarrativeEvidence(tenantId: string, runId: string): Promise<NarrativeEvidence> {
  const data = await withTenant(tenantId, async (client) => {
    const run = await client.query<{ business_problem: string | null; research_objective: string | null; decision_statement: string | null; audience: string | null }>(
      "select business_problem, research_objective, decision_statement, audience from runs where id = $1",
      [runId],
    );
    const insights = await client.query<NarrativeEvidence["insights"][number] & { confidence_tier: string | null }>(
      `select id, headline, observation, tension, implication, confidence_tier
         from synthesized_insights where run_id = $1 and review_status = 'accepted'`,
      [runId],
    );
    const recs = await client.query<NarrativeEvidence["recommendations"][number] & { synthesized_insight_id: string }>(
      `select r.action_text, r.owner_role, r.timeline, si.headline as synthesized_insight_headline, si.id as synthesized_insight_id
         from recommendations r join synthesized_insights si on si.id = r.synthesized_insight_id
        where r.run_id = $1 and r.status = 'accepted'`,
      [runId],
    );
    return { run: run.rows[0], insights: insights.rows, recs: recs.rows };
  });
  const support = await loadInsightSupportOrUnchecked(tenantId, runId, data.insights.map((i) => i.id));
  const insights = data.insights.filter((i) => support.statusOf(i.id).status !== "invalid");
  const tiers = (t: string) => insights.filter((i) => i.confidence_tier === t).length;
  return {
    insights,
    recommendations: data.recs.filter((r) => support.statusOf(r.synthesized_insight_id).status !== "invalid"),
    context: [
      data.run?.business_problem ?? "",
      data.run?.research_objective ?? "",
      data.run?.decision_statement ?? "",
      data.run?.audience ?? "",
      `${insights.length} insights: ${tiers("strong")} strong, ${tiers("moderate")} moderate, ${tiers("exploratory")} exploratory, ` +
        `${insights.filter((i) => !i.confidence_tier).length} not yet tiered`,
    ],
  };
}

export async function generateStoryNarrative(
  tenantId: string,
  runId: string,
): Promise<DeckNarrative> {
  const { run, insights: acceptedInsights, recommendations: acceptedRecommendations } = await withTenant(
    tenantId,
    async (client) => {
      const runResult = await client.query<{
        project_name: string | null;
        business_problem: string | null;
        research_objective: string | null;
        decision_statement: string | null;
        evidence_synthesis: string | null;
        audience: string | null;
      }>(
        `select project_name, business_problem, research_objective, decision_statement, evidence_synthesis, audience
       from runs where id = $1`,
        [runId],
      );

      const insightsResult = await client.query<EvidenceInsight>(
        `select si.id, si.headline, si.observation, si.tension, si.implication,
              si.confidence_tier, si.quality_tier, si.quality_score
       from synthesized_insights si
       where si.run_id = $1 and si.review_status = 'accepted'
       order by si.quality_score desc nulls last, si.created_at`,
        [runId],
      );

      const recommendationsResult = await client.query<EvidenceRecommendation>(
        `select r.action_text, r.owner_role, r.timeline, r.metric, r.priority, si.headline as synthesized_insight_headline,
              si.id as synthesized_insight_id
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
       order by si.quality_score desc nulls last, r.created_at`,
        [runId],
      );

      return {
        run: runResult.rows[0],
        insights: insightsResult.rows,
        recommendations: recommendationsResult.rows,
      };
    },
  );

  if (!run) {
    throw new Error("Project not found");
  }

  // FND-001: a narrative is never drafted from an insight whose support is no longer valid (a
  // supporting finding rejected or deleted), nor from a recommendation anchored to one. Insights
  // whose support changed or cannot be checked are still used; the exports qualify them visibly
  // (see supportStatus.ts and both story export routes). A failed check reads every insight as
  // "not checked", which is allowed here and qualified on export - it never blocks silently and
  // never certifies anything as current.
  const support = await loadInsightSupportOrUnchecked(
    tenantId,
    runId,
    acceptedInsights.map((insight) => insight.id),
  );
  const insights = acceptedInsights.filter((insight) => support.statusOf(insight.id).status !== "invalid");
  const recommendations = acceptedRecommendations.filter(
    (rec) => !rec.synthesized_insight_id || support.statusOf(rec.synthesized_insight_id).status !== "invalid",
  );
  if (acceptedInsights.length > 0 && insights.length === 0) {
    throw new Error(
      "Every accepted synthesized insight now rests on evidence that was rejected or deleted. Review them " +
        "(their support status is shown on the Insights screen), then re-run synthesis or accept current ones " +
        "before generating the Insights Report.",
    );
  }
  if (insights.length === 0) {
    throw new Error(
      "No accepted synthesized insights yet. Run synthesis and accept at least one synthesized insight " +
        "before generating the Insights Report.",
    );
  }

  const insightsBlock = insights
    .map(
      (insight, index) =>
        `${index}. (confidence: ${insight.confidence_tier ?? "not yet triangulated"}, quality: ${
          insight.quality_tier ?? "unscored"
        }) ` +
        `Headline: ${insight.headline}\n   Observation: ${insight.observation}\n   Tension: ${insight.tension}\n` +
        `   Implication: ${insight.implication}`,
    )
    .join("\n");

  const recommendationsBlock =
    recommendations.length > 0
      ? recommendations
          .map(
            (rec) =>
              `- [${rec.priority.toUpperCase()}] ${rec.action_text} (${rec.owner_role}, ${rec.timeline})` +
              (rec.synthesized_insight_headline
                ? ` — from: ${rec.synthesized_insight_headline}`
                : ""),
          )
          .join("\n")
      : "(No recommendations have been accepted yet.)";

  const strongCount = insights.filter(
    (i) => i.confidence_tier === "strong",
  ).length;
  const moderateCount = insights.filter(
    (i) => i.confidence_tier === "moderate",
  ).length;
  const exploratoryCount = insights.filter(
    (i) => i.confidence_tier === "exploratory",
  ).length;
  const untieredCount = insights.filter((i) => !i.confidence_tier).length;

  const contextBlock = [
    run.business_problem ? `Business problem: ${run.business_problem}` : null,
    run.research_objective
      ? `Research objective: ${run.research_objective}`
      : null,
    run.decision_statement
      ? `Decision(s) this project exists to inform: ${run.decision_statement}`
      : null,
    // Golden-thread repair: background only. It was written earlier, from findings as they then
    // stood, and is not refreshed when verification changes, so it must not supply figures.
    run.evidence_synthesis
      ? `Earlier evidence summary (background framing only; take every figure from the accepted insights and recommendations below, never from this summary): ${run.evidence_synthesis}`
      : null,
    run.audience ? `Audience for this report: ${run.audience}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  // Pillar grouping is the one part of this call that's a genuinely
  // constrained, fiddly structured-output task (fit every accepted
  // insight into 2-5 groups, each with valid indices) -- non-determinism
  // means a single attempt can come back with no pillar surviving
  // validation even though the rest of the narrative (executive summary,
  // situation/complication/governing thought) is perfectly usable. Retry
  // the whole call up to 3 times before giving up on a good grouping and
  // falling back to one pillar per insight below -- cheap given how small
  // this input is, and a second or third attempt succeeding outright is
  // strictly better than either a hard failure or a same-every-time
  // fallback.
  // Numerical traceability (enforced, numberTrace.ts): every figure the narrative states must come
  // from what it cites - see narrativeFigureCheck. The earlier evidence summary is NOT a source of
  // figures (it is background only, see contextBlock), and neither are the list numbers or the
  // prompt's own instructions.
  const evidence: NarrativeEvidence = {
    insights,
    recommendations,
    context: [
      run.business_problem ?? "",
      run.research_objective ?? "",
      run.decision_statement ?? "",
      run.audience ?? "",
      `${insights.length} insights: ${strongCount} strong, ${moderateCount} moderate, ${exploratoryCount} exploratory, ${untieredCount} not yet tiered`,
    ],
  };
  let figureFeedback = "";
  let lastUnsupported: FigureCheck["figures"] = [];

  const MAX_PILLAR_ATTEMPTS = 3;
  type RawNarrative = {
    executive_summary?: unknown;
    situation?: unknown;
    complication?: unknown;
    question?: unknown;
    governing_thought?: unknown;
    pillars?: unknown;
    recommendations_intro?: unknown;
    caveats?: unknown;
  };
  let raw: RawNarrative | null = null;
  let pillars: DeckPillar[] = [];

  const asText = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;

  for (let attempt = 1; attempt <= MAX_PILLAR_ATTEMPTS; attempt++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system:
        "You structure a market research project's accepted, already-synthesized insights into a single " +
        "client-ready narrative, using the Pyramid Principle / SCQA structure consulting reports use: an " +
        "executive summary a reader could stop after, Situation (the context), Complication (the tension or " +
        "problem that makes this matter now), Question (the decision this project exists to answer), and a " +
        "Governing Thought. This is a slide deck, not a report: the governing thought is ONE punchy sentence, " +
        "at most 30 words, stated as a clear assertion, not a paragraph stacking several claims with semicolons " +
        "or em dashes. If there's a second idea worth keeping, it belongs in a pillar's so_what or in a caveat, " +
        "not crammed into the governing thought.\n\n" +
        "Write for a time-pressed executive reading this on a slide, not a researcher reading a paper. Keep " +
        "executive_summary, situation, complication, governing_thought, every pillar headline, and every " +
        "so_what in plain business English: something you could say out loud to a CEO in one breath and have " +
        "them immediately understand. Keep raw statistical notation -- p-values, odds ratios, correlation " +
        "coefficients, standard deviations, percentage-of-variance figures, confidence intervals -- out of " +
        "these fields entirely; that detail belongs to the underlying evidence, not to the narrative framing " +
        'you\'re writing here. Avoid academic/technical jargon in these fields too ("interaction effect", ' +
        '"moderator", "latent construct", "quasi-separation", "collinear", "artifact of sparse cells" ' +
        "and similar) -- say what the finding means for the business instead of how it was measured. A single " +
        "plain, rounded figure (a percentage, a rand amount, a count) is fine when it sharpens a sentence; a " +
        "statistical test result is not.\n\n" +
        "Write executive_summary first, as 2 to 4 sentences a senior stakeholder could read alone on the opening " +
        "slide and walk away with the point: state the governing thought in plain terms and name the single " +
        "highest-priority action, without repeating the situation/complication build-up word for word.\n\n" +
        "Under the governing thought, group the accepted insights into 2 to 5 pillars: a pillar is a supporting " +
        "argument, not a theme label, so its headline must be a complete, assertive sentence (the 'so what'), " +
        "the way a McKinsey slide title states the finding rather than the topic, at most 18 words, one " +
        "sentence. so_what is a separate single sentence, at most 25 words, on why it matters to the decision.\n\n" +
        "Every insight below is numbered and already represents a cluster of corroborating evidence, not a " +
        "single raw observation. For each pillar, give the indices of the insights that belong to it (an " +
        "insight can support at most one pillar, pick its best fit), but this is a highlight reel: name only " +
        "the 2 to 4 strongest, most decision-relevant insights for that pillar, prioritizing ones with a " +
        "'strong' confidence tier and a higher quality score. Do not list every insight that could plausibly " +
        "fit; the rest stay reviewable elsewhere in the app, this deck is not the only place they're visible. " +
        "Use only the indices given; do not invent insights, numbers, or claims beyond what the list below " +
        "actually supports. The governing thought and every pillar headline must be a claim this evidence " +
        "actually backs, not an aspirational or generic restatement.\n\n" +
        NO_INVENTED_EXPLANATIONS_RULE +
        "\n\n" +
        NO_DERIVED_FIGURES_RULE +
        "\n\n" +
        `${contextBlock}\n\n` +
        "Accepted, synthesized insights (confidence tier reflects how well-triangulated the cluster behind it " +
        'is: "strong" means solid corroboration across sources, "moderate" some corroboration with gaps, ' +
        '"exploratory" a single thread worth watching but not yet confirmed; quality tier is a separate check ' +
        "on how well-formed and actionable the insight itself is):\n" +
        `${insightsBlock}\n\n` +
        `Accepted recommendations:\n${recommendationsBlock}\n\n` +
        `Of the ${insights.length} accepted synthesized insights, ${strongCount} carry a "strong" confidence ` +
        `tier, ${moderateCount} "moderate", ${exploratoryCount} "exploratory", and ${untieredCount} have not ` +
        "yet been tiered. Write 2 to 4 caveats grounded in specifics like this (which confidence tier is " +
        "thinnest, what the evidence doesn't yet cover, where a pillar rests on exploratory rather than strong " +
        "evidence), not generic disclaimers. Also write recommendations_intro: one sentence transitioning from " +
        "the evidence into the recommended actions.",
      tool_choice: { type: "tool", name: "record_narrative" },
      tools: [
        {
          name: "record_narrative",
          description:
            "Records the structured SCQA/Pyramid Principle narrative for this project's insights report.",
          input_schema: {
            type: "object",
            properties: {
              executive_summary: { type: "string" },
              situation: { type: "string" },
              complication: { type: "string" },
              question: { type: "string" },
              governing_thought: { type: "string" },
              pillars: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    theme: { type: "string" },
                    headline: {
                      type: "string",
                      description:
                        "A complete, assertive sentence, not a topic label.",
                    },
                    so_what: {
                      type: "string",
                      description:
                        "One sentence on why this matters to the decision.",
                    },
                    insight_indices: {
                      type: "array",
                      items: { type: "integer" },
                    },
                  },
                  required: ["theme", "headline", "so_what", "insight_indices"],
                },
              },
              recommendations_intro: { type: "string" },
              caveats: { type: "array", items: { type: "string" } },
            },
            required: [
              "executive_summary",
              "situation",
              "complication",
              "question",
              "governing_thought",
              "pillars",
              "recommendations_intro",
              "caveats",
            ],
          },
        },
      ],
      messages: [
        { role: "user", content: `Build the narrative structure now.${figureFeedback}` },
      ],
    });

    await logApiUsage(tenantId, runId, "story_narrative", response.usage);

    // Codex RR-F06: only a finished generation may replace the saved narrative. A cut-off one can
    // carry well-shaped but unfinished prose; it, a refusal, a missing result or a missing required
    // field throws here, before anything is written, so the previous narrative stays and the caller
    // records the failure (story_narrative_error) for the Insights report section to show.
    const what = "The report generation";
    const input = finishedToolInput(response, "record_narrative", what);
    // The narrative's contract (Codex batch12): the summary, situation, complication and governing
    // thought are the report's content and must say something, so blank or whitespace-only text is a
    // malformed result like a missing field; the question may be blank only when the project's
    // decision statement stands in for it (as it does below); the recommendations intro and the
    // caveats are optional and may be empty.
    for (const field of ["executive_summary", "situation", "complication", "governing_thought"]) {
      const v = input[field];
      if (typeof v !== "string") throw new UnfinishedModelResultError("malformed", `${what} returned a result without ${field}, so nothing was saved. Try again.`);
      if (!v.trim()) throw new UnfinishedModelResultError("malformed", `${what} returned an empty ${field}, so nothing was saved. Try again.`);
    }
    for (const field of ["question", "recommendations_intro"]) {
      if (typeof input[field] !== "string") throw new UnfinishedModelResultError("malformed", `${what} returned a result without ${field}, so nothing was saved. Try again.`);
    }
    if (!(input.question as string).trim() && !run.decision_statement?.trim())
      throw new UnfinishedModelResultError("malformed", `${what} returned an empty question and the project has no decision statement to use, so nothing was saved. Try again.`);
    for (const field of ["pillars", "caveats"]) {
      if (!Array.isArray(input[field])) throw new UnfinishedModelResultError("malformed", `${what} returned a result without ${field}, so nothing was saved. Try again.`);
    }
    raw = input as RawNarrative;

    const rawPillars = Array.isArray(raw.pillars)
      ? (raw.pillars as RawPillar[])
      : [];
    const attemptPillars: DeckPillar[] = [];
    for (const rawPillar of rawPillars) {
      const theme = asText(rawPillar.theme, "");
      const headline = capWords(asText(rawPillar.headline, ""), 22);
      const soWhat = capWords(asText(rawPillar.so_what, ""), 30);
      const indices = Array.isArray(rawPillar.insight_indices)
        ? rawPillar.insight_indices.filter(
            (value): value is number =>
              typeof value === "number" &&
              Number.isInteger(value) &&
              value >= 0 &&
              value < insights.length,
          )
        : [];
      if (!headline || indices.length === 0) continue;
      const uniqueIndices = [...new Set(indices)];
      // Defensive cap: even if the model names more than MAX_INSIGHTS_PER_PILLAR,
      // keep only the strongest few here so a prompt regression can't bring
      // back the "every insight gets a slide" data dump. Ranked by confidence
      // tier (strong first), then by quality score, rather than the order the
      // model listed them in, since that's what "strongest proof point"
      // actually means.
      const ranked = [...uniqueIndices].sort((a, b) => {
        const tierA = confidenceRank[insights[a].confidence_tier ?? ""] ?? 3;
        const tierB = confidenceRank[insights[b].confidence_tier ?? ""] ?? 3;
        if (tierA !== tierB) return tierA - tierB;
        return (
          (insights[b].quality_score ?? 0) - (insights[a].quality_score ?? 0)
        );
      });
      const kept = ranked.slice(0, MAX_INSIGHTS_PER_PILLAR);
      const insightIds = kept.map((index) => insights[index].id);
      attemptPillars.push({
        theme: theme || "Key finding",
        headline,
        so_what: soWhat,
        insight_ids: insightIds,
        insight_overflow_count: Math.max(0, uniqueIndices.length - kept.length),
      });
    }

    // Enforced: a draft stating a figure that is unsupported by what it cites is not accepted. The
    // next attempt is told which figures to drop; if the last attempt still has one, nothing is
    // saved (below) and the previous narrative, if any, stays as it was. Figures that only need
    // review do not block: they are stored with the narrative and shown (see figure_check).
    const attemptCheck = narrativeFigureCheck(
      {
        executive_summary: asText(raw.executive_summary, ""),
        situation: asText(raw.situation, ""),
        complication: asText(raw.complication, ""),
        question: asText(raw.question, ""),
        governing_thought: asText(raw.governing_thought, ""),
        recommendations_intro: asText(raw.recommendations_intro, ""),
        caveats: (Array.isArray(raw.caveats) ? raw.caveats : []).filter((c): c is string => typeof c === "string"),
        pillars: attemptPillars,
      },
      evidence,
    );
    lastUnsupported = attemptCheck.figures.filter((f) => f.status === "unsupported");
    if (lastUnsupported.length > 0) {
      const listed = [...new Set(lastUnsupported.map((f) => `${f.text} (${f.reason})`))].join("; ");
      figureFeedback =
        ` Your previous draft stated figures that the evidence it cites does not support: ${listed}. ` +
        "Use only figures exactly as they appear in the accepted insights and recommendations (rounding is fine), " +
        "for the same group and measure. Do not compute new ranges, margins, differences, ratios or totals.";
      continue;
    }

    if (attemptPillars.length > 0) {
      pillars = attemptPillars;
      break;
    }
    // Empty this attempt: loop again (if attempts remain) and re-roll the
    // whole call, rather than retrying just the grouping -- a different
    // attempt may frame the whole narrative better, not only the indices.
  }

  if (!raw) {
    throw new Error("Claude did not return a structured narrative");
  }
  if (lastUnsupported.length > 0) {
    const detail = lastUnsupported.map((f) => `${f.field}: ${f.text} (${f.reason})`).join("; ");
    throw new Error(
      `The drafted narrative stated figures that the evidence it cites does not support (${detail}), ` +
        `in each of ${MAX_PILLAR_ATTEMPTS} attempts. Nothing was saved; the previous narrative, if any, is unchanged. ` +
        "Try again, or add the figure to the insight it belongs to if it is genuinely part of the evidence.",
    );
  }

  if (pillars.length === 0) {
    // The model returned a narrative but either named no pillars or named
    // insight_indices that didn't survive validation (out of range, or all
    // pointing at the same insight). Rather than hard-fail a report that's
    // otherwise usable -- the executive summary, situation/complication/
    // governing thought above all came back fine -- fall back to one
    // pillar per accepted insight, verbatim from its own headline and
    // implication. Worse than a good grouping, but strictly better than no
    // report at all, and exactly right when there are only a couple of
    // insights to begin with (little for a "pillar" to add over the
    // insight itself).
    for (const insight of insights) {
      pillars.push({
        theme: insight.confidence_tier ?? "Key finding",
        headline: capWords(insight.headline, 22),
        so_what: capWords(insight.implication, 30),
        insight_ids: [insight.id],
        insight_overflow_count: 0,
      });
    }
  }

  const rawCaveats = Array.isArray(raw.caveats)
    ? raw.caveats.filter(
        (value): value is string =>
          typeof value === "string" && value.trim() !== "",
      )
    : [];

  const narrative: DeckNarrative = {
    executive_summary: capWords(asText(raw.executive_summary, ""), 115),
    situation: capWords(asText(raw.situation, ""), 75),
    complication: capWords(asText(raw.complication, ""), 75),
    question: asText(raw.question, run.decision_statement ?? ""),
    governing_thought: capWords(asText(raw.governing_thought, ""), 34),
    pillars,
    recommendations_intro: capWords(asText(raw.recommendations_intro, ""), 32),
    caveats: rawCaveats.map((caveat) => capWords(caveat, 38)),
    generated_at: new Date().toISOString(),
  };

  // The stored check describes exactly what is saved (including the one-pillar-per-insight fallback).
  const finalCheck = narrativeFigureCheck(narrative, evidence);
  await withTenant(tenantId, async (client) => {
    const storeCheck = await figureCheckAvailable(client);
    await client.query(
      `insert into deck_narratives
         (tenant_id, run_id, executive_summary, situation, complication, question, governing_thought, pillars,
          recommendations_intro, caveats, generated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (run_id) do update set
         executive_summary = excluded.executive_summary,
         situation = excluded.situation,
         complication = excluded.complication,
         question = excluded.question,
         governing_thought = excluded.governing_thought,
         pillars = excluded.pillars,
         recommendations_intro = excluded.recommendations_intro,
         caveats = excluded.caveats,
         generated_at = excluded.generated_at`,
      [
        tenantId,
        runId,
        narrative.executive_summary,
        narrative.situation,
        narrative.complication,
        narrative.question,
        narrative.governing_thought,
        JSON.stringify(narrative.pillars),
        narrative.recommendations_intro,
        JSON.stringify(narrative.caveats),
      ],
    );
    if (storeCheck) {
      await client.query("update deck_narratives set figure_check = $2 where run_id = $1", [runId, JSON.stringify(finalCheck)]);
    }
  });

  return narrative;
}

/**
 * The latest failed generation that is newer than the saved narrative (Codex RR-F06): shown in the
 * Insights report section whether or not an earlier narrative exists, so a failed regeneration is
 * never mistaken for the report it left in place. Null when the latest attempt is the saved one.
 */
export async function latestNarrativeFailure(tenantId: string, runId: string): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ message: string | null }>(
      `select coalesce(detail->>'message', 'The report generation failed.') as message from trace
        where run_id = $1 and event = 'story_narrative_error'
          and occurred_at > coalesce((select generated_at from deck_narratives where run_id = $1), '-infinity'::timestamptz)
        order by occurred_at desc, id desc limit 1`,
      [runId],
    );
    return r.rows[0]?.message ?? null;
  });
}

# Insight quality scoring

## Why this exists

`verdicts.verdict_tier` (robust / use-with-caution) already judges one thing: is the
*finding* underneath an insight well-supported evidence. It says nothing about whether
the *insight* built on top of that finding is actually an insight, a non-obvious,
explanatory, actionable claim, rather than a restated observation wearing an insight's
format. A finding can be statistically airtight and still produce an insight that's just
"usage is lower for segment X," which is true, verifiable, and not an insight.

Insight quality scoring is a second, independent axis for that second question. It does
not replace, gate, or filter anything the pipeline already produces: every insight
Insights Elevator generates still appears, still feeds into recommendations, still gets
exported. A low score sorts an insight lower and gives a researcher a one-line reason why,
nothing more.

## What a "finding" is and isn't, in one page

The working definition, synthesized from several independent sources that converge on
the same distinction:

- A **finding** is an observed fact, metric, or pattern: it tells you *what* happened. It
  is "nice to know," often a single data point, and, standing alone, invites no particular
  action.
- An **insight** connects that pattern to a motivation, mechanism, or business
  consequence: it tells you *why* it's happening and *why it matters*. It's "need to
  know," synthesizes more than one observation with context, and points at a decision.

Worked example, the one that makes the distinction concrete:

> Finding: "80% of users abandon the checkout form on the shipping page." A raw metric,
> no cause named.
>
> Insight: "Users abandon checkout on the shipping page because the unexpected addition
> of delivery fees breaks their price expectations at the final step, signaling a need to
> display shipping estimates earlier." Names the psychological driver and points at a
> fix.

A fast gut-check for either: does it only state what people said or did (finding);
does it explain the root cause, motivation, or tension (leans insight); does it answer
"so what," or does the path forward become obvious the moment you read it (insight).

## The five dimensions

Each insight is scored 1, 3, or 5 on each of five dimensions, summed into a score out of
25.

| # | Dimension | 1 (Finding) | 3 (Emerging) | 5 (True insight) |
|---|---|---|---|---|
| 1 | **The Why** (motivation / mechanism) | States what happened, no cause named | Implies a reason, doesn't name it | Names the root cause or psychological/behavioral driver |
| 2 | **Actionability** (so what?) | Nice to know, no next step | Vague direction, no concrete application | Dictates a clear decision or design action |
| 3 | **Novelty** | Obvious, already assumed | Confirms an existing assumption with new numbers | Surprising, overturns or sharpens an assumption |
| 4 | **Synthesis** (depth) | One data point or quote | A couple of similar points | Triangulates across sources (quant + qual, multiple findings) |
| 5 | **Evidentiary proportionality** | The claimed mechanism isn't in the evidence at all | Plausible but asserted more confidently than the evidence warrants | The explanatory claim is directly traceable to, or a reasonable inference from, the cited finding, no unsupported leap |

### Why these five, and not a different set

The first four collapse a longer list of properties commonly cited for what makes
something an insight (an unrecognized truth, a change in viewing things, an
understanding of motivations, a gateway to new outcomes) into four non-overlapping,
independently scorable axes: Why and Novelty are both forms of non-obviousness (Why asks
whether a *mechanism* is named; Novelty asks whether that mechanism is *surprising*),
Actionability is the "so what" test (closely related to Minto's Pyramid Principle), and
Synthesis rewards triangulating across more than one source rather than generalizing
from a single quote or number.

The fifth, **evidentiary proportionality**, is the one dimension none of the generic
insight-vs-finding frameworks include, and it earns its place for this product
specifically. Insights Elevator's whole premise is red-teaming the gap between what
research actually shows and what gets claimed about it. An LLM generating the checkout
example above can just as easily invent a plausible-sounding psychological mechanism
that isn't actually supported by the underlying finding or quote, a well-documented
failure mode for generative insight tools. Evidentiary proportionality is the check for
exactly that: it scores whether the "why" is earned by the evidence, not just whether a
why was offered. A generic insight-quality framework built for human researchers doesn't
need this dimension, because a human generating their own insights from their own data
doesn't fabricate the underlying evidence. A tool that generates both the insight and the
story behind it does need it.

A sixth dimension considered and deliberately left out: **longevity** (does this remain
true next year, or is it tied to a specific moment). It's a reasonable axis for ongoing
UX research practice, but FinMark-style engagements are usually tied to a specific
decision window (should we target this segment now, should we launch this feature this
quarter) rather than enduring brand truths, so most insights would default to a middle
score and the dimension would add noise rather than signal for this product's actual use
case.

## Scoring thresholds

| Total | Tier | Meaning |
|---|---|---|
| 5–11 | `finding` | Descriptive. True and possibly useful, but not yet explanatory or actionable enough to call an insight. |
| 12–14 | `partial` | Has a kernel of something real but is underdeveloped, usually weak on Why or Actionability specifically. |
| 15–25 | `qualified` | A genuine insight: non-obvious, explains why, points at an action, and stays proportionate to its evidence. |

## Implementation

- **Additive, non-destructive.** Five nullable `smallint` columns plus a total, a tier,
  and a one-line rationale were added to the `insights` table
  (`supabase/migrations/0020_insight_quality_score.sql`). Nothing existing was changed,
  removed, or restructured. An insight that hasn't been scored yet (or whose scoring call
  failed) simply has `quality_score is null`; it still displays and still feeds
  recommendations.
- **Automatic, same trigger pattern as verification.** `src/lib/insightQualityScorer.ts`
  exports `scoreInsightQuality` (the judging logic, chunked and concurrency-limited the
  same way `verifyFindings.ts` and `insightGenerator.ts` are) and `refreshInsightQuality`
  (a safe wrapper that logs to `trace` and swallows errors rather than blocking the
  pipeline step that triggered it, same pattern as `refreshVerdicts`). It's wired in
  right after every `refreshInsights` call in `src/app/runs/[id]/page.tsx`
  (`extractFindingsAction`, `generateFindingsAction`, `codeThemesAction`,
  `processRunAction`, `reverifyFindingsAction`), so every path that can produce a new
  insight also scores it.
- **Incremental.** The eligibility query is `insights.quality_score is null`, the same
  "not exists yet" shape used throughout this pipeline, so re-running any of the above
  actions only scores insights that don't have a score yet; it never re-scores or
  re-spends an API call on an insight that's already been judged.
- **Sorting, not filtering.** `getInsights` orders by `quality_score desc nulls last`
  (then theme, then creation order); `getRecommendations` orders by its parent insight's
  `quality_score desc nulls last`. Both the Insights and Recommendations sections of the
  run page show the score, tier, and (for insights) the one-line rationale as a badge, plus a
  second stat-tile row (Qualified / Partial / Finding only) a researcher can click to
  filter, exactly mirroring the existing robust / use-with-caution dashboard. Nothing in
  either query or UI drops a low-scoring insight or recommendation; the score is a
  prioritization signal, not a gate.

## Sources

- Nielsen Norman Group. (n.d.). *Findings vs. insights: The differences*.
  https://www.nngroup.com/articles/data-findings-insights-differences/
- Anderson, N. (n.d.). *Stop calling it an insight if it's just an observation* [LinkedIn
  post]. https://www.linkedin.com/posts/nikkianderson-ux_stop-calling-it-an-insight-if-its-just-activity-7317547275021344770-hiZI
- UI/UX Design Studio Japan. (n.d.). *What is an insight and how is it different from a
  finding?* https://uism.co.jp/en/blog/what-is-an-insight-and-how-is-it-different-from-a-finding/
- Southpaw Insights. (n.d.). *What's the difference between an insight and a finding?*
  https://www.southpawinsights.com/whats-the-difference-between-an-insight-and-a-finding/
- *The difference between insights and findings, and why it matters.* (n.d.). Medium,
  Everything That's Next. https://medium.com/everything-thats-next/the-difference-between-insights-and-findings-and-why-it-matters-689d7787d7df
- Minto, B. (2010). *The Pyramid Principle: Logic in Writing and Thinking* (3rd ed.).
  Pearson. (Source of the "so what" test underlying the Actionability dimension.)

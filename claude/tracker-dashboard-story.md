# Brand tracking dashboard as a story: findings, AI insights, slides (contract)

Grant, 30 October 2026: "the entire module can be put straight into slides. We can add an executive summary,
conclusion/recommendations. Also, we are missing an AI Insights button ... We could take these and add it to the
exported slide. So all self-contained from input to report. Then it can also go the usual route to findings,
insights etc." Built in batch R5story (`claude/batchR5story-handover-2026-10-30.md`). Tier A (findings, AI prompts
and grounding, exports).

## One registry of pages and cards

`src/lib/trackerDashboardCards.ts` is the one place the dashboard's pages and cards are described for anything that
leaves the screen. A page registers with one call:

```ts
registerDashboardPage({ id, title, load: (tenantId, runId, documentId) => ({ data, ctx }), cards: [{ id, title, figures, sentence }] })
```

- `load` is the page's own loader (the one the screen's action calls), so findings, AI insights and slides use the
  screen's figures, recomputed on the server; nothing the browser sends is a figure.
- `figures(data, ctx)` returns `CardFigures`: every figure with an identity key (stage, variable, brand code; never a
  label or position), its unrounded value, unit, unweighted base and who the base is, small-base level
  (`trackerAudience.smallBaseLevel`: below 50 small, below 30 descriptive only), significance flag when a page ran a
  test (none does today); the card's method, caveat tags (base tags from `stats.checkBaseSize`), plain notes for
  footnotes, the data files it read (`sourceDocumentIds`), and the bars for its slide.
- `sentence(card, ctx)` writes the finding's one plain sentence from those figures only (client brand, figure, base,
  weighting, wave; rank among the listed brands where meaningful, "not tested").
- Unknown is never 0: a figure the page could not compute is `value: null` with its reason; a card whose part is
  "Not measured" or "Mapping needed" has that status and no sentence; a card that speaks for the client brand without
  one chosen is `needs_brand`.
- On the screen a card names itself by page and card id (`TrackerDashboardPanel.tsx` `STORY_CARDS` by test id, or
  `<DashboardFindingButton page card />`). The page ids in menu order are `src/lib/trackerDashboardPageIds.ts`;
  `dashboardStory.test.ts` keeps them equal to the registry. A new view: register its page, add its card's test id.

## Post as finding (`src/lib/dashboardFindings.ts`)

- The Brand Health tool's approach: a generated, accepted `level` finding, `stated_stats.source = "tracker_dashboard"`,
  recorded as a tool action (`findingProvenance.recordHumanReview`, "tool_add"), `source_document_id` the wave file.
- Provenance in `stated_stats`: kind (card or ai_insight), identity, page, card, data file, wave, client brand,
  weighted and weight variable, effective base, method, every figure, `figuresHash`, notes, caveats,
  `sourceDocumentIds`, `sourceState`, `readingBase` and its label (the smallest base the sentence states, which
  `verifyFindings` checks with the shared base-size owner), posted time.
- Identity: a card is (data file, page, card, client brand); an AI insight is its draft id and wording. Same identity
  and same `figuresHash`: nothing is added (a rejected one is revived by the explicit post). Different figures: a new
  finding; every earlier finding of the identity keeps its wording, status and decisions and is tagged
  `dashboard_superseded` with `supersededByFindingId`.
- Write: one transaction holding the project row (`assertRunOwned` with lock), the data file checked as the
  project's, so two posts of one card insert once.
- The source state is read before the figures and again at the write (also inside the transaction for the choices and
  files); a change in between refuses the post ("try again"), so a finding never records a state its figures do not
  belong to.

## Freshness

- `sourceStateOf`: the dashboard choices' scope and revision (`tracker_dashboards`; null before 0132 compares as
  unknown, never as unchanged) and, per data file the card read, an md5 of the stored file, content hash, set-up and
  corrections, and a hash of the confirmed questionnaire and codebook mapping (`instruments.getConfirmedItemsForData`,
  the reader the dashboard itself uses). A failed read throws.
- `sourceChanges(recorded, now)`: the reasons in words; nothing recorded is a reason.
- `syncDashboardFindingFreshness(tenantId, runId)` tags a changed finding `dashboard_source_changed` with
  `freshness.reasons`, wording and decisions kept. Tagging changes `stated_stats`, part of `finding_support_parts`
  (0096), so pre-insights, insights and recommendations built on it read "support changed" through the existing
  support owner. Called on: choices save and reset (every project of the scope, `syncDashboardFreshnessForScopeOf`;
  a failure is traced and returned), dashboard open (`dashboardFindingStatusAction`, failure shown), and before the
  pipeline's verification and insight work (`verifyFindings.refreshVerdicts`, failure traced). A finding marked for
  review keeps the mark until the same card is posted from the current state.

## AI insights (`src/lib/dashboardInsights.ts`)

- Model input: only the page's computed figures as structured data (`pageModelInput`: wording, value to one decimal,
  unit, base and whom it counts, small-base, availability and significance flags, card methods and notes). No
  respondent data, no uploaded document text. The block is delimited by `untrustedContent.wrapUploadedContent` and
  the system prompt carries `UPLOADED_CONTENT_RULE`.
- Prompt guards (`RULES`): only the given figures, one decimal, a difference in points between two of the page's
  shares allowed; no causal language; no significance unless flagged; small bases named; unavailable is not zero.
- Enforced in code (`checkDraft`), never left to the prompt: `numberTrace.figureCheck` against the page's evidence
  (`pageEvidenceText`, one source so differences of two shares trace), absent figures unsupported; label numbers that
  look like figures are neutralised (`labelForEvidence`) so a label cannot supply evidence for a number;
  `numberTrace.claimLanguage` on every sentence (cause, whole population, significance; significance allowed only for
  a sentence whose figures all carry a significance flag). Unsupported: the draft is kept as `refused` with the
  reason. Needs review: kept as a draft with the note. A small base the text relies on and does not name is appended
  by the app ("Small base: ... (n=..)").
- Storage (migration 0138, `tracker_dashboard_ai`, `tracker_dashboard_ai_requests`): the figures and their hash per
  draft (stale when the page's hash differs), model text and current text, `human_edited` apart from `status`
  (draft, accepted, discarded, refused), the check, the finding it was posted as, a revision for compare-and-swap.
- Ordering: a generation records its request as the page's latest; its answer is written only while it is still the
  latest (row lock), so a late answer returns `superseded` and changes nothing. A regeneration replaces untouched
  drafts and refusals only; accepted, edited and discarded drafts stay.
- Decisions: accept (never a refused or stale draft), discard, reopen; edit is checked like a draft (an unsupported
  number is not saved) and returns an accepted draft to draft; every one is a compare-and-swap on the revision.
- Post: an accepted, current insight is posted through `postDashboardInsightFinding` (caveat `ai_drafted_wording`).
- Before 0138: every entry point says the migration is needed (`STORY_UNAVAILABLE`); export still works and says
  nothing is accepted.

## Executive summary and conclusions

- Drafted only from this data file's accepted, current AI insights and accepted dashboard card findings that are
  neither marked for review nor superseded (`loadStoryInputs`). Nothing accepted: refused with the reason, no model
  call.
- Inputs are delimited as uploaded content; every number must be one of the inputs' (`checkDraft`, absent figures
  unsupported for the summary, needs review for the conclusions, where a proposed target is not a claim).
- Stored as kind `summary` / `conclusions` on page `_module`, stale when the inputs' hash changes; same decisions.

## Slides (`src/lib/trackerModuleSlides.ts`, `src/lib/trackerModuleExport.ts`, route `tracker-dashboard/export`)

- Title; executive summary; one slide per registered page (charts from `renderChartImage.renderBarsImage`, each
  card's key-figures sentence, footnote with every card's method and bases and the page's notes and caveats; the
  page's accepted current AI insights); conclusions and recommendations.
- Drafts appear only with `includeDrafts=1`, labelled "AI DRAFT, NOT ACCEPTED"; refused and discarded never; accepted
  insights whose figures changed are left out and counted on the slide; the summary or conclusions say "nothing
  accepted", "not accepted yet" or "drafted from material that has changed" instead of inventing.
- A page that fails to calculate gets a slide with the reason. Text is never cut: sizes are measured with the
  crosstab slides' font metrics and shrunk to a floor; an insight list continues on a following slide; anything else
  that cannot fit throws `ModuleDeckLayoutError`, returned as 422.

## Limits

- Brand dashboard only; the CSM dashboard is not registered.
- Ranks are among all listed brands with a figure, not the screen's Compare selection (not saved).
- A data change made elsewhere is marked when the dashboard is next opened, choices are saved, or the pipeline next
  verifies; until then the Findings page shows the earlier state.
- The figure check is lexical (numberTrace limits apply); a label quoted verbatim in an insight is checked like text.

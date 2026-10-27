# Evidence chain (26 October 2026)

Insights Elevator's selling point is the evidence trail: every recommendation traceable to the brief.
The chain is brief/proposal → objectives and decisions → analysis plan → findings → insights →
recommendations → report. Audit of the code on 26 October 2026 (before this work): ids are stored from
recommendation back to finding and source; above the insight level the link to objectives, decisions
and the brief was text or a model-filled id array.

## Routes to a finding (Grant, 26 October 2026)

1. **Planned:** from the analysis plan, so it carries its plan line and objective (to build).
2. **Discovered:** the app's scan of the data, an ad-hoc table, an emergent qual theme. Made without an
   objective, so discovery stays open; mapped to an objective afterwards, or marked as bearing on none.
3. **Stated:** claims read from a report, or added by the researcher; verified against the data and
   mapped to an objective the same way.

## Work, in order

- **CE-1 (done, b42): coverage keyed by identity and known to be current.** `objectiveCoverage.ts` is the
  one reader. Migration 0119 adds `objective_validations.objective_candidate_id`,
  `decision_candidate_id`, `inputs` (fingerprints) and the `objective_validation_insights` link table.
  - A check records the fingerprints of what it was assessed against: accepted insight ids; accepted
    objectives and decisions (id, wording, source); the project's own objective and decision text.
    Readers compare them with the current inputs, so any change (insight accepted, rejected, deleted or
    re-synthesised; objective edited; an automatic re-check that failed) shows the coverage as out of date.
    Rows from before 0119 read as "not known to be current".
  - B37-F01 (Codex, repaired b47): the fingerprint says which insights are accepted, not whether they are
    still supported. Each conclusion also carries the support of the insights it cites (worst status, read
    live from `supportStatus.ts`, the same reader as the insight cards); invalid, changed or unchecked
    support qualifies the conclusion everywhere it is read (`coverageRowNote`, `coverageNote`,
    `qualifiedConclusion`), keeping the saved verdict and wording. A re-check never offers an insight
    whose support is invalid; with none left it refuses and keeps the last check.
  - Saving takes a per-project advisory lock and re-reads the inputs; if they changed while the model was
    answering nothing is saved (`CoverageInputsChangedError`) and the earlier rows stand.
  - The qualification reaches the coverage pane, the selected objective's tile, the verdict chip, the
    report pane, both story exports (in the conclusion text), the stage status (needs you) and the
    research assistant. "Suggest objectives from unmatched insights" refuses on coverage that is not
    current.
  - Fixed on the way: the automatic re-check treated a project whose objectives exist only as accepted
    candidates (no free text) as having none, and cleared its coverage.
  - Not in the fingerprint: the objective evidence lane's results (they are recomputed by their own
    lane); a change there is not yet detected.
- **CE-2 (done, b43): recommendations record the decisions they serve; insight prompts see the objectives.**
  - Migration 0120 `recommendation_decisions`: one row per decision a recommendation serves, with the
    accepted candidate's id (or null for a free-text decision line) and its wording, origin model or
    researcher. Both recommendation generators list the decisions numbered and the model names them in
    `decision_indices`; invalid indices are dropped; written in the same transaction as the
    recommendation, so a retry writes neither twice (`recommendationDecisions.ts`).
  - Shown on each recommendation card ("Serves: ...") and in the main recommendation export ("Decision
    served"); none named is "Not recorded", a decision since rejected or reworded is "no longer a current
    decision", with its wording kept.
  - A served decision is current only when the same decision is accepted and worded the same now
    (whitespace and case aside); one reworded since says so with its new wording, one rejected or removed
    is "no longer a current decision" (B37-F02, b47). A free-text decision's wording is its identity.
  - An insight's objectives are read from coverage (CE-1, by id), not stored a second time.
  - Insight generation and synthesis now see the accepted objectives in both modes
    (`projectObjectives.ts`), as context and not a filter; before, a project with a confirmed decision
    gave them no objective at all.
  - Not yet: the researcher choosing the decisions by hand (with the chain view, CE-5), and
    researcher-written recommendations (they read "Not recorded" until then).
- **CE-3 (done, b43): the report narrative records what it was written for.** Migration 0121
  `deck_narratives.inputs`: the fingerprints of the business problem, the objectives, the decisions, the
  project's own objective and decision text and the accepted insights, read before the model is asked
  (`narrativeFreshness.ts`, the same fingerprints as coverage plus the business problem). A difference
  qualifies the narrative on the Insights report screen, in both story exports (joined to the existing
  support qualification on every framing slide and passage) and for the research assistant; the narrative
  and any researcher revision of it are kept until the report is regenerated. A narrative saved before
  0121 reads as not known to be current. Before migration 0121 itself, an existing narrative is also "not known to be current", naming the
  update; no narrative has no note (B37-F03, b47).
  Insights and recommendations are not marked stale on an objective edit: objectives are context for
  them, not a filter (discovery stays open), and the link from an insight to an objective is coverage
  (CE-1), which is marked out of date. Recommendations already carry decision freshness (GT-007) and,
  from CE-2, the decisions they serve.
- **CE-4 (done, b44): the brief or proposal passage behind each objective.** The brief reading now names,
  for each objective and for the business problem, the document (brief or proposal) and a verbatim
  passage (`briefIntake.ts`). Each passage is checked against the full text of the document it names
  with the shared quote rule (`quoteMatch.ts`) and stored with the result (migration 0122
  `brief_passages`, written in the same transaction as the objectives it describes, `briefPassages.ts`).
  A passage not found word for word is shown as possibly reworded, never as a quote; one for a document
  not given or an objective that does not exist is dropped. Shown under the objective's detail and in the
  evidence trail beneath the objective. Objectives typed by hand, or filled before 0122, show "none
  recorded".
- **CE-5 (screen done, b43): the evidence trail of a recommendation.** "Trace the evidence" on each
  recommendation card opens a tree (`EvidenceTrailDialog.tsx`, read by `evidenceTrail.ts`): what it is
  for (the decisions it serves, CE-2; the objectives its insight answers, from coverage by id, CE-1, with
  coverage freshness) above the recommendation, and beneath it the insight (review and support status),
  pre-insights, findings (origin, latest verdict), the data point (quote, stated figures) and the source
  file. Every node is a stored link; a missing, out-of-date or invalid link is a dashed or amber node that
  says why, and the trail counts its breaks. The Word report prints every recommendation's trail as an
  appendix (`trailOutline`), with each break stated; an unreadable trail is stated, not dropped. Still to
  do: the trail in the deck,
  the reverse view from an objective, the researcher choosing a recommendation's decisions, links from a
  node to its table or transcript, and objective evidence in the exports.
- **CE-6: the analysis plan** from objectives, decisions, the proposal's methodology and the
  questionnaire or guide; approved line by line; planned findings carry their line.
- **CE-7: qualitative:** spontaneous versus probed (the moderator turn before an answer), negative cases
  attached to the findings and insights they qualify, a failed guide read shown as a failure.

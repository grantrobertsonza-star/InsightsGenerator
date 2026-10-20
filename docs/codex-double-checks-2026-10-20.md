# Codex double checks for the night of 20 October 2026

Prepared by Claude at 18:00 on 20 October 2026 (Johannesburg), updated at 20:00 for the 3000 port of Coding and Reports and decks, for Codex's independent review tonight. It covers everything committed from the evening of 18 October to 20 October that has not had an independent review. The last independently accepted scope is still `1e0f2a3` (Research Quality Review lifecycle, 18 October), and the release baseline is still 37 Closed / 6 Blocked. Only one item in this period was found by Codex itself: the Wave 1 workbook timeout on 19 October, fixed in `d20c897` and still to be confirmed.

**Review targets (laptop checkouts, committed as Grant, not pushed):**

| Copy | Path | Branch | HEAD | Tree |
|---|---|---|---|---|
| Main (port 3000) | `C:\Personal\InsighsAI\app` | as checked out | `6a8dc08` | `065faa461937325b2aaf68a8f83fee0ce1cbb4fa` |
| Redesign (port 3001) | `C:\Personal\InsighsAI\app-import-redesign` | `redesign/import-two-pane` | `0afd1c3` | `12a6fd8f62678e1fe992d2c79453279af9ccba4f` |

Both copies share history up to `79e00b3` (19 October, 16:08 UTC). The statistics engine (`api/parse-stats-file.py`) and the migrations (`0001` to `0107`) are byte-identical in both. Commit times below are UTC. Commit order after the code HEADs. 3000: check fix `dbfc2ea` (`e2e/ui/global-rail.check.mjs` only, see C7), docs `3ba2234`, then, at Grant's request at 19:28, the Coding and Reports and decks port `6a8dc08` (the code HEAD in the table) and a second docs-only commit. 3001: check fix `d4596dd`, then docs `f8c1f50`.

**How to read this list.** It is sequenced as the standard asks: technical defects first (A: calculations and identity, B: persistence, ownership and concurrency), then asynchronous UI state (C), then parity between the copies (D), then maintainability and comments (E). Each item gives the commits, what to establish, and what counts as a pass. "Claude's evidence" says what has already been run, so Codex can decide what to rerun rather than repeat it blindly. Please treat any "pass" from Claude as a claim, not a closure.

**Out of scope tonight** (still open from before): the deployed security gate G1 to G6 (IMP-001/016), the real-model benchmark, the 13 real-model Research Quality cases, and the five archived OBJ rows.

---

## A. Calculations, identity and analytical contracts (highest priority)

**A1. Margin-of-error check (RQC-6).** 3000 `b4a6ff0`, 3001 `1c2b5bf`. Files: `src/lib/marginOfError.ts`, the RQC-6 release, the review manifest `precisionChecks`.
- Establish: the formula is z x sqrt(deff x 0.25 / n) x 100 at 95% (and 90%/99% when stated); 95% and deff 1 are assumed and said when not stated; no finite-population correction, and that is said; "claims more precision than the sample supports" gives the n it would need; a sentence with no sample size, or several, is "not checked", never "consistent".
- Probe sentences Claude did not try: "n = 1 000" (space as thousands separator), "1,000 interviews per wave" with two waves, "±3pp", "3 percentage points", "a margin of error of 3% at the 90% level", a margin stated for a subgroup with a different n in the same sentence, qual sample sizes ("30 interviews") with a margin.
- Pass: independent hand values (n=1,000 gives ±3.10; n=400 gives ±4.90; ±3 needs n=1,068) match; the ambiguous cases are "not checked", not guessed; the panel and the Word export label the result as calculated, not the model's rating.
- Claude's evidence: `marginOfError.test.ts` reference values; `researchQuality.db.test.ts` "RQC-6"; `research-quality.check.mjs` (calculated panel).

**A2. Research Quality dashboards (RQC-3 to RQC-6).** Shared: `13580f4`, `382569c`, `59d536d`, `0e88509`; then RQC-6 as 3000 `b4a6ff0` and 3001 `1c2b5bf`, and the 3001 dimension cards `3b30786`.
- Establish: brief overall = weighted points over weighted maximum across rated dimensions, problem, decisions and objectives counting double; unrated or dismissed dimensions left out (never zero); no overall under half the weight; bands 80/60. Proposal weights 36/18/14/14/9/9 (Grant's 110% scaled to 100); a category averages its rated items; RQC-6 methodological rigour averages six items; a review made under RQC-4 or RQC-5 keeps its single sampling item and its score.
- Pass: an independent recount from stored ratings equals the screen and the Word export for one brief, one proposal (RQC-6) and one older proposal (RQC-4 or RQC-5); the 3001 dimension cards (`scoreOutOfFive`) show the same numbers as the 3000 bars for the same review.

**A3. Scatter correlation as a finding.** 3001 `e2d7909`, `469ceb2`; 3000 `b42db18`. Files: `src/lib/scatter.ts`, `src/lib/scatterActions.ts`, `ScatterVisual.tsx`.
- Establish: r uses every complete case, not the at most 5,000 points drawn; weighted r is computed correctly and carries no p-value, saying so; unweighted p comes from `stats.ts`; cases with a missing or non-positive weight are dropped and counted; "Post to findings" recomputes on the server from the variable identities and does not trust any client-supplied r, n or points; repost does not duplicate; a removed finding is revived, not duplicated.
- Probes: an independent r (numpy, or R `cor` and `cov.wt`) on a fixture with weights and missing values; a variable whose label changes but whose name does not (identity must hold); a post after the data file is re-read (does the finding become stale or unknown as other findings do, standard 8?).
- Pass: r agrees to the displayed precision; no p-value appears for a weighted r anywhere (screen, Findings, exports); a stale source is not shown as current.

**A4. Histogram and Bar/Line.** Same commits as A3. Establish: Bar and Line use one calculation (a toggle changes only the drawing); the histogram says correctly whether its bars are the engine's bins or one per value. Pass: bar and line values are identical for one question; the label matches the method applied.

**A5. Unique question-set keys ("EN9").** 3001 `5ac12c0`, `890a46d`; 3000 `1f6087d`, `55103f2`. Files: `api/parse-stats-file.py`, `src/lib/variableSetKeys.ts`, `src/lib/crosstabs.ts`, Brand Health.
- Establish: a multiple-response set keeps its stem key, and only a clashing battery or grid becomes "<stem> (battery)" or "<stem> (grid)"; stems with no clash keep their keys; a cached dictionary is rebuilt only when it repeats a key; a dictionary whose `sets` is not a list is left alone (not rebuilt, not crashed).
- The open question for Codex: saved artefacts made before the fix (crosstabs, Brand Health choices, findings) that referred to "set:EN9". The engine resolved the first set, a screen the last. Does each saved artefact still mean what it meant when it was made, and is any whose meaning has changed marked rather than silently reinterpreted?
- Pass: `engineSetKeyIdentity` (real engine) and `variableSetKeys` pass; a saved pre-fix crosstab on a clashing stem either keeps its meaning or is visibly qualified.

**A6. Excel identifier formats in one pass (Codex's 19 October finding).** `d20c897`, in both copies' shared history. Establish: output digests identical to the old code at every size, row alignment kept for short rows, the 1,000 x 97 case well inside the 60 s limit. Pass: Codex's original `csm_Wave1_Baseline.xlsx` reads.

**A7. 100 MB import limit and worker reload.** `6ebfeb8`, `3389438`, shared by both copies. Establish: the limit is read from `api/import-limits.json` everywhere (TypeScript, Python, captions, `proxyClientMaxBodySize`); a file imported under an older limit is still readable; the local worker reloads the engine when it or the limits change, and a failed reload fails the request with its reason rather than serving the old engine. Pass: `large-spss-crosstab.check.mjs` and `statsWorkerReload.test.ts` pass for Codex; the positive control (old 20 MB limit) fails.

## B. Persistence, ownership and concurrency

**B1. Choosing a questionnaire match by hand.** 3000 only: `48481b4`, `ce6fabf`. Files: `src/lib/instruments.ts` (`chooseInstrumentLink`), `src/lib/instrumentActions.ts`.
- Establish: question, data file and variable belong to this run and organisation on the write; the data file's row is locked so two choices for one file go one at a time; a variable already confirmed for another question is refused, naming it; a repeat is idempotent; matching again keeps hand-chosen links.
- Known gap Claude recorded and did not fix: Confirm on a suggested link does not check whether its variable is confirmed for another question. Codex to judge whether this is a defect (two questions confirmed to one variable) or acceptable.
- Pass: `instrumentManualLink.db.test.ts` passes; Codex's own two-connection race produces one link and one refusal.

**B2. Automatic questionnaire and guide reading.** 3000 only: `d52acbf`. Files: `useInstrumentAutoStart.ts`, `InstrumentAutoRead.tsx`.
- Establish: a paid read starts once per questionnaire per page; a failed read is recorded (`instrument_read_failed`) and not paid for again on reload; a later finished read clears it.
- Not covered by Claude: two browser tabs, or two people, opening Import at once. Is there a server-side guard against two paid reads of the same document, or only a page-level one?
- Pass: one read per document across two concurrent sessions, or the gap recorded as a limitation.

**B3. Transcript wave label and Undo accept (migration 0107).** Shared `79e00b3`. Establish: before 0107 the other choices still save and the wave and Undo controls say they need the update; the missing-migration message is thrown after the save commits (it used to roll back while claiming success); Undo is recorded so the card does not accept it again; Coding skips a withdrawn transcript; a row created by coding with no confirmation is not treated as withdrawn. Pass: `transcriptWaveAndUndo.db.test.ts` and `transcript-card.check.mjs` pass, including the pre-0107 schema case.

**B4. Opening an imported file.** `1f4bc70`, shared by both copies. Establish: `openDocumentAction` checks the document belongs to this run and organisation before signing; the link lasts ten minutes; another project's document gets nothing; a storage failure is reported. Pass: `documentOpen.db.test.ts`; Codex's cross-organisation probe with two signed-in users is refused.

**B5. Set objectives filled from an imported brief or proposal.** 3000 `ff97069`; 3001 also through `ObjectiveSetup` (`4cbb8ff`). Establish: no model call unless a document is chosen; only blank fields are filled and typed text wins; a document from another project is refused and traced, and what was typed is still saved. Pass: `briefFillFromImport.db.test.ts`.

**B6. Research Quality live-run robustness and review kinds.** Shared: `34ffde7`, `59d536d`; then plain step names as 3000 `367ce23` and 3001 `4c04d3a`. Establish: an answer stopped at the token limit is refused with that reason; a review with nothing moving for two minutes is marked interrupted and Continue resumes only unstarted steps without duplicating paid work; failed steps are listed only once a run has settled; the 150,000-character read limit is reported when exceeded; only documents imported or reviewed as a brief or proposal are offered. Pass: the related `researchQuality.db.test.ts` cases, plus Codex's own interrupted-run probe.

**B7. Document size indicators.** `e73cee2` (its second part, "Import: pages, words and quality-review coverage"), shared by both copies. Establish: pages are "not known" with a reason, never zero, when there is no PDF copy or it cannot be read; words come from the stored text; the "reads about the first N%" figure uses the same 150,000-character limit as B6; a late answer for a previously selected file is dropped. Pass: `documentIndicators.db.test.ts`.

**B8. Projects page statuses (3001 only).** `300d0bc`. Establish: the projects listed and the current-project switcher are only the signed-in organisation's; status is derived from records each time (no files: Setup needed; a finding awaiting a decision: Review needed; otherwise In progress); `?section=` opens a section only when it exists. Pass: `projectStatus.test.ts`, `projects-page.check.mjs`; Codex's two-organisation probe shows no other organisation's project.

## C. Asynchronous UI state and human work (standard 5 and 9)

**C1. Set objectives workspace (3001 only).** `4cbb8ff`. Files: `ObjectiveSetup.tsx`, `objectiveSetupPresentation.ts`. The drawers are one form posted to `saveRunContext`, so every field is sent together. Establish: saving from one drawer cannot blank a field held in another drawer, or an objective being edited; switching objectives asks before dropping an unsaved edit; a failed save keeps the draft; "saved" shows only after the save succeeds. Pass: Codex's edit, switch, fail and reload sequence loses nothing.

**C2. Business decisions list and workspace (3001), evidence summary (both).** 3001 `4cbb8ff`, `736b2d2`; 3000 `f46b479`, `5108b17`. Establish: the downstream warning still separates earlier from unknown recommendations (the 17 October contract, `8fa326c`), including after reload; "What the evidence shows" is marked as AI-generated. Pass: the decision-refresh checks pass on both copies and the warning text matches across them.

**C3. Cross tabs opened directly.** 3001 `f688a3f`, `2567d2b`; 3000 `5ea57d5`, `3a35e52`. Files: `CrosstabsSection.tsx`, `DataFileSection.tsx`, `CrosstabWorkspace.tsx`, `lib/crosstabEntry.ts`.
- Establish: switching files and back keeps an unfinished table, its filters and settings; the last-used file (localStorage `data-file-last:<runId>`) falls back safely when that file has been deleted or storage is blocked; a file that needs its setup accepted shows Accept and does not build anything; opening builds nothing and calls no model.
- Pass: `crosstabs-entry.check.mjs`; Codex's deleted-last-file and blocked-storage probes.

**C4. Analytics workspace.** 3001 `0d41e72`, `51e7c19`, `7fe70ea`, `c6dc100`; 3000 `b42db18`, `e474d6c`. Establish: switching between tools and back keeps the chosen file; a driver run started before a file switch cannot write its result to the new file's view (late-response ordering); a saved driver analysis reloads with its settings; the right pane appears only once something is saved. Pass: `analytics-landing.check.mjs`, plus Codex's late-response probe.

**C5. Coding and Reports and decks (both).** 3001 `169b14d`, `020c04d`, `2a835a8`, `0afd1c3`; 3000 `6a8dc08`, the same changes in one commit (the Coding and Reports sections of `page.tsx` are identical in both copies). Files: `DocumentPicker.tsx`, `page.tsx`, `TranscriptSetup.tsx` (CodeGate wording).
- Establish: the chooser remounts the selected file's card (keyed by id). Does a running Code themes job keep running and show its progress again after switching away and back, and is a half-made choice on the card lost without warning? When the list changes after a server refresh (a transcript deleted in Sources), the selection falls back to the first file without an error. Opening Reports and decks calls no model (the check counts usage records). Quality and exports appears only for a coded transcript.
- Pass: `coding-reports-sections.check.mjs` passes for Codex; the running-job probe either keeps progress or the gap is recorded. Also on 3000: the ported sections match 3001's line for line, and the full 3000 suite passed after the port (61 passed, 1 skipped; see the handover).

**C6. Review objectives rolled up (3000 only).** `20b77b8`, `69f8b38`, `c240846`. Establish: a rolled-up objective's wording is still reachable (toggle has a name and state); editing always shows the full text; acceptance and edit provenance are unchanged. Pass: `objective-review-acceptance.mjs` passes.

**C7. Collapsed main menu icons (both).** 3000 `37bb569`, 3001 `07d3875`. Files: `sectionIcons.tsx`, `CollapsibleRail.tsx`, `GlobalNav.tsx`, `GlobalShell.tsx`, `RunShell.tsx`. Establish: the strip is always rendered (hidden while the menu is open) so RunNav keeps its portal targets; each icon has a name and `aria-current` on the current section; a section without an icon shows letters; blocked storage still toggles. Pass: `global-rail.check.mjs` and `sidebar.check.mjs`. Note: the full suite on both copies failed this check after these commits, because it still expected no destination link in the hidden menu; the check was corrected (`dbfc2ea`, `d4596dd`) and passes 2 of 2. Please confirm the correction tests the new behaviour rather than merely loosening the old assertion.

**C8. Shared panes.** `ThreePane.tsx` (left and right optional; `leftDefaultPx`, `leftMaxShare`; the `workspace` style, which on 3000 arrived with `6a8dc08` and moved each style's border width into the style). Establish: the left, middle, right and plain panes render exactly as before on 3000 (border width included); stored widths from the older layout shapes are still read safely; a screen with its own `storageKey` does not overwrite another's. Pass: `three-pane.check.mjs`.

## D. Parity between the two copies

**D1. Which changes each copy has.** The copies diverged at `79e00b3`, so everything up to it (including the 100 MB limit, the workbook speed fix, the worker reload, file opening and document size) is in both. After it, 3000 alone has: the manual questionnaire match (`48481b4`, `ce6fabf`), the separate guide types with automatic reading and the Weights and missing codes tab (`d52acbf`), the type groups and sorting (`c36964a`), and Review objectives rolled up (`20b77b8`, `69f8b38`, `c240846`). 3001 alone has: the Projects page (`300d0bc`), the global rail with Programs and Help (`3046264`), the Import visual refinement (`717b831`), Set objectives and Business decisions as list and workspace (`4cbb8ff`), and Research quality dimension cards (`3b30786`). Coding and Reports and decks is now in both (3001 `169b14d` to `0afd1c3`, 3000 `6a8dc08`). Claude checked this by file comparison (`diff -rq src` lists 38 differing or one-sided files) and by commit history. Pass: Codex confirms the table, and raises any security or calculation change present in one copy only as a finding.

**D2. Ported changes keep their meaning.** Changes taken from 3001 to 3000 (Sources, Research quality layout, Cross tabs entry, set keys, Analytics) were re-applied, not merged. Establish: the shared business-rule files are identical where they should be (`lib/variableSetKeys.ts`, `lib/scatter.ts`, `lib/scatterActions.ts`, `lib/chartKinds.ts`, `lib/crosstabEntry.ts`, `lib/driverPresentation.ts`), and list any that differ. Pass: no business rule differs without a reason.

## E. Maintainability, comments and checks

**E1. Comments against code.** Especially the header comments of `DocumentPicker.tsx`, `CrosstabsSection.tsx`, `DataFileSection.tsx`, `ThreePane.tsx`, `ObjectiveReviewTable.tsx`, `ScatterVisual.tsx` and `marginOfError.ts`, which changed several times today. Pass: no comment describes an earlier layout or claims a guarantee the code does not give.

**E2. Lint.** ESLint was run on changed files only. `RunShell.tsx` has two pre-existing `set-state-in-effect` errors on both copies (present on parent commits). Pass: no new errors on a whole-repo run; the two pre-existing ones listed separately.

**E3. Full suites.** Rerun on each HEAD: `npx tsc --noEmit -p .`; `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`; `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` against `scripts/e2e/local-stack.mjs`; `npx playwright test` (smoke); `node scripts/e2e/objective-review-acceptance.mjs`. Claude's results tonight are in the handover (section "Checks run"). Pass: Codex's own counts, with any failure kept beside its rerun.

**E4. Help text and manual.** `src/app/manual/page.tsx` and `src/app/knowledge/content/decisions.tsx` differ between the copies. Establish: each describes the screens that copy has (for example, no "three panes" wording for a two-pane screen, and the Analytics and Charts wording matches the tools). Pass: no instruction refers to a control that is not there.

---

**For Grant, not Codex:** migrations 0102 to 0107 must be applied, in order, wherever the app runs (0106 and 0107 are new since the last applied set Claude knows of). Nothing has been pushed or deployed, and no development or live database was touched.

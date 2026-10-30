# Batch R5fmcg handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `r5fmcg`, base `b3e230f`. Approved by Grant ("yes, we need
it ... don't want to over complicate"). No migration: the tracker type is one more key in the programme's saved choices
(`tracker_dashboards.choices`, JSON, migration 0132).

Tier A (recognition and saved choices change research meaning), with tier B screen changes (Customise dropdown, stage
labels).

## What changed

1. **"Bought in the past 3 months" is usage in that window, not acquisition.** A per-brand question with a buying or
   using word and a recent window (past week, past month or 4 weeks, past 3 months, past 6 months; P1W, P1M, P4W, P3M,
   P6M) is usage in that window: FMCG penetration. The rule runs after repeat and before acquisition. A take-up wording
   (acquired, acquisition, started, joined, switched, signed up, took out, opened) stays acquisition whatever the
   window ("Acquired", "Recently acquired", "Started using in the past 3 months", telecoms' "Past 90 days category
   start").
2. **The 12-month purchase is decided by tracker type.** A buying word with a 12-month window is acquisition for
   Durables (as before) and annual penetration (usage) for FMCG. The recogniser keeps `stage` = acquisition and adds
   `stageByType`; `resolveDashboard` applies the type in effect to a stage nobody chose, and only when no other
   question already has that stage, so an FMCG file with P3M and P12M keeps P3M as usage and P12M as acquisition (the
   type never creates a contest). Take-up wordings with a 12-month window ("Past 12 month household acquisition",
   "Past 12 months category start") are acquisition for both types.
3. **Time window**, a new recognised attribute of each per-brand measure: past week, past month, past 3 months, past 6
   months, past 12 months, ever, currently, or unknown, from the wording, else from the answer labels when they agree
   on one; two periods are unknown; unknown is never read as a period. Shown compactly beside the stage on every tile,
   Customise stage row, funnel row and trend chart ("Usage, past 3 months", "Trial, ever", "Usage, currently"; an
   unknown window only on a behaviour stage, as "window not stated").
4. **Wave comparison only for the same window.** `changesAgainst` (the shared comparison owner, used by every page that
   shows a stage change) withholds a change whose window differs between the waves, with the reason "The time window
   changed (past 3 months in the previous wave, past month now), so it is not compared." The trend chart draws no
   point for a wave with another window and lists it under the chart (`windowChangeReason`, the same rule).
5. **Tracker type: Durables or FMCG.** Suggested from the questions with the reason (rule below), shown in Customise
   dashboard as one dropdown "Tracker type" ("Suggested: FMCG", Durables, FMCG) with the "Suggested from the questions:
   ..." text, saved as a programme choice through `saveTrackerChoices`. It sets the overview's stages and order,
   exposed by the owner as `ResolvedDashboard.overviewStages`: Durables = awareness, consideration, shortlist, first
   choice, usage (owner), acquisition; FMCG = awareness, consideration, trial (ever tried), usage (bought in the
   window), frequent usage (bought most often); no type = the seven stages used before. The four headline trend charts
   are the first four of that list (the compact redesign in parallel can read the same list; panel edits are minimal).
   No other new setting.

### Tracker type suggestion rule (`suggestTrackerType`, `src/lib/trackerType.ts`)

- FMCG when the file has a usage question in a window of 3 months or less (past week, past month, past 3 months) or a
  bought most often question (frequent usage: "most often", "frequent", "regular", BUMO), and no shortlist or first
  choice question.
- Otherwise Durables when it has a shortlist or first choice question, current ownership or use (usage, currently), or
  an acquisition in the past 12 months.
- Otherwise no suggestion: "The questions do not suggest a type ... Choose one." No brand list: no suggestion.
- Results: BMW, banking, insurance and telecoms packs: Durables; Grant's coffee raw files (P3M, Frequent): FMCG; the
  synthetic snack tracker: FMCG.

### Saved-choice contract (`TrackerChoices.trackerType`)

- Stored as text in `choices` (normaliseChoices keeps any short text; null or absent means "use the suggestion").
- A new or changed value must be `durables` or `fmcg`; anything else is refused before any write (`"services" is not a
  tracker type. Choose Durables or FMCG.`). An unchanged stored value is kept like other carried choices.
- A stored value the app does not know is reported under "Still to decide" and the suggestion is used until a type is
  chosen; it is never read as either type.
- Saved with the same compare-and-swap as every other choice (scope and revision; a stale save is a conflict that
  returns the current choices; "Saved" only after the save succeeds; Reset to suggested clears it). The suggestion
  record saved with the choices now includes `windows` and `trackerType` (`TRACKER_ROLE_RULES` = `r5fmcg-2026-10-30`).

## Impact checklist

1. **Rule:** recognition (`claude/rules-registry.md`, "Which tracker a file is ..."), brand figures (change against
   the previous wave), configuration (saved choices). Owners used: `stageOf` in `trackerRoles.ts`, `changesAgainst`
   in `trackerFigures.ts`, `resolveDashboard`/`choiceProblems`/`normaliseChoices` in `trackerDashboard.ts`,
   `saveTrackerChoices` in `trackerDashboards.ts`. New rules with a registry row and contract (tracker-roles.md 3, 3a,
   7a): `src/lib/trackerWindows.ts` (window reading, wording, comparison rule; import-free so the screen uses the
   same rule) and `src/lib/trackerType.ts` (suggestion, stage lists). No second version: the screen imports
   `windowSuffix` and `windowChangeReason` from the owner.
2. **Inputs:** no window stated: unknown, shown on behaviour stages as "window not stated", never a period. Two
   periods: unknown with the reason. A known window against an unknown one between waves: withheld; two unknown
   windows compared (the same variable at the same stage; documented). No type suggested: the previous seven-stage list
   and a reason asking for a choice. Unknown stored type: reported, suggestion used.
3. **Persistence:** no new table or column. The type is one key in the existing choices JSON, written in the existing
   transaction with the project row locked, ownership and file checked, revision compare-and-swap, unique first save.
   Retry: a repeated save with the old revision is a conflict, never a duplicate. Partial failure: one statement.
4. **Freshness:** the dashboard is computed on every read and saves no findings, insights or tables, so nothing goes
   stale. What changes meaning on read: a stage that was acquisition ("Bought in the past 3 months") is now usage; the
   overview's stage list follows the type; a change across a changed window is withheld. Human decisions survive:
   chosen stages are never changed by the type or the new rules (a chosen stage keeps `source: "chosen"`). Under FMCG,
   a 12-month purchase read as usage leaves the acquisition stage, so pages that read acquisition (Audience "recent
   acquirers", Category "acquired" repertoire) say it is not measured unless the researcher maps acquisition.
5. **Screens:** the dropdown is part of the Customise draft: nothing changes until Apply; "Saved" only after the save;
   a conflict reloads the stored choices (existing apply path). Reload shows the saved type. The stage rows in
   Customise follow the type in effect (applied, not the unapplied draft).
6. **Proof:** below.

## Files

- New: `src/lib/trackerWindows.ts`, `src/lib/trackerType.ts`, `src/lib/__tests__/trackerFmcg.test.ts`,
  `src/lib/__tests__/trackerFmcg.db.test.ts`, `e2e/ui/tracker-fmcg.check.mjs`, `fixtures/tracker-fmcg/make_fmcg.py`,
  `fixtures/tracker-fmcg/fmcg_wave1.sav`, `fixtures/tracker-fmcg/fmcg_wave2.sav`.
- Changed: `src/lib/trackerRoles.ts` (stage rule order and recent purchase or use, BUMO, P1M/P6M/P1W/P4W; `window`,
  `windowReason`, `stageByType`, `trackerType` on the recognition), `src/lib/trackerDashboard.ts` (choice, validation,
  resolved type, type-dependent stage, `overviewStages`, window on stages), `src/lib/trackerDashboards.ts`
  (suggestion record), `src/lib/trackerFigures.ts` (window on stage figures, comparison rule, `overviewMeasures` reads
  `overviewStages`; `OVERVIEW_STAGES` removed, its list is `OVERVIEW_STAGES_UNTYPED`), `src/lib/trackerOverview.ts`
  (tiles in the type's order with their window; candidates with window),
  `src/app/runs/[id]/TrackerDashboardPanel.tsx` (dropdown, stage labels with window, headline charts from
  `overviewStages`, trend points withheld across a changed window), `e2e/ui/tracker-dashboard.check.mjs` (BMW is now
  Durables: six tiles with a question; the hide/show case runs under FMCG, where trial and frequent usage are blank),
  `src/lib/__tests__/trackerFigures.db.test.ts` (BMW overview stages now include acquisition), docs
  `claude/tracker-roles.md`, `claude/rules-registry.md`, `claude/d2-design-2026-10-29.md`.
- Callers and consumers checked: `trackerAdvertising.ts` and `trackerAssociations.ts` (`overviewMeasures` for awareness,
  in every type's list), `trackerCategory.ts` and `trackerAudience.ts` (`stageClaims`, unaffected by the list),
  `trackerDashboardActions.ts` (passes raw choices to `saveTrackerChoices`, which validates).

## Proof

GATES_PLACEHOLDER

## Mocks versus real

- Unit tests: pure functions, no mocks except the module stand-ins needed to import `trackerFigures`/`trackerOverview`
  (storage client, request context, Next cache), which the tested functions do not call.
- `trackerFmcg.db.test.ts`: real disposable PostgreSQL (migrations applied), the actual Python engine reading the SPSS
  files; storage is an in-memory stand-in. The reference is an independent pandas reading of the same files.
- Browser checks: production build (`next build --webpack`) on the disposable stack (local database, storage and auth
  stand-ins, model replay).

## Limits

- Customise lists the stages of the type in effect: under Durables, trial and frequent usage are not offered as tiles
  (they are under FMCG, and the type can be switched); under FMCG, shortlist, first choice and acquisition are not.
  The mapping of any question to any listed stage is unchanged.
- The window reader knows English wordings and the P-forms listed; other languages or forms ("L3M", "in the last
  quarter-year") read as unknown, shown as "window not stated", never guessed.
- "Currently" also matches "own" and "now", so a wording such as "Would buy now" reads as currently; it is shown, and
  the stage rules decide the stage independently.
- Two unknown windows are compared across waves; if a questionnaire changed an unstated period between waves without
  saying so, the app cannot tell.
- Services as a tracker type is not offered (Grant: not now).

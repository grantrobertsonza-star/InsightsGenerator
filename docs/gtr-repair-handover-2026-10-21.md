# Handover: GTR-01, GTR-02, SEC-01, SEC-02 and M-GTR-01 (main copy), 21 October 2026

Status: **implemented, ready for independent review.** Repairs for `docs/independent-gt100-rereview-main-2026-10-21.md`, main copy (`C:\Personal\InsighsAI\app`, port 3000) only; 3001 stays out of scope. Base: `ea9f398` (the frozen head of that review). The last accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; no migration added.

## Review targets

| Commit | What |
|---|---|
| `9ff70e5` | Keys on the server elements handed to the section workspaces (removes React's development warning Grant saw; no behaviour change) |
| `12ae030` | GTR-01: partial questionnaire schema drift refuses calculations |
| `bfb6df5` | GTR-02: support rows, quotes and report text from one snapshot |
| `b007ef4` | SEC-01 and SEC-02: one HTML-safe theme key (design; please review with the design) |
| `979cdc9` | M-GTR-01: engineering briefs in `claude/` |
| `74ed2ef` | Design, at Grant's request: filters across the top (Findings, Insights, Report claims, Recommendations) and theme tiles (please review with the design) |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-keys,m-gtr1,m-gtr2,m-sec,m-briefs}/hashes.txt`. The briefs package was applied by hand (the apply script compares the whole tree when none of a package's files is tracked yet); its four files were then checked against the package hashes, all equal.

## GTR-01

`getConfirmedItemsForData` (`src/lib/instruments.ts`) treats a missing table or column as "no confirmed links" only when `questionnaireSchemaAbsent` establishes, with `to_regclass`, that neither `instrument_links` nor `instrument_items` exists (the clean schema before 0060). With either table present, every lookup failure (a renamed `routing_text`, a links table missing beside items, permission, connection) raises `InstrumentMeaningUnavailableError`, and calculations refuse before the engine is called. The presence check fails closed. Refusal was chosen over a compatibility query that keeps labels without routing. The comment's inference is corrected. `crosstabs.ts` is unchanged.

Tests: `instrumentMeaningLookup.db.test.ts` adds renamed `routing_text` with a confirmed link (lookup, `loadCategories` and `buildCrosstab` refuse with no engine call; saved tables and the link unchanged; restored column recovers the Yes/No/Don't know overlay), links table missing beside items, and presence-check failure (the one mocked boundary, a proxy that fails only the `to_regclass` query). The old-schema control now removes both tables. The 3 new cases fail on `ea9f398`; the 3 controls pass.

## GTR-02

`loadInsightSupport` and `loadPreInsightSupport` (`src/lib/supportStatus.ts`) read the catalogue check, the support rows and the report texts inside the existing `withTenantRepeatableRead` (`src/lib/db.ts`, unchanged), so a concurrent deletion or an atomic quote-and-text replacement is seen whole. The text was not folded into the main query, to avoid repeating full report text on every link row. A failed text read still throws, so the `...OrUnchecked` wrappers report unknown with the error. The false comment is corrected; the header says what is not atomic: the settings lookups in `classifyRows` run afterwards on their own connections, and separate loaders in one export are separate snapshots.

Tests: new `supportQuoteSnapshot.db.test.ts` (real PostgreSQL; the app pool's clients run the concurrent change from another connection straight after the main support query, which is between the two reads the old code made): actual `deleteDocument` with both loaders (coherent before-state during the read, invalid on a fresh read, the actual Accepted Slides deck says "Left out: support no longer valid"); atomic valid-to-valid replacement (never `quote_missing`); missing quote; failed text read (unknown, then current on retry). 3 of the 6 fail on `ea9f398` (both deletion cases and the atomic case); the 3 controls pass. Four test doubles of `../db` gained `withTenantRepeatableRead`.

## SEC-01 and SEC-02

`themeKeyOf` (`src/lib/evidenceOverview.ts`) gives `"t:"` plus the trimmed text for a named theme and `"none"` for null, empty and whitespace-only themes: plain text, safe in HTML attributes, unable to collide with `"__all__"`. `themeLabelOf` gives the text, or "No theme set", so a theme literally named "No theme" is its own key and label. In `FindingsTable.tsx` the pills (count, order, React key, label), card groups and their order, chart eligibility and toggles, colours, the dropdown and the filter all use the key; pills carry `data-testid="theme-pill"` and `data-theme-key`. Stored themes are never rewritten; the per-finding theme editor is unchanged.

Tests: `evidenceOverview.test.ts` adds the literal "No theme" collision and key round-trip, key character safety (no control characters, U+FFFD or noncharacters) and pill count equal to the IDs opened (2 fail on `ea9f398`). The browser check `findings-insights-overview` seeds "SEC Trust", " SEC Trust ", null and "No theme" and asserts one pill per key with the right label and a count equal to the database, exact visible IDs on click, clear, the native select (no U+FFFD, `none` selects exactly the unthemed findings), keyboard selection, reload, and unchanged stored themes.

## Filters across the top and theme tiles (design, `74ed2ef`)

`ThreePane` gains `leftOnTop`: the left pane becomes a full-width band above the list and the detail, its blocks in columns, foldable to its header (remembered per screen under `three-pane-top:<key>`, content kept mounted), with the list and detail keeping their resizable split below (stored under its own key). Insights, Recommendations and Report claims use it. The Findings review's own filter column becomes the same band as a `details` element (folding keeps the choices). Its theme pills become tiles across the band: the 15 most common first (count, then label), a search when there are more than 15, Show all for the rest; the chosen theme stays visible even when it is not among them. Tiles keep the SEC-01 key, label and counts. First trialled on 3001 (`db659d1`, `b9c26da`).

## M-GTR-01

New briefs: `claude/questionnaire-meaning-failure.md`, `claude/support-grounding-and-dependencies.md`, `claude/scatter-wording-confirmation.md`, `claude/section-overview-counts.md`. Each states the lasting contract, the authoritative implementation, compatibility, concurrency and failure boundaries, the tests and the limits.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

Full suite on the final tree (`74ed2ef`):

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| Browser checks (`e2e/ui/ui-check.config.mjs`, 1 worker) | 67 passed, 1 skipped |
| Golden-thread smoke | 1 passed |
| Objective review acceptance | passed |
| Unit and database tests (`vitest --pool=forks`) | 1,269 passed, 66 skipped (174 files, 1 skipped) |
| `npx eslint .` | 349 errors, 40 warnings (errors unchanged from Codex's baseline) |

The same full suite also passed on `979cdc9` (before the design change): browser 67 passed, 1 skipped; unit 1,269 passed.

Targeted before committing: the repairs, `findings-insights-overview`, `recommendations-report-overview`, `journey-changes` (7), `journey-exports`, `main-recommendation-exports`, `review-action-failure` (12 of 12); the design, those plus `group-correction-calculation`, `research-quality`, `sidebar`, `three-pane` (5) and a scratch probe seeding 40 extra themes (15 tiles shown, search 11, Show all 42, a tile opens exactly its one finding) (21 of 21). The probe is not retained.

Previous-code controls: GTR-01, the 3 new cases fail on `ea9f398`; GTR-02, 3 of the 6 new cases fail; SEC, 2 of the 3 new unit cases fail.

## Limits

- GTR-02: an export that calls several support loaders is not one atomic read (stated in the code).
- GT100-F02 limits stand: the findings Excel "Quote verified" column shows the value recorded at extraction.
- The Import screen's dictionary fallback for trimmed files still shows the capped view on any error (display only).

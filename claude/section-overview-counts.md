# Section overviews: every count opens the records it counts

Findings, Insights, Recommendations and the Insights report each open on an overview, with the
review (or the narrative and exports) as the second tab, kept mounted so unsaved edits survive tab
changes (`FindingsWorkspace`, `InsightsWorkspace`, `RecommendationsWorkspace`,
`InsightsReportWorkspace` in `src/app/runs/[id]`). The rules live in `src/lib`: `evidenceOverview.ts`,
`recommendationOverview.ts`, `reportReadiness.ts`.

**Counts and drill-downs.** One matcher per overview (`insightMatches`, `findingNeedsAttention`,
`recommendationMatches`) produces each count from the very filter its click opens, and the review
lists with the same function, so a count and what it opens cannot disagree. In-use figures exclude
rejected records through the filter itself. A headline that sums several figures, or a figure no
filter matches (report verdicts, the reviewed total), is plain text; full-list links are separate
and labelled. Insights whose sources were not checked for independence (`independent_source_count`
null) are "Independence not checked", never Strong. Recommendations inherit their insight's support;
unknown is never current. The Insights report counts follow the export rules (no longer valid left
out; changed and not checked included with a qualification) and say that edits after the narrative
was generated are not checked (no edit time is stored).

**Theme identity** (Codex OV-03, SEC-01, SEC-02). `themeKeyOf` is the one identity: `"t:" +` the
trimmed text for a named theme, `"none"` for null, empty or whitespace-only. Keys are plain,
HTML-safe text (a control-character sentinel was turned into U+FFFD by server-rendered option values).
`themeLabelOf` gives the trimmed text, or "No theme set" for unthemed findings, so a theme literally
named "No theme" stays its own theme with its own label. Pills, counts, order, groups, colours,
chart toggles, the dropdown and the filter all use the key. Stored theme text is never rewritten.

**Layout.** Tiles shrink to the container; below 768px the main menu starts hidden when no choice
is remembered and, opened, lies over the page.

**Tests.** `evidenceOverview.test.ts`, `recommendationOverview.test.ts`,
`recommendationsReviewRequest.test.tsx`, `reportReadiness.test.ts`; browser checks
`findings-insights-overview` (exact ID sets, rejected copies, padded and literal "No theme" themes,
the native select, keyboard, reload, 375 and 768 px) and `recommendations-report-overview`.

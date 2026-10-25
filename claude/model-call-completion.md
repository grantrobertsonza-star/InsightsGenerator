# Model calls: using only finished results

Codex release audit RR-F01 and RR-F02 (2026-10-23). A forced tool call (`tool_choice` naming one
tool) that finished stops with `stop_reason: "tool_use"` and carries that tool's block. A call cut
off at `max_tokens` can still carry a block whose input is only what was written before the cut
(one objective of three, half a methodology sentence), and it reads as complete. A refusal or any
other stop carries nothing to rely on.

`src/lib/modelToolResult.ts`:

- `finishedToolInput(response, toolName, what)` returns the tool's input object, or throws
  `UnfinishedModelResultError` with a reason (`max_tokens`, `refusal`, `other_stop`,
  `no_tool_use`, `malformed`) and a sentence naming the work (`what`).
- `optionalTextField(input, field, what)` reads a string-or-null field (absent is null, blank is
  null); any other type is `malformed`.
- `requiredTextOrNullField(input, field, what)` is the same for a field the tool's schema requires:
  absent is `malformed` (Codex batch10: `{}` was taken for a finished reading that found nothing).

A finished call that legitimately finds nothing is the caller's own field rule, never this
helper's: a brief with neither field returns nulls (a fill that found nothing); a methodology
reading with `found: false` keeps the saved text.

## Callers

| Caller | On an unfinished result |
|---|---|
| `briefIntake.extractBriefFields` (both fields required) | throws, including when either field is missing; `saveRunContext` records `brief_intake_error` and returns a failed fill with its retry, keeps what was typed, adds no objective and records no `brief_intake_used`, so the same document is read again on the next fill |
| `methodologyExtractor.generateMethodologySummary` | throws before writing; the saved methodology stays; the processing step records `methodology_extraction_error`. A finished reading records `methodology_extraction_done`. `methodologyStatus.latestMethodologyFailure` (the later of the two) is shown in the Insights report section, and the Word report says the methodology could not be read when nothing was read before, rather than that none was stated |

| `extractFindings` report reading, per part (Codex SEC500-F01) | a cut-off answer, an answer with no findings list (absent or not a list) and one whose returned findings are all unusable (each needs text, a quote, a theme and a recognised kind) fail the part; `extract_findings_bad_response` records the reason (`no_findings_list`, `no_usable_findings`). A single-part report then throws and is stamped failed, and every part failing throws; nothing is replaced and the previous findings stay. A part with some unusable findings left out keeps the usable ones and counts with the failed parts (`some_findings_unusable`), so the reading is partial: it cannot retire previous findings, and a first reading that publishes is marked incomplete. An explicit empty list is a genuine empty reading and still replaces unprotected findings |
| `storyNarrative.generateStoryNarrative` (Codex RR-F06) | throws before writing, on a cut-off, refused or missing result and when a required text field is not a string or `pillars` or `caveats` is not a list, when the executive summary, situation, complication or governing thought is blank (Codex batch12 RR-F06), and when the question is blank and the project has no decision statement; the saved narrative stays; the action records `story_narrative_error`. `latestNarrativeFailure` (an error newer than the saved narrative) is shown in the Insights report section even when an earlier narrative exists, saying the report shown is the previous one |

Other model calls have their own completion checks (the assistant loop, research quality,
crosstab reading, instruments, findings extraction, coding); the audit's Part 2 sweep covers the
rest.

## Tests

`narrativeWrongGroup.db.test.ts` (RR-F06): cut-off, refused, missing summary and non-list pillars,
a whitespace-only summary, an empty situation, and a blank question without a decision statement
each leave the saved summary and show the failure; a blank question with a decision statement is
accepted; a finished generation replaces it and clears it.


`src/lib/__tests__/releaseAuditRepairs.db.test.ts` (real database, model client and storage
controlled): cut-off fill saves nothing and the ordinary retry fills; refusal, no tool result,
another tool, a malformed field and a non-object input are failed fills; a finished empty fill is
not a failure; cut-off, refusal, no tool, found-without-text and malformed `found` leave the
methodology; a finished reading replaces it and clears the failure; `found: false` keeps it; the
Word text for an unread methodology. The cut-off, refusal, no-tool and malformed cases fail against
the extractors as they were before the repair (checked by running them against the previous files).

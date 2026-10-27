# The Mean tick (batch 48, 27 October 2026)

Grant: "add Mean to the Show in each cell list", with the mean row at the top of each rating-scale
question, ticked by default.

## Rule

Owner: engine `crosstab` (`api/parse-stats-file.py`, `meanRows` in the request). When the request has
`meanRows: true`, every single choice question whose codes form a rating scale gets a mean row above its
answers:

- **Which questions:** numeric answer codes judged an ordered scale by `_is_ordered_scale` (the file's
  measurement level; a numbered scale of 10 or more points, labelled or not; or scale wording in the
  labels). It is the same rule that already decides a question's own mean and spread.
- **The figure:** the weighted mean of the codes, don't know, refused and not applicable codes left out
  (`_DK_RE`), per column and in total. It is tested like any mean (difference of means against the rest
  of the banner variable, or the design t-test), with letters.
- **The row:** label "Mean", marked `autoMean`, `isMean`. A question that already has a mean group of the
  researcher's own gets no second one.
- **Answer labels do not enter it** (B48-F01, batch 48R): the row is the mean of the raw codes, so it never
  resolves labels to codes. Two codes sharing a label (2 and 3 both "High") still get the row, with the same
  figures as distinct labels give. A group the researcher defines by its labels still refuses a label shared
  by several codes (`_resolve_group_labels`), naming it in `skipped`.
- **Not a scale** (regions, brands, text answers): no mean, and the question is named in
  `notes.meanNotAdded` ("No mean row for ...: their answer codes are not a rating scale ..."), shown under
  the table.
- **Absent or false:** no mean rows, nothing named. A request saved before the tick existed has no
  `meanRows`, so a wave rebuild or replication of an older table builds as it did.

The request is checked at `buildCrosstab` (a non-boolean is refused, nothing saved), saved as
`savedRequest.meanRows`, and recorded in `provenance.meanRows`.

## Screens and exports

- Table settings, Cell display: "Mean", on by default (`DEFAULT_CELLS.mean`). Sent with CrossTabs and
  StarterTabs builds. Other ways of building (plain-English, the assistant, objectives) do not set it.
- A built table with mean rows shows a "Mean" tick (in "Show in each cell" in the stacked view, beside the
  other options otherwise). Unticking hides those rows on screen; the Excel, PowerPoint and PDF links then
  carry `mean=0`, and the export route leaves them out of every format (`withoutMeanTickRows`). Defined
  mean groups are never hidden by it. Nothing is recalculated.

## Findings

Committing a table makes a tested difference on a mean row a finding, worded "The mean of <question> is
higher for <group> (x) than overall (y)". The display tick does not change what is committed: the content
is decided when the table is built.

Repair found while proving it: a question's candidate findings were ranked by their gap, which mixes
units (a mean's gap is in scale points, an answer's in percentage points), so a tested mean or score
difference almost never kept a place among the question's findings. Summary rows (means and scores) now
rank first, then answers, each by its own gap (`crosstabFindings` in `crosstabs.ts`). This also
applies to mean and score groups the researcher defines.

## Tests

`scripts/crosstab_selftest.py` batch 48 cases (row placement, independent weighted means with don't know
left out, total, tested, no mean for a non-scale, the named question, off, no second mean);
`meanTick.db.test.ts` (real database and engine: saved, provenance, off and legacy, invalid refused,
commit makes the mean finding; the last fails without the ranking repair); `e2e/ui/mean-tick.check.mjs`.

## Limits

A rating scale stored as text answers ("1 - Very poor") has no numeric codes and gets no mean; it is named.
A numeric question with many values is a numeric question, not a single choice, and keeps its "Average" row.

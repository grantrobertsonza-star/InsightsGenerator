# Respondent-level quality checks

Grant, 26 October 2026, after Inspirient's survey quality assessment. Owner: `respondent_quality` in
`api/parse-stats-file.py`, loaded by `src/lib/respondentQuality.ts` and shown by
`src/app/runs/[id]/RespondentQualityPanel.tsx` on the Import screen's Data quality tab. Pinned by
`respondentQuality.db.test.ts` (a designed file whose every flag is known by construction) and
`e2e/ui/respondent-quality.check.mjs`.

**What it is.** Case diagnostics over every case of a raw data file, read in the file's saved layout and
sheet. Unweighted counts of respondents. Flags for the researcher to look at: nothing excludes a case,
changes a table or is stored. Each check says when it could not be measured instead of reporting zero.

**Batteries.** Five or more variables sharing a stem with a numbered or lettered item suffix (`Q13_1` to
`Q13_14`, `Q11a` to `Q11g`), where the stem carries a question number or a separator (so `F12` to `F20` are
not a battery "F"); every item numeric with whole-number answers on one scale of 3 to 11 points, not
counting non-answer codes (`_non_answer_codes`). Sets of 0/1 items ("tick all that apply") and
`_summary` companions are left out; an identifier or weight variable is never an item.

**Straightlining.** In each battery a respondent who answered at least five items scores the share of
their answers equal to their most common answer. One answer throughout is 1.0; "near" is 0.9 or more. A
respondent is flagged when they give one answer throughout at least two batteries and at least half of the
batteries they answered. One battery alone is not enough: it can be answered the same way honestly.
Reverse-worded items are not known to the check, which is one reason a flag is a prompt, not a verdict.

**Non-answers** (`_rq_non_answers`). Over the variables where the file says which codes are not
answers: a value label meaning no usable answer (`_DK_RE`), or a declared user-missing value or range.
Codes are identities, not numbers: a labelled text code such as "DK" counts (B36-F04). The denominator is
the answers a respondent gave to those variables, non-answers included; a blank is in neither count. A
respondent is flagged when non-answers are half or more of at least ten answers. An SPSS file is read a
second time with its user-missing values kept (`_rq_raw_answers`), for this check only; a Stata file
the same way, so its declared extended missing values (.a to .z) count as non-answers (a plain "." stays a
blank: pyreadstat returns it as 0 in that read, so only declared letters are taken from it): the analysis read,
every table and the read cache still treat them as missing. Without such labels or declarations the check
is "not measured". A diagnostic prompt: no case is excluded.

**Speeders.** The first numeric variable whose name or label reads as an interview length (duration,
length of interview, LOI, interview time, time taken, elapsed, seconds, minutes). Against the median of
positive lengths: under half is a speeder, under 30% a super-speeder (Inspirient's defaults); over three
times is reported as long, not flagged. The variable used is named on screen.

**Interviewers.** A variable whose name reads as an interviewer (interviewer, int_id, enumerator, field
worker, agent) with 2 to 1,000 values. For each interviewer with ten or more cases: cases, the share of
their respondents flagged for straightlining, and the median interview length. Marked to check when that
share is at least twice the overall share and at least 10 points above it, or the median length is under
half the overall median. The screen says differences can come from where or whom they interviewed.

**Respondents to look at.** Every flagged respondent, most flags first, the first 100 listed with their
identifier (the first identifier-like variable) or row number and the reasons.

**Limits.** Detection is by name and values, so a battery, duration or interviewer variable with an
unusual name is missed (the screen then says "not measured"); a researcher's own choice of these is not
yet saved. Thresholds are fixed constants in the engine (`RQ_*`), stated on screen.

# Batch D3b handover: customer satisfaction by company and against the previous wave (29 October 2026)

Status: implemented, ready for independent review. Branch d3b (worktree b88), on top of BatchD3a.

## What Grant gets

On the Tracker dashboard's **Customer satisfaction** tab (Grant: "CSM change against the previous wave, splitting by
company (for example per bank)"):

- **Showing.** A "Showing" choice offers all customers or one company. It defaults to the client's company when one
  is chosen or suggested. The tiles then show that company's figures.
- **Change since the previous wave.** Each tile has its change in points: the top-box share, or the NPS score.
- **By company table.** Every company with each headline and its change. The client's company is marked "(yours)".
- **Customise.** It now has "Company each customer rates" (the question) and "Which company is yours?". These are
  saved for the programme like the other choices.
- **Driver priority** stays for all customers. When one company is showing, the screen says so.

Brand tab: no change.

## Rules and owners

- **The company role.** It is found by `trackerRoles.ts` `companyOf`, a new CSM role `company`. It is a
  single-choice question whose wording names a company, bank, provider, insurer, network or operator and is not a
  rating. Its answer list must be names, not a scale; without an answer list, it must be a coded question with no
  stated scale.
  - Two candidates become a question; nothing is guessed.
  - It is looked for only in a CSM file without a brand list. In the brand packs, brand names such as
    "Standard Bank" otherwise read as companies. A file with a brand list compares brands through it.
- **Choices.**
  - `csm.company` holds the question.
  - `focalCompanyCode` holds the client's company. `choiceProblems` refuses a code the company question's answer list
    does not have.
  - The client's company is suggested from the programme's or project's name, the same rule as the client's brand
    (`prefilledFocalBrand`). For this, `TrackerDashboardView` now carries `scopeNames`.
- **Companies.** `trackerOverview.ts` `csmCompanyOf` takes them from the answer list, by code. "Other", "None" and
  no-answer codes are left out.
  - Without an answer list, figures by company are not shown, and the screen says the labels are needed.
- **Figures.** `trackerCsmFigures.ts` gives each box tile and the NPS tile a `byCompany` list.
  - Each list comes from the same owner (`runDistributionAction`, `runNpsAction`) split by the company question, read
    by the banner column's answer code.
  - Two additive fields carry that code: `ChartSeries.code` and `NpsSegment.code`. Existing callers are unaffected.
  - The all-customers figure is still the owner's unsplit reading.
  - A company whose figure the owner withholds (a small base) is listed with no figure.
  - A failed split is reported as failed.
- **Change.** `csmChangesAgainst` covers all customers and each company by code, unrounded, in points, with no
  significance claim.
  - It compares only when both waves read the same question by name. Otherwise it says why: a different question,
    not available in one wave, a company not in the previous wave, or the earliest wave.
  - The previous wave is the same `loadProjectWaves` file as the brand change.

## Impact checklist

1. **Rule:** the recogniser and the dashboard choices are the owners, and no figure is computed on the screen. The
   registry rows and `claude/d2-design-2026-10-29.md` are updated.
2. **Inputs:**
   - no company question: no split, no table;
   - two candidates: a question;
   - no answer list: a note;
   - a withheld company: no figure;
   - a failed split: failed, with the reason;
   - a different question in the previous wave: no change, with the reason.
3. **Persistence:** D2's compare-and-swap save only. There is one new validated choice key (`focalCompanyCode`).
4. **Freshness:** nothing derived is stored. Every open recalculates.
5. **Screens:**
   - The Showing choice is on-screen only.
   - "Saved" appears after the save, as in D3a.
   - An edit in Customise clears an earlier "Saved" note.
6. **Proof:** see Checks. `trackerCsmCompany.db.test.ts` cannot pass on D3a, which has no company split. The new
   recogniser tests fail on D3a, which returns no `company`.

## Checks

- `trackerCsmCompany.db.test.ts`: 3 tests, real PostgreSQL and the actual engine, banking pack waves 1 and 2.
  - **Every bank's figures, wave 2, weighted:** satisfaction top two, likely to continue (top two) and switching
    risk (8 to 10) match `reference_relationship_w1_w2.json` to 1e-6. NPS matches to within 0.05.
  - **Changes:** wave 2 minus wave 1 for all customers (satisfaction) and for FNB (continue) matches the
    references' difference. On wave 1, every change is "the earliest wave".
  - **The client's bank:** saved by code (Capitec shown as chosen). Code 42 is refused with the reason.
- `trackerRolesRaw.test.ts`, 2 new tests:
  - a second company question is asked about, never guessed;
  - a rating naming the bank, a scale list, or a yes/no flag is never the company.

  The three existing CSM expectations now include `company: "company"`, and the brand packs still raise no CSM
  question.
- Tracker suites: 8 files, 100 tests passed. Typecheck and lint clean.
- `e2e/ui/tracker-dashboard.check.mjs`, a new third test (banking waves 1 and 2, labelled):
  - 7 company rows;
  - the satisfaction tile and its change against the reference;
  - Showing Capitec gives Capitec's reference figures;
  - FNB chosen and applied is marked "(yours)".

  This runs with the full gates (see the package note).

## Limits

- No on-page filters yet. Driver analysis has no filter input, so filtering every tile needs an engine change. It is
  proposed as D3c: filters on the brand and CSM tiles first, then drivers.
- Driver priority is not split by company.
- No significance on changes.
- The Showing choice is not saved.
- A raw file whose company question has no labels gets no company figures. That needs a codebook or labels file.

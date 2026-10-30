# Batch R1 handover: workbook label sheets headed "value_label" (29 October 2026)

Status: implemented, ready for independent review. Commit c94314d on top of BatchUI1R (0504ebf).

## Finding (S1, found by Claude while testing D3 against Grant's packs)

A workbook whose labels sheet has a column headed `value_label` (the BMW and banking packs' own workbooks) was read
wrongly. The header reader matched `value label` with a space but not with an underscore. As a result, every
answer code took the variable's own label instead of its answer label. Identical labels then merged into one
category in Cross tabs, so a whole question could appear as a single answer. The recogniser also found no brand
list in the BMW workbook, and in the CSM workbook it found "brands" all called "Services work accurately and
reliably".

## Change

- `api/parse-stats-file.py` `_classify_header`: underscores and hyphens in a header are read as spaces, so
  `value_label`, `value-label` and `value label` are the same column.
- `DICTIONARY_VERSION = 15`, with a comment explaining why. `src/lib/crosstabs.ts` `minimumDictionaryVersion`
  returns 15 for xlsx, so a cached dictionary of a workbook is rebuilt on next read.
- `src/lib/trackerRoles.ts`: a labelled driver battery without question IDs is grouped by its question ID, else
  its set, else its name without the last part. The battery's name follows the same rule.

## Freshness and limit

- Dictionaries are rebuilt automatically, because version 15 marks earlier xlsx dictionaries as out of date.
- **Tables already built from an affected workbook keep their merged categories until rebuilt.** The table
  method version was not raised, because that would have marked every table in every project as out of date,
  most of them unaffected. A researcher who built tables from such a workbook should rebuild them. Codex may judge
  whether a narrower staleness marker is needed.

## Checks

- `scripts/crosstab_selftest.py` has two new "label sheet headed value_label" checks. The first fails on the
  previous engine (every code took the variable label) and passes now.
- `trackerRolesRaw.test.ts` has new cases on the packs' own workbooks
  (`fixtures/tracker-raw/bmw_car_workbook_wave1.json`, `banking_csm_relationship_workbook.json`):
  - BMW: ten brands by code, with Other and None set aside, and every funnel stage, 12 moments and 10 attributes.
  - Banking: every CSM role and the six labelled drivers, without the importance battery or contact counts.
- Five library tests pinned the dictionary version at 14 (the current version when they were written):
  `dictionaryCacheUpgrade.db`, `engineCodeIdentity`, `engineLabelConflicts`, `exactNumberBoundary.db` and
  `sheetSelectionConsistency`. The first full library run on R1 with D3a failed these, as intended by the version
  bump. They now expect 15. R1 had only been run against the self-test and the recogniser tests before, which is
  why this was not seen at the commit.
- Full gates are run with the D3a package.

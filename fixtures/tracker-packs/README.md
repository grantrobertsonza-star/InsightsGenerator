Grant's synthetic BMW car brand tracker pack (TestProjects, 28 October 2026), trimmed for the D2 tests
(src/lib/__tests__/trackerInput.db.test.ts, trackerDashboards.db.test.ts). Every record is synthetic.
- wave1_first20_labels_only.sav: the first 20 respondents of wave 1 as SPSS with the pack's variable and answer
  labels and nothing else (no question numbers, types or multiple-response sets): the usual raw file.
- wave1_first60.csv: the first 60 respondents of wave 1 as the pack's CSV (no labels).
- Master_Codebook.csv and metadata.json: the pack's, unchanged. The pack's guide says a CSV's labels and
  multiple-response sets "must be attached separately"; the tests import them as the codebook. Grant (29 October
  2026): such a JSON file is unlikely in practice, so the SPSS file is the main case.
Expected roles: claude/tracker-packs-role-spec-2026-10-28.md, section 3.1.

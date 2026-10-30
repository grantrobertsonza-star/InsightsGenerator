# U&A validation artifacts

These artifacts contain only the synthetic Karoo Drinks fixture results and local validation summaries. They contain no credentials or real respondent data.

* qa-db-wave-1/2/3.json: each supplied QA row, plus the actual result from the real database-backed U&A loader and Cross tab engine. There are 66 rows per wave, 198 in total. Counts are exact; weighted quantities use max(1e-6, abs(expected) * 1e-6) tolerance against the supplied file's precision. The application never imports this reference file.
* fixture-integrity.json: original file SHA256 and byte preservation through the committed checkout. The fixture folder's attributes disable text conversion for original inputs.
* routing-performance.json: paired complete-quality-output equivalence and timing against the base commit on the actual 5,000 by 600 reader output. Excludes I/O and browser time.
* framing-performance.json: paired complete-message equivalence and timing for the original and incremental 16 MB reply readers. Excludes engine, storage and browser time.

Executable proof lives in src/lib/__tests__/uaDashboard.db.test.ts, uaRoles.test.ts, uaPanel.test.tsx, scripts/ua_engine_selftest.py, scripts/ua_reference_controls.py, the two benchmark scripts, and e2e/ui/ua-dashboard.check.mjs. The handover records exact completed commands, counts, failed attempts and limits. Database, codebook reader, raw CSV readers and arithmetic are real; auth/storage boundaries and model orchestration use explicitly synthetic stand-ins. Mounted UI tests replace server actions.
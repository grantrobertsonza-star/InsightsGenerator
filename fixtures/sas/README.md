# SAS reference files

Real SAS datasets with independently produced expected values, used by
`src/lib/__tests__/dataFileFormats.db.test.ts` to verify SAS import before it was enabled
(26 October 2026). The app's reader (pyreadstat) cannot write `.sas7bdat`, so these come from an
outside source.

Source: the pandas project's test data, `pandas/tests/io/sas/data/` at tag v2.2.3
(https://github.com/pandas-dev/pandas), BSD 3-Clause licence. Each `.sas7bdat` file is paired with
the CSV pandas uses as its expected values.

| File | SHA-256 | Expected values |
|---|---|---|
| `airline.sas7bdat` | 3bbe13c2b810a6bd176491cd3ab807a13ec278298759a3e3d22e6febd6190112 | `airline.csv` (d8ea4161ca68cfad068c959f13760778162806e94ea5219805241a063472c4e9) |
| `test1.sas7bdat` | a9b3a0cfccb6fcce9d3797f95fc56f865c0aab8cb0d928efe08b5a3124a1cddc | `test_sas7bdat_1.csv` (87e76b2189a59ccbb5033df5130095a470b4c1208da8c2389a3bd4b5b5794925) |

In `test_sas7bdat_1.csv`, SAS date columns are written as days since 1 January 1960 (SAS's epoch),
and numbers are written to the precision SAS stored them.

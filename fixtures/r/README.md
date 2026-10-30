# R reference files

Written by R 4.3.3 itself (not by the app's reader), 26 October 2026, to verify R import
(`src/lib/__tests__/dataFileFormats.db.test.ts`, `e2e/ui/data-file-formats.check.mjs`).

```r
survey <- data.frame(
  id = 1:6,
  region = factor(c("North","South","South",NA,"East","North"), levels = c("North","South","East")),
  score = c(7.5, 8, NA, 6.25, 9, 5),
  visits = c(2L, 0L, 5L, 1L, NA, 3L),
  joined = as.Date(c("2024-01-15","2023-06-30",NA,"2025-02-28","2024-12-31","2020-02-29")),
  member = c(TRUE, FALSE, TRUE, NA, FALSE, TRUE),
  comment = c("good", "", NA, "late", "ok", "fine"),
  stringsAsFactors = FALSE)
notes <- data.frame(note = c("pilot", "main"))
saveRDS(survey, "survey.rds")
save(survey, notes, file = "survey.RData")
write.csv(survey, "survey-expected.csv", row.names = FALSE, na = "")
```

| File | SHA-256 |
|---|---|
| `survey.rds` | 84d9b94063bf7793e7f423356e9e5c1f18e22d98a375d3c677b86327a5647ea3 |
| `survey.RData` | 891920a936bd33788a61b3be463d3cd4db6a44e49241ed1c63111976389f4512 |
| `survey-expected.csv` | df52a88e252e33d82ad8ba075a0bec0db5b20063f71377fa842ebb2d29171ef3 |

`survey.RData` holds two data frames; the larger (`survey`) is the one read. `write.csv` writes both an
empty string and NA as an empty cell, so the comparison accepts either for those cells.

# Local cache of downloaded data files (stats-src)

Codex M-B8-01 (2026-10-23): the lifecycle contract for the respondent-data cache in
`src/lib/parseStatsFile.ts`.

## Scope

Only the local reading path (`runLocalStatsPython`), used when neither `VERCEL_URL` nor
`PARSE_STATS_FILE_URL` is set: data files read on the app's own server (the development laptop,
the disposable test stack). The remote parser (`/api/parse-stats-file`) does not write these files.

## Files

- `stats-src-<sha1 of the storage path>` in the operating system's temporary folder: one
  downloaded copy of a data file (SPSS, Stata, SAS, workbook). Respondent-level data.
- `stats-src-<...>.<pid>.<time>.part`: a download being written; renamed to the cache name when
  complete, so the worker never reads half a file. A crash can leave one behind.
- `stats-<random>/` folders from `mkdtemp` (input, output, arguments of one Python run) are
  removed in a `finally` after each run and are not part of this cache.

## Reuse and deletion

- Reuse: a cached copy younger than 10 minutes (`STATS_CACHE_FRESH_MS`, by its modified time) is
  read instead of downloading again; an older one is downloaded again and replaced.
- Deletion eligibility: `sweepStatsCache` removes files whose names start `stats-src-` (the cache
  and its `.part` files) and whose modified time is more than 30 minutes ago
  (`STATS_CACHE_KEEP_MS`). That is the 10-minute reuse window plus the worker's longest request
  (5 minutes, `WORKER_REQUEST_TIMEOUT_MS`) plus a margin, so a copy handed to the worker just
  inside the reuse window is not removed while it is read. Folders and other files are left alone.
- Cadence: a sweep runs when a data file is read locally, at most once a minute per server
  process, in the background of that read. There is no timer: an idle process does not sweep, so
  30 minutes is when a file becomes eligible, not a deadline by which it is gone. The next local
  read after that removes it.
- Failure: best effort. A file that cannot be removed now (in use on Windows, already gone) is
  left for the next sweep; an unreadable temporary folder sweeps nothing. A sweep never fails the
  read that started it.

## Tests

`src/lib/__tests__/statsCacheSweep.test.ts`, against a real temporary folder: files and `.part`
files past the window removed; recent and just-inside-window files kept; other files and a
`stats-src-` folder untouched; a second sweep removes nothing more; a missing folder is not an
error.

## Not covered

No guaranteed retention deadline (see Cadence). Copies made before this change are removed by the
first sweep that runs after it.

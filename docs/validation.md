# Validation commands

One gate, the same locally and in CI (`.github/workflows/validate.yml`).

| Command | What it runs |
|---|---|
| `npm run typecheck` | `next typegen`, then `tsc --noEmit` |
| `npm run test:retained` | every retained test in `src/lib/__tests__` |
| `npm run validate` | both of the above |
| `npx eslint <files>` | lint; CI lints only the files a pull request changes, because untouched files still carry older findings |

## Real-database and Python-engine suites

- `*.db.test.ts` suites run only when `TEST_DATABASE_URL` points at a **local** PostgreSQL 16 with pgvector. The account must be allowed to create databases (for example `postgres://postgres@localhost:5432/postgres`). Each suite builds its own `ie_test_*` database from `supabase/migrations` and drops it afterwards. Non-local hosts are refused.
- The engine suites need `python3` with `pandas`, `openpyxl` and `pyreadstat`: `pip install -r requirements.txt pandas`.
- When a prerequisite is missing, a suite runs a visible `NOT RUN` placeholder instead of passing silently.
- `VALIDATE_REQUIRE_INTEGRATION=1 npm run validate` makes the gate fail if any of those suites only ran its placeholder. CI always sets this.

## What CI does

On every pull request, push to `main` and manual dispatch:

1. Starts a throwaway `pgvector/pgvector:pg16` service.
2. Installs Python 3.12 with the engine packages.
3. Runs `npm ci`.
4. Lints the changed files.
5. Runs `npm run validate` in strict mode.

No live or development database is touched, and no secrets are used.

## Browser smoke test (golden thread)

Not part of `npm run validate` or CI yet: it needs a browser, a running app and a disposable database. It drives one thread through the app's own controls: upload, import quality, a Purchase by Gender table, accept, researcher note, synthesis, narrative, reject, support warnings, the three exports and a reload. The spec (`e2e/golden-thread-smoke.spec.mjs`) and its references (`fixtures/golden-thread-1/`) are Codex's independent material; the app-owned parts are the adapter (`e2e/adapter/golden-thread-adapter.mjs`), `playwright.config.mjs` and the stack below.

One-time setup: `npx playwright install chromium`.

1. Start the stack. `E2E_ADMIN_DATABASE_URL` must be a **local** PostgreSQL 16 + pgvector admin connection; any other host is refused.
   - bash: `E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run e2e:stack`
   - PowerShell: `$env:E2E_ADMIN_DATABASE_URL="postgres://postgres@localhost:5432/postgres"; npm run e2e:stack`

   It creates a new `ie_e2e_*` database and a non-owner, NOSUPERUSER, NOBYPASSRLS `ie_e2e_app_*` role, an in-memory storage stand-in and a scripted model replay, starts the app on `http://127.0.0.1:3210` with every `.env*` value overridden, and writes `e2e-results/target-manifest.json` (no credentials). Ctrl+C stops it and drops the database and role; `--keep` leaves them for inspection.
2. In a second terminal, run the smoke test:
   - bash: `GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json GOLDEN_SMOKE_ADAPTER=e2e/adapter/golden-thread-adapter.mjs npm run e2e:smoke`
   - PowerShell: `$env:GOLDEN_SMOKE_TARGET_MANIFEST="e2e-results/target-manifest.json"; $env:GOLDEN_SMOKE_ADAPTER="e2e/adapter/golden-thread-adapter.mjs"; npm run e2e:smoke`

Results, traces, screenshots and the downloaded exports go to `e2e-results/` (git-ignored); `e2e-results/model-replay-log.json` lists every model call the replay answered. With the replay the run is orchestration evidence only: it shows the workflow, persistence, freshness and export rules working on predictable text, not the quality of real model output. Export checks read the downloaded files' text and XML; they do not certify how Office renders them. `npm test` (plain `vitest run`) would also pick up the Playwright spec, so use `npm run validate` for the unit and integration gate.

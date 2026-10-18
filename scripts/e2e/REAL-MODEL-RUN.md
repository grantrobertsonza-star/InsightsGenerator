# Real-model quality pass on Windows

Two measurements with the real model through one budget gateway, capped together at **US$7**:

1. the golden-thread-1 benchmark again (about US$5 at most), now with computed survey tables committed first, so claims are checked against data rather than only against each other (the 2026-10-18 run lacked them and is incomplete as a benchmark);
2. the Research Quality Review semantic cases (13 synthetic cases, about US$2 at most).

Recorded spend is US$4.018694 (US$3.817316 plus the gateway's US$0.201378 on 2026-10-18). Grant raised the cumulative cap to US$12 on 2026-10-18, so US$7 here keeps the total under it.

The app now requires sign-in. The disposable stack creates its own synthetic accounts and signed-in browser state, so nothing changes in the steps below and no real account is used.

Everything runs on a throwaway database created on your local Supabase PostgreSQL server (port 54322). It is dropped at the end. Your development database, its data and the cloud project are never touched. The API key stays on your machine: only the budget gateway reads it, from a temporary file you delete at the end.

You need: Docker with local Supabase running (`supabase start`), Node, and LibreOffice in its default folder. Use three PowerShell windows, all in `C:\Personal\InsighsAI\app`.

## Window 1: build a separate copy of the app

```powershell
$copy = "$env:TEMP\ie-realmodel"
robocopy . $copy /MIR /XD node_modules .next .git e2e-results backups scripts\workflow-tenant-review .fnd001 /XF .env* /NFL /NDL /NJH /NJS
cmd /c mklink /J "$copy\node_modules" "$PWD\node_modules"
$admin = "postgres://postgres:postgres@127.0.0.1:54322/postgres"
node scripts/e2e/prepare-build-db.mjs $admin ie_test_build_realmodel
cd $copy
$env:NEXT_FONT_GOOGLE_MOCKED_RESPONSES = "$copy\scripts\e2e\font-mock.cjs"
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54322/ie_test_build_realmodel"
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:39123"
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "stand-in"; $env:SUPABASE_SECRET_KEY = "stand-in"; $env:ANTHROPIC_API_KEY = "stand-in"
npx next build --webpack
cd C:\Personal\InsighsAI\app
node scripts/e2e/prepare-build-db.mjs $admin ie_test_build_realmodel --drop
```

Expected: the build ends with the route list, and the last line says `dropped ie_test_build_realmodel`.

## Window 2: the budget gateway (holds the key)

```powershell
$keyFile = "$env:TEMP\ie-realmodel-key.txt"
(Select-String -Path .env.local -Pattern '^ANTHROPIC_API_KEY=(.*)$').Matches[0].Groups[1].Value.Trim('"') | Set-Content -NoNewline $keyFile
$env:ANTHROPIC_KEY_FILE = $keyFile; $env:GATEWAY_BUDGET_USD = "7"
node scripts/e2e/model-budget-gateway.mjs
```

Expected: `model budget gateway on 127.0.0.1:55017, budget US$7`. Leave it running.

## Window 3: the stack, then the check

```powershell
$env:E2E_ADMIN_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres"
$env:E2E_MODEL_GATEWAY = "http://127.0.0.1:55017"
$env:E2E_NEXT_START = "$env:TEMP\ie-realmodel"
$env:E2E_STORAGE_PORT = "39123"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd C:\Personal\InsighsAI\app; node scripts/e2e/local-stack.mjs"
```

A fourth window opens with the stack. Wait for `ready: http://127.0.0.1:3210` there. Then, back in window 3:

```powershell
$env:GOLDEN_SMOKE_TARGET_MANIFEST = "$PWD\e2e-results\target-manifest.json"
npx playwright test -c e2e/ui/ui-check.config.mjs real-model-quality
```

It takes about 10 to 40 minutes and prints `[real-model-quality]` progress lines. It writes `e2e-results\real-model-quality.json` and the gateway writes `e2e-results\model-gateway-log.json`. Neither file contains the key or any prompt text.

Then the Research Quality Review cases, in the same window 3 (the stack is not needed for these, but leaving it running does no harm). They use a throwaway database on your local Supabase server and the same gateway:

```powershell
$env:RQ_REAL_MODEL = "1"
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:55017"
$env:TEST_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres"
npx vitest run src/lib/__tests__/researchQualityModel.real.test.ts --pool=forks
```

It takes about 5 to 20 minutes and writes `e2e-results\research-quality-model.json`. Each case says whether the model's judgement met the case's acceptable outcome; a disagreement is a result, not a failed run.

## Afterwards

1. In the stack window press **Ctrl+C**. It drops its throwaway database and role.
2. In window 2 press **Ctrl+C**, then delete the key file:
   `Remove-Item "$env:TEMP\ie-realmodel-key.txt"`
3. Optionally remove the build copy: `Remove-Item -Recurse "$env:TEMP\ie-realmodel"`. The node_modules junction is removed with it, not your real node_modules.
4. Send me `e2e-results\real-model-quality.json`, `e2e-results\research-quality-model.json` and `e2e-results\model-gateway-log.json`, or just say "done" and I'll read them from your laptop.

If the gateway refuses a call (budget reached), the pipeline records that step as failed. The check still writes what it measured.

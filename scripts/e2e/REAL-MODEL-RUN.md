# Real-model quality pass on Windows

One run on the golden-thread-1 synthetic fixture with the real model, capped at **US$5**. Recorded spend is US$3.817316 of US$10, so the total stays under the cap.

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
$env:ANTHROPIC_KEY_FILE = $keyFile; $env:GATEWAY_BUDGET_USD = "5"
node scripts/e2e/model-budget-gateway.mjs
```

Expected: `model budget gateway on 127.0.0.1:55017, budget US$5`. Leave it running.

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

It takes about 10 to 40 minutes. It writes `e2e-results\real-model-quality.json` and the gateway writes `e2e-results\model-gateway-log.json`. Neither file contains the key or any prompt text.

## Afterwards

1. In the stack window press **Ctrl+C**. It drops its throwaway database and role.
2. In window 2 press **Ctrl+C**, then delete the key file:
   `Remove-Item "$env:TEMP\ie-realmodel-key.txt"`
3. Optionally remove the build copy: `Remove-Item -Recurse "$env:TEMP\ie-realmodel"`. The node_modules junction is removed with it, not your real node_modules.
4. Send me `e2e-results\real-model-quality.json` and `e2e-results\model-gateway-log.json`, or just say "done" and I'll read them from your laptop.

If the gateway refuses a call (budget reached), the pipeline records that step as failed. The check still writes what it measured.

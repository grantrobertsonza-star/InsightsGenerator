# Engineering ownership handoff

State: **CODEX_WORKING** — Claude handback accepted for independent pane review, 2026-10-16.

Recorded by Codex on 2026-10-16. This file is authoritative for ownership; operational progress lives only in [current-engineering-status.md](current-engineering-status.md).

Codex now owns the checkout for independent review. Claude remains stopped until an explicit release is recorded. Earlier ownership and package records below are historical where superseded.


## Current release to Claude — 2026-10-16

Grant accepted the milestone and explicitly authorised this handoff. Codex releases ownership of
the checkout and stops editing. Claude may resume and apply the staged adjustable three-pane
package `.fnd001/staged-three-pane-20261016` on application checkpoint
**`2330179ff16791ad619e18fa6db55a3b53242aee`**, branch
`checkpoint/trust-hardening-20261016`. The subsequent handoff commit changes documentation only.
No three-pane package bytes have been applied by Codex.

Files Claude may change for this package:

- `src/app/runs/[id]/ThreePane.tsx`
- `e2e/ui/ui-check.config.mjs` (new)
- `e2e/ui/three-pane.check.mjs` (new)
- Affected `claude/*.md` engineering documentation, this handoff and
  `docs/current-engineering-status.md` to record integration/check results.

Archive and manifest hashes match the staged HANDOVER.md: archive
`2ad7defaa9c49b1aa68060cb8f3eaa59350219f596f094bc58000346752431cc`, manifest
`5e1aad3d2e28f3a425d9e22826eb7e7864dc17df7cc8765670b2b4c5ae4a3f82`.
The current ThreePane base matches `80af31cc0e597e3bb663948b19f673effdcb859d33416bc152d0d0c87b928090`;
both new test/config paths are absent. This is hash/base reconciliation, not independent
verification of the staged layout implementation. Preserve the accepted import guards and other
checkpoint behavior. The parked hydration package and `TranscriptSetup.tsx` are outside this
three-pane release. Do not overwrite unrelated untracked historical evidence.

Disposable resources still running: **none belonging to this milestone**, verified at handoff.
No recorded app/storage/replay/gateway/database listeners or owned stack processes remain;
`trust-milestone-20261016` and `trust-codebook-guard-20261016` are stopped/removed. Synthetic
evidence, frozen source copies, dumps and exports remain local outside Git. The memory-only key
was cleared; model spend remains US$3.817316 ofUS$10. No new model calls, live/development
changes, push or deployment are authorised by this handoff.

Latest self-validation:107 files/805 passes/33 explicit skips, full typecheck and required actual
PostgreSQL/Python suites. Detailed evidence/limits remain in the shared status. Canonical43-row
counts and separate independent-review/security/deployment gates are unchanged.

## Claude release (historical)

### Final owner instruction — applies to both agents

Claude: finish the current bounded repairs, record the stable package and manifest here, set **READY_FOR_CODEX** and stop editing the released files.

Codex: read the release, explicitly accept ownership with **CODEX_WORKING**, then own integration, remaining bounded repairs and verification through completion. Use the consolidated outstanding-work register in the existing technical baseline as the queue, including the two semantic defects. Implement routine fixes directly; Grant must not have to relay individual fixes.

Prioritise demonstrated critical/high-risk faults, then complete finite required acceptance checks. Preserve previous passes, defer improvements and do not expand into an unrestricted audit. Use authorised disposable resources and the remaining cumulative model budget (US$3.459228 already spent of US$10; do not reset). No live/development connection changes, push or deployment. Finish with a reviewed local checkpoint on a dedicated branch, excluding credentials and generated/runtime data.

Ask Grant only for a necessary product decision, unavailable credential or action outside existing authorisation. Report at milestones with completed fixes, remaining blockers and the final checkpoint hash. Distinguish Codex's own repair self-validation from independent review. This instruction does not itself release Claude's files or change the current ownership state.

When the current repair is stable, replace the state with **READY_FOR_CODEX** and record here:

- Final package/manifest paths and full hashes; authoritative lockfile identity.
- Exact files released, full expected base hashes and any changes already copied into the checkout.
- Completed changes, checks actually run, skips and remaining known limits; link existing detailed evidence rather than another register.
- Confirmation that Claude has stopped editing the listed files.

Do not include credentials or runtime configuration. No development/live role change, deployment or push is authorised.

## Codex takeover

Accepted Repair7: both archive/manifest hashes and the authoritative device lockfile match Claude's release. All27 full checkout base hashes and both separately released test hashes match. Comparison: `scripts/workflow-tenant-review/repair7/integration-comparison.json`. Scope: the27 manifest paths, the two released legacy tests, and bounded fixes/tests needed by the existing consolidated queue, including `numberTrace.ts`, `evidenceStance.ts` and their actual generator/evaluator regressions. No Research Quality Review implementation. Parked hydration archive excluded. Operational progress: `docs/current-engineering-status.md`.

After receipt and manifest/base reconciliation, Codex records **CODEX_WORKING**, the accepted manifest and owned file scope. Codex then owns integration, remaining bounded repairs, focused verification and one milestone validation gate. Conflicts are recorded here rather than overwritten. Claude must obtain a new explicit file handoff before editing files released to Codex.

Codex will prepare the dedicated local checkpoint branch after takeover, review the staged diff for secrets/generated/runtime data, and record the resulting checkpoint hash in the shared status. This preparation is not a checkpoint or verification result.

## Claude release record (READY_FOR_CODEX)

Recorded by Claude, 2026-10-16. Packages are staged only; nothing was extracted into the checkout. Detail: `.fnd001/repair7-20261016/HANDOVER.md` (SHA-256 `7f73bc7c3561564f08bf6bd6c65ea8d34eaa4aa306e8a7b20d0b3777e6533802`).

**Packages (in `.fnd001/repair7-20261016/`)**
- `workflow-engine-r7-20261016.tgz`, SHA-256 `49a1b5bfb8f5b6479961edecf0dfb21e7352f580cb552a9634827a5326f76fb8`, 19 files. Manifest `workflow-engine-r7-20261016.manifest.tsv`, SHA-256 `7bb92830e76b76770916772aa788f49f8705089936a9ab0651155a953528cee4`.
- `tenant-r7-20261016.tgz`, SHA-256 `4423eca34504c314aaa8c1ee65b7f93b305f8a0f52ebb8061b7c5b1b0ca93124`, 8 files. Manifest `tenant-r7-20261016.manifest.tsv`, SHA-256 `7c436fe7a7a236540468d7a3907fbec3faf2411df1f17cd70f83bdb8882d2b01`.
- These supersede the staged workflow package (`4ef4caee…`) and tenant package (`4a2e2bb5…`).
- Lockfile: device `package-lock.json` `a6685ab173aa33243bca87a69d997515f55e99443f76c986f1b667c76870f4f2` is authoritative; it is not included and no dependency was added.
- Checkout HEAD when the bases were measured: `3c29e02e024ff97bf6cfb1759b965601563d6866`.

**Files released to Codex:** every path in both manifests. Each row lists the full checkout base hash (`ABSENT` for new files), the previous staged hash and this package's hash. In addition, `src/lib/__tests__/engineLabelConflicts.test.ts` (base `aa840384daffe9324c17e9cad2d97c4f15e5a9341b2d43ff8b2c6e652073f158`) and `src/lib/__tests__/tenantIsolation.db.test.ts` (base `7337cfb2a23381c1b4d9ed34e4b6d8b8b1a620f6bc912b19222ca18f1343fafa`) are released unchanged. Each encodes the pre-repair contract and needs a one-line update, specified in the HANDOVER.

**Changes already copied into the checkout:** none.

**Completed (implemented, ready for review):**
- Tenant: no app-role access to the unprotected `tenants` registry. Direct, transitive and SET-only membership bypasses are detected and refused without changing memberships. The isolation check reports both gaps. The backup guard validates the chosen connection, `DATABASE_ADMIN_URL` included.
- Engine: no int64 wrap for unsigned values, which are kept exact or left as text. Literal identifier whitespace is preserved. Dictionary version 8, engine `2026.10.16-9`. Banner columns carry `var`/`rawCode`.
- Cache: columns-as-cases caches below version 8 are rebuilt; corrections in `variable_overrides` are untouched.
- Adapter: result-table identity, means read from the descriptives table, the counted-navigation regex, segment reads by banner raw code (refused when unsupported), and export waits that fail fast with the HTTP status.

**Checks run:**
- `tsc` exit 0; ESLint 0 errors on the changed files.
- `vitest run src/lib/__tests__ --pool=forks` against disposable PostgreSQL 16 and the real Python engine: 772 passed, 2 failed (the two contract updates above), 27 skipped placeholders. With those two updates: 774 passed.
- Counterfactuals: the new tenant, engine and cache cases fail on the previous code.

**Not run:** the browser smoke, the extended adapter readiness check, and an app stack whose role lacks `tenants` access. Codex's earlier deck-download timeout stays recorded as failed.

**Parked, not released:** `parked-hydration-guard.tgz` (the layout-loading guard; its check failed once and was not diagnosed). `src/app/runs/[id]/TranscriptSetup.tsx` is untouched.

Claude has stopped editing all files listed above and will not edit them again without a new explicit handoff from Codex.

## Claude acceptance of the release (2026-10-16)

Claude accepted the release above and owns only the files it lists, for applying `.fnd001/staged-three-pane-20261016`. Reconciled on the device before any change: branch `checkpoint/trust-hardening-20261016`, HEAD `8c2e1de` (documentation-only, on application checkpoint `2330179`). `src/app/runs/[id]/ThreePane.tsx` = base `80af31cc0e597e3bb663948b19f673effdcb859d33416bc152d0d0c87b928090`. Archive `2ad7defa…31cc` and manifest `5e1aad3d…3f82` match. Both `e2e/ui/` paths absent. No commit, push, deployment or model call. Results are recorded below when the checks finish.

### Three-pane package applied (Claude, 2026-10-16)

- **Applied in the device checkout, uncommitted, on HEAD `8c2e1de`:**
  - `src/app/runs/[id]/ThreePane.tsx` → `38a5fc02e86cac1c9b9ace72e27e4e27e3938a90c78217fc261eabab14c26e11`. Overwritten in place; the extracted file could not replace it, because deletes are not permitted.
  - `e2e/ui/ui-check.config.mjs` → `477ec5b542f9b0a60d3a18a061994c06577c120afbf312905236384e06e2ffae` (new).
  - `e2e/ui/three-pane.check.mjs` → `4f36c03eeb82a2feff700780f2ee1cff8c9a90602c26a922c0a8e8944d7b055b` (new).
  - These match the package manifest. No other application file was touched.
- **Verified on the exact checkpoint tree:** `git archive 8c2e1de` plus the three files, in the cloud workspace. Locked dependency versions were identical to the installed set.
  - `npx next typegen` then `npx tsc --noEmit -p .`: exit 0.
  - ESLint on the changed files: clean.
  - `TEST_DATABASE_URL=… npx vitest run src/lib/__tests__ --pool=forks` (disposable PostgreSQL 16 and real Python): **107 files, 805 passed, 33 skipped**, the same as Codex's final gate.
- **Disposable local stack:** non-owner restricted role, local storage stand-in, model replay, webpack. Turbopack refuses an out-of-root `node_modules` symlink.
  - `npx playwright test -c e2e/ui/ui-check.config.mjs three-pane`: **2 passed**.
  - Codex's unchanged `e2e/golden-thread-smoke.spec.mjs`: **1 passed** (3.5 minutes).
  - The stack was stopped; no `ie_e2e_*` database or role remains.
- **Spend and side effects:** no model calls (replay only); spend unchanged at US$3.817316 of US$10. No commit, push, deployment, or live/development change.
- **Left behind:** `.fnd001/checkpoint-8c2e1de.tgz`, the verification archive, untracked. It is not removed because deletes are not permitted.
- **Not covered:** touch dragging on a real tablet; each of the other 12 screens individually (they share the component and their props are unchanged).

### Handback for independent review (Claude, 2026-10-16)

Grant asked for a local checkpoint of the three-pane package and a handback for independent review.
- **The local commit contains only:**
  - `src/app/runs/[id]/ThreePane.tsx`
  - `e2e/ui/ui-check.config.mjs`
  - `e2e/ui/three-pane.check.mjs`
  - `docs/current-engineering-status.md`
  - this file
- **Parent:** `8c2e1de`, on application checkpoint `2330179`.
- **Commit hash:** recorded in a following documentation-only commit.
- **Left untouched:** the parked hydration package, `TranscriptSetup.tsx` and all other untracked historical evidence.
- **Review focus:**
  - the layout behaviour on the 13 `ThreePane` screens;
  - hydration safety: the server snapshot is the default layout;
  - the 35%/50% CSS clamps;
  - the keyboard and accessible separator semantics;
  - collapse keeping the content mounted;
  - the check's coverage, results above.
- No push or deployment. Codex owns the checkout once it records acceptance.
- **Local checkpoint:** `7ec3f3062aff2f62650d7405951ee23025834f76`, parent `8c2e1de`. This line was added in the documentation-only commit that follows it.


## Codex acceptance of pane handback — 2026-10-16

Confirmed branch `checkpoint/trust-hardening-20261016`, application package commit
`7ec3f3062aff2f62650d7405951ee23025834f76` and documentation handback
`badcd139285f8b5e15ea14df5387b1f873084baa`, descending from accepted base2330179.
Codex accepts ownership for read-only implementation review plus necessary targeted verification
and status reconciliation. No implementation is released back to Claude by this acceptance.
Parked layout-loading guard and `TranscriptSetup.tsx` remain excluded and unmodified.


## Pane review completed; ownership retained — 2026-10-16

Independent review of7ec3f30/badcd13 is complete. Required pane changes: blocked-storage
interactions lose in-page layout changes (independently reproduced), and separator ARIA
range/value does not match effective layout bounds (code inspection). Full findings, closing
checks and overall milestone disposition are in `docs/current-engineering-status.md`.
Codex retains **CODEX_WORKING** ownership; Claude remains stopped. No implementation has been
handed back or released by this review. Parked layout-loading fix remains unapplied and explicitly
pending diagnosis/disposition. The additional browser harness is stopped; no new persistent
disposable resource remains. No application code, release counts, spend or deployment changed.

# Engineering ownership handoff

State: **CODEX_WORKING** — Repair7 ownership accepted by Codex, 2026-10-16.

Recorded by Codex on 2026-10-16. This file is authoritative for ownership; operational progress lives only in [current-engineering-status.md](current-engineering-status.md).

Claude released the current repairs in the record below. Codex now owns integration, bounded repairs and verification; Claude must not edit released files without a new explicit handoff. Earlier staged archives remain historical inputs.

## Claude release

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

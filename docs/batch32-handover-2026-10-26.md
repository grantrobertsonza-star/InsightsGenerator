# Handover: change tiers, rules registry and CI gates (main copy), 26 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch31. Grant's decision of
26 October (07:21): speed up development where a change cannot alter research meaning, and keep the full
checking where it can. No application code changes. No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | Tiers, checklist, registry, PR template, CI gates | process (tier C) |
| docs commit | This handover and the status line | |

## What changes

- **`AGENTS.md`:** new section "Change tiers and the impact checklist" (tiers A, B, C and the six
  questions every A or B change answers); the obsolete "no test runner wired up yet" sentence corrected.
- **`scripts/change-tier.cjs`:** prints a change's tier from the files it touches (unknown paths count as
  A); CI writes it to the job summary on every pull request.
- **`claude/rules-registry.md`:** the owner, contract and pinning test of every rule that decides research
  meaning, with the known mirrors (missing tokens in `dataQuality.isMissing`, name allocation in
  `dataSetup.allocateVariableNames`, the effective base computed in two engine places) marked as risks.
- **`.github/pull_request_template.md`:** the checklist and proof sections.
- **`.github/workflows/validate.yml`:** whole-repository lint (0 errors since batch 29) instead of changed
  files only; the engine self-test; the tier summary.
- **`.github/workflows/browser.yml` (new):** production build, disposable stack, full browser suite and
  golden-thread smoke on pull requests, nightly at 03:30 Johannesburg, and by hand.

## Checks run

- `changeTier.test.ts`: **4 passed** (A, B and C placement; unknown paths are A; a change takes its
  highest tier).
- Both workflow files parse as YAML. **Neither new CI step has run on GitHub yet**: the first runs need
  watching and may need timing changes (the browser job's build, LibreOffice install and stack start).
- `npx eslint .` 0 errors; `npx tsc --noEmit` clean.

## Limits

- Branch protection is a GitHub setting Grant turns on; until then a failing check does not block a merge.
- Mutation testing and the AI evaluation benchmark are not CI jobs yet (the release programme runs them).

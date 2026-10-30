## What changes for the researcher

<!-- One or two sentences: the visible outcome and how to see it. -->

## Tier

<!-- CI prints the tier from the changed files (scripts/change-tier.cjs). Say if you think it is wrong. -->

## Impact checklist (tier A and B; AGENTS.md)

- [ ] **Rule:** rule(s) touched from `claude/rules-registry.md`, owner used, no second implementation
- [ ] **Inputs:** missing, invalid, partial, stale and unavailable inputs handled; unknown is never silently false, zero or empty
- [ ] **Persistence:** transaction boundary, ownership on the write, lock or revision check, retry without duplicates, recovery after partial failure (or not applicable)
- [ ] **Freshness:** derived results that change meaning are marked stale; human wording and decisions survive (or not applicable)
- [ ] **Screens:** late responses, switching and reload handled; "saved" only after saving (or not applicable)
- [ ] **Proof:** the test that fails without this change, named below

## Proof

<!-- The regression test(s), and the gates run with their counts: typecheck, lint, library, engine self-test, browser, smoke. Screenshots for visible changes. -->

## Review

- [ ] Tier A: independent review requested before merge
- [ ] Migration included, and noted for the owner to apply

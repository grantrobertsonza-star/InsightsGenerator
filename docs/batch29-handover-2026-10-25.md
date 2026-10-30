# Handover: lint to zero errors (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch28 (`bf93d6b`). Grant's
decision of 25 October: clear the inherited lint errors rather than revise the release criterion. No
migration. Nothing pushed or deployed. Kept separate from batch28 so each can be reviewed on its own.

| Commit | What | Kind |
|---|---|---|
| repair commit | Lint configuration for CommonJS files; test casts; six effect fixes; tests | maintainability, async UI |
| docs commit | This handover and the status line | |

## Result

`npm run lint` (`eslint`): **exit 0, 0 errors, 41 warnings** (before: 349 errors, 41 warnings, exit 1).
The 41 warnings are the inherited ones (unused names and expressions, one anonymous default export,
one unused disable comment); none is added. They are listed by `npx eslint .` and are not part of this
batch.

## The 349 errors, by kind

1. **295 `@typescript-eslint/no-require-imports`, all in `.cjs` files under `scripts/`.** A `.cjs` file
   is CommonJS by its extension, so `require()` is its module system. This is a **rule change, not a
   code change**: `eslint.config.mjs` turns that one rule off for `**/*.cjs`, with the reason in a
   comment. `scripts/validate.cjs` carried an inline disable for the same rule, now redundant (it became
   an "unused directive" warning) and removed. TypeScript and ES-module files still get the rule.
2. **48 `@typescript-eslint/no-explicit-any`, all in seven test files.** Test doubles cast to production
   types: `as any` became `as never` (assignable to any parameter, without switching type checking off),
   and the `withTenant` mock callbacks lost their `cb: any` annotations so TypeScript infers the real
   callback type; the fake clients passed to them are cast `as never`. One fake query result is typed
   `Record<string, unknown>[]`. No assertion changed.
3. **6 `react-hooks/set-state-in-effect`, in five app screens.** Each effect set state synchronously.
   Fixed so the behaviour stays the same, without suppressions:
   - `ClaimTableChecks.tsx`: the first load now drops a response that arrives after the project changed
     (it had no stale-response guard at all, so an earlier project's claims could replace the current
     one's).
   - `CodingProgressBar.tsx`, `ProcessProgress.tsx`: progress is cleared when polling stops by adjusting
     state while rendering (React's pattern for state that follows a prop), not in the effect.
     `ProcessProgress` keeps its interval in the effect's own closure (the ref was not needed).
   - `CrosstabFilters.tsx`: choosing another variable resets the ticks, answers, range and error while
     rendering; the effect only loads the new variable's answers, with its existing stale guard.
   - `RunShell.tsx` `RunSectionProvider`: the section named by `?section=` or remembered in session
     storage is read through `useSyncExternalStore` (default on the server and while hydrating, as
     before); a section chosen in the page wins and is remembered; a linked section is remembered by an
     effect that only writes storage. `RunNav` finds its two portal slots the same way.

## Checks run

Real disposable PostgreSQL 16, the actual engine and the disposable browser stack.

- `npm run lint`: exit 0, 0 errors, 41 warnings (the inherited set; compared rule by rule and file by
  file with batch28's: none added).
- `npx tsc --noEmit`: clean.
- `effectStateRefactors.test.tsx` (new, mounted components in linkedom): **6 passed**: a late first load
  for an earlier project dropped (ClaimTableChecks); progress cleared when switched off and not shown
  again before the first poll (CodingProgressBar); a variable switch clears ticks and drops the earlier
  variable's late answers (CrosstabFilters); a `?section=` link opens and is remembered, a remembered
  section opens, an unknown one falls back, a choice in the page wins and is remembered
  (RunSectionProvider). Mutation checks, each undone after: the stale guard removed, the progress reset
  removed, the filter reset removed, the linked-section write removed: each fails one test.
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,750 passed, 72 skipped, 0 failed**
  (232 files passed, 1 skipped).
- Browser: `sidebar`, `crosstabs-entry` and `analytics-landing` (section navigation, cross tabs and
  analytics screens) **3 passed**; full browser suite (no filters) **107 passed, 1 skipped, 0 failed**;
  smoke 1 passed.

Mocks: storage, the model (never reached), and in the new component test the server actions and fetch.

## Limits

- `ProcessProgress` (inside a form, via `useFormStatus`) and `RunNav`'s portals are not mounted on their
  own; the browser suite renders both on every run page.
- The 41 inherited warnings remain.

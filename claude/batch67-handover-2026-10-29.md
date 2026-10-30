# Batch 67 handover: new landing page (29 October 2026)

Status: **implemented, ready for independent review.** Tier C (public static page). No migration.

Grant, 28 October 2026: "add this as our new landing page. Explore the platform is the button that takes us
into the app".

- `public/home.html` replaced by Grant's page (served at `/home` without sign-in, as before; "Home" in the
  main menu still opens it).
- "Explore the platform" (header) now leads into the app (`/`): the sign-in page when signed out, the
  dashboard when signed in. "Sign in" unchanged. The page's other buttons still scroll to its walkthrough.
- The module cards' tag separators had been saved as "?" ("Data files ? Questionnaires ? Codebooks"):
  restored as middle dots. The browser-tab title's em-dash is written as a colon (house style).
- `e2e/ui/landing-page.check.mjs` extended: Explore the platform signed out (to sign-in) and signed in (to the
  dashboard); no tag contains "?". Run: 3 passed on a fresh stack (`fe316af`), and again in the final gates.

Gates on the final tree (`83665a3` in the cloud; batches 66, 67, 68, 53 and D1 on top of `16253c5b`): tsc and eslint clean; engine self-test passed; library 304 files, 2,315 tests passed, 91 skipped, 0 failed (real disposable PostgreSQL, run on `0bcbfc0`, which differs only in the control check); full browser suite 140 passed, 1 skipped (the real-model check), 0 failed; smoke 1 passed.

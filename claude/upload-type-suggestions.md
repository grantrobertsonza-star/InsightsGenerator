# Suggested file types on upload

Grant, 2026-10-21: each file added under Import data arrives with a suggested type instead of an
empty choice. `suggestPurposeFor(fileName, csvSample?)` (`uploadPurposes.ts`) suggests from the
extension and words in the file name and, for a CSV, from its first lines. `AddFilesPanel.tsx`
preselects it with a "Suggested" chip (and a screen-reader reason) until the researcher changes it;
a CSV sample read later never overrides a type the researcher chose. A file with no basis for a
guess gets no suggestion and still needs a choice.

Upload still waits until every file has a type that fits it (`purposeMismatch`), and each file is
sent under the form field its type always used, so the server's checks and limits are unchanged:
the suggestion is a default in the browser, never a server-side decision.

Tests: `uploadPurposes.test.ts`; browser `e2e/ui/add-files-panel.check.mjs`.

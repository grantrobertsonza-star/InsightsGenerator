# Recommendation edits and researcher-written adds

Codex REC500-F01 to F04 (2026-10-24). Library: `src/lib/recommendationWrites.ts`; actions:
`src/lib/recommendationActions.ts`; screens: `RecommendationsReview.tsx` and
`SynthesizedRecommendationsReview.tsx`, sharing `recommendationEditing.tsx`.

## Edit and accept

`updateAndAcceptRecommendation(runId, id, fields, expected?)` returns `{ ok: true }`, a conflict
`{ ok: false, conflict: true, error, current }` or a refusal `{ ok: false, error }`; an unexpected
failure is thrown.

- **Opened state.** The editor captures all eight fields when Edit is pressed and sends them as
  `expected`. In one transaction the row is locked by id and run (`for update`); the save is refused,
  nothing written, when the row is gone (`current: null`: deleted, or deleted and recreated under a new
  id) or its stored fields differ from `expected` (another editor saved first; `current` holds them).
  Fields compare after trimming. Without `expected` the edit is applied unconditionally (no caller in
  the app does this now).
- **Screen.** A refusal keeps the editor open with the draft and the error. A conflict shows "Stored
  now: <action>" with "Use current wording" (the draft becomes the stored fields, which become the
  opened state) and "Replace with mine" (saves the draft with the stored fields as `expected`, so the
  replacement is itself checked). The editor closes only after a confirmed save.
- **Boundary.** Fields are validated server-side: eight strings, a non-blank action, priority high,
  medium or low.
- **Quality score (REC500-F02).** The edit clears the figure check and, when migration 0045's quality
  columns exist, the seven quality columns in the same statement. Only the columns' absence is
  tolerated; any failure rolls the whole edit back and is reported, so the edited wording never stands
  with the earlier score. The scorer then runs (`refreshRecommendationQuality`, which never throws);
  if it fails, the recommendation stays unscored, shown as not scored.

## Adding your own (REC500-F03, F04)

`addOwnRecommendation(runId, insightId, fields, requestKey)` and
`addOwnSynthesizedRecommendation(runId, synthesizedInsightId, fields, requestKey)` return
`{ ok: true, id, alreadySaved }` or `{ ok: false, error }`.

- **Request identity.** The add form makes a key (`crypto.randomUUID()`) when it opens, sends it with
  every attempt, and makes a new one only after a confirmed add. The insert stores it in
  `recommendations.client_request_key`; migration 0113's partial unique index on (run, key) allows one
  row per key, so two sends at once wait on each other and the second finds the first.
- **Resend.** A key already stored with the same anchor and fields is answered with that
  recommendation (`alreadySaved: true`) and nothing is added. The same key with changed contents is
  refused ("An earlier attempt from this form was already saved, as it was then"). A new key is a
  deliberate new recommendation, even with the same words.
- **Anchor ownership (REC-001)** is checked in the inserting statement; a synthesized insight must also
  still be accepted. A refused anchor stores nothing, and a later valid send with the same key adds it.
- **Without migration 0113** the add is refused ("needs database migration 0113") and nothing stored.
- **Form failures.** A send that throws (connection reset, lost reply, server error) is caught in the
  form: every field and the chosen insight stay, the error is shown under the form
  (`recommendation-add-error`), and pressing Add again resends with the same key.

## Tests

`src/lib/__tests__/recommendationWrites.db.test.ts` (real PostgreSQL, actual actions and the actual
quality scorer, the model controlled): stale, deleted and recreated targets; deliberate replacement;
two editors at once; boundary; healthy rescoring; a fault refusing only the score clearing rolls the
edit back, then recovers; both anchors' resend; racing sends; refused then valid send; changed resend;
a new key; without the quality columns and without 0113. `recommendationIntegrity.db.test.ts` (REC-001,
REC-002). Browser: `e2e/ui/recommendation-edit-and-add.check.mjs` (stale and deleted editors; a send
that never arrives; a stored send whose reply is lost).

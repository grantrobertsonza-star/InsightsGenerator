// actionFailure.ts: a failed server action becomes text a control can show, never a throw.
import { describe, expect, it } from "vitest";
import { actionFailureMessage, attempt, attemptResult, CONNECTION_LOST_MESSAGE } from "../../app/runs/[id]/actionFailure";
import { failedFillText, lastFillText } from "../briefFillText";

describe("actionFailure", () => {
  it("shows an ordinary error's own message", () => {
    expect(actionFailureMessage(new Error("Could not save this edit: it kept conflicting"))).toBe("Could not save this edit: it kept conflicting");
  });
  it("replaces a production-withheld message (digest) with a generic sentence carrying the reference", () => {
    const withheld = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "3942759881" });
    const text = actionFailureMessage(withheld);
    expect(text).toContain("reference 3942759881");
    expect(text).not.toContain("Server Components render");
  });
  it("GT-008: a request lost in transit reads as a plain connection message in every browser's wording", () => {
    for (const raw of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed"]) {
      expect(actionFailureMessage(new TypeError(raw)), raw).toBe(CONNECTION_LOST_MESSAGE);
    }
    expect(CONNECTION_LOST_MESSAGE).toMatch(/may not have been saved/);
    expect(CONNECTION_LOST_MESSAGE).not.toMatch(/Failed to fetch/);
  });
  it("GT-008 boundary: other TypeErrors and server messages that mention fetching keep their own text", () => {
    expect(actionFailureMessage(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe("Cannot read properties of undefined (reading 'id')");
    expect(actionFailureMessage(new Error("Failed to fetch the saved table: it was deleted"))).toBe("Failed to fetch the saved table: it was deleted");
  });
  it("handles a thrown non-Error", () => {
    expect(actionFailureMessage("plain")).toBe("The server could not complete this. Try again.");
  });
  it("attempt returns null on success and the failure text on rejection, without throwing", async () => {
    expect(await attempt(async () => "ok")).toBeNull();
    await expect(attempt(async () => { throw new Error("Synthetic write outage"); })).resolves.toBe("Synthetic write outage");
  });
  // GT500-F03 and P01: a returned refusal keeps the editor's draft just as a thrown error does.
  it("attemptResult treats a returned { ok: false } as a failure, and ok or void as success", async () => {
    expect(await attemptResult(async () => ({ ok: true }))).toBeNull();
    expect(await attemptResult(async () => undefined)).toBeNull();
    expect(await attemptResult(async () => ({ ok: false, error: "This objective was changed or removed after you opened it" }))).toBe("This objective was changed or removed after you opened it");
    expect(await attemptResult(async () => ({ ok: false }))).toBe("The server refused this. Try again.");
    await expect(attemptResult(async () => { throw new Error("Synthetic write outage"); })).resolves.toBe("Synthetic write outage");
  });
});

// GT500-F02: a failed fill is said, and the record shown beside it is labelled as the previous one.
describe("fill messages", () => {
  const fill = { at: "2026-10-21T12:20:00.000Z", brief: null, proposal: { id: "p", filename: "P.docx", stillImported: true }, objectivesAdded: 1, filledBusinessProblem: false, importedBefore: 2 };
  it("names the documents, the reason and the retry; labels the previous fill", () => {
    expect(failedFillText({ documents: "the proposal P.docx", reason: "Synthetic outage." })).toBe(
      "The fill from the proposal P.docx did not happen: Synthetic outage. What you typed was saved. Use Try the fill again, or choose the document again and save.",
    );
    expect(lastFillText(fill)).toMatch(/^Last filled from the proposal P\.docx on .*\(1 objective added, 2 imported earlier not added again\)\.$/);
    expect(lastFillText(fill, { previous: true })).toMatch(/^The last successful fill was from the proposal P\.docx/);
  });
});

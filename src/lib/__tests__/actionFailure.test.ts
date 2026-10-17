// actionFailure.ts: a failed server action becomes text a control can show, never a throw.
import { describe, expect, it } from "vitest";
import { actionFailureMessage, attempt, CONNECTION_LOST_MESSAGE } from "../../app/runs/[id]/actionFailure";

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
});

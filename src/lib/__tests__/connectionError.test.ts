// The browser's own words for a request with no answer are said plainly in the Research assistant;
// a server's error message is shown as it is.
import { describe, expect, it } from "vitest";
import { isBrowserNetworkErrorMessage, plainConnectionError } from "../../components/connectionError";
import { actionFailureMessage, CONNECTION_LOST_MESSAGE } from "../../app/runs/[id]/actionFailure";

describe("plainConnectionError", () => {
  it("says a lost connection plainly, for each browser's wording", () => {
    for (const m of ["Failed to fetch", "TypeError: Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "fetch failed"]) {
      expect(plainConnectionError(m)).toBe("The connection to the server was lost before an answer came back.");
    }
  });
  it("leaves a server's message alone, including one that mentions fetching", () => {
    expect(plainConnectionError("This needs migration 0108 applied first (npx.cmd supabase migration up).")).toBe("This needs migration 0108 applied first (npx.cmd supabase migration up).");
    expect(plainConnectionError("Couldn't fetch the variables: timeout")).toBe("Couldn't fetch the variables: timeout");
  });
  it("one list of browser wordings serves both the project controls and the assistant, each in its own words (M-B8-02)", () => {
    for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed", "Network request failed"]) {
      expect(isBrowserNetworkErrorMessage(m)).toBe(true);
      expect(actionFailureMessage(new TypeError(m))).toBe(CONNECTION_LOST_MESSAGE);
      expect(plainConnectionError(m)).toBe("The connection to the server was lost before an answer came back.");
    }
    // Project controls still count only a TypeError: a server error reading "fetch failed" is shown as it is.
    expect(actionFailureMessage(new Error("fetch failed"))).toBe("fetch failed");
    expect(isBrowserNetworkErrorMessage("Failed to fetch the table")).toBe(false);
  });
});

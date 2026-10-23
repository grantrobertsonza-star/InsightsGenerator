// The browser's own words for a request with no answer are said plainly in the Research assistant;
// a server's error message is shown as it is.
import { describe, expect, it } from "vitest";
import { plainConnectionError } from "../../components/connectionError";

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
});

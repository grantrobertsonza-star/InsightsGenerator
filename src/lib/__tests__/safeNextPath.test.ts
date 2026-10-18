// G6: after sign-in only a path on this app is followed (no open redirect).
//
// Codex 2026-10-18 (ed3e980) reproduced "/\t/evil.example/": it passed the old prefix checks, and
// the browser, which drops tabs and newlines from URLs, then navigated to http://evil.example/.
// Every refused value below is one a browser would resolve to another host (or back to sign-in).
import { describe, expect, it, vi } from "vitest";
import { safeNextPath } from "../authActions";

vi.mock("next/headers", () => ({ cookies: async () => ({}), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const APP = "https://app.example";

describe("safeNextPath", () => {
  it("keeps in-app paths with their query and fragment", async () => {
    for (const good of ["/", "/runs/abc?x=1", "/runs/abc?next=%2F%2Fevil.example#notes", "/programs", "/loginhelp"]) {
      expect(await safeNextPath(good)).toBe(good);
    }
    // Dot segments are resolved, still on this app.
    expect(await safeNextPath("/runs/../programs")).toBe("/programs");
  });

  it("refuses anything that would leave the app, however it is spelled", async () => {
    const bad = [
      "/\t/evil.example/", // Codex's reproduction
      "/\n/evil.example/",
      "/\r/evil.example/",
      "/\r\n/evil.example/",
      "/\u0000/evil.example/",
      "/\\evil.example",
      "/\\/evil.example",
      "//evil.example",
      "///evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      " /evil",
      "evil.example",
    ];
    for (const value of bad) {
      const result = await safeNextPath(value);
      expect(result, JSON.stringify(value)).toBe("/");
      // Independent of the implementation: what a browser on this app would navigate to.
      expect(new URL(result, APP).origin).toBe(APP);
    }
  });

  it("never sends the user back to the sign-in page, and tolerates non-strings", async () => {
    for (const value of ["/login", "/login?next=/x", "/login/", "", null, undefined, 42, {}, "/" + "a".repeat(3000)]) {
      expect(await safeNextPath(value)).toBe("/");
    }
  });
});

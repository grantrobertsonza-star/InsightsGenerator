// G6: after sign-in only a same-site relative path is followed (no open redirect).
import { describe, expect, it, vi } from "vitest";
import { safeNextPath } from "../authActions";

vi.mock("next/headers", () => ({ cookies: async () => ({}), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

describe("safeNextPath", () => {
  it("keeps same-site paths and refuses everything else", async () => {
    expect(await safeNextPath("/runs/abc?x=1")).toBe("/runs/abc?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "", null, 42]) {
      expect(await safeNextPath(bad)).toBe("/");
    }
  });
});

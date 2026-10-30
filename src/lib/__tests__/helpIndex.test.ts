// The Knowledge base and Manual as text for the Research assistant (Grant, 2026-10-22). The index is
// generated from the rendered pages; this suite fails when an article or manual page was changed
// without rebuilding it (node scripts/build-help-index.mjs), and checks the search and read the
// assistant's tools use against the real index. No mocks.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { articles } from "../../app/knowledge/articles";
import { manualSections } from "../../app/manual/sections";
import { helpContents, MAX_HELP_TEXT, readHelp, searchHelp } from "../helpIndex";
import index from "../helpIndex.generated.json";

describe("help index", () => {
  it("is current with the pages it was built from", () => {
    const out = execFileSync(process.execPath, [path.resolve("scripts/build-help-index.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("Help index is current");
  }, 60_000);

  it("holds every Knowledge base article and Manual page, with sections and links", () => {
    const refs = index.pages.map((p) => p.ref);
    for (const a of articles) expect(refs).toContain(`knowledge/${a.slug}`);
    for (const s of manualSections) expect(refs).toContain(`manual/${s.slug || "start"}`);
    for (const p of index.pages) {
      expect(p.sections.length).toBeGreaterThan(0);
      for (const s of p.sections) expect(s.href.startsWith(p.href)).toBe(true);
    }
    // Navigation is left out: no "On this page" list and no previous/next links in the text.
    const crosstabs = index.pages.find((p) => p.ref === "knowledge/crosstabs")!;
    expect(crosstabs.sections.map((s) => s.text).join("\n")).not.toContain("On this page");
    expect(crosstabs.sections.map((s) => s.text).join("\n")).not.toMatch(/[←→]/);
  });

  it("search finds the sections that use the question's words, best first, with a ref that reads", () => {
    const hits = searchHelp("what sample size do I need for a margin of error");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].ref).toBe("knowledge/research-assistant#sample");
    expect(hits[0].href).toBe("/knowledge/research-assistant#sample");
    const read = readHelp(hits[0].ref)!;
    expect(read.title).toBe("How the Research assistant works: Sample sizes and margins of error");
    expect(read.text).toContain("385");
    // Stems: "weights" finds sections about weighting.
    expect(searchHelp("weights").some((h) => h.ref.startsWith("knowledge/crosstabs"))).toBe(true);
    // Words that are all stop words, or nothing in common, find nothing.
    expect(searchHelp("what is the")).toEqual([]);
    expect(searchHelp("zzqx")).toEqual([]);
  });

  it("reads a whole page or one section; an unknown ref is null; a long page is cut and says so", () => {
    expect(readHelp("manual/limits")!.text).toContain("## Initial import exclusions");
    expect(readHelp("knowledge/nothing")).toBeNull();
    expect(readHelp("knowledge/crosstabs#no-such-section")).toBeNull();
    const longest = [...index.pages].sort((a, b) => b.sections.reduce((n, s) => n + s.text.length, 0) - a.sections.reduce((n, s) => n + s.text.length, 0))[0];
    const read = readHelp(longest.ref)!;
    expect(read.truncated).toBe(true);
    expect(read.text.length).toBeLessThan(MAX_HELP_TEXT + 200);
    expect(read.text).toContain("read one of its sections instead");
    expect(helpContents()).toContain("knowledge/research-assistant: How the Research assistant works.");
  });
});

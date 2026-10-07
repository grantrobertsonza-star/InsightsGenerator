import { describe, expect, it } from "vitest";
import { classifyHeader, parseCodedParagraphs, parseCodingGrid } from "../codedImport";

describe("classifyHeader", () => {
  it("reads ATLAS.ti quotation report headers", () => {
    expect(classifyHeader("Quotation Content")).toBe("quote");
    expect(classifyHeader("Codes")).toBe("code");
    expect(classifyHeader("Quotation Name")).toBe("other");
    expect(classifyHeader("Comment")).toBe("other");
    expect(classifyHeader("Document")).toBe("document");
  });
  it("reads theme table headers", () => {
    expect(classifyHeader("Theme")).toBe("code");
    expect(classifyHeader("Theme definition")).toBe("definition");
    expect(classifyHeader("Illustrative quote")).toBe("quote");
    expect(classifyHeader("Count")).toBe("count");
    expect(classifyHeader("Number of participants")).toBe("count");
  });
});

describe("parseCodingGrid", () => {
  it("parses a theme table with several quotes in one cell", () => {
    const grid = [
      ["Theme", "Definition", "Count", "Illustrative quotes"],
      [
        "Confusing pricing, offers, and billing",
        "People cannot tell what they will pay",
        "18",
        "I never know what my bill will be\nThe promotion ended and nobody told me",
      ],
      ["Retention offers", "", "5", "They offered me a discount but not a fix"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.shape).toBe("table");
    expect(r.codes.map((c) => c.name)).toEqual([
      "Confusing pricing, offers, and billing",
      "Retention offers",
    ]);
    expect(r.codes[0].definition).toBe("People cannot tell what they will pay");
    expect(r.entries).toHaveLength(3);
    expect(r.warnings.join(" ")).toMatch(/counts/);
  });

  it("parses coded sentences with several codes per cell", () => {
    const grid = [
      ["Document", "Quotation Content", "Codes", "Comment"],
      ["P1", "My data ran out and I was charged again", "Billing; Bundle confusion", ""],
      ["P1", "I just want someone to own the problem", "Accountability", ""],
      ["P2", "Nothing was coded here", "", ""],
    ];
    const r = parseCodingGrid(grid);
    expect(r.entries.map((e) => [e.code, e.quote])).toEqual([
      ["Billing", "My data ran out and I was charged again"],
      ["Bundle confusion", "My data ran out and I was charged again"],
      ["Accountability", "I just want someone to own the problem"],
    ]);
    expect(r.warnings.join(" ")).toMatch(/no code/);
  });

  it("does not split code names on commas", () => {
    const grid = [
      ["Quote", "Code"],
      ["Some long enough quote here", "Pricing, offers, and billing"],
    ];
    expect(parseCodingGrid(grid).codes[0].name).toBe("Pricing, offers, and billing");
  });

  it("reads a coding matrix", () => {
    const grid = [
      ["Sentence", "Pricing", "Support"],
      ["The price changed without warning", "1", ""],
      ["The agent never called back", "", "x"],
      ["Both things happened to me", "1", "1"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.shape).toBe("matrix");
    expect(r.entries).toHaveLength(4);
    expect(r.codes.map((c) => c.name)).toEqual(["Pricing", "Support"]);
  });

  it("uses a fallback code name when the sheet is named after the code", () => {
    const grid = [
      ["Quotation Content", "Comment"],
      ["A quote that is long enough to match", ""],
    ];
    expect(parseCodingGrid(grid).entries).toHaveLength(0);
    expect(parseCodingGrid(grid, "Trust in staff").entries[0].code).toBe("Trust in staff");
  });

  it("finds the header below a title block", () => {
    const grid = [
      ["Coding report"],
      [""],
      ["Theme", "Quote"],
      ["Trust", "They really helped me out on the phone"],
    ];
    expect(parseCodingGrid(grid).entries).toHaveLength(1);
  });
});

describe("two-level theme tables", () => {
  it("uses the sub-theme as the code and fills the theme down", () => {
    const grid = [
      ["Theme", "Sub-Theme / Code", "Code Definition", "Frequency", "Representative Quote"],
      ["Digital Fatigue", "Always-On Expectation", "Feeling forced to reply after hours.", "14 mentions", "\"If I don't reply to a Slack message by 8 PM, I feel like I'm seen as lazy.\" (P3, Line 45)"],
      ["", "Meeting Overload", "Exhaustion from back-to-back calls.", "9 mentions", "\"By the third Zoom call of the day, my brain just completely shuts off.\" (P7, Line 112)"],
      ["Loss of Boundaries", "Physical Workspace Blurry", "No separation of home and work.", "11 mentions", "\"My laptop sits on my dining table.\" (P1, Line 89)"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.codes.map((c) => c.name)).toEqual([
      "Always-On Expectation",
      "Meeting Overload",
      "Physical Workspace Blurry",
    ]);
    expect(r.entries[0].quote).toBe("If I don't reply to a Slack message by 8 PM, I feel like I'm seen as lazy.");
    expect(r.codes[1].theme).toBe("Digital Fatigue");
    expect(r.codes[1].definition).toBe("Exhaustion from back-to-back calls.");
  });
});

describe("parseCodedParagraphs", () => {
  it("reads a themed data extract", () => {
    const r = parseCodedParagraphs([
      "THEME A: DIGITAL FATIGUE",
      "Code: Always-On Expectation",
      "Participant 3 (Transcript lines 42-45): \"If I don't reply to a Slack message by 8 PM, I feel like I'm seen as lazy.\"",
      "Participant 5 (Transcript lines 12-14): \"My manager sends emails at midnight and the pressure is intense.\"",
      "[Researcher Analytical Note: \"the pressure isn't always explicit\" for later]",
      "Code: Meeting Overload",
      "Participant 7 (Transcript lines 112-114): \"By the third Zoom call of the day, my brain just completely shuts off.\"",
    ]);
    expect(r.codes.map((c) => c.name)).toEqual(["Always-On Expectation", "Meeting Overload"]);
    expect(r.entries.filter((e) => e.quote)).toHaveLength(3);
    expect(r.codes[1].theme).toBe("DIGITAL FATIGUE");
  });
});

describe("codebook only files", () => {
  it("reads code, definition, inclusion and exclusion without quotes", () => {
    const grid = [
      ["Code Name", "Theme / Category", "Definition", "Inclusion Criteria", "Exclusion Criteria", "Frequency"],
      ["Always-On", "Digital Fatigue", "Replying after hours", "Mentions evening messages", "Planned on-call", "14"],
      ["Meeting Overload", "Digital Fatigue", "Too many calls", "Back-to-back meetings", "", "9"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.entries.every((e) => e.quote === null)).toBe(true);
    expect(r.codes[0]).toMatchObject({
      name: "Always-On",
      theme: "Digital Fatigue",
      definition: "Replying after hours",
      inclusion: "Mentions evening messages",
      exclusion: "Planned on-call",
    });
    expect(r.codes).toHaveLength(2);
  });
  it("reads keyword columns", () => {
    const grid = [
      ["Core Target Concept", "Explicit Manifest Meaning", "Target Key Words / Phrases"],
      ["Peer Support", "Coworkers helping", "\"team\", \"colleague\""],
    ];
    const r = parseCodingGrid(grid);
    expect(r.codes[0].keywords).toBe('"team", "colleague"');
  });
});

describe("worksheet templates", () => {
  it("reads the thematic analysis worksheet", () => {
    const grid = [
      ["Theme", "Sub-Theme / Code", "Data Meaning & Boundaries", "Participant IDs", "Raw Text Extracts / Quotes"],
      ["Systemic Burnout", "Invisible Workloads", "Tasks required but not counted in formal hours.", "P_03, P_11", "\"I spend two hours every night just updating charts on my own time.\" (P_03)"],
      ["Systemic Burnout", "Emotional Exhaustion", "Feeling drained or empty.", "P_02, P_09", "\"By noon, I feel like a hollow shell. I have nothing left to give.\" (P_09)"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.codes.map((c) => c.name)).toEqual(["Invisible Workloads", "Emotional Exhaustion"]);
    expect(r.entries[1].quote).toBe("By noon, I feel like a hollow shell. I have nothing left to give.");
  });
  it("reads the content analysis worksheet and ignores IDs and counts", () => {
    const grid = [
      ["Category ID", "Core Target Concept", "Explicit Manifest Meaning", "Target Key Words / Phrases", "Document Frequency", "Total Mentions", "Example Data Point"],
      ["CAT-01", "Peer Support", "Mentions of coworkers providing relief.", "\"team\", \"colleague\"", "8 / 10 transcripts", "34 times", "\"My team is the only reason I haven't quit yet.\" (T_04, Line 22)"],
    ];
    const r = parseCodingGrid(grid);
    expect(r.codes.map((c) => c.name)).toEqual(["Peer Support"]);
    expect(r.entries[0].quote).toBe("My team is the only reason I haven't quit yet.");
    expect(r.warnings.join(" ")).toMatch(/counts/);
  });
});

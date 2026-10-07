import { describe, expect, it } from "vitest";
import {
  segmentTranscriptDetailed,
  summariseSegmentation,
  buildApplyBatches,
  buildPageIndex,
  pageForSegment,
  matchQuote,
  parseAssignments,
  pickExemplar,
  segmentTranscript,
  tallyQuoteMatches,
  validateConsolidation,
} from "../qualCoding";

const LABELLED = `Moderator: How do you feel about the new fees?
Thandi: Honestly I think the fees are too high for what we get. I do not see the value.
Moderator: And you?
Sipho: For me it is the trust. I do not trust the app with my money.
Moderator: Say more about that.
Sipho: Last year they froze my account for a week and nobody called me back.`;

describe("segmentTranscript", () => {
  it("splits labelled turns and marks moderator turns", () => {
    const segs = segmentTranscript(LABELLED);
    expect(segs).toHaveLength(6);
    expect(segs[0]).toMatchObject({ speaker: "Moderator", role: "moderator" });
    expect(segs[1]).toMatchObject({ speaker: "Thandi", role: "participant" });
    expect(segs[5].text).toContain("froze my account");
  });

  it("does not treat a stray colon in prose as a speaker", () => {
    const text =
      "The reason: it was late.\n\nAnother paragraph here with no labels at all.";
    const segs = segmentTranscript(text);
    expect(segs.every((s) => s.speaker === null && s.role === "unknown")).toBe(
      true,
    );
    expect(segs).toHaveLength(2);
  });

  it("joins continuation lines to the same turn", () => {
    const text = `Q: First?\nA: one line\nand more of the answer\nQ: Second?\nA: another\nQ: Third?\nA: last`;
    const segs = segmentTranscript(text);
    const answer = segs.find((s) => s.text.startsWith("one line"));
    expect(answer?.text).toBe("one line and more of the answer");
    expect(answer?.role).toBe("participant");
  });

  it("splits very long turns at sentence boundaries without losing text", () => {
    const sentence = "This is a fairly long sentence about prices. ";
    const long = `Lerato: ${sentence.repeat(60)}\nModerator: ok\nLerato: yes\nModerator: and\nLerato: fine`;
    const segs = segmentTranscript(long).filter((s) => s.speaker === "Lerato");
    expect(segs.length).toBeGreaterThan(2);
    expect(segs.every((s) => s.text.length <= 1200)).toBe(true);
  });
});

describe("segmentTranscript respondent headings", () => {
  const NOTES = `Interview 1 Transcript\nDemographics\nSex: Male\nAge Group: 25-34\nCharging stations are limited.\n\nInterview 2 Transcript\nDemographics\nSex: Female\nAge Group: 35-44\nCost is the main worry.`;

  it("treats each heading as a respondent and ignores field labels", () => {
    const segs = segmentTranscript(NOTES);
    expect(segs.map((s) => s.speaker)).toEqual(["Interview 1", "Interview 2"]);
    expect(segs.every((s) => s.role === "participant")).toBe(true);
    expect(segs[1].text).toContain("Cost is the main worry");
  });

  it("does not trigger on a single heading", () => {
    const segs = segmentTranscript(
      "Interview 1\n\nSome text here.\n\nMore text.",
    );
    expect(segs.every((s) => s.speaker === null)).toBe(true);
  });
});

describe("segmentTranscriptDetailed", () => {
  const NOTES = `Interview 1 Transcript\nDemographics\n- Sex: Male\n- Age Group: 25-34\n- Residence: Urban (Cape Town)/Western Cape\nCharging infrastructure & convenience\n- Charging stations are limited.\n\nInterview 2 Transcript\nDemographics\n- Sex: Female\n- Age Group: 35-44\nCost is the main worry.`;

  it("lifts profile lines out of the text and keeps them per respondent", () => {
    const r = segmentTranscriptDetailed(NOTES);
    expect(r.mode).toBe("headings");
    expect(r.profiles).toEqual([
      {
        speaker: "Interview 1",
        fields: {
          Sex: "Male",
          "Age Group": "25-34",
          Residence: "Urban (Cape Town)/Western Cape",
        },
      },
      {
        speaker: "Interview 2",
        fields: { Sex: "Female", "Age Group": "35-44" },
      },
    ]);
    expect(r.segments[0].text).not.toContain("Sex");
    expect(r.segments[0].text).toContain("Charging stations are limited");
  });

  it("reads each paragraph as a respondent when asked", () => {
    const r = segmentTranscriptDetailed(
      "First person says this.\n\nSecond person says that.",
      {
        mode: "paragraphs",
      },
    );
    expect(r.segments.map((s) => s.speaker)).toEqual([
      "Respondent 1",
      "Respondent 2",
    ]);
  });

  it("falls back with a note when a forced mode finds nothing", () => {
    const r = segmentTranscriptDetailed("Just prose.\n\nMore prose.", {
      mode: "headings",
    });
    expect(r.mode).toBe("none");
    expect(r.notes[0]).toContain("No headings");
  });

  it("marks chosen speakers as moderator, case-insensitively", () => {
    const text =
      "Anna: How do you feel?\nBen: Fine thanks.\nAnna: And the cost?\nBen: Too high.";
    const r = segmentTranscriptDetailed(text, { moderators: ["anna"] });
    expect(r.segments.filter((s) => s.role === "moderator")).toHaveLength(2);
  });
});

describe("summariseSegmentation", () => {
  it("warns when no speakers and no moderator were found", () => {
    const r = segmentTranscriptDetailed("Some text.\n\nOther text.");
    const s = summariseSegmentation(r.segments, r.mode);
    expect(s.respondents).toBeNull();
    expect(s.warnings.length).toBe(2);
  });

  it("counts respondents and warns on a dominant speaker", () => {
    const seg = (speaker: string, n: number) => ({
      speaker,
      role: "participant" as const,
      text: "x".repeat(n),
    });
    const s = summariseSegmentation(
      [seg("A", 900), seg("B", 50), seg("C", 50)],
      "headings",
    );
    expect(s.respondents).toBe(3);
    expect(s.warnings.some((w) => w.includes("70%"))).toBe(true);
  });
});

describe("matchQuote", () => {
  const segs = segmentTranscript(LABELLED);

  it("finds an exact quote and reports who said it", () => {
    const m = matchQuote("I do not trust the app with my money", segs);
    expect(m.match).toBe("exact");
    expect(m.speaker).toBe("Sipho");
    expect(m.role).toBe("participant");
  });

  it("ignores curly quotes and case", () => {
    const m = matchQuote("“FOR ME IT IS THE TRUST”", segs);
    expect(m.match).toBe("exact");
  });

  it("joins fragments from one turn across an ellipsis", () => {
    const m = matchQuote(
      "Last year they froze my account ... nobody called me back",
      segs,
    );
    expect(m.match).toBe("exact");
  });

  it("calls a slightly altered quote near, not exact", () => {
    const m = matchQuote(
      "Last year they froze my account for a whole week and nobody phoned me back",
      segs,
    );
    expect(m.match).toBe("near");
  });

  it("returns none for an invented quote", () => {
    expect(
      matchQuote("I love the rewards programme and the cashback", segs).match,
    ).toBe("none");
  });

  it("flags a quote that only appears in the moderator's words", () => {
    const m = matchQuote("How do you feel about the new fees", segs);
    expect(m.match).toBe("exact");
    expect(m.role).toBe("moderator");
    expect(tallyQuoteMatches([m]).moderator).toBe(1);
  });

  it("treats words stitched from two turns as near with spansTurns", () => {
    const m = matchQuote(
      "I do not see the value. And you? For me it is the trust",
      segs,
    );
    expect(m.match).toBe("near");
    expect(m.spansTurns).toBe(true);
  });
});

describe("validateConsolidation", () => {
  const good = (name: string, members: { run: number; theme: number }[]) => ({
    name,
    definition: `${name} definition`,
    inclusion_criteria: "when it applies",
    exclusion_criteria: "when it does not",
    members,
  });

  it("computes reproduction from valid members, never from the model", () => {
    const codes = validateConsolidation(
      [
        good("Fees", [
          { run: 1, theme: 1 },
          { run: 2, theme: 2 },
          { run: 2, theme: 1 },
        ]),
        good("Trust", [{ run: 3, theme: 1 }]),
      ],
      [2, 2, 1],
    );
    expect(codes.map((c) => [c.name, c.reproducedRuns])).toEqual([
      ["Fees", 2],
      ["Trust", 1],
    ]);
  });

  it("drops members pointing outside the runs and codes with none left", () => {
    const codes = validateConsolidation(
      [
        good("Ghost", [
          { run: 9, theme: 1 },
          { run: 1, theme: 99 },
        ]),
        good("Real", [{ run: 1, theme: 1 }]),
      ],
      [1],
    );
    expect(codes.map((c) => c.name)).toEqual(["Real"]);
  });

  it("drops duplicate names and malformed entries", () => {
    const codes = validateConsolidation(
      [
        good("Fees", [{ run: 1, theme: 1 }]),
        good("fees", [{ run: 1, theme: 1 }]),
        { name: "", members: [] },
        null,
      ],
      [1],
    );
    expect(codes).toHaveLength(1);
  });

  it("returns nothing for a non-array", () => {
    expect(validateConsolidation({}, [1])).toEqual([]);
  });
});

describe("buildApplyBatches", () => {
  it("skips moderator segments and attaches the preceding question as context", () => {
    const batches = buildApplyBatches(segmentTranscript(LABELLED));
    const items = batches.flatMap((b) => b.items);
    expect(items).toHaveLength(3);
    expect(items[0].context).toContain("How do you feel");
    expect(items.every((i) => i.index !== 0)).toBe(true);
  });

  it("starts a new batch when the item limit is reached", () => {
    const text = Array.from(
      { length: 8 },
      (_, i) => `Mod: q${i}\nPerson: answer number ${i} with some words`,
    ).join("\n");
    const batches = buildApplyBatches(segmentTranscript(text), { maxItems: 3 });
    expect(batches.length).toBe(3);
  });
});

describe("parseAssignments", () => {
  it("keeps valid indexes and codes only, and dedupes", () => {
    const out = parseAssignments(
      [
        { index: 1, codes: [1, 1, 3, 9, 0, "x"] },
        { index: 7, codes: [1] },
        { index: 2, codes: [] },
      ],
      new Set([1, 2]),
      3,
    );
    expect([...out.entries()]).toEqual([[1, [1, 3]]]);
  });
});

describe("pickExemplar", () => {
  it("prefers a readable participant turn near the target length and never a moderator", () => {
    const segs = segmentTranscript(LABELLED);
    const pick = pickExemplar(segs);
    expect(pick?.segment.role).toBe("participant");
    expect(segs.some((s) => s.text.includes(pick!.quote))).toBe(true);
  });

  it("returns null with only moderator segments", () => {
    expect(
      pickExemplar([
        {
          index: 0,
          speaker: "Moderator",
          role: "moderator",
          text: "hello there",
        },
      ]),
    ).toBeNull();
  });

  it("cuts a long turn to a verbatim stretch", () => {
    const text = "word ".repeat(300).trim();
    const pick = pickExemplar([
      { index: 0, speaker: "P", role: "participant", text },
    ]);
    expect(pick!.quote.length).toBeLessThanOrEqual(500);
    expect(text.startsWith(pick!.quote)).toBe(true);
  });
});

describe("pageForSegment", () => {
  it("finds the page a segment starts on", () => {
    const index = buildPageIndex([
      {
        pageNumber: 1,
        text: "Moderator: hello and welcome to the session today.",
      },
      {
        pageNumber: 2,
        text: "Sipho: For me it is the trust. I do not trust the app with my money.",
      },
    ]);
    expect(
      pageForSegment(
        "For me it is the trust. I do not trust the app with my money.",
        index,
      ),
    ).toBe(2);
    expect(
      pageForSegment("nothing like this anywhere in the document", index),
    ).toBeNull();
    expect(pageForSegment("anything at all here", [])).toBeNull();
  });
});

describe("segmentTranscriptDetailed, several sessions in one file", () => {
  const GROUPS = `Setting: fictional\n\nFOCUS GROUP 1: PREPAID CUSTOMERS\nModerator: M, facilitator.\n[00:00-06:00] Introductions\nM: Welcome.\nP1: Prices are odd.\nM: Why?\nP2: Same here.\nP1: Yes.\n\nFOCUS GROUP 2: CONTRACT CUSTOMERS\nM: Welcome back.\nP1: Support is slow.\nP2: Agreed.\nP1: Always.`;

  it("keys participants by session and treats M as the moderator", () => {
    const r = segmentTranscriptDetailed(GROUPS);
    expect(r.mode).toBe("sessions");
    const people = new Set(
      r.segments.filter((s) => s.role === "participant").map((s) => s.speaker),
    );
    expect(people).toEqual(
      new Set([
        "P1 (Focus group 1)",
        "P2 (Focus group 1)",
        "P1 (Focus group 2)",
        "P2 (Focus group 2)",
      ]),
    );
    expect(
      r.segments.some((s) => s.speaker === "M" && s.role === "moderator"),
    ).toBe(true);
  });

  it("does not glue time blocks onto a turn and skips the preamble", () => {
    const r = segmentTranscriptDetailed(GROUPS);
    expect(r.segments.some((s) => s.text.includes("Introductions"))).toBe(
      false,
    );
    expect(
      r.notes.some((n) => n.includes("before the first session heading")),
    ).toBe(true);
  });

  const INTERVIEWS = `Index\nU01 Unstructured\n\nU01: Unstructured interview\nNandi, 26 | Student | Prepaid\nI: Tell me about it.\nR: It is fine.\nI: And?\nR: Data is costly.\n\nS01: Semi-structured interview\nI: How reliable is it?\nR: Mostly.\nI: Support?\nR: Slow.`;

  it("makes each interview one respondent, with I as the interviewer", () => {
    const r = segmentTranscriptDetailed(INTERVIEWS);
    expect(r.mode).toBe("sessions");
    expect(
      r.segments
        .filter((s) => s.role === "moderator")
        .every((s) => s.speaker === "I"),
    ).toBe(true);
    expect(
      new Set(
        r.segments
          .filter((s) => s.role === "participant")
          .map((s) => s.speaker),
      ),
    ).toEqual(new Set(["U01", "S01"]));
    const u01 = r.profiles.find((p) => p.speaker === "U01");
    expect(u01?.fields["Session title"]).toBe("Unstructured interview");
    expect(u01?.fields.Profile).toContain("Nandi");
  });
});

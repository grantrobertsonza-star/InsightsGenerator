import { describe, expect, it } from "vitest";
import {
  buildRespondents,
  cohenKappa,
  computeCodeStats,
  detectEchoes,
  findCaseRow,
  flagDissonance,
  formatCount,
  kappaBand,
  kappaCaveat,
  numericVariables,
  parseNegativeCases,
  parseNumber,
  selectCalibrationSample,
  validateLinkProposals,
  type AnalysisSegment,
} from "../qualAnalysis";

const pairs = (spec: [boolean, boolean, number][]) =>
  spec.flatMap(([model, researcher, n]) =>
    Array.from({ length: n }, () => ({ model, researcher })),
  );

describe("cohenKappa", () => {
  it("gives 1 for perfect agreement with both outcomes present", () => {
    const k = cohenKappa(
      pairs([
        [true, true, 5],
        [false, false, 5],
      ]),
    );
    expect(k.kappa).toBeCloseTo(1);
    expect(k.agreement).toBe(1);
  });

  it("matches a worked example", () => {
    // 20 yes/yes, 5 model-only, 10 researcher-only, 15 no/no
    const k = cohenKappa(
      pairs([
        [true, true, 20],
        [true, false, 5],
        [false, true, 10],
        [false, false, 15],
      ]),
    );
    expect(k.n).toBe(50);
    expect(k.agreement).toBeCloseTo(0.7);
    expect(k.kappa).toBeCloseTo(0.4, 5);
  });

  it("is about zero when agreement is no better than chance", () => {
    const k = cohenKappa(
      pairs([
        [true, true, 5],
        [true, false, 5],
        [false, true, 5],
        [false, false, 5],
      ]),
    );
    expect(k.kappa).toBeCloseTo(0);
  });

  it("is undefined when one side never varies", () => {
    expect(cohenKappa(pairs([[true, true, 10]])).kappa).toBeNull();
    expect(cohenKappa([]).kappa).toBeNull();
  });

  it("labels bands and warns on thin samples", () => {
    expect(kappaBand(0.7)).toBe("Substantial");
    expect(kappaBand(-0.1)).toBe("Worse than chance");
    expect(kappaBand(null)).toBe("Not defined");
    expect(
      kappaCaveat(
        cohenKappa(
          pairs([
            [true, true, 3],
            [false, false, 3],
          ]),
        ),
      ),
    ).toMatch(/Only 6 turns/);
    expect(
      kappaCaveat(
        cohenKappa(
          pairs([
            [true, true, 1],
            [false, false, 40],
          ]),
        ),
      ),
    ).toMatch(/very few/);
    expect(
      kappaCaveat(
        cohenKappa(
          pairs([
            [true, true, 10],
            [false, false, 20],
          ]),
        ),
      ),
    ).toBeNull();
  });
});

describe("selectCalibrationSample", () => {
  const segs = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`,
    index: i,
    role: (i % 5 === 0 ? "moderator" : "participant") as
      "moderator" | "participant",
    codes: i % 3 === 0 ? [1] : i % 3 === 1 ? [2] : [],
  }));

  it("is deterministic, skips moderators, and returns transcript order", () => {
    const a = selectCalibrationSample(segs, 2, { size: 12 });
    const b = selectCalibrationSample(segs, 2, { size: 12 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    const idx = a.map((id) => Number(id.slice(1)));
    expect(idx.every((i) => i % 5 !== 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it("includes turns for every code and some with no code", () => {
    const sample = selectCalibrationSample(segs, 2, { size: 12 });
    const chosen = segs.filter((s) => sample.includes(s.id));
    expect(
      chosen.filter((s) => s.codes.includes(1)).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      chosen.filter((s) => s.codes.includes(2)).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      chosen.filter((s) => s.codes.length === 0).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("never returns more than exist", () => {
    const small = segs.slice(0, 4);
    expect(
      selectCalibrationSample(small, 2, { size: 24 }).length,
    ).toBeLessThanOrEqual(4);
  });
});

const seg = (
  index: number,
  speaker: string | null,
  text: string,
  role: "participant" | "moderator" = "participant",
): AnalysisSegment => ({ id: `id${index}`, index, speaker, role, text });

describe("computeCodeStats", () => {
  const segments = [
    seg(0, "Moderator", "How do you find the fees?", "moderator"),
    seg(
      1,
      "Thandi",
      "The fees are far too high for what the app gives me every month.",
    ),
    seg(2, "Moderator", "And you?", "moderator"),
    seg(3, "Sipho", "Same for me."),
    seg(
      4,
      "Sipho",
      "I also worry about trust and where my money sits overnight.",
    ),
    seg(5, "Lerato", "Mine is not the fees, I just like the colours."),
  ];
  const assignments = new Map<string, number[]>([
    ["id1", [1]],
    ["id3", [1]],
    ["id4", [2]],
  ]);

  it("counts turns and speakers against the participants in the transcript", () => {
    const [fees, trust] = computeCodeStats({
      segments,
      assignments,
      codeCount: 2,
      focusGroup: false,
    });
    expect(fees).toMatchObject({
      turns: 2,
      participantTurns: 4,
      speakersWith: 2,
      speakersTotal: 3,
      echoTurns: 0,
    });
    expect(trust).toMatchObject({
      turns: 1,
      speakersWith: 1,
      speakersTotal: 3,
    });
    expect(fees.independentSpeakers).toBeNull();
  });

  it("flags a short reply right after another speaker as an echo in a focus group", () => {
    const [fees] = computeCodeStats({
      segments,
      assignments,
      codeCount: 2,
      focusGroup: true,
    });
    expect(fees.echoTurns).toBe(1);
    expect(fees.speakersWith).toBe(2);
    expect(fees.independentSpeakers).toBe(1);
  });

  it("reports no speaker counts for an unlabelled transcript", () => {
    const plain = [seg(0, null, "one answer"), seg(1, null, "another answer")];
    const [s] = computeCodeStats({
      segments: plain,
      assignments: new Map([
        ["id0", [1]],
        ["id1", [1]],
      ]),
      codeCount: 1,
      focusGroup: false,
    });
    expect(s.speakersWith).toBeNull();
    expect(s.speakersTotal).toBeNull();
    expect(s.turns).toBe(2);
  });

  it("groups coded turns into episodes", () => {
    const long = Array.from({ length: 12 }, (_, i) =>
      seg(i, "P", `turn number ${i} with some words`),
    );
    const [s] = computeCodeStats({
      segments: long,
      assignments: new Map([
        ["id0", [1]],
        ["id1", [1]],
        ["id9", [1]],
      ]),
      codeCount: 1,
      focusGroup: false,
    });
    expect(s.episodes).toBe(2);
  });
});

describe("detectEchoes", () => {
  it("does not flag a long, different turn, flags a short agreement, ignores the same speaker", () => {
    const segments = [
      seg(
        0,
        "A",
        "Prices keep climbing and my statement shows a new charge every single month now.",
      ),
      seg(
        1,
        "B",
        "In my case it was the card replacement, which cost me far more than I was ever told about at the branch.",
      ),
      seg(2, "A", "Yes."),
    ];
    const echoes = detectEchoes(segments, new Set(["id0", "id1", "id2"]));
    expect(echoes.has("id1")).toBe(false);
    expect(echoes.has("id2")).toBe(true);
    const same = detectEchoes(
      [seg(0, "A", "Fees are too high for me"), seg(1, "A", "Yes really")],
      new Set(["id0", "id1"]),
    );
    expect(same.has("id1")).toBe(false);
  });

  it("flags a long turn that repeats most of the earlier words", () => {
    const first =
      "the monthly account fee is far too expensive for the small balance I keep there";
    const segments = [
      seg(0, "A", first),
      seg(1, "B", `${first} honestly, truly`),
    ];
    expect(detectEchoes(segments, new Set(["id0", "id1"])).has("id1")).toBe(
      true,
    );
  });

  it("ignores earlier turns outside the window", () => {
    const filler = Array.from({ length: 5 }, (_, i) =>
      seg(
        i + 1,
        "C",
        `unrelated talk about something else entirely number ${i}`,
      ),
    );
    const segments = [
      seg(0, "A", "Fees are too high"),
      ...filler,
      seg(6, "B", "Agreed"),
    ];
    expect(detectEchoes(segments, new Set(["id0", "id6"])).has("id6")).toBe(
      false,
    );
  });
});

describe("buildRespondents", () => {
  it("builds one row per speaker with theme counts and case keys", () => {
    const segments = [
      seg(0, "Moderator", "q", "moderator"),
      seg(1, "Thandi", "a"),
      seg(2, "Thandi", "b"),
      seg(3, "Sipho", "c"),
    ];
    const rows = buildRespondents(
      segments,
      new Map([
        ["id1", [1]],
        ["id2", [1, 2]],
      ]),
      new Map([["Thandi", "R001"]]),
    );
    expect(rows.map((r) => r.label)).toEqual(["Sipho", "Thandi"]);
    const thandi = rows[1];
    expect(thandi.caseKey).toBe("R001");
    expect(thandi.codes.get(1)).toBe(2);
    expect(thandi.codes.get(2)).toBe(1);
    expect(rows[0].codes.size).toBe(0);
  });

  it("treats an unlabelled transcript as one respondent", () => {
    const rows = buildRespondents(
      [seg(0, null, "x"), seg(1, null, "y")],
      new Map([["id0", [1]]]),
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Whole transcript");
  });
});

describe("closed answers", () => {
  const headers = ["Respondent", "Fee satisfaction", "Region"];
  const rows = [
    ["R001", 1, "North"],
    ["R002", 2, "South"],
    ["R003", 4, "North"],
    ["R004", 5, "East"],
    ["R005", "NA", "East"],
  ];

  it("parses numbers and missing tokens", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("45%")).toBe(45);
    expect(parseNumber("NA")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });

  it("finds numeric columns and their median", () => {
    const vars = numericVariables(headers, rows);
    expect(vars.map((v) => v.name)).toEqual(["Fee satisfaction"]);
    expect(vars[0].median).toBe(3);
  });

  it("matches a case key regardless of case and spacing", () => {
    expect(findCaseRow(headers, rows, "Respondent", " r003 ").row?.[1]).toBe(4);
    expect(findCaseRow(headers, rows, "Respondent", "R999").row).toBeNull();
    expect(findCaseRow(headers, rows, "Nope", "R001").row).toBeNull();
  });

  it("flags a respondent who voiced the theme but answered on the wrong side", () => {
    const respondents = [
      {
        key: "A",
        label: "A",
        caseKey: "R001",
        turns: 3,
        codes: new Map([[1, 2]]),
      },
      {
        key: "B",
        label: "B",
        caseKey: "R004",
        turns: 3,
        codes: new Map([[1, 1]]),
      },
      {
        key: "C",
        label: "C",
        caseKey: "R005",
        turns: 3,
        codes: new Map([[1, 1]]),
      },
      {
        key: "D",
        label: "D",
        caseKey: null,
        turns: 3,
        codes: new Map([[1, 1]]),
      },
      { key: "E", label: "E", caseKey: "R002", turns: 3, codes: new Map() },
    ];
    const result = flagDissonance({
      respondents,
      codeNames: ["Fees too high"],
      links: [
        {
          codeName: "Fees too high",
          variable: "Fee satisfaction",
          direction: "lower",
        },
      ],
      headers,
      rows,
      caseColumn: "Respondent",
    });
    expect(result.flags.map((f) => f.respondent)).toEqual(["B"]);
    expect(result.checked).toBe(2);
    expect(result.unmatched).toBe(2);
  });

  it("does not flag a value on the median", () => {
    const result = flagDissonance({
      respondents: [
        {
          key: "A",
          label: "A",
          caseKey: "R003",
          turns: 1,
          codes: new Map([[1, 1]]),
        },
      ],
      codeNames: ["x"],
      links: [
        { codeName: "x", variable: "Fee satisfaction", direction: "lower" },
      ],
      headers,
      rows: [
        ["R003", 3, "N"],
        ["R1", 1, "N"],
        ["R2", 5, "N"],
      ],
      caseColumn: "Respondent",
    });
    expect(result.flags).toHaveLength(0);
    expect(result.checked).toBe(1);
  });
});

describe("model output validation", () => {
  it("snaps variables to real headers and drops invalid proposals", () => {
    const out = validateLinkProposals(
      [
        {
          code: 1,
          variable: "fee satisfaction",
          direction: "lower",
          rationale:
            "People who say fees are high should rate satisfaction low.",
        },
        {
          code: 1,
          variable: "Fee Satisfaction",
          direction: "lower",
          rationale: "duplicate",
        },
        {
          code: 9,
          variable: "Fee satisfaction",
          direction: "lower",
          rationale: "bad code",
        },
        {
          code: 1,
          variable: "Invented",
          direction: "lower",
          rationale: "bad variable",
        },
        {
          code: 1,
          variable: "Fee satisfaction",
          direction: "sideways",
          rationale: "bad direction",
        },
        {
          code: 1,
          variable: "Fee satisfaction",
          direction: "higher",
          rationale: "",
        },
      ],
      2,
      ["Respondent", "Fee satisfaction"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].variable).toBe("Fee satisfaction");
  });

  it("keeps valid negative cases, caps per code, and drops unknown turns", () => {
    const out = parseNegativeCases(
      [
        { code: 1, index: 4, reason: "Says fees are fine" },
        { code: 1, index: 4, reason: "dup" },
        { code: 1, index: 7, reason: "Another" },
        { code: 1, index: 8, reason: "Third" },
        { code: 1, index: 9, reason: "Fourth is over the cap" },
        { code: 2, index: 99, reason: "not shown" },
        { code: 3, index: 4, reason: "no such code" },
        { code: 2, index: 4, reason: "" },
      ],
      new Set([4, 7, 8, 9]),
      2,
    );
    expect(out.map((o) => `${o.code}:${o.index}`)).toEqual([
      "1:4",
      "1:7",
      "1:8",
    ]);
  });

  it("formats counts with a plural denominator noun", () => {
    expect(formatCount(5, 8, "participant")).toBe("5 of 8 participants");
    expect(formatCount(1, 1, "group")).toBe("1 of 1 group");
  });
});

describe("sessionOfSpeaker", () => {
  it("reads the session from a speaker label", async () => {
    const { sessionOfSpeaker } = await import("../qualAnalysis");
    expect(sessionOfSpeaker("P3 (Focus group 2)")).toBe("Focus group 2");
    expect(sessionOfSpeaker("Focus group 2")).toBeNull();
    expect(sessionOfSpeaker("Mary")).toBeNull();
    expect(sessionOfSpeaker(null)).toBeNull();
  });
});

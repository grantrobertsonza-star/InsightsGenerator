import { describe, expect, it } from "vitest";
import { computeTranscriptImportQuality } from "../qualImportQuality";
import type { QualitySegment } from "../qualQuality";

function seg(i: number, speaker: string | null, role: string, text: string): QualitySegment {
  return { id: String(i), index: i, speaker, role, text };
}
const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("computeTranscriptImportQuality", () => {
  const segments = [
    seg(0, "Moderator", "moderator", "What do you use mobile money for? Do you trust it?"),
    seg(1, "P1", "participant", long(60)),
    seg(2, "Moderator", "moderator", "Tell me more about that."),
    seg(3, "P2", "participant", "Not much."),
    seg(4, "Moderator", "moderator", "Isn't it easier than cash, right?"),
    seg(5, "P1", "participant", long(80)),
    seg(6, "P3", "participant", `${long(70)} [inaudible]`),
  ];

  it("counts respondents, turns and moderator share", () => {
    const q = computeTranscriptImportQuality({ segments, sessionType: "focus_group" });
    expect(q.respondents).toBe(3);
    expect(q.participantTurns).toBe(4);
    expect(q.moderatorTurns).toBe(3);
    expect(q.moderatorWordShare).toBeGreaterThan(0);
    expect(q.respondentLines[0].label).toBe("P1");
    expect(q.markers.inaudible).toBe(1);
  });

  it("classifies questions and flags leading ones", () => {
    const q = computeTranscriptImportQuality({ segments, sessionType: "focus_group" });
    expect(q.questions.asked).toBe(3);
    expect(q.questions.open).toBe(1);
    expect(q.questions.closed).toBe(2);
    expect(q.questions.leading).toBe(1);
  });

  it("flags thin and quiet respondents in a focus group", () => {
    const q = computeTranscriptImportQuality({ segments, sessionType: "focus_group" });
    expect(q.thinRespondents.map((t) => t.label)).toEqual(["P2"]);
    expect(q.quietRespondents.length).toBe(3);
    expect(q.checks.find((c) => c.id === "thin")?.status).toBe("warn");
  });

  it("fails when no speakers are found and warns about missing moderator", () => {
    const q = computeTranscriptImportQuality({ segments: [seg(0, null, "participant", long(30))], sessionType: "individual" });
    expect(q.checks.find((c) => c.id === "respondents")?.status).toBe("fail");
    expect(q.checks.find((c) => c.id === "moderator")?.status).toBe("warn");
    expect(q.status).toBe("fail");
  });

  it("spots label look-alikes and moderator-style respondents", () => {
    const q = computeTranscriptImportQuality({
      segments: [seg(0, "P1", "participant", long(60)), seg(1, "P 1", "participant", long(60)), seg(2, "Interviewer", "participant", long(60))],
      sessionType: "focus_group",
    });
    expect(q.confusableLabels).toEqual([{ a: "P1", b: "P 1" }]);
    expect(q.moderatorLookingParticipants).toEqual(["Interviewer"]);
    expect(q.checks.find((c) => c.id === "labels")?.status).toBe("warn");
  });

  it("counts duplicates and timestamps", () => {
    const q = computeTranscriptImportQuality({
      segments: [seg(0, "P1", "participant", "same thing said"), seg(1, "P1", "participant", "same thing said")],
      sessionType: "individual",
      rawText: "00:01 P1: same thing said\n00:09 P1: same thing said\nplain line",
    });
    expect(q.duplicateTurns).toBe(1);
    expect(q.timestamps.lines).toBe(2);
  });
});

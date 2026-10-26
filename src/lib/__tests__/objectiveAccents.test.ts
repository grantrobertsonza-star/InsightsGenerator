// Each objective keeps one colour across the left list, the scores table and the detail
// (objectiveAccents.objectiveListPositions): stated lines by their own order, then the rest as the
// left list orders them; a rejected suggestion has none.
import { describe, expect, it } from "vitest";
import { objectiveAccent, objectiveListPositions, splitObjectiveLabel } from "../../app/runs/[id]/objectiveAccents";
import type { ObjectiveRow } from "../../app/runs/[id]/ObjectiveReviewTable";

const row = (id: string, source: ObjectiveRow["source"], status: ObjectiveRow["status"]): ObjectiveRow => ({
  id, text: id, rationale: "", source, status, edited: false, scores: null,
});

describe("objective list positions", () => {
  it("follows the left list: stated lines first, accepted then suggested, rejected unlisted", () => {
    const rows = [row("sugg", "ai_suggested", "pending"), row("s2", "researcher_authored", "accepted"), row("inf", "ai_suggested", "accepted"), row("rej", "ai_suggested", "rejected"), row("s1", "researcher_authored", "accepted")];
    // A stated line with no candidate (null) still takes its place in the numbering.
    expect(objectiveListPositions(["s1", null, "s2"], rows)).toEqual({ s1: 0, s2: 2, inf: 3, sugg: 4 });
  });
  it("a stated line keeps its colour when rejected; colours wrap after six", () => {
    expect(objectiveListPositions(["s1"], [row("s1", "researcher_authored", "rejected")])).toEqual({ s1: 0 });
    expect(objectiveAccent(6)).toBe(objectiveAccent(0));
  });
  it("short names: a label before a colon or spaced dash, otherwise none", () => {
    expect(splitObjectiveLabel("Main question: Which segments use it")).toEqual({ label: "Main question", body: "Which segments use it" });
    expect(splitObjectiveLabel("Structural profiling – To analyse how")).toEqual({ label: "Structural profiling", body: "To analyse how" });
    expect(splitObjectiveLabel("To identify the determinants of usage")).toEqual({ label: null, body: "To identify the determinants of usage" });
  });
});

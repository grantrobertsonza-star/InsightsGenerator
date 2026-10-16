// Acceptance: Codex's independent numerical-grounding cases (fixtures/number-check/cases.json,
// golden-thread hardening task C) run against the ACTUAL shared validator, numberTrace.ts. The
// fixture is the reference, not this file: each case's cited finding TEXT is what the application
// has at run time (its structured figures describe the reference judgement and are not given to the
// validator), the AI text is checked against the cited findings only (uncited findings are never
// sources), and both the overall classification and every per-claim disposition must match.
// A claim's disposition is the worst outcome of the validator's figures inside that claim's span.
// Skipped with a visible NOT RUN placeholder when the fixture file is absent.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { explainFigures, figureCheck } from "../numberTrace";

const FIXTURE = resolve(process.cwd(), "fixtures/number-check/cases.json");
type Claim = { text: string; expectedDisposition: "traced" | "needs_review" | "unsupported" };
type Case = { id: string; findings: { text: string }[]; aiText: string; expectedClassification: Claim["expectedDisposition"]; numericalClaims: Claim[] };
const rank = { traced: 0, needs_review: 1, unsupported: 2 } as const;

const present = existsSync(FIXTURE);
const cases: Case[] = present ? JSON.parse(readFileSync(FIXTURE, "utf8")).cases : [];

describe.skipIf(!present)("numerical grounding: Codex task C cases (actual validator)", () => {
  it("has the 24 delivered cases", () => {
    expect(cases).toHaveLength(24);
  });
  for (const c of cases) {
    it(`${c.id}: ${c.expectedClassification}`, () => {
      const sources = c.findings.map((f) => f.text);
      const overall = figureCheck([{ field: "text", text: c.aiText, sources }]).status;
      const { figures, sentences } = explainFigures(c.aiText, sources);
      const perClaim = c.numericalClaims.map((claim) => {
        const at = c.aiText.indexOf(claim.text);
        expect(at, `claim "${claim.text}" located in the AI text`).toBeGreaterThanOrEqual(0);
        const inside = figures.filter((f) => f.start < at + claim.text.length && f.end > at);
        expect(inside.length, `the validator read a figure inside "${claim.text}"`).toBeGreaterThan(0);
        const worst = inside.reduce((w, f) => (rank[f.status] > rank[w] ? f.status : w), "traced" as Claim["expectedDisposition"]);
        return { claim: claim.text, got: worst, expected: claim.expectedDisposition };
      });
      expect({ overall, perClaim }, JSON.stringify({ figures, sentences })).toEqual({
        overall: c.expectedClassification,
        perClaim: perClaim.map((p) => ({ ...p, got: p.expected })),
      });
    });
  }
});

describe.skipIf(present)("numerical grounding: Codex task C cases (actual validator)", () => {
  it.skip("fixtures/number-check/cases.json absent: independent acceptance cases NOT RUN", () => {});
});

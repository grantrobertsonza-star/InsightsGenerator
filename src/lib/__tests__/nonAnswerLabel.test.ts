import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isNonAnswerLabel } from "../nonAnswerLabel";
import { PYTHON } from "./helpers/pythonEngine";

const LABELS = [
  "Don't know", "Don’t know", "Dont know", "Do not know", "DK", "Don't know which brand", "Don't know about it",
  "Refused", "Prefer not to say", "Prefer not to answer", "No response", "No answer", "Not sure", "Unsure",
  "Not applicable", "N/A", "NA", "Not stated", "Unknown", "Missing", "Very satisfied", "Satisfied", "Not at all likely",
  "None of the above", "Nationality", "Know it well", "Unsurpassed", "dk_ref", "Don't knowingly buy",
];

describe("non-answer labels: the engine's rule, once in TypeScript", () => {
  it("the same verdict as the engine's own _DK_RE on every label", () => {
    const script = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location('engine', ${JSON.stringify(path.join(process.cwd(), "api", "parse-stats-file.py"))})`,
      "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "labels = json.loads(sys.stdin.read())",
      "print(json.dumps([bool(m._DK_RE.match(l.strip())) for l in labels]))",
    ].join("\n");
    const r = spawnSync(PYTHON, ["-c", script], { input: JSON.stringify(LABELS), encoding: "utf8", maxBuffer: 1 << 24 });
    expect(r.status, r.stderr).toBe(0);
    const engine = JSON.parse(r.stdout.trim().split("\n").pop()!) as boolean[];
    expect(LABELS.map(isNonAnswerLabel)).toEqual(engine);
  });
  it("Grant's decisions: not sure is a non-answer; a don't-know naming its subject is an answer", () => {
    expect(isNonAnswerLabel("Not sure")).toBe(true);
    expect(isNonAnswerLabel("Don't know which brand")).toBe(false);
  });
});

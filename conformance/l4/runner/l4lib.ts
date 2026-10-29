// Shared helpers for the L4 runners: the case list, the engine's own table read (the exact function
// parseTableDocument asks for, api/parse-stats-file.py read_table, minus storage), and the result log.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const L4 = path.resolve(__dirname, "..");
export const ROOT = path.resolve(L4, "../..");
export const FIXTURES = path.join(L4, "fixtures");
export const OUT = path.join(L4, "out");
const ENGINE = path.join(ROOT, "api", "parse-stats-file.py");
const PYTHON = process.env.PYTHON_EXECUTABLE || "python3";

export type Case = {
  id: string;
  file: string;
  path: string;
  desc: string;
  truth: Record<string, unknown> & { tables?: Record<string, unknown>[]; suggestion?: string };
  claims?: { id: string; text: string; atom: Record<string, unknown>; expected: string; why?: string }[];
};

export function loadCases(): Case[] {
  return JSON.parse(readFileSync(path.join(L4, "cases.json"), "utf8")).cases as Case[];
}

/** basis: "contract" = a documented rule or a guarantee stated in the code's own comments;
 *  "research" = an independent researcher's reading where no contract exists (a gap if it fails). */
export type Check = {
  case: string;
  check: string;
  basis: "contract" | "research";
  expected: unknown;
  actual: unknown;
  pass: boolean;
  severity?: "S1" | "S2" | "S3";
  note?: string;
};

export class ResultLog {
  checks: Check[] = [];
  extra: Record<string, unknown> = {};
  constructor(readonly name: string) {}
  add(c: Check) {
    if (c.pass) delete c.severity;
    this.checks.push(c);
    return c;
  }
  write() {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `${this.name}.results.json`), JSON.stringify({ runner: this.name, checks: this.checks, extra: this.extra }, null, 1));
  }
}

export type EngineAnswer = { ok: true; headers: string[]; rows: Record<string, string | number | boolean | null>[]; sheetName: string } | { ok: false; error: string };

/** The engine's read_table answer for a file, as parseTableDocument receives it (args as for an aggregated
 *  document: no persisted sheet, rows-as-cases). */
export function engineReadTable(file: string, sourceFilename = path.basename(file)): EngineAnswer {
  const script = String.raw`
import sys, json, importlib.util
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
b = open(sys.argv[2], "rb").read()
try:
    out = m.read_table(b, sys.argv[3], {})
    print(json.dumps({"ok": True, **out}, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;
  const r = spawnSync(PYTHON, ["-c", script, ENGINE, file, sourceFilename], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as EngineAnswer;
}

/** The engine's codebook reading (codebook_items), as a codebook upload is read. */
export function engineCodebook(file: string, sourceFilename = path.basename(file)): { ok: true; result: { items: { variable: string; label?: string | null }[] } & Record<string, unknown> } | { ok: false; error: string } {
  const script = String.raw`
import sys, json, importlib.util
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
try:
    print(json.dumps({"ok": True, "result": m.codebook_items(open(sys.argv[2], "rb").read(), sys.argv[3], {})}, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;
  const r = spawnSync(PYTHON, ["-c", script, ENGINE, file, sourceFilename], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

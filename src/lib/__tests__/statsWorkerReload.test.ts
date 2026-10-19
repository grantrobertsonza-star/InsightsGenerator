import { PYTHON } from "./helpers/pythonEngine";
// The long-lived local statistics worker (scripts/parse_stats_worker.py) reloads the engine when the
// engine or api/import-limits.json changes on disk. Grant, 2026-10-19: FinScope SA 2024.sav was still
// refused at "the supported 20 MB limit" on his laptop after the limit was raised to 100 MB, because
// `next dev` had been running since before the change and its worker (kept across hot reloads) had
// read the old limits once at start. Runs the REAL worker from a temporary copy of scripts/ and api/,
// so the checkout's own files are never touched:
//   1. a file over a lowered limit is refused with the new limit's wording, without a restart;
//   2. raising the limit again lets the same file through, still without a restart;
//   3. an engine that fails to load after an edit fails that request with the reason (not the older
//      engine's answer), and the next request after the engine is repaired succeeds.
// Skipped, with the reason printed, without python3 + pandas/openpyxl/pyreadstat.
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

function copyTree() {
  const root = mkdtempSync(path.join(tmpdir(), "stats-worker-reload-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "api"));
  copyFileSync(path.join(process.cwd(), "scripts", "parse_stats_worker.py"), path.join(root, "scripts", "parse_stats_worker.py"));
  copyFileSync(path.join(process.cwd(), "api", "parse-stats-file.py"), path.join(root, "api", "parse-stats-file.py"));
  copyFileSync(path.join(process.cwd(), "api", "import-limits.json"), path.join(root, "api", "import-limits.json"));
  return root;
}

/** Rewrites a file and moves its modification time forward, so a same-second edit is still seen. */
function rewrite(file: string, content: string, step: number) {
  writeFileSync(file, content);
  const t = new Date(Date.now() + step * 2000);
  utimesSync(file, t, t);
}

describe.skipIf(!PYTHON_OK)("local statistics worker picks up engine and limit changes without a restart", () => {
  it("follows a changed size limit, and reports an engine that fails to reload", async () => {
    const root = copyTree();
    const csv = path.join(root, "data.csv");
    writeFileSync(csv, "id,q1\n" + Array.from({ length: 400 }, (_, i) => `${i + 1},${(i % 5) + 1}`).join("\n") + "\n");
    const size = readFileSync(csv).length;
    const limitsFile = path.join(root, "api", "import-limits.json");
    const engineFile = path.join(root, "api", "parse-stats-file.py");
    const limits = JSON.parse(readFileSync(limitsFile, "utf8"));
    const engineSource = readFileSync(engineFile, "utf8");

    const proc = spawn(PYTHON, ["-I", path.join(root, "scripts", "parse_stats_worker.py")], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: proc.stdout! });
    const queue: Record<string, unknown>[] = [];
    const waiters: ((v: Record<string, unknown>) => void)[] = [];
    lines.on("line", (l) => {
      const msg = JSON.parse(l);
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    });
    const next = () => new Promise<Record<string, unknown>>((resolve) => (queue.length ? resolve(queue.shift()!) : waiters.push(resolve)));
    let id = 0;
    const ask = async () => {
      proc.stdin!.write(JSON.stringify({ id: ++id, src: csv, sourceFilename: "data.csv", action: "dictionary", args: {} }) + "\n");
      return next();
    };
    try {
      expect(await next()).toEqual({ ready: true });
      const first = await ask();
      expect(first.error).toBeUndefined();

      // 1. Lower the limit below this file's size: refused, in the new limit's own words.
      const low = Math.floor(size / 2);
      rewrite(limitsFile, JSON.stringify({ ...limits, maxFileBytes: low }), 1);
      const refused = await ask();
      expect(String(refused.error)).toContain(`(${low.toLocaleString("en-US")} bytes)`);

      // 2. Raise it again: the same file is read.
      rewrite(limitsFile, JSON.stringify(limits), 2);
      const again = await ask();
      expect(again.error).toBeUndefined();
      expect((again.result as { nCases: number }).nCases).toBe(400);

      // 3. A broken engine fails the request with the reason; repairing it recovers.
      rewrite(engineFile, engineSource + "\nthis is not python\n", 3);
      const broken = await ask();
      expect(String(broken.error)).toMatch(/changed on disk and could not be reloaded/);
      expect(broken.result).toBeUndefined();
      rewrite(engineFile, engineSource, 4);
      const repaired = await ask();
      expect(repaired.error).toBeUndefined();
      expect((repaired.result as { nCases: number }).nCases).toBe(400);
    } finally {
      proc.stdin!.end();
      proc.kill();
    }
  }, 60_000);
});

// V-B36-02 (Codex): the full library run failed a rendered-slides check with LibreOffice exit 1 while
// another worker converted at the same time. Reproduced here: four conversions at once on the shared
// default profile, two exit 1; on profiles of their own, all four succeed. Every test conversion now
// goes through officeArgs, so this checks the arguments the tests actually use, run concurrently.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOFFICE, officeArgs } from "./helpers/officeRender";

const run = (args: string[]) =>
  new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(SOFFICE!, args, { timeout: 180_000 }, (err, _out, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stderr }));
  });

describe.skipIf(!SOFFICE)("test conversions never share a LibreOffice profile (V-B36-02)", () => {
  it("four conversions at the same time all succeed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lo-parallel-"));
    const inputs = [1, 2, 3, 4].map((i) => {
      const f = path.join(dir, `t${i}.csv`);
      writeFileSync(f, `a,b\n${i},2\n`);
      return f;
    });
    const results = await Promise.all(inputs.map((f) => run(officeArgs(f, "pdf", dir))));
    expect(results.map((r) => r.code), results.map((r) => r.stderr).join("\n")).toEqual([0, 0, 0, 0]);
    for (const f of inputs) expect(existsSync(f.replace(/\.csv$/, ".pdf"))).toBe(true);
  }, 240_000);
});

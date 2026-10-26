// The local statistics worker answers only with the code on disk (26 October 2026). A worker started
// before batch 26 added the "table" action kept running across updates and read a workbook's "table"
// request as an SPSS "convert", refusing ".xlsx" ("Unsupported stats file extension"). Now:
//   - the worker refuses an action it does not know, instead of running another one;
//   - when its own script changes on disk it answers {"restart": true} and exits, and
//     parseStatsFile.ts sends the request to a fresh worker, which answers it;
//   - the one-shot runner refuses an unknown action too.
// The real worker script and engine run (python3 + pandas); storage is an in-memory stand-in.
import { afterAll, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { PYTHON } from "./helpers/pythonEngine";

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }) }) } },
}));
vi.setConfig({ testTimeout: 120_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const ROOT = path.resolve(".");

/** A copy of the worker in its own folder (its engine is the real one, linked), so its file can be touched. */
function workerCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), "worker-copy-"));
  mkdirSync(path.join(dir, "scripts"));
  cpSync(path.join(ROOT, "scripts", "parse_stats_worker.py"), path.join(dir, "scripts", "parse_stats_worker.py"));
  symlinkSync(path.join(ROOT, "api"), path.join(dir, "api"));
  return path.join(dir, "scripts", "parse_stats_worker.py");
}
function talk(script: string) {
  const proc = spawn(PYTHON, ["-u", script], { stdio: ["pipe", "pipe", "ignore"] });
  const lines: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  createInterface({ input: proc.stdout! }).on("line", (l) => { lines.push(JSON.parse(l)); waiters.splice(0).forEach((w) => w()); });
  const next = async (n: number) => { while (lines.length < n) await new Promise<void>((r) => waiters.push(r)); return lines[n - 1]; };
  const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
  return { proc, next, exited, send: (o: unknown) => proc.stdin!.write(JSON.stringify(o) + "\n") };
}
const csv = () => {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "worker-src-")), "t.csv");
  writeFileSync(p, "a,b\n1,2\n3,4\n");
  return p;
};

describe.skipIf(!PYTHON_OK)("the local statistics worker answers only with the code on disk", () => {
  afterAll(() => {
    const live = (globalThis as { __statsWorkerLive?: { proc: { kill: () => void } } }).__statsWorkerLive;
    live?.proc.kill();
  });

  it("refuses an action it does not know, and still answers a known one", async () => {
    const w = talk(path.join(ROOT, "scripts", "parse_stats_worker.py"));
    expect(await w.next(1)).toEqual({ ready: true });
    const src = csv();
    w.send({ id: 1, src, sourceFilename: "t.csv", action: "tabel", args: {} });
    const refused = await w.next(2);
    expect(refused.id).toBe(1);
    expect(String(refused.error)).toMatch(/does not know the action 'tabel'/);
    w.send({ id: 2, src, sourceFilename: "t.csv", action: "table", args: {} });
    const ok = (await w.next(3)) as { result?: { headers: string[] } };
    expect(ok.result?.headers).toEqual(["a", "b"]);
    w.proc.stdin!.end();
    expect(await w.exited).toBe(0);
  });

  it("asks to be restarted and exits when its own script changes on disk", async () => {
    const script = workerCopy();
    const w = talk(script);
    expect(await w.next(1)).toEqual({ ready: true });
    const src = csv();
    w.send({ id: 1, src, sourceFilename: "t.csv", action: "table", args: {} });
    expect(((await w.next(2)) as { result?: unknown }).result).toBeTruthy();
    const t = statSync(script).mtime.getTime() / 1000 + 5;
    utimesSync(script, t, t);
    w.send({ id: 2, src, sourceFilename: "t.csv", action: "table", args: {} });
    expect(await w.next(3)).toEqual({ id: 2, restart: true });
    expect(await w.exited).toBe(0);
  });

  it("through the app: a request after the worker's script changed is answered by a fresh worker", async () => {
    const { runEngineConversion } = await import("../parseStatsFile");
    storage.objects.set("t/r/fresh.csv", Buffer.from("x,y\n5,6\n"));
    const first = await runEngineConversion<{ headers: string[] }>("table", "t/r/fresh.csv", "fresh.csv", {});
    expect(first.headers).toEqual(["x", "y"]);
    const holder = globalThis as { __statsWorkerLive?: { proc: { pid?: number } } };
    const before = holder.__statsWorkerLive?.proc.pid;
    expect(before).toBeTruthy();
    const script = path.join(ROOT, "scripts", "parse_stats_worker.py");
    const st = statSync(script);
    const t = st.mtime.getTime() / 1000 + 5;
    try {
      utimesSync(script, t, t);
      const second = await runEngineConversion<{ headers: string[] }>("table", "t/r/fresh.csv", "fresh.csv", {});
      expect(second.headers).toEqual(["x", "y"]);
      expect(holder.__statsWorkerLive?.proc.pid).not.toBe(before);
    } finally {
      utimesSync(script, st.atime, st.mtime);
    }
  });

  it("the one-shot runner refuses an unknown action", () => {
    const src = csv();
    const dir = mkdtempSync(path.join(tmpdir(), "local-out-"));
    writeFileSync(path.join(dir, "args.json"), "{}");
    const r = spawnSync(PYTHON, [path.join(ROOT, "scripts", "parse_stats_local.py"), src, "t.csv", path.join(dir, "o.json"), "tabel", path.join(dir, "args.json")], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does not know the action 'tabel'/);
  });
});

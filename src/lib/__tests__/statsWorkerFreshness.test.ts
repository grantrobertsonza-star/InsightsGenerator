// The local statistics worker answers only with the code on disk (26 October 2026). A worker started
// before batch 26 added the "table" action kept running across updates and read a workbook's "table"
// request as an SPSS "convert", refusing ".xlsx" ("Unsupported stats file extension"). Now:
//   - the worker refuses an action it does not know, instead of running another one;
//   - when its own script changes on disk it answers {"restart": true} and exits, and
//     parseStatsFile.ts sends the request to a fresh worker, which answers it;
//   - several requests waiting on an old worker together start one replacement between them (B35-F02);
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
  // "junction" makes this a directory link Windows creates without admin rights (Codex B31-V01); other
  // systems ignore the type.
  symlinkSync(path.join(ROOT, "api"), path.join(dir, "api"), "junction");
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

  it.each([undefined, 6])("through the app: an older worker holder (%s) is replaced before it answers (B31-F01)", async (oldProtocol) => {
    const { runEngineConversion } = await import("../parseStatsFile");
    // Neither an untagged holder nor version 6 may retain its old JavaScript listener after reload.
    // This stand-in must never answer a request, making reuse of either holder observable.
    const legacy = path.join(mkdtempSync(path.join(tmpdir(), "legacy-worker-")), "old_worker.py");
    writeFileSync(
      legacy,
      [
        "import json, sys",
        "print(json.dumps({'ready': True}), flush=True)",
        "for line in sys.stdin:",
        "    req = json.loads(line)",
        "    print(json.dumps({'id': req['id'], 'error': 'Unsupported stats file extension: .csv'}), flush=True)",
      ].join("\n"),
    );
    const proc = spawn(PYTHON, ["-u", legacy], { stdio: ["pipe", "pipe", "ignore"] });
    const exited = new Promise<void>((r) => proc.on("exit", () => r()));
    await new Promise<void>((r) => proc.stdout!.once("data", () => r()));
    const holder = globalThis as { __statsWorker?: unknown; __statsWorkerLive?: { proc: { pid?: number; kill: () => void } } };
    holder.__statsWorkerLive?.proc.kill();
    const old = { proc, pending: new Map(), nextId: 1, protocol: oldProtocol };
    holder.__statsWorker = Promise.resolve(old);
    holder.__statsWorkerLive = old as unknown as typeof holder.__statsWorkerLive;
    storage.objects.set("t/r/legacy.csv", Buffer.from("q,r\n5,6\n7,8\n"));
    const result = await runEngineConversion<{ headers: string[]; rows: unknown[][] }>("table", "t/r/legacy.csv", "legacy.csv", {});
    expect(result.headers).toEqual(["q", "r"]);
    expect(result.rows).toHaveLength(2);
    // The old process was stopped (not left running beside the new one).
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("the old worker is still running")), 15_000))]);
    expect(holder.__statsWorkerLive?.proc.pid).not.toBe(proc.pid);
    // The fresh worker keeps answering.
    const again = await runEngineConversion<{ headers: string[] }>("table", "t/r/legacy.csv", "legacy.csv", {});
    expect(again.headers).toEqual(["q", "r"]);
  });

  it("through the app: callers waiting together on an old worker share one replacement (B35-F02)", async () => {
    const { runEngineConversion } = await import("../parseStatsFile");
    const legacy = path.join(mkdtempSync(path.join(tmpdir(), "legacy-worker-")), "old_worker.py");
    writeFileSync(legacy, ["import json, sys", "print(json.dumps({'ready': True}), flush=True)", "for line in sys.stdin:", "    pass"].join("\n"));
    const proc = spawn(PYTHON, ["-u", legacy], { stdio: ["pipe", "pipe", "ignore"] });
    const exited = new Promise<void>((r) => proc.on("exit", () => r()));
    await new Promise<void>((r) => proc.stdout!.once("data", () => r()));
    const holder = globalThis as { __statsWorker?: unknown; __statsWorkerStarts?: number; __statsWorkerLive?: { proc: { pid?: number; kill: () => void; exitCode: number | null } } };
    holder.__statsWorkerLive?.proc.kill();
    // The old worker's startup is held open until every caller is waiting on it.
    let release!: () => void;
    const old = { proc, pending: new Map(), nextId: 1 };
    holder.__statsWorker = new Promise((r) => (release = () => r(old)));
    holder.__statsWorkerLive = undefined;
    const startsBefore = holder.__statsWorkerStarts ?? 0;
    storage.objects.set("t/r/race.csv", Buffer.from("m,n\n1,2\n"));
    const calls = Array.from({ length: 4 }, () => runEngineConversion<{ headers: string[] }>("table", "t/r/race.csv", "race.csv", {}));
    await new Promise((r) => setTimeout(r, 200));
    release();
    const results = await Promise.all(calls);
    expect(results.map((x) => x.headers)).toEqual(Array(4).fill(["m", "n"]));
    // One replacement started, and it is the one the holder owns; the old one was stopped.
    expect((holder.__statsWorkerStarts ?? 0) - startsBefore).toBe(1);
    const live = (holder as { __statsWorkerLive?: { proc: { exitCode: number | null } } }).__statsWorkerLive;
    expect(live?.proc.exitCode).toBeNull();
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("the old worker is still running")), 15_000))]);
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

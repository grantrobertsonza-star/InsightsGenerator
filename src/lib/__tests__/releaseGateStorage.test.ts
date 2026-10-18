// Release gate script scripts/release-gate/check-storage-privacy.mjs, run as a real process against
// a stand-in for the Supabase Storage HTTP API (the external boundary; the script's own logic is
// what is tested). Cases: a private bucket with expiring links passes; a public bucket, a readable
// public URL, an anon-readable object or a link that never expires each fail with exit 2; an
// unreachable storage service or a missing sample object is "could not check" (exit 1), never a pass.
// Added after Codex's formal verdict (2026-10-18): a server error, rate limit, redirect or dropped
// connection is never read as a refusal (exit 1), served partial content (206) is a failure
// (exit 2), --no-sign cannot yield ENFORCED, and an outage followed by a working service checks
// conclusively on the next run.
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

type Mode = {
  publicBucket?: boolean;
  publicRead?: boolean;
  anonRead?: boolean;
  neverExpires?: boolean;
  missingObject?: boolean;
  // Codex formal verdict 2026-10-18 counterexamples: answers that are not refusals.
  publicStatus?: number; // the public URL answers this status (500, 206, 429, 302 ...)
  anonStatus?: number; // the publishable-key read answers this status
  staleStatus?: number | "reset"; // the signed link after expiry answers this, or drops the connection
  outageReads?: number; // the first N public/anon reads answer 503, later ones behave normally
};
const SECRET = "test-secret-key";
const ANON = "test-anon-key";
let server: http.Server | null = null;

async function storage(mode: Mode): Promise<string> {
  const issued = new Map<string, number>();
  let outages = 0;
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const key = req.headers.apikey;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (url.pathname === "/storage/v1/bucket/documents") return key === SECRET ? send(200, { id: "documents", public: !!mode.publicBucket }) : send(401, {});
    const obj = /^\/storage\/v1\/object\/(public|authenticated|sign)\/documents\/(.+)$/.exec(url.pathname);
    if (obj) {
      const [, kind, p] = obj;
      if (mode.missingObject || p !== "tenant/run/file.xlsx") return send(404, { error: "not found" });
      if (kind !== "sign" && key !== SECRET && mode.outageReads && outages < mode.outageReads) {
        outages++;
        return send(503, { error: "unavailable" });
      }
      if (kind === "public" && mode.publicStatus) return send(mode.publicStatus, mode.publicStatus === 206 ? "da" : { error: "x" });
      if (kind === "authenticated" && key === ANON && mode.anonStatus) return send(mode.anonStatus, mode.anonStatus === 206 ? "da" : { error: "x" });
      if (kind === "public") return mode.publicRead ? send(200, "data") : send(400, { error: "bucket not public" });
      if (kind === "authenticated") return key === SECRET || (key === ANON && mode.anonRead) ? send(200, "data") : send(400, { error: "not authorised" });
      if (kind === "sign" && req.method === "POST") {
        const token = Math.random().toString(36).slice(2);
        issued.set(token, Date.now());
        return send(200, { signedURL: `/object/sign/documents/${p}?token=${token}` });
      }
      if (kind === "sign") {
        const t = issued.get(url.searchParams.get("token") ?? "");
        if (t === undefined) return send(400, {});
        if (mode.neverExpires || Date.now() - t < 2000) return send(200, "data");
        if (mode.staleStatus === "reset") return void req.socket.destroy();
        return mode.staleStatus ? send(mode.staleStatus, { error: "x" }) : send(400, { error: "expired" });
      }
    }
    send(404, {});
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  const a = server.address() as { port: number };
  return `http://127.0.0.1:${a.port}`;
}

function run(base: string, extra: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts/release-gate/check-storage-privacy.mjs"), "--path", "tenant/run/file.xlsx", ...extra], {
      env: { PATH: process.env.PATH ?? "", NEXT_PUBLIC_SUPABASE_URL: base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON, SUPABASE_SECRET_KEY: SECRET } as unknown as NodeJS.ProcessEnv,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

afterEach(async () => {
  await new Promise((r) => (server ? server.close(() => r(null)) : r(null)));
  server = null;
});

describe("release gate: storage privacy check", () => {
  it("passes a private bucket whose objects need the server key and whose signed links expire", async () => {
    const r = await run(await storage({}));
    expect(r.out).toMatch(/STORAGE PRIVACY: ENFORCED/);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(SECRET);
    expect(r.out).not.toContain(ANON);
  }, 20000);
  for (const [label, mode] of [["a public bucket", { publicBucket: true }], ["a readable public URL", { publicRead: true }], ["an object readable with the publishable key", { anonRead: true }], ["a signed link that never expires", { neverExpires: true }]] as const) {
    it(`fails ${label}`, async () => {
      const r = await run(await storage(mode));
      expect(r.out).toMatch(/STORAGE PRIVACY: NOT ENFORCED/);
      expect(r.code).toBe(2);
    }, 20000);
  }
  it("a missing sample object is not a pass: the refusals would prove nothing", async () => {
    const r = await run(await storage({ missingObject: true }), ["--no-sign"]);
    expect(r.out).toMatch(/COULD NOT CHECK\s+object reads/);
    expect(r.code).toBe(1);
  }, 20000);
  for (const [label, mode] of [
    ["the public URL answering 500", { publicStatus: 500 }],
    ["the publishable-key read answering 500", { anonStatus: 500 }],
    ["a rate-limited (429) public read", { publicStatus: 429 }],
    ["a redirected (302) public read", { publicStatus: 302 }],
    ["the expired signed link answering 503", { staleStatus: 503 }],
    ["the expired signed link dropping the connection", { staleStatus: "reset" }],
    ["the expired signed link answering 404 (object gone, expiry unknown)", { staleStatus: 404 }],
  ] as const) {
    it(`${label} is could-not-check, never a pass`, async () => {
      const r = await run(await storage(mode as Mode));
      expect(r.out).toMatch(/STORAGE PRIVACY: NOT FULLY CHECKED/);
      expect(r.out).not.toMatch(/STORAGE PRIVACY: ENFORCED/);
      expect(r.code).toBe(1);
    }, 20000);
  }
  for (const [label, mode] of [["partial content (206) through the public URL", { publicStatus: 206 }], ["partial content (206) with the publishable key", { anonStatus: 206 }]] as const) {
    it(`fails ${label}: bytes were served`, async () => {
      const r = await run(await storage(mode as Mode));
      expect(r.out).toMatch(/STORAGE PRIVACY: NOT ENFORCED/);
      expect(r.code).toBe(2);
    }, 20000);
  }
  it("--no-sign records expiry as skipped, so the summary cannot read ENFORCED", async () => {
    const r = await run(await storage({}), ["--no-sign"]);
    expect(r.out).toMatch(/SKIPPED\s+signed link expires/);
    expect(r.out).toMatch(/STORAGE PRIVACY: NOT FULLY CHECKED/);
    expect(r.code).toBe(1);
  }, 20000);
  it("an outage is could-not-check; once the service answers, the next run checks conclusively", async () => {
    const base = await storage({ outageReads: 2 });
    const first = await run(base);
    expect(first.code).toBe(1);
    expect(first.out).toMatch(/COULD NOT CHECK\s+no read through the public URL: answered 503/);
    const second = await run(base);
    expect(second.out).toMatch(/STORAGE PRIVACY: ENFORCED/);
    expect(second.code).toBe(0);
  }, 30000);
  it("an unreachable storage service is could-not-check, never a pass", async () => {
    const r = await run("http://127.0.0.1:9");
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/ENFORCED$/m);
  }, 20000);
});

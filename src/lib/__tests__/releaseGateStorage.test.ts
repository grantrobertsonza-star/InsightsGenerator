// Release gate script scripts/release-gate/check-storage-privacy.mjs, run as a real process against
// a stand-in for the Supabase Storage HTTP API (the external boundary; the script's own logic is
// what is tested). Cases: a private bucket with expiring links passes; a public bucket, a readable
// public URL, an anon-readable object or a link that never expires each fail with exit 2; an
// unreachable storage service or a missing sample object is "could not check" (exit 1), never a pass.
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

type Mode = { publicBucket?: boolean; publicRead?: boolean; anonRead?: boolean; neverExpires?: boolean; missingObject?: boolean };
const SECRET = "test-secret-key";
const ANON = "test-anon-key";
let server: http.Server | null = null;

async function storage(mode: Mode): Promise<string> {
  const issued = new Map<string, number>();
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
        return mode.neverExpires || Date.now() - t < 2000 ? send(200, "data") : send(400, { error: "expired" });
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
  it("an unreachable storage service is could-not-check, never a pass", async () => {
    const r = await run("http://127.0.0.1:9");
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/ENFORCED$/m);
  }, 20000);
});

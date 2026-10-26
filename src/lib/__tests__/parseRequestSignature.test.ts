// IMP-001 (worker scope): the TypeScript signer and the Python verifier agree, and the verifier
// refuses every retargeted, expired, unsigned or wrongly keyed request. Runs the actual
// verify_parse_request from api/parse-stats-file.py (no Python reimplementation here).
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { signParseRequest } from "../parseRequestSignature";

const ROOT = path.resolve(__dirname, "../../..");
const T = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const PATH = `${T}/${R}/1700000000000-abc-survey.sav`;

function verify(secret: string | null, header: string | null, action: string, bucket: string, storagePath: string | null, now?: number) {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("psf", ${JSON.stringify(path.join(ROOT, "api/parse-stats-file.py"))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
a = json.loads(sys.stdin.read())
print(json.dumps(m.verify_parse_request(a["secret"], a["header"], a["action"], a["bucket"], a["path"], a["now"])))
`;
  const r = spawnSync("python3", ["-c", script], { input: JSON.stringify({ secret, header, action, bucket, path: storagePath, now: now ?? null }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim()) as string | null;
}

const saved = process.env.PARSE_STATS_SHARED_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.PARSE_STATS_SHARED_SECRET;
  else process.env.PARSE_STATS_SHARED_SECRET = saved;
});

describe("signed conversion requests (TypeScript signer, Python verifier)", () => {
  it("accepts the exact request it was signed for", () => {
    process.env.PARSE_STATS_SHARED_SECRET = "s3cret-value-for-tests";
    const h = signParseRequest("dictionary", "documents", PATH);
    expect(verify("s3cret-value-for-tests", h, "dictionary", "documents", PATH)).toBeNull();
  });

  it("refuses the same signature retargeted at another path, action or bucket", () => {
    process.env.PARSE_STATS_SHARED_SECRET = "s3cret-value-for-tests";
    const h = signParseRequest("dictionary", "documents", PATH);
    const other = `33333333-3333-4333-8333-333333333333/${R}/1700000000000-abc-survey.sav`;
    expect(verify("s3cret-value-for-tests", h, "dictionary", "documents", other)).toBe("signature mismatch");
    expect(verify("s3cret-value-for-tests", h, "crosstab", "documents", PATH)).toBe("signature mismatch");
    expect(verify("s3cret-value-for-tests", h, "dictionary", "other-bucket", PATH)).toBe("action or bucket not allowed");
  });

  it("refuses an expired signature and one from a different secret", () => {
    process.env.PARSE_STATS_SHARED_SECRET = "s3cret-value-for-tests";
    const issued = Date.now() - 10 * 60 * 1000;
    const old = signParseRequest("convert", "documents", PATH, issued);
    expect(verify("s3cret-value-for-tests", old, "convert", "documents", PATH)).toBe("signature expired");
    const h = signParseRequest("convert", "documents", PATH);
    expect(verify("a-different-secret", h, "convert", "documents", PATH)).toBe("signature mismatch");
  });

  it("refuses a missing secret, a missing or legacy header, and a path outside tenant/run/file", () => {
    process.env.PARSE_STATS_SHARED_SECRET = "s3cret-value-for-tests";
    const h = signParseRequest("convert", "documents", PATH);
    expect(verify(null, h, "convert", "documents", PATH)).toBe("secret not configured");
    expect(verify("s3cret-value-for-tests", null, "convert", "documents", PATH)).toBe("missing signature");
    // The old scheme sent the raw secret as the header value; that is no longer accepted.
    expect(verify("s3cret-value-for-tests", "s3cret-value-for-tests", "convert", "documents", PATH)).toBe("missing signature");
    expect(verify("s3cret-value-for-tests", h, "convert", "documents", `${T}/../x.sav`)).toBe("storage path not allowed");
  });

  it("will not sign without a secret or for a path that is not tenant/run/file", () => {
    delete process.env.PARSE_STATS_SHARED_SECRET;
    expect(() => signParseRequest("convert", "documents", PATH)).toThrow(/PARSE_STATS_SHARED_SECRET is not set/);
    process.env.PARSE_STATS_SHARED_SECRET = "s3cret-value-for-tests";
    expect(() => signParseRequest("convert", "documents", "anything/else.sav")).toThrow(/tenant\/run\/file/);
    expect(() => signParseRequest("convert", "documents", `${T}/${R}/../x.sav`)).toThrow(/tenant\/run\/file/);
  });
});

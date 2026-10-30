// Batch 65, the rest of B52-F01 (Codex, 28 October 2026): one statistical-output selection is one output set even
// when the reply to its first request is lost. Real PostgreSQL (disposable, every migration) through the app's own db.ts and the actual uploadDocumentsAction and ingestOutputFiles; storage is the
// mocked boundary. Each request is built as the Add files dialog builds it: the selection id on every request that
// carries the selection's output, the set id once a reply has named it, and the "unconfirmed" flag after a request
// of the selection got no answer before any reply named the set.
//   - stored but reply lost, then retry: one set, every file once
//   - before-write failure, then retry; a later lost reply; normal sequential batches; two requests at once
//   - a binned set or another project's set of the selection is refused; a mismatched set id is refused
//   - two different selections stay separate, even with the same file names
//   - a set made before 0129 is claimed by its selection (before 0129: outputSelectionPre0129.db.test.ts)
// Also: a storage write that fails with a network cause records that cause (the 120 MB check's "fetch failed").
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const TENANT = "00000000-0000-4000-8000-0000000000de";
const storage = vi.hoisted(() => ({ objects: new Set<string>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          // A network failure as supabase-js reports it: StorageUnknownError("fetch failed") whose originalError is
          // fetch's TypeError, whose cause is the socket error (with an address carrying a token, to be hidden).
          if (path.endsWith("wave-a.csv")) {
            const socket = Object.assign(new Error("other side closed https://store.example/object/documents/x?token=secret123"), { code: "UND_ERR_SOCKET" });
            return { error: { message: "fetch failed", originalError: Object.assign(new TypeError("fetch failed"), { cause: socket }) } };
          }
          storage.objects.add(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) storage.objects.delete(p);
          return { error: null };
        },
      }),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn(async () => undefined) }));

const file = (name: string, body = `term,estimate\n${name},1.5\n`) => new File([body], name, { type: "text/csv" });
type Req = { names: string[]; wave: string; selection?: string; setId?: string; unconfirmed?: boolean };
const request = ({ names, wave, selection, setId, unconfirmed }: Req) => {
  const fd = new FormData();
  for (const n of names) fd.append("outputFiles", n.endsWith(".png") ? new File(["not read"], n) : file(n));
  fd.set("outputWave", wave);
  if (setId) fd.set("outputSetId", setId);
  if (selection) fd.set("outputSelectionId", selection);
  if (unconfirmed) fd.set("outputSelectionUnconfirmed", "1");
  return fd;
};

async function setup(stopBefore?: string) {
  const db = await createDisposableDb(stopBefore);
  process.env.DATABASE_URL = db.url;
  process.env.DEFAULT_TENANT_ID = TENANT;
  await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
  return db;
}

function helpers(get: () => DisposableDb) {
  const newRun = async () => (await get().pool.query(`insert into runs (tenant_id) values ($1) returning id`, [TENANT])).rows[0].id as string;
  // Every set of a wave label in a project, with its files (and families) in name order.
  const sets = async (run: string, wave: string) =>
    (
      await get().pool.query(
        `select s.id, array_agg(d.source_filename || ':' || coalesce(d.output_family, '') order by d.source_filename) as files
           from output_sets s join documents d on d.output_set_id = s.id
          where s.run_id = $1 and s.wave_label = $2 group by s.id order by min(s.created_at)`,
        [run, wave],
      )
    ).rows as { id: string; files: string[] }[];
  const setCount = async (wave: string) => (await get().pool.query(`select count(*)::int as n from output_sets where wave_label = $1`, [wave])).rows[0].n as number;
  return { newRun, sets, setCount };
}

describe.skipIf(!TEST_DATABASE_URL)("one output set per selection across lost replies (real database, batch 65)", () => {
  let db: DisposableDb;
  let run = "";
  const { newRun, sets, setCount } = helpers(() => db);
  const upload = async (r: Req, project = run) => (await import("../documentUploadActions")).uploadDocumentsAction(project, request(r));

  beforeAll(async () => {
    db = await setup();
    run = await newRun();
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("A stored but its reply lost: B and C (selection id, unconfirmed) join A's set, each file once", async () => {
    const s = randomUUID();
    await upload({ names: ["model-a.csv"], wave: "lost first", selection: s }); // reply dropped: the dialog never sees it
    const b = await upload({ names: ["model-b.csv"], wave: "lost first", selection: s, unconfirmed: true });
    expect(b.ok).toBe(true);
    const c = await upload({ names: ["model-c.csv"], wave: "lost first", selection: s, setId: b.outputSetId });
    expect(c.ok).toBe(true);
    expect(c.outputSetId).toBe(b.outputSetId);
    expect(await sets(run, "lost first")).toEqual([{ id: b.outputSetId, files: ["model-a.csv:model", "model-b.csv:model", "model-c.csv:model"] }]);
  });

  it("before-write failure: a request that stored nothing leaves no set; the retry creates the selection's one set", async () => {
    const s = randomUUID();
    const refused = await upload({ names: ["picture.png"], wave: "before write", selection: s });
    expect(refused.ok).toBe(false);
    expect(await setCount("before write")).toBe(0);
    // And a request that never reached the server: the dialog marks the rest unconfirmed; the server starts the set.
    const retry = await upload({ names: ["model-b.csv", "model-c.csv"], wave: "before write", selection: s, unconfirmed: true });
    expect(retry.ok).toBe(true);
    expect(await sets(run, "before write")).toEqual([{ id: retry.outputSetId, files: ["model-b.csv:model", "model-c.csv:model"] }]);
  });

  it("a later lost reply, normal sequential batches, and two requests at once each give one set", async () => {
    const s = randomUUID();
    const a = await upload({ names: ["model-a.csv"], wave: "later lost", selection: s });
    await upload({ names: ["model-b.csv"], wave: "later lost", selection: s, setId: a.outputSetId }); // reply dropped
    const c = await upload({ names: ["model-c.csv"], wave: "later lost", selection: s, setId: a.outputSetId });
    expect(c.ok).toBe(true);
    expect(await sets(run, "later lost")).toEqual([{ id: a.outputSetId, files: ["model-a.csv:model", "model-b.csv:model", "model-c.csv:model"] }]);

    const t = randomUUID();
    const one = await upload({ names: ["model-a.csv"], wave: "sequential", selection: t });
    const two = await upload({ names: ["model-b.csv"], wave: "sequential", selection: t, setId: one.outputSetId });
    expect(two.outputSetId).toBe(one.outputSetId);
    expect((await sets(run, "sequential"))[0].files).toEqual(["model-a.csv:model", "model-b.csv:model"]);

    // A retry sent while the lost request is still running: whichever arrives first makes the set, the other joins.
    const u = randomUUID();
    const both = await Promise.all([
      upload({ names: ["model-a.csv"], wave: "at once", selection: u }),
      upload({ names: ["model-b.csv"], wave: "at once", selection: u, unconfirmed: true }),
    ]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(await sets(run, "at once")).toEqual([{ id: both[0].outputSetId, files: ["model-a.csv:model", "model-b.csv:model"] }]);
  });

  it("two different selections stay separate, even with the same file names", async () => {
    await upload({ names: ["model-a.csv"], wave: "two selections", selection: randomUUID() });
    await upload({ names: ["model-a.csv"], wave: "two selections", selection: randomUUID() });
    expect((await sets(run, "two selections")).map((x) => x.files)).toEqual([["model-a.csv:Other files"], ["model-a.csv:Other files"]]);
  });

  it("the selection's set in the bin or in another project is refused; nothing is added or left stored", async () => {
    const s = randomUUID();
    const first = await upload({ names: ["model-a.csv"], wave: "binned", selection: s });
    // Removing to the bin moves the set to the bin project (documentBin); simulated by moving it away.
    const bin = await newRun();
    await db.pool.query(`update output_sets set run_id = $2 where id = $1`, [first.outputSetId, bin]);
    await db.pool.query(`update documents set run_id = $2 where output_set_id = $1`, [first.outputSetId, bin]);
    const before = storage.objects.size;
    const late = await upload({ names: ["model-b.csv"], wave: "binned", selection: s, unconfirmed: true });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toContain("no longer in this project");
    expect(storage.objects.size).toBe(before);
    expect(await setCount("binned")).toBe(1);

    const other = await newRun();
    const t = randomUUID();
    await upload({ names: ["model-a.csv"], wave: "foreign", selection: t }, other);
    const crossed = await upload({ names: ["model-b.csv"], wave: "foreign", selection: t });
    expect(crossed.ok).toBe(false);
    expect(await setCount("foreign")).toBe(1);
    expect((await sets(other, "foreign"))[0].files).toEqual(["model-a.csv:Other files"]);
  });

  it("a set id that belongs to another selection is refused, and nothing is added to either set", async () => {
    const x = await upload({ names: ["model-a.csv"], wave: "mismatch", selection: randomUUID() });
    const s = randomUUID();
    const y = await upload({ names: ["model-a.csv"], wave: "mismatch", selection: s });
    const crossed = await upload({ names: ["model-b.csv"], wave: "mismatch", selection: s, setId: x.outputSetId });
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.error).toContain("belongs to a different upload");
    // A set with no selection id cannot be claimed by a selection that already has its own set.
    const plain = await upload({ names: ["model-a.csv"], wave: "mismatch" });
    const claim = await upload({ names: ["model-b.csv"], wave: "mismatch", selection: s, setId: plain.outputSetId });
    expect(claim.ok).toBe(false);
    expect((await sets(run, "mismatch")).map((r) => [r.id, r.files.length])).toEqual([[x.outputSetId, 1], [y.outputSetId, 1], [plain.outputSetId, 1]]);
    const bad = await (await import("../documentUploadActions")).uploadDocumentsAction(run, (() => {
      const fd = request({ names: ["model-b.csv"], wave: "mismatch" });
      fd.set("outputSelectionId", "not-an-id");
      return fd;
    })());
    expect(bad.ok).toBe(false);
  });

  it("a set made before migration 0129 (no selection id) is claimed by the selection that names it", async () => {
    const plain = await upload({ names: ["model-a.csv"], wave: "claimed" });
    const s = randomUUID();
    const b = await upload({ names: ["model-b.csv"], wave: "claimed", selection: s, setId: plain.outputSetId });
    expect(b.ok).toBe(true);
    const c = await upload({ names: ["model-c.csv"], wave: "claimed", selection: s, unconfirmed: true });
    expect(c.outputSetId).toBe(plain.outputSetId);
    expect((await sets(run, "claimed"))[0].files).toHaveLength(3);
  });

  it("a storage write that fails with a network cause records and shows the cause, without the address or token", async () => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const fd = new FormData();
    fd.append("rawTableFiles", file("wave-a.csv", "id,age\n1,30\n"));
    const r = await uploadDocumentsAction(run, fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Upload of wave-a.csv failed: fetch failed. The connection reported: UND_ERR_SOCKET, other side closed [address].");
    const trace = (await db.pool.query(`select detail from trace where run_id = $1 and event = 'upload_error' order by occurred_at desc limit 1`, [run])).rows[0].detail;
    expect(trace.cause).toEqual({ code: "UND_ERR_SOCKET", message: "other side closed [address]" });
    expect(JSON.stringify(trace)).not.toContain("secret123");
  });
});

if (!TEST_DATABASE_URL) console.warn(DISPOSABLE_DB_SKIP_REASON);

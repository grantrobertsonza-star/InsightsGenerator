// Batch 65: before migration 0129 is applied the Add files dialog's selection id cannot be recorded. Uploads keep
// working as before (a reply's set id continues the set), and a request of a selection whose earlier request got
// no answer is refused with what to do, rather than quietly starting a second set (OUTPUT_SELECTION_UNKNOWN).
// Real PostgreSQL with every migration before 0129, actual uploadDocumentsAction and ingestOutputFiles; storage
// mocked. Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
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

describe.skipIf(!TEST_DATABASE_URL)("before migration 0129 (real database, batch 65)", () => {
  let db: DisposableDb;
  let run = "";
  const { newRun, sets, setCount } = helpers(() => db);
  const upload = async (r: Req) => (await import("../documentUploadActions")).uploadDocumentsAction(run, request(r));

  beforeAll(async () => {
    db = await setup("0129");
    run = await newRun();
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("uploads work as before; a lost first reply is refused with what to do, never a silent second set", async () => {
    const s = randomUUID();
    const a = await upload({ names: ["model-a.csv"], wave: "pre", selection: s });
    expect(a.ok).toBe(true);
    const b = await upload({ names: ["model-b.csv"], wave: "pre", selection: s, setId: a.outputSetId });
    expect(b.ok).toBe(true);
    expect((await sets(run, "pre"))[0].files).toEqual(["model-a.csv:model", "model-b.csv:model"]);

    const t = randomUUID();
    await upload({ names: ["model-a.csv"], wave: "pre lost", selection: t }); // reply dropped
    const before = storage.objects.size;
    const retry = await upload({ names: ["model-b.csv", "model-c.csv"], wave: "pre lost", selection: t, unconfirmed: true });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error).toMatch(/migration 0129 is not applied.*no second set was started/);
    expect(storage.objects.size).toBe(before);
    expect(await setCount("pre lost")).toBe(1);
  });
});

if (!TEST_DATABASE_URL) console.warn(DISPOSABLE_DB_SKIP_REASON);

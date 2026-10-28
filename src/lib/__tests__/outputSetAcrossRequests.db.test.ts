// B52-F01 (Codex, 28 October 2026): one selection of statistical output is one output set, however many
// requests the Add files dialog needs to send it. Real PostgreSQL (disposable, every migration) through the
// app's own db.ts and the actual uploadDocumentsAction and ingestOutputFiles; storage is the mocked boundary.
//   - two requests (the second naming the set the first created) give exactly what one request gives: one set,
//     both files, the same families (assignFamilies over the whole set, not per request)
//   - a set from another project, or one removed to the bin, is refused: nothing is added, no stored copy left
//   - a refused request leaves the set and its earlier files as they were; a malformed set id is refused
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const TENANT = "00000000-0000-4000-8000-0000000000dd";
const storage = vi.hoisted(() => ({ objects: new Set<string>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
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

const file = (name: string, body: string) => new File([body], name, { type: "text/csv" });
const outputs = (wave: string, names: string[], setId?: string) => {
  const fd = new FormData();
  for (const n of names) fd.append("outputFiles", file(n, `term,estimate\n${n},1.5\n`));
  fd.set("outputWave", wave);
  if (setId !== undefined) fd.set("outputSetId", setId);
  return fd;
};

describe.skipIf(!TEST_DATABASE_URL)("one output set across requests (real database, B52-F01)", () => {
  let db: DisposableDb;
  let run = "";
  let other = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const sets = async (r: string, wave: string) =>
    (
      await db.pool.query(
        `select s.id, array_agg(d.source_filename || ':' || coalesce(d.output_family, '') order by d.source_filename) as files
           from output_sets s join documents d on d.output_set_id = s.id
          where s.run_id = $1 and s.wave_label = $2 group by s.id`,
        [r, wave],
      )
    ).rows as { id: string; files: string[] }[];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    other = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("two requests naming the first request's set give exactly what one request gives", async () => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const together = await uploadDocumentsAction(run, outputs("one request", ["model-coefficients.csv", "model-fit.csv"]));
    expect(together.ok).toBe(true);
    const first = await uploadDocumentsAction(run, outputs("two requests", ["model-coefficients.csv"]));
    expect(first.ok).toBe(true);
    expect(first.outputSetId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await uploadDocumentsAction(run, outputs("two requests", ["model-fit.csv"], first.outputSetId));
    expect(second.ok).toBe(true);
    expect(second.outputSetId).toBe(first.outputSetId);
    const a = await sets(run, "one request");
    const b = await sets(run, "two requests");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // The family is "model" for both files only when the set's names are read together.
    expect(b[0].files).toEqual(["model-coefficients.csv:model", "model-fit.csv:model"]);
    expect(b[0].files).toEqual(a[0].files);
  });

  it("a set from another project or in the bin is refused; nothing is added and no stored copy is left", async () => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const elsewhere = await uploadDocumentsAction(other, outputs("elsewhere", ["model-coefficients.csv"]));
    const before = storage.objects.size;
    const crossed = await uploadDocumentsAction(run, outputs("elsewhere", ["model-fit.csv"], elsewhere.outputSetId));
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.error).toContain("no longer in this project");
    expect(storage.objects.size).toBe(before);
    expect((await db.pool.query(`select count(*)::int as n from documents where output_set_id = $1`, [elsewhere.outputSetId])).rows[0].n).toBe(1);

    const binned = await uploadDocumentsAction(run, outputs("binned", ["model-coefficients.csv"]));
    // Removing to the bin moves the set to the bin project (documentBin); simulated here by moving it away.
    const bin = await one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
    await db.pool.query(`update output_sets set run_id = $2 where id = $1`, [binned.outputSetId, bin]);
    await db.pool.query(`update documents set run_id = $2 where output_set_id = $1`, [binned.outputSetId, bin]);
    const late = await uploadDocumentsAction(run, outputs("binned", ["model-fit.csv"], binned.outputSetId));
    expect(late.ok).toBe(false);
    expect((await db.pool.query(`select count(*)::int as n from documents where output_set_id = $1`, [binned.outputSetId])).rows[0].n).toBe(1);
  });

  it("a refused append leaves the set and its earlier files as they were; a malformed set id is refused", async () => {
    const { uploadDocumentsAction } = await import("../documentUploadActions");
    const first = await uploadDocumentsAction(run, outputs("recover", ["model-coefficients.csv"]));
    const unreadable = new FormData();
    unreadable.append("outputFiles", file("picture.png", "not read"));
    unreadable.set("outputSetId", first.outputSetId!);
    const refused = await uploadDocumentsAction(run, unreadable);
    expect(refused.ok).toBe(false);
    expect(await sets(run, "recover")).toEqual([{ id: first.outputSetId, files: ["model-coefficients.csv:Other files"] }]);
    const retry = await uploadDocumentsAction(run, outputs("recover", ["model-fit.csv"], first.outputSetId));
    expect(retry.ok).toBe(true);
    expect((await sets(run, "recover"))[0].files).toEqual(["model-coefficients.csv:model", "model-fit.csv:model"]);

    const bad = await uploadDocumentsAction(run, outputs("bad", ["model-fit.csv"], "not-a-set"));
    expect(bad.ok).toBe(false);
    expect((await db.pool.query(`select count(*)::int as n from output_sets where wave_label = 'bad'`)).rows[0].n).toBe(0);
  });
});

if (!TEST_DATABASE_URL) console.warn(DISPOSABLE_DB_SKIP_REASON);

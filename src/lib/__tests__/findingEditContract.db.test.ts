// Codex TR500-F03 and TR500-M01 (2026-10-23): the Findings edit actions say whether they saved.
// Real database built from every migration; the actual actions in findingActions.ts. A finding
// that is gone (never existed, deleted between opening the page and saving, or in another project)
// is refused and nothing is written; a bulk change naming a gone finding changes none (rolled
// back); inputs outside the contract are refused before any write; a database failure throws (the
// page shows it) and the same call succeeds once the failure clears. The page's handling of these
// replies is checked in e2e/ui/findings-edit-failure.check.mjs.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));

describe.skipIf(!TEST_DATABASE_URL)("TR500-F03 / M01: finding edits are acknowledged only when saved (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Synthetic finding edits')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool?.end?.();
    await db.drop();
  });

  const newRun = async () => (await q("insert into runs(tenant_id,project_name) values($1,'Edits') returning id", [tenant])).rows[0].id as string;
  const newFinding = async (run: string) =>
    (
      await q(
        "insert into findings(tenant_id,run_id,origin,finding_text,status,theme,researcher_note,finding_kind) values($1,$2,'stated','Original','pending','Original theme','Original note','fact') returning id",
        [tenant, run],
      )
    ).rows[0].id as string;
  const row = async (id: string) =>
    (await q("select status, theme, researcher_note, finding_kind, human_edited_fields from findings where id=$1", [id])).rows[0];
  const actions = () => import("../findingActions");
  const GONE = /no longer in this project.*Nothing was saved.*Reload the page/;

  type Setter = [string, (run: string, id: string) => Promise<unknown>, string, unknown];
  const setters = async (): Promise<Setter[]> => {
    const a = await actions();
    return [
      ["status", (r, id) => a.setFindingStatus(r, id, "accepted"), "status", "accepted"],
      ["kind", (r, id) => a.setFindingKind(r, id, "hypothesis"), "finding_kind", "hypothesis"],
      ["theme", (r, id) => a.setFindingTheme(r, id, "New theme"), "theme", "New theme"],
      ["note", (r, id) => a.setFindingNote(r, id, "New note"), "researcher_note", "New note"],
    ];
  };

  it("each setter saves its own finding and says so", async () => {
    for (const [, call, column, value] of await setters()) {
      const run = await newRun();
      const id = await newFinding(run);
      expect(await call(run, id)).toEqual({ ok: true });
      expect((await row(id))[column]).toBe(value);
    }
  });

  it("a never-existing, deleted, or other project's finding is refused with nothing written; a save that follows works", async () => {
    for (const [name, call, column] of await setters()) {
      const run = await newRun();
      const other = await newRun();
      const id = await newFinding(run);
      const before = await row(id);
      // Never existed.
      expect(await call(run, randomUUID())).toMatchObject({ ok: false, error: expect.stringMatching(GONE) });
      // In another project of the same organisation.
      expect(await call(other, id)).toMatchObject({ ok: false, error: expect.stringMatching(GONE) });
      expect(await row(id)).toEqual(before);
      // Deleted between opening the page and saving.
      const doomed = await newFinding(run);
      await q("delete from findings where id=$1", [doomed]);
      expect(await call(run, doomed), name).toMatchObject({ ok: false, error: expect.stringMatching(GONE) });
      expect((await q("select count(*)::int n from findings where id=$1", [doomed])).rows[0].n).toBe(0);
      // Recovery: the live finding still saves.
      expect(await call(run, id)).toEqual({ ok: true });
      expect((await row(id))[column]).not.toEqual(before[column]);
    }
  });

  it("a bulk change is all or nothing: one gone finding changes none, and says how many were missing", async () => {
    const { setManyFindingStatuses } = await actions();
    const run = await newRun();
    const a = await newFinding(run);
    const b = await newFinding(run);
    const gone = await newFinding(run);
    await q("delete from findings where id=$1", [gone]);
    const r = await setManyFindingStatuses(run, [a, b, a, gone], "rejected");
    expect(r).toEqual({ ok: false, error: "1 of the 3 findings is no longer in this project, so none of them was changed. Reload the page to see the current findings." });
    expect((await row(a)).status).toBe("pending");
    expect((await row(b)).status).toBe("pending");
    // Another project's finding counts as gone too.
    const otherRun = await newRun();
    const foreign = await newFinding(otherRun);
    expect(await setManyFindingStatuses(run, [a, foreign], "accepted")).toMatchObject({ ok: false, error: expect.stringMatching(/^1 of the 2 findings/) });
    expect((await row(foreign)).status).toBe("pending");
    // The same batch without the gone finding saves; duplicates count once; an empty batch is a no-op.
    expect(await setManyFindingStatuses(run, [a, b, b], "rejected")).toEqual({ ok: true });
    expect([(await row(a)).status, (await row(b)).status]).toEqual(["rejected", "rejected"]);
    expect(await setManyFindingStatuses(run, [], "accepted")).toEqual({ ok: true });
  });

  it("inputs outside the contract are refused before any write (M01); a blank theme or note clears it", async () => {
    const a = await actions();
    const run = await newRun();
    const id = await newFinding(run);
    const before = await row(id);
    const bad = <T,>(v: unknown) => v as T;
    for (const r of [
      await a.setFindingStatus(run, id, bad("archived")),
      await a.setFindingStatus(run, id, bad(null)),
      await a.setManyFindingStatuses(run, [id], bad("")),
      await a.setManyFindingStatuses(run, bad("not a list"), "accepted"),
      await a.setFindingKind(run, id, bad(null)),
      await a.setFindingKind(run, id, bad("opinion")),
      await a.setFindingKind(run, id, bad(["fact"])),
      await a.setFindingTheme(run, id, bad(["not", "a", "theme"])),
      await a.setFindingTheme(run, id, bad({ theme: "x" })),
      await a.setFindingTheme(run, id, bad(null)),
      await a.setFindingNote(run, id, bad(42)),
      await a.setFindingNote(run, id, bad(null)),
    ]) {
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing was saved|none of them was changed/) });
    }
    expect(await a.setFindingKind(run, id, bad(null))).toMatchObject({ error: expect.stringMatching(/a kind cannot be cleared/) });
    expect(await row(id)).toEqual(before);

    // Valid clears, then recovery to a value.
    expect(await a.setFindingTheme(run, id, "   ")).toEqual({ ok: true });
    expect(await a.setFindingNote(run, id, "")).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ theme: null, researcher_note: null });
    expect(await a.setFindingTheme(run, id, "  Padded theme ")).toEqual({ ok: true });
    expect((await row(id)).theme).toBe("Padded theme");
  });

  it("a database failure throws with nothing saved, and the same call saves once it clears", async () => {
    const a = await actions();
    const run = await newRun();
    const id = await newFinding(run);
    await q(`create function tr500_refuse() returns trigger language plpgsql as $$ begin raise exception 'Synthetic update failure'; end $$`);
    await q(`create trigger tr500_refuse before update on findings for each row when (old.id = '${id}') execute function tr500_refuse()`);
    try {
      await expect(a.setFindingNote(run, id, "Researcher draft")).rejects.toThrow(/Synthetic update failure/);
      await expect(a.setManyFindingStatuses(run, [id], "accepted")).rejects.toThrow(/Synthetic update failure/);
      expect(await row(id)).toMatchObject({ researcher_note: "Original note", status: "pending" });
    } finally {
      await q("drop trigger tr500_refuse on findings");
      await q("drop function tr500_refuse()");
    }
    expect(await a.setFindingNote(run, id, "Researcher draft")).toEqual({ ok: true });
    expect((await row(id)).researcher_note).toBe("Researcher draft");
  });
});

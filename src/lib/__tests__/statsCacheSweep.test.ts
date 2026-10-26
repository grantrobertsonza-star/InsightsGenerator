// Cached data file downloads are removed once they are old (the stats-src-* temporary-file leak):
// each read of a data file kept its download in the temporary folder for good, respondent-level
// data with no end. sweepStatsCache removes downloads and half-written .part files older than the
// keep window, and only those, from a real temporary folder; nothing else in the folder is touched,
// and a folder it cannot read is not an error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe("sweepStatsCache", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sweep-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("removes old downloads and .part files, keeps recent ones and anything that is not a download", async () => {
    const { sweepStatsCache, STATS_CACHE_KEEP_MS } = await import("../parseStatsFile");
    const now = Date.now();
    const age = async (name: string, ms: number) => {
      const f = path.join(dir, name);
      await writeFile(f, "respondent data");
      const t = (now - ms) / 1000;
      await utimes(f, t, t);
    };
    await age("stats-src-old", STATS_CACHE_KEEP_MS + 60_000);
    await age("stats-src-old.123.456.part", STATS_CACHE_KEEP_MS + 60_000);
    await age("stats-src-recent", 5 * 60_000);
    // Just inside the keep window (a few seconds short of it) it is kept: it may still be in use.
    await age("stats-src-boundary", STATS_CACHE_KEEP_MS - 5_000);
    await age("someone-elses-file", STATS_CACHE_KEEP_MS + 60_000);
    await mkdir(path.join(dir, "stats-src-a-folder"));

    const removed = await sweepStatsCache(dir, now);
    expect(removed.sort()).toEqual(["stats-src-old", "stats-src-old.123.456.part"]);
    expect((await readdir(dir)).sort()).toEqual(["someone-elses-file", "stats-src-a-folder", "stats-src-boundary", "stats-src-recent"]);
    // A second sweep finds nothing more to remove.
    expect(await sweepStatsCache(dir, now)).toEqual([]);
  });

  it("a folder that cannot be read is not an error", async () => {
    const { sweepStatsCache } = await import("../parseStatsFile");
    expect(await sweepStatsCache(path.join(dir, "does-not-exist"))).toEqual([]);
  });
});

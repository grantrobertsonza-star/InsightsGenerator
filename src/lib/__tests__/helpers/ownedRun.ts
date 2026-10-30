// SEC2 test seam: every server action that takes a run id first asks runOwnership.runAccessible
// whether that run is the signed-in tenant's. Unit tests that mock the database have no runs table
// to answer that read, so they mock runOwnership with this: a well-formed run id is the signed-in
// tenant's, a malformed one is not (as in the real check, which never queries for one). The rest of
// the real module (assertRunOwned, runOwned, the messages) is kept.
//
// The check itself is proven on a real database by tenantEntryOwnership.db.test.ts and
// tenantScopingWithoutRls.db.test.ts; tests using this seam are about something else.
import { vi } from "vitest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run id the tests share; any well-formed id works. */
export const TEST_RUN_ID = "00000000-0000-4000-8000-0000000000cc";

export async function ownedRunModule() {
  const real = await vi.importActual<typeof import("../../runOwnership")>("../../runOwnership");
  const owned = (runId: unknown) => typeof runId === "string" && UUID.test(runId);
  return {
    ...real,
    runAccessible: vi.fn(async (_tenantId: string, runId: string) => owned(runId)),
    assertRunAccessible: vi.fn(async (_tenantId: string, runId: string) => {
      if (!owned(runId)) throw new real.RunNotFoundError();
    }),
  };
}

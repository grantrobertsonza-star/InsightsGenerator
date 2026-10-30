// Programs (migration 0026): a name that groups related projects. Renaming and deleting (Grant, 27 October
// 2026: "There is no delete button for a programme"). Deleting a program only ends the grouping: its
// projects are unlinked (program and wave label cleared, as "Remove from program" does) and nothing in
// them is touched. Both run in one transaction, scoped to the tenant on every write.
import { withTenant } from "./db";

export const MAX_PROGRAM_NAME = 200;

export async function renameProgram(tenantId: string, programId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the program a name. Nothing was changed.");
  if (trimmed.length > MAX_PROGRAM_NAME) throw new Error(`A program name can be at most ${MAX_PROGRAM_NAME} characters. Nothing was changed.`);
  await withTenant(tenantId, async (client) => {
    const r = await client.query("update programs set name = $1 where id = $2 and tenant_id = $3", [trimmed, programId, tenantId]);
    if (r.rowCount === 0) throw new Error("That program no longer exists. Nothing was changed.");
  });
}

/** Deletes a program; returns how many projects were unlinked from it (their data is kept). */
export async function deleteProgram(tenantId: string, programId: string): Promise<{ unlinked: number }> {
  return withTenant(tenantId, async (client) => {
    // Locked first, so a project linked to it meanwhile is either unlinked here or refused by the
    // foreign key, never left pointing at a program that is gone.
    const found = await client.query("select id from programs where id = $1 and tenant_id = $2 for update", [programId, tenantId]);
    if (found.rowCount === 0) throw new Error("That program no longer exists. Nothing was changed.");
    const unlinked = await client.query("update runs set program_id = null, wave_label = null where program_id = $1 and tenant_id = $2", [programId, tenantId]);
    await client.query("delete from programs where id = $1 and tenant_id = $2", [programId, tenantId]);
    return { unlinked: unlinked.rowCount ?? 0 };
  });
}

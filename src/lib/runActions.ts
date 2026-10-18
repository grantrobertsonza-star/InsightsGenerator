"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";
import { requireTenantId } from "./requestContext";

const BUCKET = "documents";

export async function deleteRun(runId: string) {
  const TENANT_ID = await requireTenantId();
  // Storage files aren't known to Postgres, so they're cleaned up here
  // before the run itself (and everything that cascades from it) is deleted.
  const storagePaths = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ storage_path: string }>(
      "select storage_path from documents where run_id = $1",
      [runId]
    );
    return result.rows.map((row) => row.storage_path);
  });

  if (storagePaths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(storagePaths);
  }

  await withTenant(TENANT_ID, async (client) => {
    await client.query("delete from runs where id = $1", [runId]);
  });

  revalidatePath("/");
}

export async function renameRun(runId: string, name: string) {
  const TENANT_ID = await requireTenantId();
  const trimmed = name.trim();
  if (!trimmed) return;
  await withTenant(TENANT_ID, async (client) => {
    await client.query("update runs set project_name = $1 where id = $2", [trimmed, runId]);
  });

  revalidatePath("/");
  revalidatePath(`/runs/${runId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { supabaseAdmin } from "./supabaseAdmin";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const BUCKET = "documents";

export async function deleteRun(runId: string) {
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

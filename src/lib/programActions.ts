"use server";

import { revalidatePath } from "next/cache";
import { deleteProgram, renameProgram } from "./programs";
import { requireTenantId } from "./requestContext";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function renameProgramAction(programId: string, name: unknown): Promise<Result> {
  const TENANT_ID = await requireTenantId();
  if (typeof programId !== "string" || typeof name !== "string") return { ok: false, error: "Give the program a name. Nothing was changed." };
  try {
    await renameProgram(TENANT_ID, programId, name);
    revalidatePath("/programs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteProgramAction(programId: string): Promise<Result<{ unlinked: number }>> {
  const TENANT_ID = await requireTenantId();
  if (typeof programId !== "string") return { ok: false, error: "That program no longer exists. Nothing was changed." };
  try {
    const r = await deleteProgram(TENANT_ID, programId);
    revalidatePath("/programs");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

"use server";
// Server entry points for the brand dashboard extension (brandExtension.ts, brandExtensionConfirmations.ts). Each
// re-checks the signed-in tenant's access to the project; the request's options and changes are checked here, at the
// boundary, never trusted from the screen; the file, project and revision are checked again inside the write.
import { revalidatePath } from "next/cache";
import { requireRequestContext } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { loadBrandExtension, loadBrandExtensionTrend, type BrandExtension, type ExtensionOptions, type TrendWave } from "./brandExtension";
import { saveBrandExtensionConfirmation, type ConfirmationChange, type ConfirmationSaveResult } from "./brandExtensionConfirmations";
import { EXTENSION_CONSTRUCTS, type ExtensionConstruct } from "./brandExtensionRoles";

type Fail = { ok: false; error: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const shortText = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max;

/** The page's options: weighted (true, false, or null for the dashboard's own setting) and one audience answer. */
export async function extensionOptionsFrom(raw: unknown): Promise<ExtensionOptions | null> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const { weighted, audience } = raw as { weighted?: unknown; audience?: unknown };
  if (weighted !== undefined && weighted !== null && typeof weighted !== "boolean") return null;
  let a: ExtensionOptions["audience"] = null;
  if (audience !== undefined && audience !== null) {
    const { variable, code } = audience as { variable?: unknown; code?: unknown };
    if (!shortText(variable, 128) || !shortText(code, 32) || !/^-?\d+(\.\d+)?$/.test(code as string)) return null;
    a = { variable: variable as string, code: code as string };
  }
  return { weighted: (weighted as boolean | null | undefined) ?? null, audience: a };
}

/** A confirmation change as sent by the screen, checked for shape (its meaning is checked against the file later). */
export async function confirmationChangeFrom(raw: unknown): Promise<ConfirmationChange | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "construct" && (EXTENSION_CONSTRUCTS as readonly string[]).includes(r.construct as string) && shortText(r.choice, 4000))
    return { kind: "construct", construct: r.construct as ExtensionConstruct, choice: r.choice as string };
  if (r.kind === "alias" && shortText(r.name, 200) && (r.brandCode === null || shortText(r.brandCode, 32)) && (r.otherName === null || shortText(r.otherName, 200)))
    return { kind: "alias", name: r.name as string, brandCode: r.brandCode as string | null, otherName: r.otherName as string | null };
  if (r.kind === "remove_alias" && shortText(r.name, 200)) return { kind: "remove_alias", name: r.name as string };
  return null;
}

function expectedFrom(raw: unknown): { scope: string; revision: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const { scope, revision } = raw as { scope?: unknown; revision?: unknown };
  if (typeof scope !== "string" || !/^(programme|project):[0-9a-f-]{36}$/i.test(scope)) return null;
  if (revision !== null && !(Number.isInteger(revision) && (revision as number) >= 1)) return null;
  return { scope, revision: revision as number | null };
}

export async function loadBrandExtensionAction(runId: string, documentId: string, optionsRaw: unknown): Promise<{ ok: true; extension: BrandExtension } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const options = await extensionOptionsFrom(optionsRaw);
  if (!options) return { ok: false, error: "Those dashboard options are not valid." };
  try {
    return { ok: true, extension: await loadBrandExtension(ctx.tenantId, runId, documentId, options) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function loadBrandExtensionTrendAction(runId: string, documentId: string, optionsRaw: unknown): Promise<{ ok: true; waves: TrendWave[] } | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const options = await extensionOptionsFrom(optionsRaw);
  if (!options) return { ok: false, error: "Those dashboard options are not valid." };
  try {
    return { ok: true, waves: (await loadBrandExtensionTrend(ctx.tenantId, runId, documentId, options)).waves };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function saveBrandExtensionConfirmationAction(runId: string, documentId: string, expectedRaw: unknown, changeRaw: unknown): Promise<({ ok: true } & ConfirmationSaveResult) | Fail> {
  const ctx = await requireRequestContext();
  if (!(await runAccessible(ctx.tenantId, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  const expected = expectedFrom(expectedRaw);
  if (!expected) return { ok: false, error: "The page's saved state is not valid. Reload and try again." };
  const change = await confirmationChangeFrom(changeRaw);
  if (!change) return { ok: false, error: "That confirmation is not valid." };
  try {
    const r = await saveBrandExtensionConfirmation(ctx.tenantId, runId, documentId, expected, change, ctx.email ?? ctx.userId);
    if (r.saved) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// The researcher's confirmations for the brand dashboard extension (migration 0140), once per programme (or per
// project in no programme), like the dashboard's own choices (trackerDashboards.ts, scopeKeyOf). Contract:
// claude/brand-extension.md, "Confirmations". Guarantees:
//   - confirmation is the exception: only a construct in review can be confirmed (which candidate it is, or that the
//     file does not measure it), checked against this wave's own recognition on the server, never trusted from the
//     screen; an alias is an Other name (normalised) to a tracked brand of this file's list, or to another Other name;
//   - every entry records who, when and from which file (provenance); confirming one entry never changes another;
//   - a save is a compare-and-swap on the scope and revision the screen read, under the project's row lock with the
//     file checked in the same transaction: a stale screen is told the current revision and nothing is written; two
//     first saves cannot both win (the scope's unique index); a project moved to another programme since the read is
//     a conflict that writes nowhere; the same change sent twice after it was saved is a conflict (its revision moved),
//     never a duplicate;
//   - before migration 0140 nothing can have been saved, so the extension shows its detection and saving is refused
//     with that reason; a stored record that is not valid is an error, never read as "no confirmations".
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { loadRoleInput } from "./trackerInput";
import { recogniseTracker } from "./trackerRoles";
import { scopeKeyOf } from "./trackerDashboards";
import { EXTENSION_CONSTRUCTS, RATING_CONSTRUCTS, normaliseBrandName, type BrandAlias, type BrandExtensionRecognition, type ConstructConfirmation, type ExtensionConstruct } from "./brandExtensionRoles";

export const BRAND_EXTENSION_CONFIRMATIONS_UNAVAILABLE = "Confirmations cannot be saved yet: the database needs migration 0140.";

export type StoredConfirmations = {
  scopeKey: string;
  revision: number | null;
  storageAvailable: boolean;
  constructs: Partial<Record<ExtensionConstruct, ConstructConfirmation>>;
  aliases: (BrandAlias & { documentId: string | null })[];
};

export type ConfirmationChange =
  | { kind: "construct"; construct: ExtensionConstruct; choice: string }
  | { kind: "alias"; name: string; brandCode: string | null; otherName: string | null }
  | { kind: "remove_alias"; name: string };

export type ConfirmationSaveResult =
  | { saved: true; revision: number }
  | { saved: false; reason: "conflict"; current: { scope: string; revision: number | null } }
  | { saved: false; reason: "invalid"; problem: string }
  | { saved: false; reason: "unavailable"; message: string };

/** The stored JSON read strictly: a malformed record throws (never read as empty). */
export function parseStoredConfirmations(raw: unknown): Pick<StoredConfirmations, "constructs" | "aliases"> {
  if (raw === null || raw === undefined) return { constructs: {}, aliases: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("The saved extension confirmations are not valid.");
  const o = raw as { constructs?: unknown; aliases?: unknown };
  const constructs: StoredConfirmations["constructs"] = {};
  if (o.constructs !== undefined) {
    if (!o.constructs || typeof o.constructs !== "object" || Array.isArray(o.constructs)) throw new Error("The saved extension confirmations are not valid.");
    for (const [k, v] of Object.entries(o.constructs as Record<string, unknown>)) {
      const c = v as Partial<ConstructConfirmation>;
      if (!(EXTENSION_CONSTRUCTS as readonly string[]).includes(k) || typeof c?.choice !== "string" || typeof c.at !== "string") throw new Error(`The saved confirmation for ${k} is not valid.`);
      constructs[k as ExtensionConstruct] = { choice: c.choice, by: typeof c.by === "string" ? c.by : null, at: c.at, documentId: typeof c.documentId === "string" ? c.documentId : null, ...(typeof c.evidence === "string" ? { evidence: c.evidence } : {}) };
    }
  }
  const aliases: StoredConfirmations["aliases"] = [];
  if (o.aliases !== undefined) {
    if (!Array.isArray(o.aliases)) throw new Error("The saved extension confirmations are not valid.");
    for (const a of o.aliases as Partial<BrandAlias & { documentId: string | null }>[]) {
      if (typeof a?.name !== "string" || typeof a.at !== "string" || (a.brandCode === undefined && a.otherName === undefined)) throw new Error("A saved Other brand alias is not valid.");
      aliases.push({ name: a.name, brandCode: a.brandCode ?? null, otherName: a.otherName ?? null, by: a.by ?? null, at: a.at, documentId: a.documentId ?? null });
    }
  }
  return { constructs, aliases };
}

async function storageAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>("select to_regclass('brand_extension_confirmations') is not null as ok");
  return r.rows[0]?.ok === true;
}

async function programOf(client: PoolClient, tenantId: string, runId: string, lock: boolean): Promise<string | null> {
  const r = await client.query<{ program_id: string | null }>(`select program_id from runs where id = $1 and tenant_id = $2 ${lock ? "for update" : ""}`, [runId, tenantId]);
  if (r.rowCount !== 1) throw new Error("That project no longer exists. Nothing was changed.");
  return r.rows[0].program_id;
}

const scopeWhere = (programId: string | null) => (programId ? "tenant_id = $1 and program_id = $2" : "tenant_id = $1 and run_id = $2");

async function storedRow(client: PoolClient, tenantId: string, programId: string | null, runId: string, lock = false) {
  const r = await client.query<{ revision: number; confirmations: unknown }>(`select revision, confirmations from brand_extension_confirmations where ${scopeWhere(programId)} ${lock ? "for update" : ""}`, [tenantId, programId ?? runId]);
  return r.rows[0] ?? null;
}

export async function loadBrandExtensionConfirmations(tenantId: string, runId: string): Promise<StoredConfirmations> {
  return withTenantRead(tenantId, async (client) => {
    const programId = await programOf(client, tenantId, runId, false);
    const scopeKey = scopeKeyOf(programId, runId);
    if (!(await storageAvailable(client))) return { scopeKey, revision: null, storageAvailable: false, constructs: {}, aliases: [] };
    const row = await storedRow(client, tenantId, programId, runId);
    return { scopeKey, revision: row?.revision ?? null, storageAvailable: true, ...parseStoredConfirmations(row?.confirmations) };
  });
}

/** Why a change cannot be saved against this wave's recognition and brand list, or null. Pure. */
export function confirmationProblem(rec: BrandExtensionRecognition, brandCodes: string[], change: ConfirmationChange): string | null {
  if (change.kind === "construct") {
    if (!(EXTENSION_CONSTRUCTS as readonly string[]).includes(change.construct)) return "Unknown construct.";
    const d = (RATING_CONSTRUCTS as readonly string[]).includes(change.construct) ? rec.ratings[change.construct as (typeof RATING_CONSTRUCTS)[number]] : change.construct === "episode" ? rec.episode : rec.reasons;
    if (d.status !== "needs_review") return "Only a construct marked Needs review can be confirmed; this one was detected without doubt or is not in this file.";
    if (change.choice === "not_measured") return null;
    if (!d.candidates.some((c) => c.key === change.choice) || !d.values?.[change.choice]) return "That choice is not one of this file's candidate questions.";
    return null;
  }
  const name = normaliseBrandName(change.name);
  if (!name || name.length > 120) return "An Other brand name is needed (at most 120 characters).";
  if (change.kind === "remove_alias") return null;
  if ((change.brandCode === null) === (change.otherName === null)) return "Map the name to one tracked brand or to one other Other name.";
  if (change.brandCode !== null && !brandCodes.includes(change.brandCode)) return "That brand is not in this file's brand list.";
  if (change.otherName !== null && (!normaliseBrandName(change.otherName) || normaliseBrandName(change.otherName) === name)) return "Map the name to a different Other name.";
  return null;
}

/** Applies one change to the stored set, with its provenance. Pure. */
export function appliedChange(stored: Pick<StoredConfirmations, "constructs" | "aliases">, change: ConfirmationChange, rec: BrandExtensionRecognition, by: string | null, at: string, documentId: string) {
  const constructs = { ...stored.constructs };
  let aliases = [...stored.aliases];
  if (change.kind === "construct") {
    const d = (RATING_CONSTRUCTS as readonly string[]).includes(change.construct) ? rec.ratings[change.construct as (typeof RATING_CONSTRUCTS)[number]] : change.construct === "episode" ? rec.episode : rec.reasons;
    const evidence = d.status === "needs_review" ? (d.candidates.find((c) => c.key === change.choice)?.description ?? "not measured") : undefined;
    constructs[change.construct] = { choice: change.choice, by, at, documentId, ...(evidence ? { evidence } : {}) };
  } else {
    const name = normaliseBrandName(change.name);
    aliases = aliases.filter((a) => a.name !== name);
    if (change.kind === "alias") aliases.push({ name, brandCode: change.brandCode, otherName: change.otherName === null ? null : normaliseBrandName(change.otherName), by, at, documentId });
  }
  return { constructs, aliases };
}

/** Saves one confirmation for the programme, made while viewing this wave's file (expected: what the screen read). */
export async function saveBrandExtensionConfirmation(
  tenantId: string,
  runId: string,
  documentId: string,
  expected: { scope: string; revision: number | null },
  change: ConfirmationChange,
  by: string | null,
): Promise<ConfirmationSaveResult> {
  const input = await loadRoleInput(tenantId, runId, documentId);
  const rec = recogniseTracker(input.variables);
  const problem = rec.brandExtension ? confirmationProblem(rec.brandExtension, (rec.frame?.brands ?? []).map((b) => b.code), change) : "This file has no brand list.";
  if (problem) return { saved: false, reason: "invalid", problem };
  return withTenant(tenantId, async (client) => {
    if (!(await storageAvailable(client))) return { saved: false, reason: "unavailable", message: BRAND_EXTENSION_CONFIRMATIONS_UNAVAILABLE } as const;
    const programId = await programOf(client, tenantId, runId, true);
    const doc = await client.query("select 1 from documents where id = $1 and run_id = $2", [documentId, runId]);
    if (doc.rowCount !== 1) throw new Error("That data file is no longer in this project. Nothing was changed.");
    const scope = scopeKeyOf(programId, runId);
    const current = await storedRow(client, tenantId, programId, runId, true);
    if (scope !== expected.scope || (current?.revision ?? null) !== expected.revision) return { saved: false, reason: "conflict", current: { scope, revision: current?.revision ?? null } } as const;
    const next = appliedChange(parseStoredConfirmations(current?.confirmations), change, rec.brandExtension!, by, new Date().toISOString(), documentId);
    const written =
      current === null
        ? await client.query<{ revision: number }>(
            `insert into brand_extension_confirmations (tenant_id, program_id, run_id, confirmations, updated_by) values ($1, $2, $3, $4, $5)
             on conflict do nothing returning revision`,
            [tenantId, programId, programId ? null : runId, JSON.stringify(next), by],
          )
        : await client.query<{ revision: number }>(
            `update brand_extension_confirmations set previous_confirmations = confirmations, confirmations = $4, updated_by = $5,
                    revision = revision + 1, updated_at = now()
              where ${scopeWhere(programId)} and revision = $3 returning revision`,
            [tenantId, programId ?? runId, expected.revision, JSON.stringify(next), by],
          );
    if (written.rowCount === 1) return { saved: true, revision: written.rows[0].revision } as const;
    const now = await storedRow(client, tenantId, programId, runId);
    return { saved: false, reason: "conflict", current: { scope, revision: now?.revision ?? null } } as const;
  });
}

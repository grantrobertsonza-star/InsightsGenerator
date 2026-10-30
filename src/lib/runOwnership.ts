// SEC1: run and program ownership for the signed-in tenant, checked by the application itself.
//
// Row-level security only applies when the app's database role is subject to it, and today the
// app may connect as a role that bypasses it (docs/database-roles.md). So every entry point that
// takes a run id, program id or row id from the browser scopes its own reads and writes to the
// tenant: either with `tenant_id = $n` in the statement, or by calling one of these first, in the
// same transaction as the write where the caller owns that transaction.
//
// Another tenant's run (or program) is reported exactly like a missing one: the caller learns
// "not available", never its name or any of its content.
//
// A run's or program's tenant is never changed by any code path (nothing updates runs.tenant_id
// or programs.tenant_id), so a check made earlier in a request stays true for its later writes.
// What a check does not guarantee without `lock`: that the run is not deleted before the write.
// A deleted run makes a later child insert fail on its foreign key and a later update match no
// row, so it cannot be turned into a cross-tenant write either way.
//
// SEC2: every exported server action that takes a run id calls runAccessible (or
// assertRunAccessible) at its entry, before any database or library call, so library code it
// delegates to never sees another tenant's run id. That entry check is a plain read; writes keep
// their own in-transaction checks (assertRunOwned with the writing client) where they have them.
//
// src/lib/__tests__/tenantOwnershipCoverage.test.ts fails when an entry point writes without
// this scoping or an action skips the entry check; src/lib/__tests__/tenantScopingWithoutRls.db.test.ts proves it on a real database
// through a role that bypasses row-level security.
import type { PoolClient } from "pg";
import { withTenantRead } from "./db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The wording kept from runSync.lockRunForContextChange, which existing screens and tests show. */
export const RUN_NOT_AVAILABLE = "That project is not available.";
export const PROGRAM_NOT_AVAILABLE = "That program is not available.";

export class RunNotFoundError extends Error {
  constructor() {
    super(RUN_NOT_AVAILABLE);
    this.name = "RunNotFoundError";
  }
}
export class ProgramNotFoundError extends Error {
  constructor() {
    super(PROGRAM_NOT_AVAILABLE);
    this.name = "ProgramNotFoundError";
  }
}

export type RunOwnershipOptions = {
  /** Take the run row FOR UPDATE for the rest of the transaction (serialises changes to one project). */
  lock?: boolean;
  /** Treat a project's bin (migration 0115, documentBin.ts) as not found; it is never a project anyone opens. */
  excludeBin?: boolean;
};

/**
 * True when run `runId` exists and belongs to `tenantId`. A malformed id is simply not found (it
 * cannot name a row), so a tampered request never becomes a database error.
 */
export async function runOwned(client: PoolClient, tenantId: string, runId: string, options: RunOwnershipOptions = {}): Promise<boolean> {
  if (typeof runId !== "string" || !UUID.test(runId)) return false;
  // to_jsonb reads bin_of without naming the column, so this works before migration 0115.
  const bin = options.excludeBin ? " and (to_jsonb(runs)->>'bin_of') is null" : "";
  const r = await client.query(`select id from runs where id = $1 and tenant_id = $2${bin}${options.lock ? " for update" : ""}`, [runId, tenantId]);
  return r.rows.length === 1;
}

/** Throws RunNotFoundError unless run `runId` exists and belongs to `tenantId`. */
export async function assertRunOwned(client: PoolClient, tenantId: string, runId: string, options: RunOwnershipOptions = {}): Promise<void> {
  if (!(await runOwned(client, tenantId, runId, options))) throw new RunNotFoundError();
}

/** Throws ProgramNotFoundError unless program `programId` exists and belongs to `tenantId`. */
export async function assertProgramOwned(client: PoolClient, tenantId: string, programId: string): Promise<void> {
  const found =
    typeof programId === "string" &&
    UUID.test(programId) &&
    (await client.query("select id from programs where id = $1 and tenant_id = $2", [programId, tenantId])).rows.length === 1;
  if (!found) throw new ProgramNotFoundError();
}

/**
 * SEC2: the entry check for a server action handed a run id by the browser. True when the run
 * exists, belongs to `tenantId` and is not a project's bin (a bin is never a project anyone opens).
 * A malformed id is answered without a database call. Non-locking, in its own read: an action that
 * writes keeps its in-transaction check as well (see the note at the top on why an earlier check
 * stays true). The caller answers false with its usual refusal and RUN_NOT_AVAILABLE, so another
 * tenant's run and a missing run look the same.
 */
export async function runAccessible(tenantId: string, runId: string): Promise<boolean> {
  if (typeof runId !== "string" || !UUID.test(runId)) return false;
  return withTenantRead(tenantId, (client) => runOwned(client, tenantId, runId, { excludeBin: true }));
}

/** As runAccessible, for an action that reports failure by throwing: throws RunNotFoundError. */
export async function assertRunAccessible(tenantId: string, runId: string): Promise<void> {
  if (!(await runAccessible(tenantId, runId))) throw new RunNotFoundError();
}

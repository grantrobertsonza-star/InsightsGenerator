import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { assertRunOwned, assertProgramOwned } from "./runOwnership";
import { scopeKeyOf } from "./trackerDashboards";
import { loadUaFields } from "./uaInput";
import { recogniseUa, UA_ROLES, isUaResponse } from "./uaRoles";
import { planUaMetrics } from "./uaMetrics";
import type { UaChoices, UaView } from "./uaTypes";

export type UaExpected = { scope: string; revision: number | null };
export type UaWorkspace = UaView & { scope: string };
export type UaSave = { saved: true; revision: number } | { saved: false; reason: string; conflict?: true };
const initial: UaChoices = { focalBrand: null, weighted: true, roleCorrections: {}, lightUserMaximum: null };
async function available(client: PoolClient) { return (await client.query<{ ok: boolean }>("select to_regclass('ua_dashboards') is not null as ok")).rows[0].ok; }
async function scope(client: PoolClient, tenantId: string, runId: string, documentId: string, lock = false) {
  await assertRunOwned(client, tenantId, runId, { lock, excludeBin: true });
  const r = await client.query<{ program_id: string | null }>("select program_id from runs where id=$1 and tenant_id=$2", [runId, tenantId]);
  const doc = await client.query("select id from documents where id=$1 and run_id=$2 and tenant_id=$3 and removed_at is null" + (lock ? " for update" : ""), [documentId, runId, tenantId]);
  if (doc.rowCount !== 1) throw new Error("That data file is not available in this project. Nothing was changed.");
  const program = r.rows[0].program_id;
  if (program) await assertProgramOwned(client, tenantId, program);
  return { key: scopeKeyOf(program, runId), program, id: program ?? runId };
}
const where = (program: string | null) => `tenant_id=$1 and ${program ? "program_id" : "run_id"}=$2`;
function choicesOf(raw: unknown): UaChoices {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The saved U&A choices could not be read. Reload or ask an administrator to inspect them.");
  const v = raw as Partial<UaChoices>;
  if (typeof v.weighted !== "boolean" || (v.focalBrand !== null && typeof v.focalBrand !== "string") || !v.roleCorrections || typeof v.roleCorrections !== "object" || Array.isArray(v.roleCorrections)) throw new Error("The saved U&A choices are invalid. Reload or ask an administrator to inspect them.");
  if (Object.values(v.roleCorrections).some(x => x !== null && typeof x !== "string") || (v.lightUserMaximum !== undefined && v.lightUserMaximum !== null && (!Number.isInteger(v.lightUserMaximum) || v.lightUserMaximum < 1 || v.lightUserMaximum > 10000))) throw new Error("The saved U&A mappings or light-user cutoff are invalid.");
  return { focalBrand: v.focalBrand ?? null, weighted: v.weighted ?? true, roleCorrections: v.roleCorrections ?? {}, lightUserMaximum: v.lightUserMaximum ?? null };
}
export async function loadUaWorkspace(tenantId: string, runId: string, documentId: string): Promise<UaWorkspace> {
  const stored = await withTenantRead(tenantId, async client => {
    const target = await scope(client, tenantId, runId, documentId);
    const ok = await available(client);
    const row = ok ? (await client.query<{ revision: number; choices: unknown }>(`select revision, choices from ua_dashboards where ${where(target.program)}`, [tenantId, target.id])).rows[0] : undefined;
    return { target, ok, row };
  });
  const input = await loadUaFields(tenantId, runId, documentId);
  const choices = stored.row ? choicesOf(stored.row.choices) : initial;
  const recognition = recogniseUa(input.fields, choices.roleCorrections);
  return { recognition, choices, revision: stored.row?.revision ?? null, scope: stored.target.key, storageAvailable: stored.ok, ...planUaMetrics(recognition, choices.lightUserMaximum) };
}

export async function saveUaChoices(tenantId: string, runId: string, documentId: string, expected: UaExpected, raw: unknown, actor: string): Promise<UaSave> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { saved: false, reason: "Choose valid U&A settings." };
  const prior = await withTenantRead(tenantId, async client => {
    const target = await scope(client, tenantId, runId, documentId);
    if (!(await available(client))) return null;
    const row = (await client.query<{ choices: unknown }>(`select choices from ua_dashboards where ${where(target.program)}`, [tenantId, target.id])).rows[0];
    return row ? choicesOf(row.choices) : null;
  });
  const input = await loadUaFields(tenantId, runId, documentId);
  const rec = recogniseUa(input.fields);
  const c = raw as Partial<UaChoices>;
  if (typeof c.weighted !== "boolean" || (c.focalBrand !== null && (typeof c.focalBrand !== "string" || !rec.brands.some(b => b.code === c.focalBrand) && prior?.focalBrand !== c.focalBrand))) return { saved: false, reason: "Choose a listed focal brand and a weighting setting." };
  if (!c.roleCorrections || typeof c.roleCorrections !== "object" || Array.isArray(c.roleCorrections)) return { saved: false, reason: "Role corrections must name confirmed variables." };
  for (const [role, variable] of Object.entries(c.roleCorrections)) if (!UA_ROLES.includes(role) || (variable !== null && !input.fields.some(f => f.variable === variable && isUaResponse(f)) && prior?.roleCorrections[role] !== variable)) return { saved: false, reason: `The correction for ${role} is not valid in this wave.` };
  if (c.lightUserMaximum !== null && (!Number.isInteger(c.lightUserMaximum) || c.lightUserMaximum! < 1 || c.lightUserMaximum! > 10000)) return { saved: false, reason: "Choose a positive whole-number light-user maximum, or leave it undefined." };
  const choices: UaChoices = { focalBrand: c.focalBrand, weighted: c.weighted, roleCorrections: c.roleCorrections, lightUserMaximum: typeof c.lightUserMaximum === "number" ? c.lightUserMaximum : null };
  return withTenant(tenantId, async client => {
    const target = await scope(client, tenantId, runId, documentId, true);
    if (target.key !== expected.scope) return { saved: false, conflict: true, reason: "This project's dashboard scope changed. Reload before saving." };
    if (!(await available(client))) return { saved: false, reason: "Choices cannot be saved until migration 0140 is applied." };
    const row = (await client.query<{ revision: number }>(`select revision from ua_dashboards where ${where(target.program)} for update`, [tenantId, target.id])).rows[0];
    if ((row?.revision ?? null) !== expected.revision) return { saved: false, conflict: true, reason: "Someone saved U&A choices since this view opened. Reload before saving." };
    if (!row) {
      const inserted = await client.query<{ revision: number }>("insert into ua_dashboards (tenant_id,run_id,program_id,choices,choices_by) values ($1,$2,$3,$4,$5) on conflict do nothing returning revision", [tenantId, target.program ? null : runId, target.program, JSON.stringify(choices), actor]);
      return inserted.rowCount === 1 ? { saved: true, revision: inserted.rows[0].revision } : { saved: false, conflict: true, reason: "Someone saved the first choices. Reload before saving." };
    }
    const updated = await client.query<{ revision: number }>(`update ua_dashboards set choices=$3,choices_by=$4,choices_at=now(),revision=revision+1 where ${where(target.program)} and revision=$5 returning revision`, [tenantId, target.id, JSON.stringify(choices), actor, expected.revision]);
    return updated.rowCount === 1 ? { saved: true, revision: updated.rows[0].revision } : { saved: false, conflict: true, reason: "The saved revision changed. Reload before saving." };
  });
}

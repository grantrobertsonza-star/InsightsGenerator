import { withTenantRead } from "./db";

export type ProjectListItem = { id: string; name: string };

/**
 * The organisation's projects, newest first, for the sidebar's current-project switcher. Names fall
 * back the way the project list does (objective, then business problem, then "Untitled project").
 * Read-only and scoped to the signed-in organisation by withTenantRead.
 */
export async function listProjects(tenantId: string): Promise<ProjectListItem[]> {
  return withTenantRead(tenantId, async (client) =>
    (
      await client.query<{ id: string; name: string | null }>(
        "select id, coalesce(project_name, research_objective, business_problem) as name from runs where tenant_id = $1 order by created_at desc",
        [tenantId],
      )
    ).rows.map((r) => ({ id: r.id, name: r.name?.trim() || "Untitled project" })),
  );
}

// Test seam for G6: actions and routes resolve their tenant from the signed-in request
// (requestContext.ts), which needs a real Next request. Tests that call actions directly mock
// that module with this: the tenant is the one the test seeded and put in DEFAULT_TENANT_ID
// (test-only use; no application source reads that variable any more), or a fixed synthetic
// tenant when the test mocks the database and seeds none. The rest of the real
// module (runBelongsToTenant, chooseMembership, ...) is kept.
import { vi } from "vitest";

export const TEST_USER_ID = "00000000-0000-4000-8000-0000000000aa";
export const TEST_TENANT_ID = "00000000-0000-4000-8000-0000000000bb";

export async function testRequestContextModule() {
  const real = await vi.importActual<typeof import("../../requestContext")>("../../requestContext");
  const context = () => {
    // Tests with a mocked database never seed a tenant; they get a fixed synthetic one.
    const tenantId = process.env.DEFAULT_TENANT_ID ?? TEST_TENANT_ID;
    return {
      userId: TEST_USER_ID,
      email: "tester@example.test",
      tenantId,
      organisationName: "Test organisation",
      role: "owner" as const,
      memberships: [{ tenantId, organisationName: "Test organisation", role: "owner" as const }],
    };
  };
  return {
    ...real,
    requireTenantId: async () => context().tenantId,
    requireRequestContext: async () => context(),
    optionalRequestContext: async () => context(),
    routeRequestContext: async () => context(),
  };
}

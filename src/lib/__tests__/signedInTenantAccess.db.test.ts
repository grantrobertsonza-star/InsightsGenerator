// G6 / IMP-001 / IMP-016: the signed-in request decides the tenant, end to end through ACTUAL
// actions and route handlers, on a REAL PostgreSQL as a NON-OWNER role without BYPASSRLS.
//
// Boundaries: Next's cookie store (next/headers) and navigation (next/navigation) are replaced
// with minimal stand-ins, and Supabase Auth's /auth/v1/user is answered by a stubbed fetch that
// knows three tokens. Everything else is real: requestContext, the membership table and its
// row-level security, app_user_memberships(), the actions, the routes and their SQL.
// What this does NOT establish: the deployed Supabase project's behaviour, cookie transport in a
// browser (covered by the browser checks), or the proxy's refresh timing.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "10000000-0000-4000-8000-0000000000a1";
const USER_B = "10000000-0000-4000-8000-0000000000b1";
const USER_NONE = "10000000-0000-4000-8000-0000000000c1";
const ROLE = "ie_test_signed_app";
const TOKENS: Record<string, { id: string; email: string }> = {
  "token-a": { id: USER_A, email: "a@example.test" },
  "token-b": { id: USER_B, email: "b@example.test" },
  "token-none": { id: USER_NONE, email: "none@example.test" },
};

// Request cookies for the "current request"; each test sets them.
let jar = new Map<string, string>();
let authDown = false;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The routes import through the @/ alias, which vitest does not resolve here; point it at the
// same real modules.
vi.mock("@/lib/requestContext", async () => await import("../requestContext"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/authSession", async () => await import("../authSession"));
vi.mock("@/lib/processProgress", async () => await import("../processProgress"));
vi.mock("next/server", async () => ({ ...(await vi.importActual<object>("next/server")), after: () => {} }));
// React cache() needs a React request scope; outside one each call simply runs (no memo).
vi.mock("react", async () => ({ ...(await vi.importActual<object>("react")), cache: <T,>(fn: T) => fn }));

describe.skipIf(!TEST_DATABASE_URL)("signed-in tenant access (actual actions and routes, real database)", () => {
  let db: DisposableDb;
  let runA: string;
  let findingA: string;
  let runB: string;
  type Mods = {
    ctx: typeof import("../requestContext");
    findings: typeof import("../findingActions");
    progress: typeof import("../../app/api/runs/[id]/process-progress/route");
    runsRoute: typeof import("../../app/api/runs/route");
  };
  let m: Mods;
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);

  beforeAll(async () => {
    db = await createDisposableDb();
    await q(`insert into tenants (id, name) values ($1, 'Org A'), ($2, 'Org B')`, [A, B]);
    runA = (await q(`insert into runs (tenant_id, project_name) values ($1, 'A project') returning id`, [A])).rows[0].id;
    runB = (await q(`insert into runs (tenant_id, project_name) values ($1, 'B project') returning id`, [B])).rows[0].id;
    findingA = (
      await q(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'stated', 'A secret', 'accepted') returning id`, [A, runA])
    ).rows[0].id;
    await q(`insert into tenant_memberships (user_id, tenant_id, role) values ($1, $2, 'owner'), ($3, $4, 'member')`, [USER_A, A, USER_B, B]);
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
        create role ${ROLE} login password 'ie_test_only' nobypassrls;
      end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
    await q(`grant execute on all functions in schema public to ${ROLE}`);
    await q(`revoke all on table tenants from ${ROLE}`);
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    process.env.DATABASE_URL = u.toString();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://auth.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test";
    process.env.SUPABASE_SECRET_KEY ??= "secret-test-unused";
    delete process.env.DEFAULT_TENANT_ID;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (authDown) throw new TypeError("fetch failed");
      if (String(url).includes("/auth/v1/token?grant_type=refresh_token")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { refresh_token?: string };
        if (body.refresh_token !== "refresh-a") return Response.json({ message: "Invalid Refresh Token" }, { status: 400 });
        return Response.json({ access_token: "token-a", refresh_token: "refresh-a2", expires_in: 3600, user: TOKENS["token-a"] });
      }
      if (String(url).endsWith("/auth/v1/user")) {
        const token = /^Bearer (.+)$/.exec(String((init?.headers as Record<string, string>)?.authorization ?? ""))?.[1];
        const user = token ? TOKENS[token] : undefined;
        return user ? Response.json(user) : Response.json({ message: "invalid JWT" }, { status: 401 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    m = {
      ctx: await import("../requestContext"),
      findings: await import("../findingActions"),
      progress: await import("../../app/api/runs/[id]/process-progress/route"),
      runsRoute: await import("../../app/api/runs/route"),
    };
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    vi.unstubAllGlobals();
    await db?.drop();
    const { Client } = await import("pg");
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    await c.query(`drop role if exists ${ROLE}`).catch(() => {});
    await c.end();
  });

  beforeEach(() => {
    jar = new Map();
    authDown = false;
  });
  const as = (token: string, organisation?: string) => {
    jar.set("ie-access", token);
    if (organisation) jar.set("ie-organisation", organisation);
  };
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("no session: actions go to sign-in, routes answer 401 and nothing is read", async () => {
    await expect(m.findings.setFindingStatus(runA, findingA, "rejected")).rejects.toMatchObject({ to: "/login" });
    const r = (await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response;
    expect(r.status).toBe(401);
  });

  it("a token Supabase Auth rejects is treated as signed out", async () => {
    as("forged-token");
    await expect(m.ctx.requireTenantId()).rejects.toMatchObject({ to: "/login" });
    expect(((await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response).status).toBe(401);
  });

  it("an unreachable Auth service is a visible failure (503), never sign-out and never a default organisation", async () => {
    as("token-a");
    authDown = true;
    await expect(m.ctx.requireTenantId()).rejects.not.toBeInstanceOf(Redirected);
    const r = (await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response;
    expect(r.status).toBe(503);
  });

  // Codex 2026-10-18 (ed3e980): with the access cookie lapsed and only the refresh cookie left, an
  // Auth outage during the proxy's refresh was answered 401 ("not signed in"). The ACTUAL proxy and
  // the ACTUAL route run in sequence here, the way Next runs them for one request.
  describe("access cookie lapsed, refresh cookie present (actual proxy, then actual route)", () => {
    const sendThroughProxy = async () => {
      const { proxy } = await import("../../proxy");
      const { NextRequest } = await import("next/server");
      const headers = new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
      const response = await proxy(new NextRequest("http://127.0.0.1:3000/api/runs", { headers }));
      // NextResponse.next() carries tokens the proxy renewed as request-cookie overrides; apply them
      // to this request's jar, as Next does before the route runs.
      const overridden = response.headers.get("x-middleware-request-cookie");
      if (overridden) for (const pair of overridden.split("; ")) { const [k, ...v] = pair.split("="); jar.set(k, v.join("=")); }
      return response;
    };

    it("Auth unreachable: unavailable (503), cookies kept, never 401 or a sign-in redirect", async () => {
      jar.set("ie-refresh", "refresh-a");
      jar.set("ie-organisation", A);
      authDown = true;
      const passed = await sendThroughProxy();
      expect(passed.status).toBe(200); // let through, not answered by the proxy
      expect(passed.headers.get("location")).toBeNull();
      expect(passed.cookies.getAll().filter((c) => c.value === "")).toEqual([]); // nothing deleted
      const r = (await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response;
      expect(r.status).toBe(503);
      await expect(m.ctx.requireTenantId()).rejects.not.toBeInstanceOf(Redirected);
      expect(jar.get("ie-refresh")).toBe("refresh-a");
    });

    it("Auth back: the same cookies renew and recover in the original organisation", async () => {
      jar.set("ie-refresh", "refresh-a");
      jar.set("ie-organisation", A);
      await sendThroughProxy();
      expect(jar.get("ie-access")).toBe("token-a");
      const r = (await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response;
      expect(r.status).toBe(200);
      expect(((await r.json()) as { runs: { id: string }[] }).runs.map((x) => x.id)).toEqual([runA]);
    });

    it("a refresh token Auth rejects is a genuine sign-out (401, cookies cleared)", async () => {
      jar.set("ie-refresh", "refresh-revoked");
      const answered = await sendThroughProxy();
      expect(answered.status).toBe(401);
      const cleared = answered.cookies.getAll().map((c) => c.name).sort();
      expect(cleared).toEqual(["ie-access", "ie-refresh"]);
    });
  });

  it("a signed-in user with no membership is refused everything", async () => {
    as("token-none");
    await expect(m.ctx.requireTenantId()).rejects.toMatchObject({ to: "/no-organisation" });
    expect(((await m.runsRoute.GET(new Request("http://x/api/runs"))) as Response).status).toBe(403);
  });

  it("each user sees only their own organisation's runs through the actual route", async () => {
    as("token-a");
    const a = (await (await m.runsRoute.GET(new Request("http://x/api/runs")) as Response).json()) as { runs: { id: string }[] };
    expect(a.runs.map((r) => r.id)).toEqual([runA]);
    jar = new Map();
    as("token-b");
    const b = (await (await m.runsRoute.GET(new Request("http://x/api/runs")) as Response).json()) as { runs: { id: string }[] };
    expect(b.runs.map((r) => r.id)).toEqual([runB]);
  });

  it("an organisation cookie naming a tenant the user does not belong to is ignored, not honoured", async () => {
    as("token-b", A);
    expect(await m.ctx.requireTenantId()).toBe(B);
    const b = (await (await m.runsRoute.GET(new Request("http://x/api/runs")) as Response).json()) as { runs: { id: string }[] };
    expect(b.runs.map((r) => r.id)).toEqual([runB]);
  });

  it("user B cannot change user A's finding through the actual action; user A can", async () => {
    as("token-b");
    // Row-level security hides A's row from B, so the update matches nothing, and the action says
    // the finding is not in the project (Codex TR500-F03) rather than acknowledging a save.
    expect(await m.findings.setFindingStatus(runA, findingA, "rejected")).toMatchObject({ ok: false, error: expect.stringMatching(/no longer in this project/) });
    expect((await q(`select status from findings where id = $1`, [findingA])).rows[0].status).toBe("accepted");
    jar = new Map();
    as("token-a");
    expect(await m.findings.setFindingStatus(runA, findingA, "rejected")).toEqual({ ok: true });
    expect((await q(`select status from findings where id = $1`, [findingA])).rows[0].status).toBe("rejected");
  });

  it("a run id from another organisation gets the same 404 as a missing run (progress route)", async () => {
    as("token-b");
    expect(((await m.progress.GET(new Request("http://x"), params(runA))) as Response).status).toBe(404);
    expect(((await m.progress.GET(new Request("http://x"), params(runB))) as Response).status).toBe(200);
  });

  it("creating a run puts it in the signed-in organisation, whatever tenantId the body names", async () => {
    as("token-b");
    const r = (await m.runsRoute.POST(new Request("http://x/api/runs", { method: "POST", body: JSON.stringify({ tenantId: A, businessProblem: "p" }) }))) as Response;
    expect(r.status).toBe(201);
    const id = ((await r.json()) as { run: { id: string } }).run.id;
    expect((await q(`select tenant_id from runs where id = $1`, [id])).rows[0].tenant_id).toBe(B);
  });

  it("the application role reads only the current user's memberships and can change none", async () => {
    expect((await m.ctx.loadMemberships(USER_A)).map((x) => [x.tenantId, x.organisationName])).toEqual([[A, "Org A"]]);
    expect(await m.ctx.loadMemberships(USER_NONE)).toEqual([]);
    const { pool } = await import("../db");
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.current_user_id', $1, true)", [USER_B]);
      expect((await c.query(`select tenant_id from tenant_memberships`)).rows.map((r) => r.tenant_id)).toEqual([B]);
      // RLS has only a SELECT policy, so a write that names the user's own rows matches nothing.
      const ins = await c.query(`insert into tenant_memberships (user_id, tenant_id) values ($1, $2)`, [USER_B, A]).catch((e: Error) => e);
      expect(ins).toBeInstanceOf(Error);
      await c.query("rollback");
      await c.query("begin");
      await c.query("select set_config('app.current_user_id', $1, true)", [USER_B]);
      expect((await c.query(`update tenant_memberships set tenant_id = $1 where user_id = $2`, [A, USER_B])).rowCount).toBe(0);
      expect((await c.query(`delete from tenant_memberships where user_id = $1`, [USER_B])).rowCount).toBe(0);
      await c.query("rollback");
    } finally {
      c.release();
    }
    expect((await q(`select count(*)::int n from tenant_memberships`)).rows[0].n).toBe(2);
  });
});

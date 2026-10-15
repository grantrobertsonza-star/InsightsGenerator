import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

// IMP-001: this route used to take tenantId straight from the request (a query param on GET, the
// body on POST) with no check at all - an unauthenticated caller could read or create runs under
// ANY tenant id simply by naming it. There is still no login system in this app (no session, no
// per-user identity - every other entry point in the codebase runs under this same single
// DEFAULT_TENANT_ID), so "authenticate the caller" cannot yet mean distinguishing one real user
// from another. What it can mean today is this: the server decides the tenant, exactly like every
// other action in the app already does, and a caller can no longer select an arbitrary one. This
// closes the concrete hole (arbitrary caller-chosen tenant scope) without pretending a multi-user
// auth system exists yet - that remains a separate, larger piece of work, deliberately deferred by
// the user's own instruction (2026-10-14) rather than attempted here.
const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export async function GET(_request: Request) {
  const runs = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query(
      `select id, business_problem, research_objective, decision_statement, evidence_threshold, audience,
              status, created_at
       from runs order by created_at desc`
    );
    return result.rows;
  });

  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const body = await request.json();
  // decisionStatement is still accepted directly here for a caller that
  // already knows its decision going in, matching what the column has
  // always meant: the run's confirmed decision. businessProblem and
  // researchObjective are the normal upstream fields the actual UI now
  // captures at intake; the decision framer proposes candidate decisions
  // from those plus the evidence rather than one being supplied upfront.
  // tenantId is deliberately NOT read from the request body any more - see the comment above
  // GET. A legacy caller that still sends one is silently ignored rather than honoured.
  const { businessProblem, researchObjective, decisionStatement, evidenceThreshold, audience } = body ?? {};

  const run = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query(
      `insert into runs (tenant_id, business_problem, research_objective, decision_statement, evidence_threshold, audience)
       values ($1, $2, $3, $4, $5, $6)
       returning id, business_problem, research_objective, decision_statement, evidence_threshold, audience, status, created_at`,
      [
        TENANT_ID,
        businessProblem ?? null,
        researchObjective ?? null,
        decisionStatement ?? null,
        evidenceThreshold ?? null,
        audience ?? null,
      ]
    );
    return result.rows[0];
  });

  return NextResponse.json({ run }, { status: 201 });
}

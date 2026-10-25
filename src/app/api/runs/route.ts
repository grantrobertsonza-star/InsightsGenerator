import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { routeRequestContext } from "@/lib/requestContext";

// IMP-001 / G6: this route used to take tenantId straight from the request, so any caller could
// read or create runs under any tenant by naming it. The tenant now comes only from the signed-in
// user's organisation (requestContext.routeRequestContext); a tenantId in the query or body is
// ignored. A request without a valid session gets 401 and touches nothing.


export async function GET(_request: Request) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const runs = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query(
      `select id, business_problem, research_objective, decision_statement, evidence_threshold, audience,
              status, created_at
       from runs where (to_jsonb(runs)->>'bin_of') is null order by created_at desc`
    );
    return result.rows;
  });

  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
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

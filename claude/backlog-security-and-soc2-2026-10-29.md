# Backlog: security baseline, enterprise controls, regional hosting, SOC 2 (Grant, 29 October 2026)

Status: **noted for later** ("note this for when we get to security"). Not started. Grant's text, kept as given.

## Principle
"A customer can trust us with sensitive company or research data, and we can provide evidence for that trust."
Do not publish SOC 2, enterprise-control or regional-hosting claims until each is established. Functional testing
does not establish SOC 2 compliance or verify the production security configuration.

| Claim | What it needs |
|---|---|
| SOC 2 Type II | An independent licensed CPA firm examines our controls and evidence that they operated effectively over an agreed period. Covers company processes as well as software. Audited cloud providers do not give Insights Elevator its own report. |
| Enterprise controls | Named capabilities actually provided: SSO, enforced MFA, access roles, audit logs, retention policies, controlled support access. |
| Regional hosting options | A deployable, supportable arrangement for storing and processing customer data in specified regions, with documented exceptions and contractual commitments. |

## Steps
1. **Audit the current security position:** production authentication, tenant isolation, file access, administrative
   access, secrets, encryption, logging, dependencies, deployment configuration. Independent penetration test; fix
   findings.
2. **Complete enterprise controls:** access roles, MFA, enterprise sign-in where needed, reliable audit trails,
   session revocation, customer data export and deletion, configurable retention. Controls must match promises and
   risks.
3. **Map the whole data journey:** uploads, database records, file storage, the Python processing service, AI
   providers, exports, logs, backups, support access. For research transcripts, AI processing location and
   retention matter most.
4. **Build and verify regional deployment:** a database region is only one part. Supabase says some processing can
   occur outside the selected region; Vercel function regions are configured separately. Verify every service
   before promising data stays in a jurisdiction.
   (https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq,
   https://vercel.com/docs/functions/configuring-functions/region)
5. **Operate the processes:** access reviews, onboarding and offboarding, incident response, vulnerability
   management, vendor reviews, release approvals, backup restoration exercises. Back up uploaded files as well as
   the database: Supabase database backups do not include Storage objects
   (https://supabase.com/docs/guides/platform/backups).
6. **Engage a SOC 2 auditor:** system boundary and scope, readiness assessment, gap closure, operating evidence,
   Type II examination. A sustained programme, not a one-off code check.

Recommendation: a verified security baseline first, then SOC 2 alongside enterprise sales; regional hosting a
separate deliverable.

## Public wording until then
> **Security for sensitive research**
> Talk to us about your organisation's access, hosting and data-handling requirements.

Checked on 29 October 2026: the landing page (`public/home.html`), Business Proposal v17 and Technical Brief v20 make
no SOC 2, enterprise-control or regional-hosting claim. Keep it that way; use the wording above if a security section
is added before the programme is done.

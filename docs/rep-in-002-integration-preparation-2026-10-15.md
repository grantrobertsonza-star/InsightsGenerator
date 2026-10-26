# REP-IN-002 disposable integration preparation ? 2026-10-15

REP-IN-002 application-code closure is preserved. This is preparation only, not integration closure.
[Package/setup/write inventory](../scripts/repin002-integration/README.md),
[planned14 core groups](../scripts/repin002-integration/plan.json),
[targeted browser protocol](../scripts/repin002-integration/browser-protocol.md),
[pinned source/migrations](../scripts/repin002-integration/sources.json),
[preparation validation](../scripts/repin002-integration/preparation-validation.json).

No application code/shared configuration/dependencies/actual migrations or existing harness changed.
No database/storage/browser writes, model requests or service startup. Actual0094 was not applied.

Core package needs a NEW explicitly named repin002_* database, actual full schema through0093,
its own marker, nonowner NOSUPERUSER/NOBYPASSRLS app role and explicit admin/app local connections.
It reuses existing pg/TypeScript/actual-function harness patterns, not a new framework or minimal
application-schema substitute. Core SQL requires no storage/model/browser. Actual0094 transition,
defaults/history, researcher actions, rollback/support publication and observed-wait concurrency
are prepared. Setup/cleanup and exact permitted write tables/objects are documented in README.
The actual migration DDL is used unchanged; raw DDL testing is distinguished from deployment-runner
ledger verification.

Six pure guard checks pass. All six JavaScript files syntax-check; explicit disabled run reports0
integration cases/no connections. Initial preparation syntax errors were corrected in new harness
files before final validation. No executable integration case is counted passed. Future execution
may expose schema/fixture gaps; stop, record failed/blocked and preserve evidence rather than
alter application assertions or migrations.

Targeted browser protocol: actual local run page status/prompt reload, scoped confirmation and safe
pre-migration recovery using one synthetic TXT. Installed SDK supports ANTHROPIC_BASE_URL, so a
local record_findings-only fixture avoids real credentials/model calls. It refuses unrelated tools.
Native confirmation's follow-on refresh/write boundary is explicitly BLOCKED until separately
authorized/isolated; current preparation does not claim a complete native framework submission
adapter. Actual dashboard/theme-guard SQL fixture groups also remain named companion preparation
work, not implied by ordinary finding-action SQL coverage.

Safe sharing: reuse a PostgreSQL host/image, actual pre0094 schema snapshot and local service setup.
Use separate repin002_* and p2a_* database clones, markers/roles/fixtures/results. Do not migrate
P2a's frozen DB concurrently; do not weaken either target guard. Local storage/browser services may
be reused sequentially with explicit separate object paths/ports/profiles/tenant fixtures. Neither
acceptance contract or existing P2a harness is changed. A common fully migrated stack would need a
new explicit freeze/authorization and compatible existing guards; it is not automatically approved.

Next step is scoped environment/write authorization and provision, not more application repair.
Existing OBJ-REV-009 authorization does not apply. The43-row baseline and all closures/counts remain
unchanged; this is a reproducible starting package with its remaining boundaries stated, not a claim
that unexecuted database or browser checks passed.

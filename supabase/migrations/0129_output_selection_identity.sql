-- Batch 65, Codex B52-F01 remainder (28 October 2026): one statistical-output selection is one output set
-- even when the reply to its first request is lost.
--
-- The Add files dialog sends a large selection in several requests. Before this, only the reply to the first
-- request told the dialog which set it had created; when that reply was lost (the set and the first file were
-- stored, the answer never arrived), the files still waiting were sent without a set and started a second one.
--
--   output_sets.client_selection_id  an id the dialog generates once per selection of statistical output,
--                                    before its first request, and sends with every request that carries
--                                    that selection's output (including a retry after a lost reply). The
--                                    first request to arrive creates the set with it; every later one joins
--                                    it (ingestOutputFiles, the grouping owner). Null for sets made before
--                                    this migration or by callers that send no selection id.
--
-- Unique per tenant, not per project: a set removed to the bin moves to the bin project (documentBin) and
-- keeps its selection id, so a late retry of that selection finds it there and is refused as not in this
-- project, rather than silently starting a new set beside it. The id is a random UUID, so two selections
-- never share one by chance; tenants are kept apart so one tenant's id can never refer to another's set.
alter table output_sets add column if not exists client_selection_id uuid;
create unique index if not exists output_sets_client_selection_idx
  on output_sets (tenant_id, client_selection_id)
  where client_selection_id is not null;

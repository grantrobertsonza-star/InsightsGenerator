-- Supports the stated-insight evidence-chain validator: a stricter check,
-- specific to finding_kind = 'stated_insight' claims (a report's own
-- interpretive insight statement), that traces the claim down to the
-- findings that actually back it rather than just judging it for plausible
-- coherence the way every other stated finding is judged.
--
-- cited_support_finding_ids: captured at extraction time (extractFindings.ts),
-- the OTHER findings from the same document the report itself appears to
-- lean on for this insight (resolved from same-batch indices into real
-- finding ids once rows exist). Empty for every finding that isn't a
-- stated_insight, and for a stated_insight the report gives no visible
-- support for.
alter table findings
  add column if not exists cited_support_finding_ids jsonb not null default '[]';

-- The chain validator writes ordinary verdicts rows, same verdict_tier /
-- corroboration_level vocabulary as everything else, just via a new
-- verification_method so a verdict born from tracing a claim to specific
-- evidence (and recording what it relied on, in due_care) is distinguishable
-- from one born from a single model pass judging plausibility alone.
alter table verdicts drop constraint if exists verdicts_verification_method_check;
alter table verdicts add constraint verdicts_verification_method_check
  check (verification_method in ('single_pass', 'dual_model', 'chain_trace'));

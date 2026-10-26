-- Business decisions: the accepted decisions an AI recommendation was generated for.
--
-- Recommendations are framed against runs.decision_statement as it stood when the generator built
-- its prompt (recommendationAgent.ts), independently of when or how the insight under them was
-- framed: a pre-decision insight with no decision context can carry a recommendation written for
-- Decision A. Inferring a recommendation's decisions from its insight therefore missed it when the
-- decisions later changed. decision_context records the statement that prompt used.
--
-- Null means not recorded: AI recommendations written before this migration (their decisions are
-- unknown and are qualified as such, never assumed current; see decisionContext.ts) and every
-- recommendation a researcher wrote (not framed by the generator, so no claim is made about it).
-- Additive and idempotent; no existing row changes.

alter table recommendations add column if not exists decision_context text;

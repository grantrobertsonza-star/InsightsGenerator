-- Splits what used to be one "decision or objective" field at intake into
-- the two upstream stages a research process actually has: the business
-- problem motivating the work, and the research objective/hypothesis this
-- project sets out to address. Neither implies a decision on its own; the
-- decision framer proposes decisions from these plus the evidence, rather
-- than a researcher's guess at one being asked for before any evidence
-- exists. decision_statement is unchanged and still means exactly what it
-- always has: the run's confirmed decision, set only once a candidate is
-- accepted.
--
-- evidence_synthesis holds the framer's own grounding statement (what the
-- evidence shows in light of the problem/objective), written before it
-- proposes decisions, so a researcher can see the reasoning a candidate
-- decision is supposed to follow from rather than taking it on faith.
alter table runs add column business_problem text;
alter table runs add column research_objective text;
alter table runs add column evidence_synthesis text;

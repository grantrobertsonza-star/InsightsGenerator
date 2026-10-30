-- Research assistant: one logical question is answered and stored once (Codex B6-F02, 2026-10-23).
-- Requires 0033 (assistant_messages). Additive and nullable: existing rows keep their meaning.
--
-- request_id: an id the drawer or card makes for each question and sends again with Send again.
--   A question and its reply are stored together under it. When the connection drops after the
--   server has stored the exchange, the browser cannot tell whether it was answered; sending the
--   same question again with the same id returns the stored reply instead of asking the model and
--   storing a second copy. Rows from before this migration have none.
-- The unique index makes a second store of the same request fail as a conflict, so two sends of
-- one request that race each other still store one pair.
alter table assistant_messages add column if not exists request_id uuid;

create unique index if not exists assistant_messages_request_role_idx
  on assistant_messages (run_id, request_id, role)
  where request_id is not null;

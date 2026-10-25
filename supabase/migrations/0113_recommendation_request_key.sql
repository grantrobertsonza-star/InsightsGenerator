-- Researcher-written recommendations keep the identity of the add request (Codex REC500-F03,
-- 2026-10-24). The add form makes one key when it opens and sends it with every attempt; a retry
-- after a lost reply, or two sends of the same form at once, store one recommendation, and the
-- resend is answered with it. A later, deliberate addition comes from a new key. Additive: existing
-- rows keep a null key and are unaffected. Without this column the add is refused with a message
-- naming this migration, and nothing is stored.
alter table recommendations add column if not exists client_request_key uuid;

create unique index if not exists recommendations_client_request_key_uidx
  on recommendations (run_id, client_request_key)
  where client_request_key is not null;

-- Grounding fields for stated claims: the exact sentence the claim was
-- drawn from, its page (when known), and whether that sentence was
-- actually found verbatim in the source document text.
alter table claims
  add column source_quote text,
  add column quote_verified boolean;

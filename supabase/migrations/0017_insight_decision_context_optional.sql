-- "Generate from data" runs the traditional order: verified findings lead
-- to insights, and a decision gets proposed or confirmed from those
-- insights afterward, so an insight can exist before any decision does.
-- "Validate existing insights" keeps the original order: a decision is
-- confirmed first, and decision_context on every insight row is that
-- decision, exactly as this table was first designed. Making the column
-- nullable is what lets one table serve both without contradicting either.
alter table insights alter column decision_context drop not null;

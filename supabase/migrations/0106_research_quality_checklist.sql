-- Research Quality Review: the quantitative checklist step (RQK-1), 2026-10-18.
--
-- A review now has a third kind of task, 'checklist': for one document and one checklist, the
-- model's element statuses (present / partial / absent, each citing facts already extracted with
-- located quotes). The statuses are stored in the task's result like the other stages; the
-- percentages and bands are computed by code when the review is shown or exported, so a change to
-- the scoring rule never needs a data migration. The checklist release is recorded in the review's
-- manifest. Additive: existing reviews simply have no checklist tasks and show no grid; without this
-- migration new reviews run as before, without a checklist, and the screen says why.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.research_quality_tasks'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%stage%'
  loop
    execute format('alter table research_quality_tasks drop constraint %I', c);
  end loop;
end $$;

alter table research_quality_tasks
  add constraint research_quality_tasks_stage_check check (stage in ('extract', 'assess', 'checklist'));


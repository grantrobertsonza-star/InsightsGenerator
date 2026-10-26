# Migration history: bringing the Supabase CLI record in line

Grant, 2026-10-23: `npx.cmd supabase migration up` failed with
`check constraint "claims_pattern_type_check" ... is violated by some row` while trying to apply
0062. The database already had 0062 and later migrations; they were applied outside the CLI
(`apply_pending_migrations.mjs`, by hand), so the CLI's record
(`supabase_migrations.schema_migrations`) lists fewer files than the database has, and `migration
up` replays old files. Replaying is wrong: 0062 sets an older list of finding pattern types that
today's data (`level`, `driver`, ...) does not satisfy. The failed command changed nothing (each
migration runs in a transaction and the first statement failed). 0108 was then applied by hand in
Studio.

## The check (read only)

`node scripts/migration-history-check.mjs` (DATABASE_URL from the environment or `.env.local`):

- reads the CLI record in a read-only transaction;
- for every file the record does not list, looks for the objects it creates (tables, columns,
  indexes, constraints, policies, functions, triggers) and reports all, some or none present;
- prints, without running it, `npx.cmd supabase migration repair --status applied <versions>`
  for the files whose objects all exist. That command changes only the record.

Limits: a file that only changes data, or only drops or replaces objects, has nothing to look for
("nothing to check": read it to judge); an object a later file dropped shows as missing for the
earlier one; a constraint whose definition later files replaced (claims_pattern_type_check) counts
as present by name.

Test: `src/lib/__tests__/migrationHistoryCheck.db.test.ts` (real disposable database built from
every migration, record listing 0001 to 0061, 0108 removed): 0062 reported as present, 0108 as not
applied, the repair line lists 0062 and not 0108 or 0061, record and schema unchanged.

## Steps for Grant

1. Back up: `npm run backup`.
2. Run the check and read every line. Anything "some of" or "none of" or "nothing to check" needs
   a decision before it is marked.
3. Run the printed repair command (only for the files listed), or a shorter one you have checked.
4. Run `npx.cmd supabase migration list --local`: the repaired versions now show as applied.
   Migration 0109 (usage outside projects) is then the only one pending; `migration up` applies it.
5. From then on, apply new migrations with `npx.cmd supabase migration up` only.

Claude does not run these against your database (the standing rule: no writes to local or cloud
Supabase).

# Project sidebar: groups and rolling them up

The project menu (`src/app/runs/[id]/RunShell.tsx`, `RunNav`) lists the run page's sections
(`navSections` in `page.tsx`) in groups: Prepare, Analyse, Develop findings, Deliver, Tools. Each group
is a `role="group"` labelled by its name; the order and membership are set in `page.tsx`.

## Rolling a group up (Grant, 2026-10-22)

- **Control.** Each group heading is a button (`data-testid="run-nav-group-toggle"`, `aria-expanded`,
  `aria-controls` naming the group's list). Click or Enter toggles it.
- **A rolled-up group hides all its entries**, the open section too (Grant, 2026-10-22, replacing a
  first version that kept the open section listed). When it holds the open section (its id, or any id
  in its `activeFor`), its heading is coloured and its title says so (`data-holds-open`), so the
  researcher can still see which group they are in.
- **What is remembered.** The set of rolled-up group names, as a JSON array under the browser storage
  key `run-nav-folded:v1`. The scope is the browser: the same groups are rolled up in every project
  and every tab of that browser. Identity is the group's name, so renaming a group in `page.tsx`
  starts it open again (the key's version is bumped only for a change of format).
- **First render.** `useSyncExternalStore` with a server snapshot of `[]`: the server and the first
  client render show every group open, and a remembered fold applies straight after, so there is no
  hydration mismatch (at the cost of a brief open state on load).
- **Other tabs.** A `storage` event for the key (or a cleared store) drops the in-page copy and rereads,
  so a fold made in one tab applies in the others; a change in the same tab is announced with the
  `run-nav-folded` window event.
- **Storage unavailable.** Reads and writes are guarded. A blocked write keeps the fold for the page
  view in a module-level copy. A blocked read, malformed JSON, or a value that is not an array reads as
  nothing rolled up, so the menu opens in full rather than failing; in an array, members that are not
  strings are ignored and the string names still fold their groups. Nothing else in the app depends on
  this value.
- **Not covered.** The collapsed main menu (the icon rail that `RunNav` renders into `#run-nav-rail`) shows every section as an icon
  and does not fold.

## Tests

Browser `e2e/ui/sidebar.check.mjs` step 5: roll up Develop findings and Analyse (all entries hidden,
the open Analytics too; Analyse's heading marked as holding it), reload (still rolled up), unfold from the keyboard, then project switching. Codex's
independent review of `1f220a6` also exercised two tabs, blocked reads and writes, and malformed JSON.

## Limits

Per browser, not per user or project; group names are the identity; no mobile certification beyond
the widths the checks use.

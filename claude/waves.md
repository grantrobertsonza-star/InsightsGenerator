# Waves of a tracking study, programs, and where a project opens

Agreed with Grant, 27 October 2026: one study is one project, and its waves are data files added to it
over time. A program is only a folder of related projects.

## Waves in one project

**Identity.** A wave is a raw data file whose data set-up has a wave label (`data_setup.wave`, set
under Import data). An unlabelled file is not a wave, so a one-off project never sees any of this.

**Fieldwork month and inclusion.** These are `data_setup.waveDate` (YYYY-MM or YYYY-MM-DD, validated by
`normaliseWaveDate`; anything else is "not given") and `data_setup.waveIncluded` (true unless the
researcher unticks "Include this wave in wave tracking"). Both are saved with the rest of the set-up
through `saveDataSetup`, with the same compare-and-swap. A set-up saved before these fields reads as no
date and included.

**Which waves, in what order.** `src/lib/waves.ts` `projectWaves` decides, and is the only place that does.
- Included waves are ordered by fieldwork date when every included wave has one.
- Otherwise they are in upload order, oldest first, and the basis names the waves without a date
  (`waveOrderText`).
- A label is never parsed for order.
- Waves with the same date keep their upload order.
- A wave left out is listed as left out.

`listWaveFilesAction` returns the included waves, the excluded ones and the order text.

**Where it is used.**
- **Wave tracking** (Analytics) uses the included waves in that order and shows the order basis and the
  waves left out.
- **Brand Health and CSM** use the included waves when run across all waves.
- **Cross tabs and Analytics** list each data file as "Wave N: file". With no file used last, they open
  the latest included wave (`initialCrosstabDataset`).
- "Copy tables from..." can copy from any labelled wave, including one left out.

**Findings say which wave.** `findingSourceSql` reads the data file's wave label, and
`formatFindingSource` puts it in the source line: "w2.sav (Wave 2), Table 3". So the trail, the exports
and the findings spreadsheet (its own Wave column) all name the wave. The Findings list shows it under
the source.

**Corroboration (migration 0124).** `finding_evidence_key` keys every finding computed from a labelled
wave file as the project's study (`study:<run_id>`). So findings across waves of one tracker count as
one source: the result holding over time, not independent confirmation. Unlabelled data files, reports
and transcripts keep their document keys (0099).

The migration recounts existing insights. When a count falls, the tier is lowered, never raised, and
each change is traced (`waves_one_study_confidence_corrected`). A label added or removed later changes
the key for the next synthesis.

**Not yet:**
- pooling waves into one table (Cross tabs reads one file at a time);
- a scope picker of selected waves inside Cross tabs;
- insights saying "holds across N waves".

## Programs

A program groups related projects, such as one client's trackers. `src/lib/programs.ts`:
- **Renaming** checks the name: required, at most 200 characters.
- **Deleting** locks the program and unlinks its projects (program and wave label cleared, as "Remove
  from program" does), then deletes the program, all in one transaction scoped to the tenant on every
  write. The projects and their data are kept. A project linked at the same moment is refused by the
  foreign key rather than left pointing at nothing.

The programs page explains that waves of a study belong in one project.

## Where a project opens

A project always opens on its overview (`ProjectOverview.tsx`): the four stages with their state and
headline, and the one next step, from the same statuses as the stage overviews and the dashboard. A
status that cannot be read says so.
- A link naming a section (`?section=`) opens that section.
- A reload of the project page returns to the section in use (`reloadOfThisPage`: the browser's own
  record that this address was reloaded).
- Opening the project from the dashboard or the project list is not a reload, so it shows the overview.

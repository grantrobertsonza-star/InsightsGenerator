# Instrument reread coverage

`readInstrumentItems` retains item and confirmed-link identities across incomplete reads.
It now records `instrument_read_finished` in the same transaction as item publication, with
the instrument ID, completion flag, failed chunks and incomplete items. A coverage-write
failure rolls the item update back rather than publishing unqualified partial coverage.

`getInstrumentSummaries` loads the latest coverage record per instrument. Import retains an
incomplete warning across reload and offers the existing Read again action. Saved legacy items
without a readable coverage record are explicitly unknown; their links are preserved.

`instrumentReread.db.test.ts` executes the actual action and loaders on disposable PostgreSQL,
with controlled extraction/model responses: complete read, partial reread, stable confirmed IDs,
repeated partial read and successful recovery without duplicates. Native interaction remains a
separate evidence level. No questionnaire capability expansion or deployment change is implied.

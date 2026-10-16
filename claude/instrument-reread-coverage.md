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


The native card now offers Read again after items exist. Previously the durable coverage warning
named a retry that could not be invoked from that state. The action uses the existing read path and
preserves pending/error handling. A native synthetic PDF and controlled chunk responses exercise
complete read, same-code confirmation, partial chunk failure, hard reload and corrected reread:
item/link IDs and confirmations remain unchanged, incomplete coverage survives reload, and successful
retry clears it. This is orchestration/persistence evidence, not real-provider interpretation proof.

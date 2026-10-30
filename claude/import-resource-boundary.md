# Initial supported import boundary

The limits are 100,000,000 bytes and 100,000 cases per file (raised from 20,000,000 bytes on 19 October 2026). The
shared contract is
`api/import-limits.json`, read by TypeScript and the Python engine. Server upload checks refuse byte
overflow before reading the body or writing storage; canonical engine and dictionary checks refuse
case overflow without publishing a partial calculation. Corrected smaller files can be uploaded again.

SAS `.sas7bdat` is excluded pending a valid fixture and verification. Upload controls, server checks
and user documentation disclose that exclusion. Valid and truncated SAV/DTA native checks are
retained separately; these do not certify every format or deployed workload capacity.

The measured synthetic engine boundary and native one-case-over/reload/corrected-upload checks
are acceptance evidence, not optimization or general performance certification. The concurrent
engine measurement uses cached in-process reads and must not be described as cold concurrent load.

Grant also excluded columns-as-cases workbooks requiring a separate Codebook for weights or
multiple-response metadata pending verification. The primary Task B fixture and its remaining
conditional-inference, small-base and downstream model chain remain unverified; passing control
datasets are not substitutes. Import guidance discloses the boundary.

The engine inspects all other sheets before flipping or matching metadata to case-column names.
Nonempty weight/MR declaration columns, weight roles and explicit weight-variable declarations
refuse dictionary/category/driver reads with a row-per-respondent re-export recovery message.
Empty declarations and label-only sheets remain allowed. Unreadable metadata fails rather than
being treated as absent. Dictionary10 is the minimum for flipped files so older saved dictionaries
cannot bypass this guard; ordinary row-oriented and SAV missing-audit minimums remain unchanged.
Full support for retargeting separate-Codebook research metadata remains backlog work.

In the app the refusal reaches the researcher as one notice per file in Import data, Variables
("Question definitions could not be checked for this file ..."), carrying the engine message and
its re-export guidance; question types then show Not checked. It used to repeat on every variable
and was framed as an SPSS/Stata/SAS read failure; engine errors are now prefixed "Couldn't read
this data file" for every format. The notice sits in the selected file's Variables group, not on
the file card beside Accept data, and accepting the data is not blocked by it. Native check:
e2e/ui/flipped-codebook-guard.check.mjs.

SAV/ZSAV readers retain formal missing declarations through metadata-only user-missing access,
while the data reader continues masking those values. Dictionary version9 is required only for
those formats; rows-oriented CSV/XLSX caches need not be reparsed for this metadata fix. Failed
upgrades retain the prior cache and researcher corrections with a visible retryable error.

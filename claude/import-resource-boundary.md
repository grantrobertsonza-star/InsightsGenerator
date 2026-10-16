# Initial supported import boundary

The approved initial scope is 20,000,000 bytes and 100,000 cases per file. The shared contract is
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

SAV/ZSAV readers retain formal missing declarations through metadata-only user-missing access,
while the data reader continues masking those values. Dictionary version9 is required only for
those formats; rows-oriented CSV/XLSX caches need not be reparsed for this metadata fix. Failed
upgrades retain the prior cache and researcher corrections with a visible retryable error.

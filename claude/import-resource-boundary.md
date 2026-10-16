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

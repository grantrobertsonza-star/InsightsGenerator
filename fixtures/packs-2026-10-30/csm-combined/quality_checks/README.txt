Combined CSM quality checks

Run from the root of the extracted combined pack:

  python3 quality_checks/validate_combined_pack.py . --report validation_results.json

The default check uses Python standard-library tools and reads the ordinary CSV
datasets, CSV codebooks, value labels, multiple-response definitions and reference
metrics. It does not need any optional JSON file or manually supplied mapping.

To check the XLSX files as well:

  python3 quality_checks/validate_combined_pack.py . --xlsx --report validation_results.json

The XLSX option requires openpyxl and opens every workbook read-only. It checks
the data and embedded metadata against their CSV counterparts, including the
pooled files, master codebooks and reference metric workbooks.

To also verify exact preservation against the earlier separated pack, add:

  --source-separated /path/to/Banking_and_Telecoms_CSM_Separated

If that original ZIP is available, add --authoritative-zip /path/to/original.zip.
This checks its known SHA256 and compares all extracted source files with the
archive. These source options are optional and are not dashboard import inputs.

Checks cover unique respondent-wave keys; 1,000 customer rows per wave; 400
variables; 3,000 pooled rows per sector; unchanged weights; lossless reconstruction
of the original channel records; blank unused-channel blocks; value codes;
question routing; anchored journeys; complaints; staying reasons; comparator
experiences; the added emotion, call, agent and IVR questions; separate optional
noncustomer records; and independently recalculated reference statistics.

The reference metrics are fixed expected results for the supplied synthetic test
data. If you replace or edit the observations, those fixed expected results will
no longer match. These checks do not establish dashboard application acceptance,
validate real-world survey estimates or turn repeated cross-sections into a panel.

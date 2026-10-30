# Separate CSM testing pack QA

Status: passed for file integrity and synthetic reference arithmetic. This is not an application acceptance test.

## Data and preservation

- Two sectors; three 1,000-customer waves each; company schema 100 fields and channel schema 88 fields.
- Pooled company files contain exactly 3,000 rows per sector. Channel files contain 4,837 banking and 4,576 mobile rows across waves. Every pooled file exactly concatenates its wave files.
- All 1,256,323 baseline company/channel values were preserved; including unchanged noncustomer data, 1,358,323 baseline cells were checked.
- All 1,428,344 separate customer and channel cells reconcile to the frozen combined representation. Parent independent reconciliation separately checked 1,428,344 cells with no errors.
- No random response generation was rerun. Original baseline files were hash-checked and remain untouched. Noncustomer data files and questionnaires are byte-identical copies.

## Workbook and metric checks

- Complete XLSX/CSV readback covered 3,088,780 cells, including all wave and pooled records, embedded codebooks, labels, MR sets, master metadata and references.
- All 26 XLSX files were checked for unexpected formula cells, Excel error cells and missing freeze panes. Raw datasets and acceptance references are deliberately static; they do not contain live forecast formulas.
- All 6,213 reference statistics were independently recalculated, including numerator, weighted base, raw base and expected result, within 0.000001.
- IDs, key uniqueness, all 13 shared context fields, labels, routes, dimensions, used/unused channels, journey anchors, comparable-task benchmark gates, emotion scales, promises not yet due and optional noncustomer eligibility passed.
- Wave workbooks, master codebooks and metric workbooks were authored and rendered using Artifact Tool. Pooled workbooks use lossless OOXML concatenation of those authored data rows, preserving identical styles and metadata, followed by complete readback and boundary checks.

## Scope and use

Updated DOCX documents were rendered and page-checked; unchanged optional noncustomer documents retain their earlier verified layout. Workbook views were visually reviewed. The supplied guides state the authorised future implementation tests; no Excel desktop/UI test, dashboard import, app change, deployment or Claude contact was performed here.

Import either three wave files or their pooled file, never both. Import either separate or combined representation, never both. Keep customer, latest-channel experience and noncustomer populations separate. See validation scripts and machine-readable reports in quality_checks.

What the tracker role recogniser reads (src/lib/trackerRoles.ts RoleVariable, built by roleVariablesFrom in
src/lib/trackerRoleVariables.ts) for raw files with no codebook, as the app's engine reads them (dictionary and
value_labels in api/parse-stats-file.py, 29 October 2026). Names, labels, answer labels and counts of distinct
values only; no respondent data. Grant (29 October 2026): "it will 90% be standard raw files".
- coffee_brand_tracker_oct2025.json: TestProjects/Brand Tracker/brand_tracker_Oct_2025.xlsx (no labels; brands in names).
- coffee_synthetic_03_rotated.json: TestProjects/Brand Tracker/Synthetic_Brand_Tracker_03_Rotated_Competitors.xlsx
  (codebook sheet inside the workbook; brands in the variable labels).
- csm_wave1_baseline.json: TestProjects/CSM Tracker/csm_Wave1_Baseline.xlsx (no labels; 0 to 10 ratings).
- banking_csm_relationship_csv.json: the banking CSM pack's Relationship wave 1 CSV, first 60 rows, no codebook.
- bmw_car_spss_labels_only.json: the BMW pack's wave 1 (first 60 rows) written as SPSS with its variable and
  answer labels and nothing else (no question numbers, types or multiple-response sets).
- bmw_car_csv_no_labels.json: the same wave as the plain CSV: brands only as _b01 to _b10.

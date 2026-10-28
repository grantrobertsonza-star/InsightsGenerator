# Indicator data fixtures (batch 54)

Small slices of published statistics, for the indicator reader (`api/parse-stats-file.py`,
`indicator_observations`) and its tests (`scripts/indicator_selftest.py`, `indicatorData*.test.ts`,
`e2e/ui/indicator-data.check.mjs`). Rows are copied unchanged from the files Grant supplied on
28 October 2026; only rows were left out.

| File | Source | Rows kept |
|---|---|---|
| `DHS_SD.csv` | World Bank Data360 DHS_SD, SDMX long download | areas AFG, COG, KEN, ZAF (all rows) |
| `DHS_SD_WIDEF.csv` | the same dataset, Data360 wide download | the same areas |
| `WB_FINDATA_WIDEF.csv` | World Bank Data360 WB_FINDATA, wide | USA and ZAF, indicators FD_FDI_OVRL and FD_SCOBIS01, including the blank "Missing value" (O) rows |
| `findex_ZAF_2024_indicator_percent.csv` | Global Findex 2025 country summary, label and value | the first 20 indicators |
| `findex_ZAF_2024_indicator_percent_by_topic.csv` | the same, with Topic and Sub Topic columns | the first 15 indicators |
| `DHS_SD_DATADICT.csv` | the Data360 data dictionary for DHS_SD (whole file) | not indicator data: must be refused |
| `IMF_STA_IL_slice.csv` | IMF data portal, IMF.STA:IL(13.0.1), wide, with byte-order mark | 7 series codes (GBR.RXF11ORA_REVS.USD in M, Q and A; GBR and ZAF RXF11FX_REVS; ZAF.RGV_REVS.FTO.A), all columns |
| `IMF_STA_WPAIAX_slice.csv` | IMF data portal, IMF.STA:WPAIAX(2.0.0), wide | the 12 GBR and ZAF series |
| `OECD_FDI_INC_AGGR_filtered_slice.csv` | OECD Data Explorer, FDI income main aggregates, "Filtered data" (codes and labels) | areas CHE, DEU, EST, GBR, NLD (EST has values withheld as confidential) |
| `OECD_FDI_INC_AGGR_reference.csv` | the same dataflow's "Unfiltered reference information" download | the whole file (79 rows, 157 KB): notes, read as notes, never as data |
| `WDI_layout_synthetic.csv` | written by hand in the WDI download layout | values invented for the layout test; not World Bank figures |

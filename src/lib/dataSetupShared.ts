export type DataUnit = "respondents" | "businesses" | "other";
export type DataLayout = "rows_are_cases" | "columns_are_cases";
export type DataMethod = "survey" | "panel" | "administrative" | "other";

export type DataSetup = {
  unit: DataUnit;
  layout: DataLayout;
  method: DataMethod;
  /** The researcher has checked the structure, preview and quality and accepted the data for analysis. */
  accepted: boolean;
};

export const DEFAULT_DATA_SETUP: DataSetup = {
  unit: "respondents",
  layout: "rows_are_cases",
  method: "survey",
  accepted: false,
};

export const UNIT_LABEL: Record<DataUnit, string> = {
  respondents: "People (respondents)",
  businesses: "Businesses or organisations",
  other: "Other units (households, stores, regions)",
};
export const LAYOUT_LABEL: Record<DataLayout, string> = {
  rows_are_cases: "Each row is one case, each column a variable",
  columns_are_cases: "Each column is one case, each row a variable (flipped)",
};
export const METHOD_LABEL: Record<DataMethod, string> = {
  survey: "Survey",
  panel: "Panel or tracking study",
  administrative: "Administrative or transactional records",
  other: "Other",
};

export function normaliseDataSetup(value: unknown): DataSetup {
  const v = (value ?? {}) as Partial<DataSetup>;
  return {
    unit: v.unit && v.unit in UNIT_LABEL ? v.unit : DEFAULT_DATA_SETUP.unit,
    layout: v.layout && v.layout in LAYOUT_LABEL ? v.layout : DEFAULT_DATA_SETUP.layout,
    method: v.method && v.method in METHOD_LABEL ? v.method : DEFAULT_DATA_SETUP.method,
    accepted: v.accepted === true,
  };
}

// The shapes and labels for per-variable overrides, split out from
// variableOverrides.ts so a client component can import them without
// pulling in that file's database access (withTenant/withTenantRead, which
// import pg) into the browser bundle. This file touches no database and no
// server-only API, so it is safe to import from "use client" components.
import type { VariableType } from "./dataQuality";
import type { ReverseCoding } from "./reverseCoding";

export type QuestionType = "single" | "multi" | "grid" | "battery";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: "Single mention",
  multi: "Multiple response",
  grid: "Grid",
  battery: "Battery",
};

export type VariableOverride = {
  type?: VariableType;
  questionType?: QuestionType;
  /** A confirmed reverse-coded battery item (reverseCoding.ts). */
  reverse?: ReverseCoding;
};

export type VariableOverrides = Record<string, VariableOverride>;

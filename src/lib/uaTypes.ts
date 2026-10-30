export type UaCondition =
  | { op: "codes"; variable: string; codes: string[] }
  | { op: "range"; variable: string; min: number; max: number }
  | { op: "answered"; variable: string }
  | { op: "all" | "any"; terms: UaCondition[] }
  | { op: "differentSets"; left: string[]; right: string[] };

export type UaField = {
  variable: string;
  label: string;
  questionId: string | null;
  options: { code: string; label: string }[];
  meta: Record<string, string | null>;
};
export type UaPageId = "footprint" | "repertoire" | "occasions" | "needs" | "memory" | "choice" | "experience" | "future" | "audiences";
export const UA_PAGES: { id: UaPageId; title: string; description: string }[] = [
  { id: "footprint", title: "Category footprint and size", description: "Consumption, personal purchase and the fictional planning universe." },
  { id: "repertoire", title: "Usage and brand repertoire", description: "Brands consumed and bought; overlapping repertoires and answered-value means." },
  { id: "occasions", title: "Occasions and context", description: "The most recent episode, never a share of all market occasions." },
  { id: "needs", title: "Needs, emotions and attitudes", description: "Stated attitudes, goals and the last occasion's sugar variant." },
  { id: "memory", title: "Brand memory and meaning", description: "Unprompted and prompted tasks with their assigned and eligible bases." },
  { id: "choice", title: "Choice, access and barriers", description: "Intentions and practical constraints, separated from historical behaviour." },
  { id: "experience", title: "Experience, repeat and switching", description: "Eligible users, verified buyers and recalled consecutive baskets; not churn." },
  { id: "future", title: "Future needs and deferred demand", description: "Use and purchase intent; postponed purchases are not guaranteed demand." },
  { id: "audiences", title: "Audiences", description: "Non-users, lapsed and light users, and buyers, with their stated barriers." },
];
export type UaMetricSpec = {
  id: string; label: string; page: UaPageId; variable: string;
  kind: "percent" | "mean" | "sum" | "verbatim"; unit: string;
  selectedCodes?: string[]; validCodes?: string[]; valueCondition?: UaCondition; valueVariables?: string[];
  assigned?: UaCondition; eligible?: UaCondition; answered?: UaCondition; logicalZero?: UaCondition;
  weightVar?: string | null; brandCode?: string; reason: string; period: string;
  note?: string; sourceQuestionIds: string[];
};
export type UaBase = { n: number; w: number; nEff: number };
export type UaMetric = {
  id: string; value: number | null; numerator: number | null;
  assignedBase: UaBase; eligibleBase: UaBase; validBase: UaBase;
  quotes?: { row: number; text: string; truncated?: boolean }[]; suppressed: boolean; reason: string | null; designApplied: boolean;
};
export type UaRecognition = {
  recognised: boolean; fields: UaField[]; reasons: string[];
  questions: { role: string; reason: string; candidates: string[] }[];
  brands: { code: string; label: string }[];
  roles: Record<string, string | null>; analysisWeight: string | null; populationWeight: string | null;
};
export type UaChoices = { focalBrand: string | null; weighted: boolean; roleCorrections: Record<string, string | null>; lightUserMaximum: number | null };
export type UaView = {
  recognition: UaRecognition; choices: UaChoices; revision: number | null;
  storageAvailable: boolean; metrics: UaMetricSpec[]; unavailable: { label: string; page: UaPageId; reason: string }[];
};
export type UaPage = { page: UaPageId; metrics: { spec: UaMetricSpec; result: UaMetric }[]; unavailable: UaView["unavailable"]; documentId: string; weightVar: string | null };

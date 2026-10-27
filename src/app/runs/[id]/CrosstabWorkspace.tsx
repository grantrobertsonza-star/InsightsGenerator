"use client";

import { EARLIER_METHOD_TEXT } from "@/lib/tableMethod";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ThreePane } from "./ThreePane";
import { useRouter } from "next/navigation";
import {
  addCrosstabAction,
  buildStarterTablesAction,
  commitCrosstabsAction,
  deleteCrosstabAction,
  deleteDraftCrosstabsAction,
  listCrosstabsAction,
  loadCategoriesAction,
  loadCrosstabAction,
  loadVariablesAction,
  setCrosstabTextAction,
  summarizeCrosstabAction,
  replicateCrosstabsToWaveAction,
} from "@/lib/crosstabActions";
import { listWaveFilesAction, type WaveFile } from "@/lib/waveTrackingActions";
import type { CrosstabInsights } from "@/lib/crosstabInsights";
import { QuickCharts, Histogram, buildRCode } from "./CrosstabExtras";
import FilterBuilder from "./CrosstabFilters";
import CrosstabAsk, { type AskHistory } from "./CrosstabAsk";
import { planStarterTables } from "@/lib/starterTables";
import { varTypeOf, type VarType } from "@/lib/crosstabVariableTypes";
import { listEvidenceTablesAction, promoteEvidenceTableAction, type EvidenceTableListing } from "@/lib/objectiveEvidenceActions";
import CrosstabOptions, { DEFAULT_CELLS, DEFAULT_STATS, STAT_LABELS, type CellPrefs, type StatPrefs } from "./CrosstabOptions";
import type { CrosstabListItem } from "@/lib/crosstabs";
import { detectSurveyDesign } from "@/lib/surveyDesign";
import { loadDataSetupStatusAction, saveDataSetupAction } from "@/lib/dataSetupActions";
import type { DataSetup, DataDesignChoice } from "@/lib/dataSetupShared";
import { resolveDesignPickerState } from "@/lib/dataSetupShared";
import { recordRequestedSave, reconcileSaveResponse } from "@/lib/saveResponseOrdering";
import type { ExpectedPreviousSetup } from "@/lib/dataSetup";
import type {
  CategoryList,
  CellBase,
  Correction,
  CrosstabDesc,
  CrosstabFilter,
  CrosstabGroup,
  CrosstabNet,
  CrosstabResult,
  CrosstabRowItem,
  VariableDictionary,
  VariableInfo,
  TableTest,
  VariableSet,
} from "@/lib/parseStatsFile";

const ROW_H = 40;

function correctionText(c: Correction | undefined): string {
  if (c === "fdr") return "false discovery rate correction (Benjamini-Hochberg) across the columns of each banner variable, per row";
  if (c === "bonferroni") return "Bonferroni correction across the columns of each banner variable, per row";
  return "uncorrected for multiple comparisons";
}
const LOW_BASE = 30;

type Entry =
  | { kind: "var"; v: VariableInfo; depth: 0 | 1 }
  | { kind: "set"; s: VariableSet; open: boolean };
type SortKey = "order" | "name" | "label" | "n" | "asked";
const VAR_TYPES: { key: VarType; label: string }[] = [
  { key: "single", label: "Single choice" },
  { key: "multi", label: "Multiple response sets" },
  { key: "rating", label: "Rating scales" },
  { key: "numeric", label: "Numeric measures" },
  { key: "grid", label: "Grids and batteries" },
  { key: "text", label: "Text answers" },
  { key: "weight", label: "Weights" },
];
type Stat = "col" | "row" | "count" | "stack";
/** What one answer row can show in each cell. Several at once in the stacked view. */
type MeasureKey = "col" | "row" | "n" | "count" | "letters" | "base" | "resp" | "residual";
const MEASURE_LABEL: Record<MeasureKey, string> = {
  col: "% within column",
  row: "% within row",
  n: "n",
  count: "Weighted count",
  letters: "Column comparisons",
  resp: "% of responses",
  residual: "Standardized residual",
  base: "",
};
/** The figures of one cell, whether it is a banner column or the NET column of a banner variable. */
type CellData = {
  pct: number | null | undefined;
  rowPct: number | null | undefined;
  count: number | null | undefined;
  nCell: number | null | undefined;
  respPct?: number | null;
  base: CellBase;
  sig: number;
  letters: string | undefined;
  residual?: number | null;
};
/** The table cell the researcher clicked, shown in the detail pane beside the workspace. */
type CellSel = {
  key: string;
  question: string;
  row: string;
  column: string;
  banner: string;
  cell: CellData;
  p: number | null;
  pAdj: number | null | undefined;
  totalPct: number | null;
  thin: boolean;
  peers: { label: string; pct: number | null; n: number }[];
};
const CellSelectContext = createContext<{ sel: CellSel | null; select: (s: CellSel | null) => void }>({
  sel: null,
  select: () => {},
});

type LayoutEntry =
  | { kind: "col"; c: CrosstabResult["columns"][number]; j: number }
  | { kind: "net"; block: number };

/** One decimal under 1% so "none" and "a few in a thousand" differ. */
const fmtPct = (v: number) => (v === 0 ? "0" : v.toFixed(1));
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Crosstab workspace for case-level files (SPSS, Stata, CSV and Excel; SAS imports are refused, importLimits.ts).
 * Left: every variable in a sortable table (name, label, responses, asked of).
 * Right: choose banner (column) variables and row questions, add the table to
 * a draft set, review each one, then commit the set to generate findings.
 * Multiple-response questions keep every option, each on its own base.
 */
export default function CrosstabWorkspace({
  runId,
  documentId,
  filename,
  onClose,
  layout = "overlay",
  fileSelector,
}: {
  runId: string;
  documentId: string;
  filename: string;
  saved?: { id: string; label: string }[];
  /** Overlay only: closes the full-window workspace. */
  onClose?: () => void;
  /**
   * "page": the Cross tabs section itself (Grant, 2026-10-20: open the workspace directly rather
   * than through a gateway page), laid out in the shared resizable panes, with the file chooser in
   * its header and no Close, as it is a page of the project. "overlay": the full-window workspace
   * opened from a data file's launcher elsewhere, unchanged.
   */
  layout?: "overlay" | "page";
  /** Page layout: the data file chooser, shown beside the title. */
  fileSelector?: ReactNode;
}) {
  const asPage = layout === "page";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dict, setDict] = useState<VariableDictionary | null>(null);
  const [items, setItems] = useState<CrosstabListItem[]>([]);
  const [query, setQuery] = useState("");
  const [fullOnly, setFullOnly] = useState(false);
  const [entry, setEntry] = useState<"ask" | "build" | "starter" | "objectives" | "all">("build");
  const [evidenceTabs, setEvidenceTabs] = useState<EvidenceTableListing[]>([]);
  const [cellPrefs, setCellPrefs] = useState<CellPrefs>(DEFAULT_CELLS);
  const [cellNet, setCellNet] = useState(true);
  const [statPrefs, setStatPrefs] = useState<StatPrefs>(DEFAULT_STATS);
  const [typeFilter, setTypeFilter] = useState<"all" | VarType>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "order", dir: 1 });
  const [openSets, setOpenSets] = useState<Set<string>>(new Set());
  const [columnVars, setColumnVars] = useState<string[]>([]);
  const [rowItems, setRowItems] = useState<CrosstabRowItem[]>([]);
  const [weightChoice, setWeightChoice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [netFor, setNetFor] = useState<CrosstabRowItem | null>(null);
  const [nets, setNets] = useState<CrosstabNet[]>([]);
  const [colGroups, setColGroups] = useState<Record<string, CrosstabGroup[]>>({});
  const [grouping, setGrouping] = useState<{ variable: string; target: "col" | "row" } | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [collapseAll, setCollapseAll] = useState<{ open: boolean; tick: number }>({ open: true, tick: 0 });
  const [layerVar, setLayerVar] = useState("");
  const [waveFiles, setWaveFiles] = useState<WaveFile[]>([]);
  const [copyFrom, setCopyFrom] = useState("");
  const [copying, setCopying] = useState(false);

  const refreshList = (added?: string) =>
    startTransition(async () => {
      const r = await listCrosstabsAction(runId, documentId);
      if (!r.ok) return setError(r.error);
      setItems(r.items);
      if (added) setLastAdded(added);
    });

  useEffect(() => {
    // A page keeps the browser's own scrolling and keys; only the full-window overlay takes them.
    if (asPage || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, asPage]);

  useEffect(() => {
    // Overnight queue, package 4 (IMP-014/ANA-NPS-003): a documentId switch (the researcher
    // picks a different file from the wave selector) previously left the PSU/strata/no-design
    // picker state exactly as the PREVIOUS document had set it, because this effect only wrote
    // those setters when the new document's own persisted design matched one of its two known
    // shapes - so a document with no persisted design at all (the common case) silently kept
    // showing and would even re-save whatever the prior document's choice was, onto the wrong
    // document. Every branch below is now unconditional: a design-less document explicitly
    // clears the picker back to "not yet decided" rather than leaving it untouched. `cancelled`
    // guards against a late response from a document the researcher has since switched away
    // from landing after a newer load's response and clobbering it (switching A -> B -> A
    // quickly could otherwise let B's slow response overwrite A's already-current state).
    //
    // Brief 38 repair (Codex re-review of Brief 37, item 1): `cancelled` only protects against
    // a response arriving after THIS effect instance has been torn down (i.e. the researcher
    // has since switched to a different document). It does nothing for a SECOND visit to the
    // SAME document (A -> B -> A) where no new save was issued during the reopened visit - the
    // stale save response from the FIRST visit to A would still look "current" to the save
    // effect's own seq-based checks, because no new seq has been recorded for A's reopening.
    // `visitRef` is a monotonic counter incremented once per effect run (i.e. once per document
    // transition, including a transition back to a document already visited), and is now bound
    // into the save effect below so a response is only reconciled when its visit still matches.
    //
    // Separately: hydration itself can race a live edit. If the researcher touches the design
    // picker while THIS load is still in flight, the load resolving afterward must not reset
    // `designTouchedRef` or overwrite the picker with the (now-stale) loaded value - that would
    // silently discard an edit already made. `designTouchedRef.current` is reset to false here,
    // synchronously, at the moment this visit's load BEGINS (not when it resolves), so "has the
    // researcher edited since loading began" has an unambiguous start point rather than carrying
    // over a touch from a previous document's visit or losing a touch that happens mid-load.
    let cancelled = false;
    visitRef.current += 1;
    const myVisit = visitRef.current;
    designTouchedRef.current = false;
    startTransition(async () => {
      const [v, l, s] = await Promise.all([
        loadVariablesAction(runId, documentId),
        listCrosstabsAction(runId, documentId),
        loadDataSetupStatusAction(runId, documentId),
      ]);
      if (cancelled) return;
      if (v.ok) setDict(v.dictionary);
      else setError(v.error);
      if (l.ok) setItems(l.items);
      else setError(l.error);
      if (!s.ok) {
        // Overnight queue, package 4: previously this lookup failure was swallowed inside
        // loadDataSetup/loadDataSetupAction and indistinguishable from "nothing saved yet,"
        // so a real failure (missing migration, dropped connection, permission error) showed
        // as a quiet fallback to defaults rather than a visible problem.
        setError(`Could not load this file's saved set-up (showing defaults instead): ${s.error}`);
      }
      lastSavedSetupRef.current = s.ok ? { documentId, setup: s.setup } : null;
      setSetup(s.setup);
      // Brief 38: only apply the loaded design to the live picker - and only treat this visit's
      // touched flag as still "untouched" - when the researcher has not already edited the
      // picker since this visit's hydration began (see the reset above). A touch mid-load means
      // the researcher has already made, or started making, a choice the save effect will
      // persist; overwriting the picker here would silently discard that choice, and resetting
      // the touched flag (which only the reset at the top of this effect does now) would be
      // wrong to repeat here regardless.
      if (myVisit === visitRef.current && !designTouchedRef.current) {
        applyDesignPickerState(s.setup.design);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runId, documentId]);

  // Other wave files in this run, so a saved table set can be replayed onto a new wave rather
  // than rebuilt by hand. Silent when the run has no wave-labelled files at all.
  useEffect(() => {
    listWaveFilesAction(runId).then((r) => {
      // Any labelled wave can be copied from, including one left out of wave tracking.
      if (r.ok) setWaveFiles([...r.files, ...r.excluded]);
    });
  }, [runId]);
  const otherWaves = waveFiles.filter((w) => w.documentId !== documentId);

  function copyFromWave() {
    if (!copyFrom) return;
    setError(null);
    setMessage(null);
    setCopying(true);
    startTransition(async () => {
      const r = await replicateCrosstabsToWaveAction(runId, copyFrom, documentId);
      setCopying(false);
      if (!r.ok) return setError(r.error);
      const skippedText = r.skipped.length
        ? ` ${r.skipped.length} could not be rebuilt here: ${r.skipped.map((s) => `${s.label} (${s.reason})`).join("; ")}`
        : "";
      setMessage(`Copied ${r.built} table(s) from that wave as drafts.${skippedText}`);
      refreshList();
    });
  }

  const byName = useMemo(() => new Map((dict?.variables ?? []).map((v) => [v.name, v])), [dict]);
  const setByKeyTop = useMemo(() => new Map((dict?.sets ?? []).map((s) => [s.key, s])), [dict]);
  /** Shows a column-var chip's label, whether it is a plain variable or a "set:<key>" MR banner reference. */
  const columnVarLabel = (n: string): string =>
    n.startsWith("set:") ? (setByKeyTop.get(n.slice(4))?.label ?? n.slice(4)) : (byName.get(n)?.label ?? n);
  const weights = useMemo(() => (dict?.variables ?? []).filter((v) => v.weightLike), [dict]);
  const [cellSel, setCellSel] = useState<CellSel | null>(null);
  const [correction, setCorrection] = useState<Correction>("fdr");
  // Don't know, refused and not applicable stay out of percentage bases unless the researcher asks for them.
  const [excludeDk, setExcludeDk] = useState(true);
  const [filters, setFilters] = useState<CrosstabFilter[]>([]);
  // SemanticTabs' earlier requests (CrosstabAsk), kept here so they outlive the panel.
  const [askHistory, setAskHistory] = useState<AskHistory>({ documentId, items: [] });
  // Survey design for Taylor series variance. Suggested from the variable names, via the same
  // heuristic (./lib/surveyDesign) every automatic caller (NPS, Objectives, brand health, CSM,
  // wave tracking) now resolves through too - previously this workspace kept its own inline copy
  // of this regex heuristic, which is the "a parallel path still uses the old behaviour" pattern
  // the counter-review kept finding. ANA-NPS-003: a PSU found with no strata (or vice versa) is
  // now suggested on its own - a design with clustering only, or stratification only, has a
  // defined default here just like one with both; detected.psu/strata are independently null
  // only when their own role's candidates were absent or ambiguous (detectSurveyDesign never
  // guesses between several candidates), in which case the field is simply left blank for a
  // person to fill in rather than defaulted to a possibly-wrong guess.
  const detected = useMemo(() => detectSurveyDesign({ variables: dict?.variables ?? [] }), [dict]);
  const [setup, setSetup] = useState<DataSetup | null>(null);
  const [psuChoiceRaw, setPsuChoiceRaw] = useState<string | null>(null);
  const [strataChoiceRaw, setStrataChoiceRaw] = useState<string | null>(null);
  const [noDesignChosen, setNoDesignChosenRaw] = useState(false);
  // Codex re-review, package 4 (cross-tab handover repair): the one place that writes the three
  // raw picker setters from a DataSetup.design value - used by BOTH the hydration effect (a new
  // document's own persisted setting, or nothing) and the save effect's conflict branch (a
  // concurrent change adopted from elsewhere). Previously each site had its own copy of this
  // three-way branch, and both copies independently omitted the same third case: when design is
  // absent, "auto", or any other non-explicit/non-none shape, neither copy reset the picker at
  // all, leaving whatever the PREVIOUS document (hydration) or the PREVIOUS choice (conflict)
  // had shown still displayed as if it still applied. All three branches are now unconditional,
  // and a single shared function means this cannot drift out of sync between the two call sites
  // again.
  const applyDesignPickerState = (design: DataDesignChoice | null | undefined) => {
    const next = resolveDesignPickerState(design);
    setPsuChoiceRaw(next.psuChoice);
    setStrataChoiceRaw(next.strataChoice);
    setNoDesignChosenRaw(next.noDesignChosen);
  };
  // ANA-NPS-003 (second counter-review): true only once a person has actually touched one of the
  // three design controls (or the initial load set them from a persisted choice is excluded by
  // design - see the loader above, which writes state directly without going through these
  // wrappers). Gates the persistence effect below so merely opening this workspace never writes
  // a design setting nobody chose.
  const designTouchedRef = useRef(false);
  // Overnight queue, package 4 (IMP-014): what this workspace last saw persisted for THIS
  // document - either from the hydration load above, or from this workspace's own last
  // successful save - carried alongside the documentId it belongs to so a save effect that
  // fires after the researcher has since switched documents never applies its compare-and-
  // swap `expected` value, or its result, against the wrong document. Null means either
  // nothing has been loaded yet or the load itself failed (see the hydrate effect), in which
  // case the save below treats it as "unknown" and does not attempt a save at all rather than
  // guessing at an `expected` value it never actually saw.
  const lastSavedSetupRef = useRef<{ documentId: string; setup: DataSetup } | null>(null);
  // Always the documentId prop as of the most recent render - read inside the save effect's
  // async callback above to detect a stale (superseded) response after a document switch.
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  // Codex re-review, package 4 (cross-tab handover repair): the documentId check alone only
  // protects against a response arriving after the researcher has switched to a DIFFERENT
  // document - it does nothing for two save requests issued for the SAME document (the
  // researcher pauses, edits, pauses again, each pause's own debounce firing its own request),
  // where a slow network can still let the OLDER request's response land after the NEWER
  // request's response already applied. saveSeqRef is a monotonic counter shared by every save
  // this effect schedules; appliedSeqByDocRef records, per document, the highest sequence number
  // whose response has actually been applied, so an out-of-order late response is recognised and
  // discarded rather than overwriting state a newer response already set.
  const saveSeqRef = useRef(0);
  const appliedSeqByDocRef = useRef<Map<string, number>>(new Map());
  // IMP-014 (Brief 37 repair): the latest save REQUESTED (scheduled) per document, recorded the
  // moment a save is scheduled - see reconcileSaveResponse's own comment for why this, not just
  // appliedSeqByDocRef, is what a response must be checked against.
  const requestedSeqByDocRef = useRef<Map<string, number>>(new Map());
  // Brief 38 (IMP-014, Codex re-review of Brief 37, item 1): incremented once per hydration
  // effect run - i.e. once per document transition, including a transition back to a document
  // already visited (A -> B -> A). Read fresh by the save effect below at both schedule time
  // and response time, and by the hydration effect itself, to recognise a response (hydration
  // or save) that belongs to a visit the researcher has since moved past, even when the
  // document id itself is unchanged and no new save has been scheduled for the reopened visit.
  const visitRef = useRef(0);
  const setPsuChoice = (v: string | null) => {
    designTouchedRef.current = true;
    setNoDesignChosenRaw(false);
    setPsuChoiceRaw(v);
  };
  const setStrataChoice = (v: string | null) => {
    designTouchedRef.current = true;
    setNoDesignChosenRaw(false);
    setStrataChoiceRaw(v);
  };
  const setNoDesignChosen = (v: boolean) => {
    designTouchedRef.current = true;
    setNoDesignChosenRaw(v);
  };
  const psuChoice = psuChoiceRaw;
  const strataChoice = strataChoiceRaw;
  const psuVar = psuChoice ?? detected.psu ?? "";
  const strataVar = strataChoice ?? detected.strata ?? "";
  // ANA-NPS-003 (second counter-review): a strata-only choice (no PSU/clustering variable, a
  // stratification variable alone) is a real, supported design - the engine treats each case as
  // its own primary sampling unit within its stratum in that case (_Design.build). Previously this
  // required a non-empty psuVar, so choosing strata alone silently fell back to "weights only"
  // with no indication why, even though the researcher had made an explicit, valid choice.
  const designOk = !noDesignChosen && (psuVar !== "" ? byName.has(psuVar) : strataVar !== "") && (strataVar === "" || byName.has(strataVar));

  // ANA-NPS-003 (second counter-review): persists the researcher's design choice against this
  // document (DataSetup.design) once they have actually touched one of the three controls, so the
  // NPS tool, Objectives and the distribution chart - none of which expose a design picker of
  // their own - pick it up the next time they run (via effectiveDesignChoice, ./surveyDesign)
  // instead of only ever guessing from variable names. Debounced so every keystroke in the PSU/
  // strata text inputs doesn't fire its own save; only a complete, valid choice (designOk) or the
  // explicit "weights only" choice is persisted - an incomplete or invalid in-progress edit is
  // left unsaved rather than overwriting a previously good setting with garbage.
  useEffect(() => {
    if (!designTouchedRef.current || !setup) return;
    const design: DataDesignChoice | null = noDesignChosen
      ? { mode: "none", psu: null, strata: null }
      : designOk
        ? { mode: "explicit", psu: psuVar || null, strata: strataVar || null }
        : null;
    if (!design) return;
    // Overnight queue, package 4 (IMP-014): "the newer workspace save caller omits
    // compare-and-swap, ignores save results and can retain an older configuration after
    // reordered saves." Fixed by: (1) capturing the documentId this save is FOR at the time
    // it is scheduled, so a response that arrives after the researcher has switched documents
    // is recognised as stale and discarded rather than applied to whatever document happens to
    // be open when it lands; (2) passing `expected` from the last value this workspace actually
    // saw persisted for this same document, turning the write into a real compare-and-swap
    // instead of an unconditional overwrite that can silently stomp a change that landed from
    // elsewhere (another tab, another tool) in between; (3) reading and acting on the save's
    // result instead of discarding it - a conflict adopts the actual current value and surfaces
    // it, exactly like the established TranscriptSetup/AcceptDataButton pattern this mirrors,
    // rather than leaving the UI showing a choice that was never actually written.
    const savingForDocumentId = documentId;
    const expectedAtScheduling = lastSavedSetupRef.current;
    const expected: ExpectedPreviousSetup =
      expectedAtScheduling && expectedAtScheduling.documentId === savingForDocumentId
        ? { kind: "value", setup: expectedAtScheduling.setup }
        : { kind: "none" };
    const nextSetup = { ...setup, design };
    const mySeq = ++saveSeqRef.current;
    // Brief 38: the visit this save was scheduled under - captured now, synchronously, exactly
    // like mySeq - so a response is only reconciled when the workspace is still on this same
    // visit to this document (see reconcileSaveResponse's own comment for why seq alone cannot
    // catch a reopened visit).
    const savingForVisit = visitRef.current;
    // IMP-014: recorded at SCHEDULE time, not when the network call resolves - a later save
    // scheduled for this document (even one still debouncing, or still in flight) must be able
    // to supersede this one's response before that response has even come back.
    recordRequestedSave(requestedSeqByDocRef.current, savingForDocumentId, mySeq);
    const t = setTimeout(() => {
      saveDataSetupAction(runId, savingForDocumentId, nextSetup, expected).then((r) => {
        const outcome = r.ok
          ? ({ kind: "success", setup: nextSetup } as const)
          : r.conflict
            ? ({ kind: "conflict", current: r.current ?? nextSetup } as const)
            : ({ kind: "failure", error: r.error } as const);
        // IMP-014 (Brief 37 repair): one shared gate for every outcome - success, conflict and
        // failure alike - so "newer success, conflict and failure each reconcile the picker and
        // saved-state reference consistently" holds by construction rather than by three inline
        // branches that could drift. See reconcileSaveResponse's own comment for what it checks
        // and why (document switch, latest-requested, already-applied) and for how this also
        // covers A -> B -> A document switching without a separate case.
        const decision = reconcileSaveResponse(
          { requestedSeqByDoc: requestedSeqByDocRef.current, appliedSeqByDoc: appliedSeqByDocRef.current },
          {
            currentDocumentId: documentIdRef.current,
            savingForDocumentId,
            seq: mySeq,
            outcome,
            currentVisit: visitRef.current,
            savingForVisit,
          },
        );
        if (decision.action === "ignore") return;
        if (decision.action === "apply-success") {
          lastSavedSetupRef.current = { documentId: savingForDocumentId, setup: decision.setup };
          return;
        }
        if (decision.action === "apply-conflict") {
          // Another save (another tab, or a reordered earlier request from this one) already
          // changed this document's set-up since the value this save was compared against.
          // Adopt what is actually persisted rather than silently leaving the UI showing a
          // design choice that was never written, and don't keep retrying against a value we
          // now know is stale.
          lastSavedSetupRef.current = { documentId: savingForDocumentId, setup: decision.setup };
          setSetup(decision.setup);
          // Codex re-review, package 4: previously this branch only handled "explicit" and
          // "none" - a conflict that resolved to no design at all (absent, or "auto") left
          // whatever the researcher had been looking at still showing in the picker, as if it
          // still applied. applyDesignPickerState's third branch now covers that case too.
          applyDesignPickerState(decision.setup.design);
          setError("This file's survey-design set-up changed elsewhere just now; showing the latest version. Make your change again if it's still needed.");
          return;
        }
        setError(decision.error);
      });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psuChoice, strataChoice, noDesignChosen]);

  const designAmbiguous = psuChoice === null && (detected.psuCandidates.length > 1 || detected.strataCandidates.length > 1);
  const weightVar =
    weightChoice ??
    (weights.find((w) => /bench|person/i.test(`${w.name} ${w.label}`)) ?? weights[0])?.name ??
    "";

  // Table rows: singles and sets (sets expand to their options).
  const entries = useMemo<Entry[]>(() => {
    if (!dict) return [];
    const q = query.trim().toLowerCase();
    const match = (name: string, label: string) =>
      !q || name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    const sets = dict.sets ?? [];
    const setByKey = new Map(sets.map((s) => [s.key, s]));
    const top: Entry[] = [];
    const seen = new Set<string>();
    for (const v of dict.variables) {
      const vSet = v.inSet ? setByKey.get(v.inSet) : undefined;
      const t = varTypeOf(v, vSet);
      if (t === "weight" ? typeFilter !== "weight" : false) continue;
      if (t !== "weight" && t !== "text" && v.nDistinct < 2 && !v.inSet) continue;
      if (t === "text" && typeFilter !== "text") continue;
      if (typeFilter !== "all" && t !== typeFilter) continue;
      if (v.inSet && setByKey.has(v.inSet)) {
        if (seen.has(v.inSet)) continue;
        seen.add(v.inSet);
        const s = setByKey.get(v.inSet)!;
        const members = s.vars.map((n) => byName.get(n)).filter((m): m is VariableInfo => !!m);
        if (match(s.key, s.label) || members.some((m) => match(m.name, m.label)))
          top.push({ kind: "set", s, open: openSets.has(s.key) });
        continue;
      }
      if (fullOnly && v.pctValid < 90) continue;
      if (match(v.name, v.label)) top.push({ kind: "var", v, depth: 0 });
    }
    const keyOf = (e: Entry) =>
      e.kind === "var"
        ? { name: e.v.name, label: e.v.label, n: e.v.nValid, asked: e.v.pctValid }
        : { name: e.s.key, label: e.s.label, n: e.s.nValid, asked: e.s.pctValid };
    if (sort.key !== "order") {
      top.sort((a, b) => {
        const ka = keyOf(a)[sort.key as Exclude<SortKey, "order">];
        const kb = keyOf(b)[sort.key as Exclude<SortKey, "order">];
        return (typeof ka === "number" ? ka - (kb as number) : String(ka).localeCompare(String(kb))) * sort.dir;
      });
    }
    const flat: Entry[] = [];
    for (const e of top) {
      flat.push(e);
      if (e.kind === "set" && e.open) {
        for (const n of e.s.vars) {
          const m = byName.get(n);
          if (m) flat.push({ kind: "var", v: m, depth: 1 });
        }
      }
    }
    return flat;
  }, [dict, byName, query, fullOnly, typeFilter, sort, openSets]);

  // How many rows each type would show, given the search box and "Asked of nearly everyone".
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    if (!dict) return c;
    const q = query.trim().toLowerCase();
    const match = (name: string, label: string) =>
      !q || name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    const setByKey = new Map((dict.sets ?? []).map((s) => [s.key, s]));
    const seen = new Set<string>();
    for (const v of dict.variables) {
      const vSet = v.inSet ? setByKey.get(v.inSet) : undefined;
      const t = varTypeOf(v, vSet);
      if (t !== "weight" && t !== "text" && v.nDistinct < 2 && !v.inSet) continue;
      if (vSet) {
        if (seen.has(vSet.key)) continue;
        seen.add(vSet.key);
        const members = vSet.vars.map((n) => byName.get(n)).filter((m): m is VariableInfo => !!m);
        if (!(match(vSet.key, vSet.label) || members.some((m) => match(m.name, m.label)))) continue;
      } else {
        if (fullOnly && v.pctValid < 90) continue;
        if (!match(v.name, v.label)) continue;
      }
      c[t] = (c[t] ?? 0) + 1;
      if (t !== "weight" && t !== "text") c.all += 1;
    }
    return c;
  }, [dict, byName, query, fullOnly]);

  // Windowed rendering: only the visible slice of a long variable list is drawn.
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // Width of the list's scrollbar, so the header columns line up with the rows beneath it.
  const [sbw, setSbw] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setSbw(el.offsetWidth - el.clientWidth);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [dict]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const end = Math.min(entries.length, start + Math.ceil(viewH / ROW_H) + 12);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  function toggleSet(key: string) {
    setOpenSets((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleRow(item: CrosstabRowItem) {
    setRowItems((r) => (r.some((x) => x.key === item.key) ? r.filter((x) => x.key !== item.key) : [...r, item]));
  }

  function useAsked(plan: import("@/lib/crosstabAsk").AskPlan, run: boolean) {
    const cols = plan.columns.map((c) => c.name);
    setColumnVars(cols);
    setRowItems(plan.rows);
    setFilters(plan.filters);
    if (run) addTable({ columnVars: cols, rowItems: plan.rows, filters: plan.filters });
    else {
      setEntry("build");
      setMessage("Filled the workspace from your request. Check it, then press Add table to set.");
    }
  }

  function addTable(over?: { columnVars: string[]; rowItems: CrosstabRowItem[]; filters?: CrosstabFilter[] }) {
    const fl = over?.filters ?? filters;
    let cv = over?.columnVars ?? columnVars;
    let ri = over?.rowItems ?? rowItems;
    // Only columns chosen: describe each of those variables on its own, as rows. Not for a
    // multiple-response banner set ("set:<key>"): that is a real banner, not a row variable.
    if (ri.length === 0 && nets.length === 0 && cv.length > 0 && !cv.some((n) => n.startsWith("set:"))) {
      ri = cv.map((n) => ({ key: n, label: byName.get(n)?.label ?? n, vars: [n] }));
      cv = [];
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const allRows: CrosstabRowItem[] = nets.length
        ? [...ri, { key: `nets-${Date.now()}`, label: "Nets", vars: [], kind: "nets", nets }]
        : ri;
      const base = {
        source: (entry === "ask" ? "ask" : "workspace") as "ask" | "workspace",
        columnVars: cv,
        rowItems: allRows,
        weightVar: weightVar || null,
        correction,
        excludeDk,
        ...(designOk ? { design: { psu: psuVar || null, strata: strataVar || null } } : {}),
        columnGroups: Object.fromEntries(Object.entries(colGroups).filter(([k, g]) => cv.includes(k) && g.length)),
      };
      if (!layerVar) {
        const r = await addCrosstabAction(runId, documentId, { ...base, ...(fl.length ? { filters: fl } : {}) });
        if (!r.ok) return setError(r.error);
        const skipped = r.skipped.length ? ` Skipped: ${r.skipped.map((s) => s.variable).join(", ")}.` : "";
        setMessage(`Added a table with ${r.questions} question(s).${skipped}`);
        setRowItems([]);
        setNets([]);
        refreshList(r.tableId);
        return;
      }
      // Layered: one saved table per category of the layer variable, SPSS-style, sharing a
      // layerGroup id so the list can show them together.
      const catsR = await loadCategoriesAction(runId, documentId, layerVar);
      if (!catsR.ok) return setError(catsR.error);
      const cats = catsR.list.categories;
      if (cats.length < 2) return setError(`${catsR.list.label} does not have enough categories to use as a layer.`);
      const layerLabel = catsR.list.label;
      const layerGroup = `layer-${Date.now()}`;
      let lastTableId: string | null = null;
      let totalQuestions = 0;
      const allSkipped: { variable: string; reason: string }[] = [];
      const failures: string[] = [];
      for (const cat of cats) {
        const r = await addCrosstabAction(runId, documentId, {
          ...base,
          filters: [...fl, { variable: layerVar, op: "in", values: [cat.label] }],
          layerGroup,
          layerVariable: layerVar,
          layerLabel,
          layerCategory: cat.label,
        });
        if (!r.ok) {
          failures.push(`${cat.label}: ${r.error}`);
          continue;
        }
        lastTableId = r.tableId;
        totalQuestions += r.questions;
        allSkipped.push(...r.skipped);
      }
      if (!lastTableId) return setError(`No layer category produced a table. ${failures.join(" ")}`);
      const skippedText = allSkipped.length ? ` Skipped: ${Array.from(new Set(allSkipped.map((s) => s.variable))).join(", ")}.` : "";
      const failedText = failures.length ? ` ${failures.length} categor${failures.length === 1 ? "y" : "ies"} could not be tabulated.` : "";
      setMessage(`Added ${cats.length - failures.length} layered table(s) by ${layerLabel}, ${totalQuestions} question(s) in all.${skippedText}${failedText}`);
      setRowItems([]);
      setNets([]);
      refreshList(lastTableId);
    });
  }

  function commit() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await commitCrosstabsAction(runId, documentId);
      if (!r.ok) return setError(r.error);
      setMessage(`Committed ${r.tables} table(s). ${r.findings} finding(s) generated.`);
      refreshList();
      router.refresh();
    });
  }

  function buildStarter() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await buildStarterTablesAction(
        runId,
        documentId,
        {
          weightVar: weightVar || null,
          correction,
          excludeDk,
          ...(designOk ? { design: { psu: psuVar || null, strata: strataVar || null } } : {}),
        },
        starterBanners ?? undefined,
      );
      if (!r.ok) return setError(r.error);
      setMessage(`Added ${r.tables} starter table(s) as drafts, ${r.questions} question(s) each. Review them, delete what you do not need, then commit.`);
      refreshList();
      router.refresh();
    });
  }

  function deleteDrafts() {
    if (!window.confirm(`Delete all ${drafts.length} draft table(s)? Committed tables and their findings are kept.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteDraftCrosstabsAction(runId, documentId);
      if (!r.ok) return setError(r.error);
      setMessage(`Deleted ${r.deleted} draft table(s).`);
      refreshList();
      router.refresh();
    });
  }

  function remove(it: CrosstabListItem) {
    const warn =
      it.status === "committed" && it.findings > 0
        ? `Delete this table and its ${it.findings} finding(s)?`
        : "Delete this table?";
    if (!window.confirm(warn)) return;
    startTransition(async () => {
      const r = await deleteCrosstabAction(runId, it.id);
      if (!r.ok) return setError(r.error);
      refreshList();
      router.refresh();
    });
  }

  const drafts = items.filter((i) => i.status === "draft" && !i.legacy);
  // Each way of making tables shows only its own tables; "All tables" shows the lot.
  const evidenceIds = new Set(evidenceTabs.filter((t) => t.status !== "evidence").map((t) => t.table_id));
  const visible =
    entry === "all"
      ? items
      : entry === "objectives"
        ? items.filter((i) => evidenceIds.has(i.id))
        : items.filter((i) => i.source === (entry === "build" ? "workspace" : entry));
  const loadEvidenceTabs = () =>
    void listEvidenceTablesAction(runId, documentId).then((r) => {
      if (r.ok) setEvidenceTabs(r.tables);
    });
  useEffect(() => {
    if (entry === "objectives") loadEvidenceTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, runId, documentId]);
  const modeName = { build: "CrossTabs", ask: "SemanticTabs", starter: "StarterTabs", objectives: "ObjectiveTabs", all: "All tables" }[entry];
  // The starter set's columns to split by: null for the recognised ones (demographics and customer
  // groupings), or the researcher's choice from the file's candidates. Kept with its file, so a
  // choice made on one file is not applied to another.
  const [starterChoice, setStarterChoice] = useState<{ documentId: string; names: string[] } | null>(null);
  const starterBanners = starterChoice && starterChoice.documentId === documentId ? starterChoice.names : null;
  const setStarterBanners = (names: string[] | null) => setStarterChoice(names ? { documentId, names } : null);
  // The column chooser opens by itself when nothing is recognised; once the researcher opens,
  // closes or uses it, it stays as they left it (choosing a first column must not fold it away).
  const [starterChooserOpen, setStarterChooserOpen] = useState<boolean | null>(null);
  const starterPlan = useMemo(() => (dict ? planStarterTables(dict, starterBanners ?? undefined) : null), [dict, starterBanners]);
  const hasStarter = items.some((i) => i.label.startsWith("Starter:"));
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const btn = (on: boolean) =>
    `rounded border px-2 py-0.5 text-[11px] ${on ? "border-primary bg-primary text-white" : "border-border hover:border-slate-400"}`;

  // The choices that change what every table means, said in one line that is always in view
  // (Grant's review, 2026-10-20), so collapsing the settings never hides them. An unresolved design
  // choice (several candidates, or a named variable not found) keeps the settings open.
  const designText = noDesignChosen
    ? "none (weights only)"
    : designOk
      ? `Taylor series (${[psuVar && `PSU ${psuVar}`, strataVar && `strata ${strataVar}`].filter(Boolean).join(", ")})`
      : psuVar || strataVar
        ? "variable not found"
        : "not set (weights only)";
  const designUnresolved = designAmbiguous || (!noDesignChosen && !designOk && (psuVar !== "" || strataVar !== ""));
  const settingsSummary = (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" data-testid="crosstab-settings-summary">
      <span>
        <span className="font-medium text-foreground">Weight:</span> {weightVar ? (weights.find((w) => w.name === weightVar)?.label ?? weightVar) : "none (unweighted)"}
      </span>
      <span className={designUnresolved ? "font-medium text-amber-800" : undefined}>
        <span className="font-medium text-foreground">Survey design:</span> {designText}
        {designAmbiguous ? ", several candidates: choose one" : ""}
      </span>
      <span>
        <span className="font-medium text-foreground">Non-answers:</span> {excludeDk ? "excluded from bases" : "included as an answer"}
      </span>
      <span>
        <span className="font-medium text-foreground">Filters:</span> {filters.length === 0 ? "none" : `${filters.length} applied`}
      </span>
      <span>
        <span className="font-medium text-foreground">Comparisons:</span> {correction === "fdr" ? "false discovery rate correction" : correction === "bonferroni" ? "Bonferroni correction" : "uncorrected"}
      </span>
      {/* The controls sit in Table settings, below the rows and columns; this goes straight to them. */}
      <button
        type="button"
        onClick={() => {
          setSettingsOpen(true);
          requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
        }}
        className="font-medium text-primary underline"
      >
        Change settings
      </button>
    </p>
  );
  // Rolled up by default, like Filters and Display (Grant, 2026-10-22); the summary line says what is
  // set, and it opens by itself while the survey design needs a choice (designUnresolved).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const tableSettings = (
    <details
      ref={settingsRef}
      open={settingsOpen || designUnresolved}
      onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
      className="rounded-lg border border-slate-200 bg-slate-50"
      data-testid="crosstab-table-settings"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-foreground">
        {asPage && entry === "build" ? "3. Table settings" : "Table settings"}
        <span className="ml-2 text-[11px] font-normal text-slate-600" data-testid="crosstab-table-settings-summary">
          {[
            weightVar ? `weighted by ${weights.find((w) => w.name === weightVar)?.label ?? weightVar}` : "unweighted",
            correction === "fdr" ? "false discovery rate" : correction === "bonferroni" ? "Bonferroni" : "uncorrected",
            designOk && (psuVar || strataVar) ? "survey design set" : "no survey design",
            excludeDk ? "non-answers excluded" : "non-answers included",
          ].join(" · ")}
        </span>
      </summary>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 px-3 py-2">
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-medium text-foreground">Weight</span>
                <select
                  value={weightVar}
                  onChange={(e) => setWeightChoice(e.target.value)}
                  className="min-w-0 max-w-xs rounded border border-border px-2 py-1 text-xs"
                >
                  <option value="">None (unweighted)</option>
                  {weights.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-medium text-foreground">Multiple comparisons</span>
                <select
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value as Correction)}
                  className="min-w-0 max-w-xs rounded border border-border px-2 py-1 text-xs"
                  title="Many columns are tested at once, so some differences appear by chance. The correction is applied across the columns of each banner variable, for each row."
                >
                  <option value="fdr">False discovery rate (Benjamini-Hochberg)</option>
                  <option value="bonferroni">Bonferroni (strictest)</option>
                  <option value="none">None (uncorrected)</option>
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-medium text-foreground">Survey design</span>
                <input
                  list="design-vars"
                  value={psuVar}
                  disabled={noDesignChosen}
                  onChange={(e) => setPsuChoice(e.target.value.trim())}
                  placeholder="PSU (cluster) variable"
                  className="w-40 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                  title="The primary sampling unit, for example the enumeration area. Leave empty (with strata filled in) for a strata-only design, or leave both empty to use weights only."
                />
                <input
                  list="design-vars"
                  value={strataVar}
                  disabled={noDesignChosen}
                  onChange={(e) => setStrataChoice(e.target.value.trim())}
                  placeholder="Strata variable"
                  className="w-36 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                  title="Optional. The stratum each case was sampled from. Can be used alone, with no PSU/clustering variable."
                />
                <label className="flex items-center gap-1 text-[11px] text-muted" title="Explicitly record that no survey design applies to this file, distinct from simply never having chosen one - this is persisted and overrides auto-detection for every tool that reads it.">
                  <input
                    type="checkbox"
                    checked={noDesignChosen}
                    onChange={(e) => setNoDesignChosen(e.target.checked)}
                  />
                  No design (weights only)
                </label>
                <datalist id="design-vars">
                  {(dict?.variables ?? []).filter((v) => !v.weightLike).slice(0, 4000).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.label}
                    </option>
                  ))}
                </datalist>
                <span className={designOk ? "text-success" : "text-muted"}>
                  {designOk ? "Taylor series variance" : (psuVar || strataVar) ? "Variable not found" : "Weights only"}
                </span>
                {designAmbiguous && (
                  <span className="text-warning" title="More than one variable name looked like a PSU or strata candidate, so none was picked automatically - choose one explicitly.">
                    Multiple design candidates found - choose explicitly
                  </span>
                )}
              </label>
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-medium text-foreground">Non-answers (don&apos;t know, refused, n/a)</span>
                <select
                  value={excludeDk ? "exclude" : "include"}
                  onChange={(e) => setExcludeDk(e.target.value === "exclude")}
                  className="rounded border border-border px-2 py-1 text-xs"
                  title="Excluded: these answers are left out of the percentage bases. Included: they stay in as an answer and take a share."
                >
                  <option value="exclude">Exclude from bases</option>
                  <option value="include">Include as an answer</option>
                </select>
              </label>
      </div>
    </details>
  );
  const headerBar = (
      <div className={asPage ? "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm" : "flex items-center justify-between gap-3 border-b border-border px-5 py-3"}>
        <div className="min-w-0">
          {asPage ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-foreground">Cross tabs</h2>
              {fileSelector}
            </div>
          ) : (
            <h2 className="truncate text-base font-semibold text-foreground">Crosstab workspace</h2>
          )}
          <p className={asPage ? "mt-0.5 text-xs text-slate-600" : "truncate text-xs text-muted"} data-testid="crosstab-file-meta">
            {asPage ? "" : filename}
            {/* Variables are the file's columns; the list below shows fewer rows, as a question set
                is one row and weights, open text and single-value columns are left out unless chosen. */}
            {dict
              ? `${asPage ? "" : " · "}${dict.nCases.toLocaleString()} cases · ${dict.variables.length.toLocaleString()} variables in the file`
              : asPage
                ? "Reading the file's variables..."
                : ""}
            {dict?.sheets?.data
              ? ` · data from sheet "${dict.sheets.data}"` +
                (dict.sheets.variables || dict.sheets.values
                  ? `, labels from "${[...new Set([dict.sheets.variables, dict.sheets.values].filter(Boolean))].join('" and "')}"`
                  : ", no label sheet found")
              : ""}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-slate-100 p-1" role="group" aria-label="Choose the interface you prefer">
            {(
              [
                ["build", "CrossTabs", "Build a table: pick columns and rows, add nets and groups"],
                ["ask", "SemanticTabs", "Ask in plain English and check the setup"],
                ["starter", "StarterTabs", "Suggested tables split by demographics or customer groups, or columns you choose"],
                ["objectives", "ObjectiveTabs", "Tables built from your research objectives"],
                ["all", `All tables (${items.length})`, "Every table from every mode, and the findings"],
              ] as const
            ).map(([k, title, hint]) => (
              <button
                key={k}
                type="button"
                title={hint}
                aria-pressed={entry === k}
                onClick={() => setEntry(k)}
                className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${entry === k ? "bg-white text-primary shadow-sm ring-1 ring-primary/40" : "text-muted hover:bg-white/70 hover:text-foreground"}`}
              >
                {title}
              </button>
            ))}
          </div>
          {/* What the chosen way of making tables does, said under the buttons rather than only on hover. */}
          <p className="text-center text-[11px] text-slate-600" data-testid="crosstab-mode-hint">
            {
              {
                build: "CrossTabs: build a table yourself by choosing columns and rows, with nets and groups.",
                ask: "SemanticTabs: describe the table in plain English, then check the setup it proposes before adding it.",
                starter: "StarterTabs: a suggested set of tables split by demographics or customer groups (or columns you choose), built as drafts.",
                objectives: "ObjectiveTabs: tables the evidence check built from your research objectives.",
                all: "All tables: every table from every way of making them, and the commit into findings.",
              }[entry]
            }
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {otherWaves.length > 0 && (
            <>
              <select
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
                title="Rebuild this wave's crosstabs from the same banner, rows and filters saved on another wave"
                className="rounded-lg border border-border px-2 py-1.5 text-xs"
              >
                <option value="">Copy tables from...</option>
                {otherWaves.map((w) => (
                  <option key={w.documentId} value={w.documentId}>
                    {w.wave}: {w.filename}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={copyFromWave}
                disabled={!copyFrom || copying || isPending}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-slate-400 disabled:opacity-50"
              >
                {copying ? "Copying..." : "Copy here"}
              </button>
            </>
          )}
          {!asPage && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-slate-400"
            >
              Close (Esc)
            </button>
          )}
        </div>
      </div>
  );
  const variablesPane = (
    <>
        {/* Variable table */}
        <section aria-label="Variables" className={asPage ? "flex h-[36rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-13rem)] lg:min-h-[32rem]" : "flex min-h-0 flex-col border-r-2 border-sky-200 bg-sky-50"}>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <div className="relative min-w-0 flex-1">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setScrollTop(0);
                if (scroller.current) scroller.current.scrollTop = 0;
              }}
              placeholder="Search name or label"
              className="w-full rounded-lg border border-border py-1.5 pl-3 pr-9 text-sm"
              autoFocus={!asPage}
            />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => {
                    setQuery("");
                    setScrollTop(0);
                    if (scroller.current) scroller.current.scrollTop = 0;
                  }}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-slate-100 hover:text-foreground"
                >
                  ×
                </button>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={fullOnly} onChange={(e) => setFullOnly(e.target.checked)} />
              Asked of nearly everyone
            </label>
            <select
              aria-label="Variable type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as "all" | VarType);
                setScrollTop(0);
                if (scroller.current) scroller.current.scrollTop = 0;
              }}
              className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs"
            >
              <option value="all">All types ({(typeCounts.all ?? 0).toLocaleString()})</option>
              {VAR_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} ({(typeCounts[t.key] ?? 0).toLocaleString()})
                </option>
              ))}
            </select>
            <span
              className="text-[11px] text-muted"
              title="Rows in this list, not variables: a question set (multiple response or grid) is one row, and weights, open text and columns with a single value are left out unless chosen under the type filter."
              data-testid="crosstab-list-count"
            >
              {dict ? `${entries.length.toLocaleString()} ${entries.length === 1 ? "row" : "rows"} in the list` : "Reading variables..."}
            </span>
            {sort.key !== "order" && (
              <button
                type="button"
                onClick={() => setSort({ key: "order", dir: 1 })}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:border-slate-400"
                title="Go back to the order the variables have in the data file"
              >
                Reset sort
              </button>
            )}
          </div>
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_4rem_4.75rem_5rem] items-stretch [&>*]:border-r [&>*]:border-border [&>*]:px-2 [&>*:last-child]:border-r-0 border-b border-border bg-slate-50 py-1.5 text-[11px] font-semibold text-muted" style={{ paddingRight: sbw }}>
            <button type="button" className="text-left" onClick={() => sortBy("name")}>
              Name{arrow("name")}
            </button>
            <button type="button" className="text-left" onClick={() => sortBy("label")}>
              Label{arrow("label")}
            </button>
            <button type="button" className="text-right" onClick={() => sortBy("n")}>
              Responses{arrow("n")}
            </button>
            <button type="button" className="text-right" onClick={() => sortBy("asked")}>
              Asked{arrow("asked")}
            </button>
            <span className="text-center">Column</span>
            <span className="text-center">Row</span>
          </div>
          <div
            ref={scroller}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="relative min-h-0 flex-1 overflow-y-auto"
          >
            <div style={{ height: entries.length * ROW_H, position: "relative" }}>
              <div style={{ position: "absolute", top: start * ROW_H, left: 0, right: 0 }}>
                {entries.slice(start, end).map((e) => {
                  if (e.kind === "set") {
                    const item: CrosstabRowItem = { key: e.s.key, label: e.s.label, stem: e.s.label, vars: e.s.vars, kind: e.s.kind ?? "multi" };
                    const on = rowItems.some((x) => x.key === e.s.key);
                    return (
                      <div
                        key={`set-${e.s.key}`}
                        style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}
                        className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_4rem_4.75rem_5rem] items-stretch [&>*]:border-r [&>*]:border-border [&>*]:px-2 [&>*:last-child]:border-r-0 [&>*:nth-last-child(-n+2)]:leading-normal border-b border-border bg-slate-50/60 text-xs"
                      >
                        <button type="button" className="truncate text-left text-muted" onClick={() => toggleSet(e.s.key)}>
                          {e.open ? "▾" : "▸"} {e.s.key}
                        </button>
                        <span className="truncate text-foreground" title={e.s.label}>
                          {e.s.label}{" "}
                          <span className="text-muted">({setKindText(e.s.kind)}, {e.s.vars.length} items)</span>
                        </span>
                        <span className="text-right tabular-nums text-muted">{fmtInt(e.s.nValid)}</span>
                        <span className="text-right tabular-nums text-muted">{Math.round(e.s.pctValid)}%</span>
                        <span className="flex items-center justify-center whitespace-nowrap">
                          {(e.s.kind ?? "multi") === "multi" && (
                            <button
                              type="button"
                              onClick={() =>
                                setColumnVars((c) => (c.includes(`set:${e.s.key}`) ? c.filter((x) => x !== `set:${e.s.key}`) : [...c, `set:${e.s.key}`]))
                              }
                              className={btn(columnVars.includes(`set:${e.s.key}`))}
                              title="Use every option of this set as its own banner column (a case can fall into more than one, since the options are not exclusive)"
                            >
                              Column
                            </button>
                          )}
                        </span>
                        <span className="flex items-center justify-center whitespace-nowrap">
                          <button type="button" onClick={() => toggleRow(item)} className={btn(on)}>
                            Row (all)
                          </button>
                        </span>
                      </div>
                    );
                  }
                  const v = e.v;
                  const isCol = columnVars.includes(v.name);
                  const item: CrosstabRowItem = { key: v.name, label: v.label, vars: [v.name] };
                  const isRow = rowItems.some((x) => x.key === v.name);
                  return (
                    <div
                      key={`v-${v.name}`}
                      style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}
                      className={`grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_4rem_4.75rem_5rem] items-stretch [&>*]:border-r [&>*]:border-border [&>*]:px-2 [&>*:last-child]:border-r-0 [&>*:nth-last-child(-n+2)]:leading-normal border-b border-border text-xs ${isCol || isRow ? "bg-slate-50" : ""}`}
                    >
                      <span className={`flex items-center gap-1 truncate text-muted ${e.depth ? "!pl-5" : ""}`} title={v.name}>
                        <span className="inline-block w-3" />
                        <span className="truncate">{v.name}</span>
                      </span>
                      <span className="truncate text-foreground" title={v.question ?? v.label}>
                        {v.label}
                      </span>
                      <span className="text-right tabular-nums text-muted">{fmtInt(v.nValid)}</span>
                      <span className={`text-right tabular-nums ${v.pctValid < 90 ? "text-amber-700" : "text-muted"}`}>
                        {Math.round(v.pctValid)}%
                      </span>
                      <span className="flex items-center justify-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setColumnVars((c) => (c.includes(v.name) ? c.filter((x) => x !== v.name) : [...c, v.name]))
                          }
                          className={btn(isCol)}
                          aria-pressed={isCol}
                        >
                          Column
                        </button>
                      </span>
                      <span className="flex items-center justify-center whitespace-nowrap">
                        <button type="button" onClick={() => toggleRow(item)} className={btn(isRow)} aria-pressed={isRow}>
                          Row
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
    </>
  );
  const dialogs = (
    <>
        {grouping && (
          <GroupDialog
            runId={runId}
            documentId={documentId}
            variable={grouping.variable}
            target={grouping.target}
            initial={
              grouping.target === "col"
                ? colGroups[grouping.variable] ?? []
                : rowItems.find((r) => r.vars[0] === grouping.variable && !r.kind)?.groups ?? []
            }
            onClose={() => setGrouping(null)}
            onSave={(groups) => {
              const lab = byName.get(grouping.variable)?.label ?? grouping.variable;
              setMessage(
                groups.length
                  ? `Saved ${groups.length} group${groups.length > 1 ? "s" : ""} for ${lab}. ${
                      grouping.target === "col"
                        ? "They will appear as columns when you add the table."
                        : "They will appear as NET rows when you add the table."
                    }`
                  : `No groups for ${lab}.`,
              );
              if (grouping.target === "col") setColGroups((g) => ({ ...g, [grouping.variable]: groups }));
              else
                setRowItems((rs) =>
                  rs.map((r) => (r.vars[0] === grouping.variable && !r.kind ? { ...r, groups } : r)),
                );
              setGrouping(null);
            }}
          />
        )}
        {netFor && (
          <NetDialog
            row={netFor}
            labelOf={(n) => byName.get(n)?.label ?? n}
            onClose={() => setNetFor(null)}
            onSave={(label, vars) => {
              setNets((x) => [...x, { label, vars }]);
              setMessage(`Added NET: ${label}. It appears as an extra row when you add the table.`);
              setNetFor(null);
            }}
          />
        )}
    </>
  );
  const buildPane = (
    <>
        {/* Build, table set, viewer */}
        <section aria-label="Tables" className={asPage ? "flex h-[36rem] flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-13rem)] lg:min-h-[32rem]" : "flex min-h-0 flex-col overflow-y-auto"}>
          <div className="space-y-3 border-b border-border p-4">
            {entry !== "all" && settingsSummary}
            {entry !== "all" && entry !== "build" && tableSettings}
            {entry === "objectives" && (
              <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-xs">
                <p className="text-muted">
                  Tables the evidence check built from your objectives for this file. Add one to your own tables to edit it
                  and commit it into findings. Until then they stay out of findings.
                </p>
                {evidenceTabs.length === 0 ? (
                  <p className="text-muted">None yet. Open Objectives, Review, and the evidence is gathered there.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {evidenceTabs.map((t) => (
                      <li key={t.table_id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-white p-2">
                        <span className="min-w-0">
                          <span className="block text-foreground">{t.question}</span>
                          <span className="block text-muted">{t.objective}{t.stance ? ` · ${t.stance}` : ""}</span>
                        </span>
                        {t.status === "evidence" ? (
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-border px-2.5 py-1 font-medium text-foreground hover:border-slate-400"
                            onClick={() =>
                              void promoteEvidenceTableAction(runId, t.table_id).then(() => {
                                loadEvidenceTabs();
                                refreshList();
                              })
                            }
                          >
                            Add to my tables
                          </button>
                        ) : (
                          <span className="shrink-0 text-muted">In your tables</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {entry === "ask" && dict && <CrosstabAsk runId={runId} documentId={documentId} dict={dict} busy={isPending} onUse={useAsked} history={askHistory} onHistory={setAskHistory} />}
            {entry === "starter" && starterPlan && starterPlan.banners.length > 0 && starterPlan.items.length > 0 && !hasStarter && (
              <div
                className={`rounded-lg border p-3 text-xs ${starterPlan.small ? "border-primary/40 bg-primary-light" : "border-border bg-slate-50"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="max-w-2xl">
                    <p className="font-medium text-foreground">
                      {starterPlan.small ? "Suggested starter tables" : "Suggest a starter set (optional)"}
                    </p>
                    <p className="mt-0.5 text-muted">
                      {starterPlan.banners.map((b) => b.label).join(", ")} against{" "}
                      {starterPlan.items.length}
                      {starterPlan.eligibleQuestions > starterPlan.items.length
                        ? ` of ${starterPlan.eligibleQuestions}`
                        : ""}{" "}
                      questions
                      {starterPlan.meanScales > 0 ? ` (${starterPlan.meanScales} rated 0 to 10 or 1 to 10, shown with their mean above the answers)` : ""}
                      {weightVar ? `, weighted by ${weightVar}` : ", unweighted"}. Built as drafts: nothing becomes a
                      finding until you commit, and only differences that survive a false discovery rate correction are kept.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={buildStarter}
                    disabled={isPending}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${starterPlan.small ? "bg-primary text-white shadow-sm hover:opacity-90" : "border border-border bg-white text-foreground hover:border-slate-400"}`}
                  >
                    Build starter tables
                  </button>
                </div>
              </div>
            )}
            {entry === "starter" && hasStarter && <p className="text-xs text-muted">A starter set is already in the table set below. Delete the drafts to build it again.</p>}
            {entry === "starter" && !hasStarter && starterPlan && starterPlan.candidates.length === 0 && (
              <p className="text-xs text-muted">
                No column in this file can split a starter set (one needs 2 to 10 answers, with at least 90% of people answering). Use one of the other ways to build a table.
              </p>
            )}
            {entry === "starter" && !hasStarter && starterPlan && starterPlan.candidates.length > 0 && starterPlan.banners.length === 0 && (
              <p className="text-xs text-muted" data-testid="starter-none-recognised">
                {starterPlan.chosen
                  ? "Choose at least one column to split by."
                  : "No demographic (gender, age, province and so on) or customer grouping (such as segment) was recognised. Choose the columns to split by below."}
              </p>
            )}
            {entry === "starter" && !hasStarter && starterPlan && starterPlan.banners.length > 0 && starterPlan.items.length === 0 && (
              <p className="text-xs text-muted">No questions suited a starter table besides the columns to split by. Use one of the other ways to build a table.</p>
            )}
            {entry === "starter" && !hasStarter && starterPlan && starterPlan.candidates.length > 0 && (
              <details
                className="rounded-lg border border-border bg-white p-3 text-xs"
                open={starterChooserOpen ?? starterPlan.banners.length === 0}
                onToggle={(e) => setStarterChooserOpen(e.currentTarget.open)}
                data-testid="starter-banner-chooser"
              >
                <summary className="cursor-pointer font-medium text-foreground">
                  {`Columns to split by (${starterPlan.banners.length} chosen, at most ${starterPlan.maxBanners})`}
                  {starterPlan.chosen && <span className="ml-1.5 font-normal text-muted">your choice</span>}
                </summary>
                <p className="mt-1.5 text-muted">
                  Each column you choose becomes one starter table, with the other questions down the side. Recognised splits are listed first.
                  {starterPlan.chosen && (
                    <button type="button" className="ml-1.5 underline" onClick={() => setStarterBanners(null)}>
                      Use the recognised ones
                    </button>
                  )}
                </p>
                <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {starterPlan.candidates.map((c) => {
                    const on = starterPlan.banners.some((b) => b.name === c.name);
                    const full = !on && starterPlan.banners.length >= starterPlan.maxBanners;
                    return (
                      <li key={c.name}>
                        <label className={`flex items-start gap-1.5 ${full ? "text-muted" : "text-foreground"}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={on}
                            disabled={full}
                            onChange={() => {
                              setStarterChooserOpen(true);
                              const current = starterPlan.banners.map((b) => b.name);
                              setStarterBanners(on ? current.filter((n) => n !== c.name) : [...current, c.name]);
                            }}
                          />
                          <span>
                            {c.label && c.label !== c.name ? `${c.label} (${c.name})` : c.name}
                            {c.recognised && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">recognised</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            {entry === "build" && (
              <>
            <h3 className="text-sm font-semibold text-foreground">1. Rows and columns</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-base font-semibold text-foreground">Columns (banner, side by side)</p>
                <div className="flex h-44 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-white p-2 text-sm shadow-inner">
                  {columnVars.length === 0 && <span className="text-muted">One or more variables, for example province. Leave empty to describe all respondents.</span>}
                  {columnVars.map((n) => (
                    <span key={n} className="flex w-full shrink-0 items-center rounded bg-slate-100">
                      <button
                        type="button"
                        onClick={() => setColumnVars((c) => c.filter((x) => x !== n))}
                        className="min-w-0 flex-1 px-2 py-1 text-left"
                      >
                        {columnVarLabel(n)}
                        {n.startsWith("set:") ? " (multiple response set, every option as a column)" : ""}
                        {colGroups[n]?.length ? ` (${colGroups[n].length} group${colGroups[n].length > 1 ? "s" : ""})` : ""} ×
                      </button>
                      {!n.startsWith("set:") && (
                        <button
                          type="button"
                          onClick={() => setGrouping({ variable: n, target: "col" })}
                          className="border-l border-border px-3 py-1 text-xs text-primary hover:underline"
                        >
                          Group
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-base font-semibold text-foreground">Rows (questions to measure)</p>
                <div className="flex h-44 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-white p-2 text-sm shadow-inner">
                  {rowItems.length === 0 && nets.length === 0 && <span className="text-muted">One or more variables or whole sets.</span>}
                  {rowItems.map((r) => (
                    <span key={r.key} data-row-key={r.key} className="flex w-full shrink-0 items-center rounded bg-slate-100">
                      <button type="button" onClick={() => toggleRow(r)} className="min-w-0 flex-1 px-2 py-1 text-left">
                        {r.label}
                        {r.vars.length > 1 ? ` (${r.vars.length} options)` : ""}
                        {r.groups?.length ? ` (+${r.groups.length} net${r.groups.length > 1 ? "s" : ""})` : ""} ×
                      </button>
                      {r.vars.length === 1 && !r.kind && (
                        <button
                          type="button"
                          onClick={() => setGrouping({ variable: r.vars[0], target: "row" })}
                          className="border-l border-border px-3 py-1 text-xs text-primary hover:underline"
                        >
                          Group
                        </button>
                      )}
                      {r.vars.length > 1 && (r.kind === "multi" || !r.kind) && (
                        <button
                          type="button"
                          onClick={() => setNetFor(r)}
                          className="border-l border-border px-3 py-1 text-xs text-primary hover:underline"
                          title="Add an any-of row: counts a person once if they chose at least one of the options you tick"
                        >
                          Net
                        </button>
                      )}
                    </span>
                  ))}
                  {nets.map((n, i) => (
                    <span key={`net-${i}`} className="flex w-full shrink-0 items-center rounded bg-primary-light">
                      <button
                        type="button"
                        onClick={() => setNets((x) => x.filter((_, j) => j !== i))}
                        className="min-w-0 flex-1 px-2 py-1 text-left"
                        title={n.vars.join(", ")}
                      >
                        NET: {n.label} ({n.vars.length} options) ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
              </>
            )}
            {entry === "build" && (
              <>
            {dict && (
              <details className="rounded-lg border border-slate-200" open={filters.length > 0 || layerVar !== "" ? true : undefined} data-testid="crosstab-filters-section">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-foreground">
                  2. Filters and optional layers
                  <span className="ml-2 text-[11px] font-normal text-slate-600">
                    {`${filters.length === 0 ? "No filter" : `${filters.length} ${filters.length === 1 ? "filter" : "filters"}`} · ${layerVar ? `layered by ${byName.get(layerVar)?.label || layerVar}` : "no layer"}`}
                  </span>
                </summary>
                <div className="border-t border-slate-200 p-2">
                  <CrosstabOptions part="filters" runId={runId} documentId={documentId} dict={dict} weighted={weightVar !== ""} filters={filters} setFilters={setFilters} cells={cellPrefs} setCells={setCellPrefs} net={cellNet} setNet={setCellNet} stats={statPrefs} setStats={setStatPrefs} layerVar={layerVar} setLayerVar={setLayerVar} />
                </div>
              </details>
            )}
            {tableSettings}
            {dict && (
              <details className="rounded-lg border border-slate-200" data-testid="crosstab-display-section">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-foreground">
                  Display and statistics options
                  <span className="ml-2 text-[11px] font-normal text-slate-600">cell figures, NET columns and sizes of association</span>
                </summary>
                <div className="border-t border-slate-200 p-2">
                  <CrosstabOptions part="display" runId={runId} documentId={documentId} dict={dict} weighted={weightVar !== ""} filters={filters} setFilters={setFilters} cells={cellPrefs} setCells={setCellPrefs} net={cellNet} setNet={setCellNet} stats={statPrefs} setStats={setStatPrefs} layerVar={layerVar} setLayerVar={setLayerVar} />
                </div>
              </details>
            )}
            {/* Kept in view at the foot of the pane while the sections above are scrolled. */}
            <div className={asPage ? "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur" : "flex flex-wrap items-center gap-3"}>
              <button
                type="button"
                onClick={() => addTable()}
                disabled={isPending || (columnVars.length === 0 && rowItems.length === 0 && nets.length === 0)}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Working..." : layerVar ? "Add layered tables to set" : "Add table to set"}
              </button>
              {columnVars.length === 0 && rowItems.length === 0 && nets.length === 0 && (
                <span className="text-[11px] text-slate-600">Choose rows or columns in the variable list first.</span>
              )}
            </div>
              </>
            )}
            {message && <p className="text-xs text-success">{message}</p>}
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>

          <div className="space-y-3 p-4">
            {asPage && entry === "build" && <h3 className="text-sm font-semibold text-foreground">4. Results and saved tables</h3>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                {modeName}: {visible.length} table{visible.length === 1 ? "" : "s"}
                {entry !== "all" && items.length > visible.length ? ` (${items.length} in all)` : ""}
              </span>
              {entry === "all" && drafts.length > 0 && (
                <button
                  type="button"
                  onClick={deleteDrafts}
                  disabled={isPending}
                  className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-danger hover:border-danger disabled:opacity-50"
                >
                  Delete all drafts ({drafts.length})
                </button>
              )}
              {drafts.length > 0 && (
                <button
                  type="button"
                  onClick={commit}
                  disabled={isPending}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  Commit {drafts.length} table{drafts.length > 1 ? "s" : ""}{entry === "all" ? "" : " (all modes)"} and generate findings
                </button>
              )}
            </div>
            {visible.length === 0 && (
              <p className="text-xs text-muted">
                {entry === "all"
                  ? "No tables yet. Make some with Workspace, Ask in plain English, the Crosstabs window or the Starter set."
                  : `No tables from ${modeName} yet. Tables you make here appear below. Every table is also listed under All tables.`}
              </p>
            )}
            {visible.map((it, i) => {
              const newLayerGroup = !!it.layerGroup && it.layerGroup !== visible[i - 1]?.layerGroup;
              return (
                <div key={`${entry === "all" ? "all" : "mode"}-${it.id}`}>
                  {newLayerGroup && (
                    <p className="mb-1 mt-2 text-[11px] font-medium text-muted first:mt-0">
                      Layered by {it.layerLabel ?? "variable"}, one table per category
                    </p>
                  )}
                  <TableCard
                    startOpen={false}
                    runId={runId}
                    item={it}
                    collapse={collapseAll}
                    cells={cellPrefs}
                    net={cellNet}
                    stats={statPrefs}
                    scrollTo={lastAdded === it.id}
                    onDelete={() => remove(it)}
                    layerBadge={it.layerCategory ?? undefined}
                  />
                </div>
              );
            })}
          </div>
        </section>
    </>
  );
  const body = (
    <CellSelectContext.Provider value={{ sel: cellSel, select: setCellSel }}>
      {asPage ? (
        // The page: the shared panes, so the variable list can be collapsed and each pane resized,
        // and the cell pane is shown only while a cell is selected (it gives its room back on Close).
        <div className="flex flex-col gap-3" data-testid="crosstab-workspace">
          {headerBar}
          {dialogs}
          <ThreePane
            storageKey="crosstab-workspace"
            leftDefaultPx={560}
            leftMaxShare={0.55}
            left={variablesPane}
            middle={buildPane}
            right={cellSel ? <CellDetailPane onClose={() => setCellSel(null)} /> : undefined}
          />
        </div>
      ) : (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Crosstab workspace">
          {headerBar}
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(34rem,48%)_minmax(0,1fr)] xl:grid-cols-[minmax(30rem,38%)_minmax(0,1fr)_22rem]">
            {variablesPane}
            {dialogs}
            {buildPane}
            <CellDetailPane />
          </div>
        </div>
      )}
    </CellSelectContext.Provider>
  );

  return asPage ? body : <>{createPortal(body, document.body)}</>;
}

/**
 * The figures behind the table cell the researcher clicked. In the overlay, a third column on wide
 * screens. On the page, a pane opened by selecting a cell, with Close (onClose) to give its room back.
 */
function CellDetailPane({ onClose }: { onClose?: () => void }) {
  const { sel } = useContext(CellSelectContext);
  return (
    <aside
      aria-label="Selected cell"
      className={
        onClose
          ? "flex h-[36rem] flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:h-[calc(100vh-13rem)] lg:min-h-[32rem]"
          : "hidden min-h-0 flex-col gap-4 overflow-y-auto border-l-2 border-slate-300 bg-white p-4 xl:flex"
      }
      data-testid="crosstab-cell-pane"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Selected cell</h3>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-foreground hover:border-slate-400">
            Close
          </button>
        )}
      </div>
      {!sel ? (
        <p className="text-sm text-muted">
          Click a figure in a table to see its base, the test behind it and how it compares with the
          other columns.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{sel.question}</p>
            <p className="text-sm font-semibold text-foreground">
              {sel.row} <span className="font-normal text-muted">in</span> {sel.column}
            </p>
            {sel.banner && <p className="text-xs text-muted">{sel.banner}</p>}
          </div>
          <div className="flex items-end gap-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Column %</p>
              <p className="text-3xl font-bold leading-none text-foreground">
                {sel.cell.pct === null || sel.cell.pct === undefined ? "-" : `${fmtPct(sel.cell.pct)}%`}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Base</p>
              <p className="text-lg font-semibold text-foreground">{fmtInt(sel.cell.base.n)}</p>
            </div>
            {sel.cell.nCell !== null && sel.cell.nCell !== undefined && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cases</p>
                <p className="text-lg font-semibold text-foreground">{fmtInt(sel.cell.nCell)}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {sel.thin && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">Small base, read with care</span>}
            {sel.cell.sig > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">Significantly higher</span>}
            {sel.cell.sig < 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-800">Significantly lower</span>}
            {sel.cell.sig === 0 && !sel.thin && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">No significant difference</span>}
            {sel.p !== null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                p {sel.p < 0.001 ? "< 0.001" : `= ${sel.p}`}
              </span>
            )}
            {sel.pAdj !== null && sel.pAdj !== undefined && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                corrected p {sel.pAdj < 0.001 ? "< 0.001" : `= ${sel.pAdj}`}
              </span>
            )}
            {sel.cell.letters && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                Higher than {sel.cell.letters}
              </span>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Compared with</p>
            <div className="space-y-1.5">
              {[...sel.peers, { label: "Total", pct: sel.totalPct, n: 0 }].map((x) => (
                <div key={x.label} className="grid grid-cols-[6rem_minmax(0,1fr)_2.75rem] items-center gap-2 text-xs">
                  <span className={`truncate ${x.label === sel.column ? "font-semibold text-foreground" : "text-muted"}`} title={x.label}>
                    {x.label}
                  </span>
                  <span className="h-2 overflow-hidden rounded bg-slate-200">
                    <span
                      className={`block h-full rounded ${x.label === sel.column ? "bg-primary" : x.label === "Total" ? "bg-slate-400" : "bg-indigo-300"}`}
                      style={{ width: `${Math.max(0, Math.min(100, x.pct ?? 0))}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-foreground">{x.pct === null ? "-" : `${fmtPct(x.pct)}%`}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * A plain, descriptive read of one table: a one-line headline above a short
 * row of cards. Regenerated on demand, never saved, never posted to
 * findings, deliberately separate from the objective-evidence lane.
 */
function CrosstabInsightsPanel({
  insights,
  error,
  loading,
}: {
  insights: CrosstabInsights | null;
  error: string | null;
  loading: boolean;
}) {
  return (
    <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
      {loading && <p className="text-xs text-muted">Reading the table...</p>}
      {!loading && error && <p className="text-xs text-danger">{error}</p>}
      {!loading && !error && insights && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1 sm:max-w-xs">
            <p className="text-sm font-semibold text-foreground">{insights.headline}</p>
            {insights.partial && (
              <p className="mt-1 text-[11px] text-amber-800" data-testid="crosstab-insights-partial">
                {`Read from the first ${insights.partial.questionsShown} of ${insights.partial.questionsTotal} questions; the rest did not fit. A smaller table is read in full.`}
              </p>
            )}
          </div>
          {insights.cards.length > 0 && (
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              {insights.cards.map((c, i) => (
                <div key={i} className="rounded-md border border-violet-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-foreground">{c.title}</span>
                    {c.stat && (
                      <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                        {c.stat}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TableCard({
  runId,
  item,
  collapse,
  startOpen = true,
  cells,
  net,
  stats,
  scrollTo,
  onDelete,
  layerBadge,
}: {
  runId: string;
  item: CrosstabListItem;
  collapse: { open: boolean; tick: number };
  startOpen?: boolean;
  cells: CellPrefs;
  net: boolean;
  stats: StatPrefs;
  scrollTo: boolean;
  onDelete: () => void;
  /** This table's layer category, shown as a small chip beside its title when it is one panel of a layered set. */
  layerBadge?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [result, setResult] = useState<CrosstabResult | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [stat, setStat] = useState<Stat>("stack");
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set());
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(item.label);
  const [caption, setCaption] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCaption, setDraftCaption] = useState("");
  const [savingText, setSavingText] = useState(false);
  const [insights, setInsights] = useState<CrosstabInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [seenTick, setSeenTick] = useState(collapse.tick);
  if (collapse.tick !== seenTick) {
    setSeenTick(collapse.tick);
    setOpen(collapse.open);
  }

  useEffect(() => {
    if (!open || result !== undefined) return;
    let live = true;
    loadCrosstabAction(runId, item.id).then((r) => {
      if (!live) return;
      if (r.ok) setResult(r.result);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, result, runId, item.id]);

  useEffect(() => {
    if (scrollTo) {
      // Pre-existing pattern, kept as is: scrollTo is a one-off signal from the parent (the table
      // just added), so this runs once per signal rather than cascading.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true); // a table you have just added opens; the rest stay rolled up
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollTo]);

  return (
    <div ref={ref} className="rounded-xl border border-border bg-white shadow-sm">
      {/* The row wraps (Codex IR-08, 2026-10-20): in a narrow results pane the action buttons keep
          their width, so the title and its "may be outdated" qualifications used to shrink to zero
          width. The title keeps at least 16rem and its labels wrap under it; the actions drop to
          the next line instead. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="crosstab-table-toggle"
          className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-2 gap-y-1 text-left"
        >
          <span className="text-xs text-muted">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 max-w-full truncate text-sm font-medium text-foreground" title={title}>
            {title}
          </span>
          {layerBadge && (
            <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">{layerBadge}</span>
          )}
          {item.source === "assistant" && (
            // Built by the Research assistant to answer a question; listed with every other table so
            // each figure it quoted can be opened, committed or deleted like any draft.
            <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800" data-testid="crosstab-assistant-badge">
              Research assistant
            </span>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${item.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
          >
            {item.status === "draft" ? "draft" : `${item.findings} findings`}
          </span>
          {item.stale && (
            <span
              className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
              title="A variable's data type or question type has been corrected since this table was built - its numbers may no longer match the correction. Rebuild it to pick up the change."
            >
              may be outdated
            </span>
          )}
          {item.methodFreshness === "earlier" && (
            <span
              data-testid="table-method-earlier"
              className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
              title={`This table was ${EARLIER_METHOD_TEXT}. Its findings and anything built on them are marked until then.`}
            >
              earlier method
            </span>
          )}
          {item.designFreshness === "stale" && (
            <span
              className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
              title="The document's survey-design setting has changed since this table was built - its standard errors and intervals may no longer reflect the design now in effect. Rebuild it to pick up the change. This never happens automatically, to preserve any human review already recorded against this table."
            >
              design setting changed
            </span>
          )}
          {/* Brief 37 repair: distinct from "stale" - this table's design freshness genuinely
              could not be checked (a legacy table built before this was tracked, or the
              document's current set-up couldn't be read just now), not confirmed to still
              match. Previously collapsed into the same "nothing shown" as a real match. */}
          {item.designFreshness === "unknown" && (
            <span
              className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              title="Whether this table's survey-design setting still matches the document's current one could not be verified just now - either it predates this check, or the document's set-up couldn't be read. Reload this workspace to check again; if it keeps failing, the document's saved set-up may need attention."
            >
              freshness could not be verified
            </span>
          )}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-slate-400"
        >
          {open ? "Roll up" : "Expand"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftTitle(title);
            setDraftCaption(caption ?? (result ? result.caption ?? "" : ""));
            setEditing((e) => !e);
            setOpen(true);
          }}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-slate-400"
        >
          Title and caption
        </button>
        <button
          type="button"
          disabled={loadingInsights}
          onClick={async () => {
            setOpen(true);
            if (showInsights) {
              setShowInsights(false);
              return;
            }
            setShowInsights(true);
            if (insights || loadingInsights) return;
            setLoadingInsights(true);
            setInsightsError(null);
            const r = await summarizeCrosstabAction(runId, item.id);
            setLoadingInsights(false);
            if (r.ok) setInsights(r.insights);
            else setInsightsError(r.error);
          }}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-slate-400 disabled:opacity-50"
        >
          {loadingInsights ? "Reading table..." : showInsights ? "Hide AI Insights" : "AI Insights"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-border px-2 py-0.5 text-[11px] text-danger hover:border-danger"
        >
          Delete
        </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-3">
          {editing && (
            <div className="mb-3 space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-xs">
              <label className="block">
                <span className="font-medium text-foreground">Title</span>
                <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={300} className="mt-1 w-full rounded border border-border px-2 py-1" />
              </label>
              <label className="block">
                <span className="font-medium text-foreground">Caption (shown under the table and in the export)</span>
                <textarea value={draftCaption} onChange={(e) => setDraftCaption(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded border border-border px-2 py-1" />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingText}
                  onClick={async () => {
                    setSavingText(true);
                    const r = await setCrosstabTextAction(runId, item.id, draftTitle, draftCaption);
                    setSavingText(false);
                    if (!r.ok) return setError(r.error);
                    if (draftTitle.trim()) setTitle(draftTitle.trim());
                    setCaption(draftCaption.trim());
                    setEditing(false);
                  }}
                  className="rounded border border-primary px-3 py-1 font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  {savingText ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="rounded border border-border px-3 py-1">Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {!error && result === undefined && <p className="text-xs text-muted">Loading...</p>}
          {result === null && (
            <p className="text-xs text-muted">
              This table was built with an earlier version and cannot be shown. Delete it and add it again.
            </p>
          )}
          {showInsights && (
            <CrosstabInsightsPanel insights={insights} error={insightsError} loading={loadingInsights} />
          )}
          {result && (
            <CrosstabView
              exportHref={`/api/runs/${runId}/crosstab/export?tableId=${item.id}`}
              initialCells={cells}
              initialNet={net}
              initialStats={stats}
              result={result}
              caption={caption ?? result.caption ?? ""}
              stat={stat}
              onStat={setStat}
              hiddenCols={hiddenCols}
              hiddenRows={hiddenRows}
              onToggleCol={(j) => setHiddenCols((s) => toggleIn(s, j))}
              onToggleRow={(k) => setHiddenRows((s) => toggleIn(s, k))}
              onReset={() => {
                setHiddenCols(new Set());
                setHiddenRows(new Set());
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function setKindText(kind?: string): string {
  return kind === "grid" ? "numeric grid, averages" : kind === "battery" ? "battery, one question per item" : "multiple response";
}

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function CrosstabView({
  exportHref,
  initialCells,
  initialNet,
  initialStats,
  result,
  caption,
  stat,
  onStat,
  hiddenCols,
  hiddenRows,
  onToggleCol,
  onToggleRow,
  onReset,
}: {
  exportHref?: string;
  initialCells?: CellPrefs;
  initialNet?: boolean;
  initialStats?: StatPrefs;
  result: CrosstabResult;
  caption?: string;
  stat: Stat;
  onStat: (s: Stat) => void;
  hiddenCols: Set<number>;
  hiddenRows: Set<string>;
  onToggleCol: (j: number) => void;
  onToggleRow: (key: string) => void;
  onReset: () => void;
}) {
  const [measures, setMeasures] = useState<CellPrefs>(initialCells ?? DEFAULT_CELLS);
  const [showNet, setShowNet] = useState(initialNet ?? true);
  const [statTicks, setStatTicks] = useState<StatPrefs>(initialStats ?? DEFAULT_STATS);
  const [showResp, setShowResp] = useState(false);
  const [lettersBeside, setLettersBeside] = useState(false);
  const [sortBy, setSortBy] = useState<"order" | "label" | "size">("order");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartsOnly, setChartsOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const { sel: cellSelected, select: selectCell } = useContext(CellSelectContext);
  const hasResp = result.questions.some((qq) => qq.rows.some((r) => r.respPct !== undefined));
  const stack = stat === "stack";
  const weighted = !!result.weightVar;
  const cols = result.columns.map((c, j) => ({ c, j })).filter(({ j }) => !hiddenCols.has(j));
  const reliableBase = result.notes?.minReliable ?? 30;
  const hasNets = !!result.nets && result.nets.length > 0;
  const overall = !!result.overall;
  // Columns in display order: each banner variable's columns, then its NET column.
  const layout: LayoutEntry[] = [];
  result.blocks.forEach((_, bi) => {
    const inBlock = cols.filter(({ c }) => c.block === bi);
    inBlock.forEach(({ c, j }) => layout.push({ kind: "col", c, j }));
    if (showNet && hasNets && !overall && inBlock.length > 0) layout.push({ kind: "net", block: bi });
  });
  const blocks = result.blocks
    .map((b, bi) => ({ b, span: layout.filter((e) => (e.kind === "col" ? e.c.block : e.block) === bi).length }))
    .filter(({ span }) => span > 0);
  const hiddenCount = hiddenCols.size + hiddenRows.size;
  const stats: [Stat, string][] = [
    ["col", "Column %"],
    ["row", "Row %"],
    ["count", "Weighted count"],
    ["stack", "Stacked"],
  ];
  const cellOf = (r: CrosstabResult["questions"][number]["rows"][number], e: LayoutEntry): CellData | null => {
    if (e.kind === "col") {
      return { pct: r.pct[e.j], rowPct: r.rowPct[e.j], count: r.count[e.j], nCell: r.nCell?.[e.j], respPct: r.respPct?.[e.j], base: r.base[e.j], sig: r.sig[e.j], letters: r.letters?.[e.j], residual: r.residual?.[e.j] };
    }
    const nt = r.net?.find((x) => x.block === e.block);
    return nt ? { pct: nt.pct, rowPct: nt.rowPct, count: nt.count, nCell: nt.nCell, respPct: nt.respPct, base: nt.base, sig: 0, letters: undefined, residual: undefined } : null;
  };
  /** Which measures an answer row shows. One in the single views, several in the stacked view. */
  const measureKeys = (mean: boolean, r: { isBase?: boolean; isEffBase?: boolean; nCell?: unknown; respPct?: unknown; residual?: unknown }): MeasureKey[] => {
    if (r.isBase) return ["base"];
    if (!stack) return [stat as MeasureKey];
    if (mean) return measures.letters ? ["col", "letters"] : ["col"];
    const out: MeasureKey[] = [];
    if (measures.col) out.push("col");
    if (measures.row && !overall) out.push("row");
    if (measures.n && r.nCell !== undefined) out.push("n");
    if (measures.count && weighted) out.push("count");
    if (showResp && r.respPct !== undefined) out.push("resp");
    if (measures.letters && !overall && !lettersBeside) out.push("letters");
    if (measures.residual && !overall && r.residual !== undefined) out.push("residual");
    return out.length > 0 ? out : ["col"];
  };
  const measureText = (mk: MeasureKey, mean: boolean, r: { isBase?: boolean; isScore?: boolean; isMean?: boolean }, c: CellData): string => {
    if (mk === "base") return c.count === null || c.count === undefined ? "" : fmtInt(c.count);
    if (mk === "letters") return c.letters ? c.letters : c.letters === undefined ? "" : "-";
    if (mk === "residual") return c.residual === null || c.residual === undefined ? "-" : `${c.residual > 0 ? "+" : ""}${c.residual.toFixed(1)}`;
    const v = mk === "col" ? c.pct : mk === "row" ? c.rowPct : mk === "n" ? c.nCell : mk === "resp" ? c.respPct : c.count;
    if (v === null || v === undefined) return mk === "n" ? "" : "-";
    if (mk === "n" || mk === "count") return fmtInt(v);
    if (r.isScore && mk === "col") return r.isMean ? v.toFixed(2) : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
    return mean && mk === "col" ? String(v) : `${fmtPct(v)}%`;
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span className="flex overflow-hidden rounded-lg border border-border">
          {stats.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onStat(k)}
              className={`px-2.5 py-1 ${stat === k ? "bg-primary text-white" : "hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </span>
        {stack && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-foreground">Show in each cell</span>
            {(
              [
                ["col", "% within column"],
                ["row", "% within row"],
                ["n", "n"],
                ...(weighted ? ([["count", "Weighted count"]] as const) : []),
                ["letters", "Comparison letters"],
                ["residual", "Standardized residual"],
              ] as const
            ).filter(([k]) => !overall || (k !== "row" && k !== "letters" && k !== "residual")).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={measures[k]} onChange={(e) => setMeasures((m) => ({ ...m, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </span>
        )}
        {hasResp && (
          <label className="flex items-center gap-1" title="Divide each option by all mentions in the column, so the options add to 100%. Percent of cases is the default.">
            <input type="checkbox" checked={showResp} onChange={(e) => setShowResp(e.target.checked)} />
            % of responses (multiple response)
          </label>
        )}
        {!overall && stack && (
          <label className="flex items-center gap-1" title="Show the comparison letters next to the figure instead of on their own line.">
            <input type="checkbox" checked={lettersBeside} onChange={(e) => setLettersBeside(e.target.checked)} />
            Letters beside figure
          </label>
        )}
        <label className="flex items-center gap-1">
          Sort answers
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "order" | "label" | "size")} className="rounded border border-border px-1 py-0.5">
            <option value="order">As coded</option>
            <option value="label">By label</option>
            <option value="size">By size (total)</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide empty answers
        </label>
        <button type="button" onClick={() => setShowChart((v) => !v)} className="font-medium text-primary hover:underline" data-testid="crosstab-chart-toggle">
          {showChart ? "Hide charts" : "Quick charts"}
        </button>
        {showChart && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={chartsOnly} onChange={(e) => setChartsOnly(e.target.checked)} data-testid="crosstab-charts-only" />
            Charts only
          </label>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildRCode(result));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt("Copy the settings and R code:", buildRCode(result));
            }
          }}
          className="font-medium text-primary hover:underline"
        >
          {copied ? "Copied" : "Copy settings and R code"}
        </button>
        {hasNets && !overall && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} />
            NET for each banner variable
          </label>
        )}
        {!overall && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-foreground">Statistics</span>
            {STAT_LABELS.map((t) => (
              <label key={t.key} className="flex items-center gap-1" title={t.hint}>
                <input type="checkbox" checked={statTicks[t.key]} onChange={(e) => setStatTicks((x) => ({ ...x, [t.key]: e.target.checked }))} />
                {t.label}
              </label>
            ))}
          </span>
        )}
        {!hasNets && !overall && (
          <span className="text-amber-700">
            This table was built before base rows and NET columns were added. Delete it and add it again to include them.
          </span>
        )}
        <span>
          {result.weightVar ? `Weighted by ${result.weightLabel ?? result.weightVar}` : "Unweighted"}. Total base{" "}
          {result.total.n.toLocaleString()} cases.
          {result.notes && result.questions.some((q) => q.kind === "multi") && <> {result.notes.multiBase}</>}
          {(stat === "col" || (stack && measures.col)) && (
            <>
              {" "}
              <span className="text-emerald-700">▲</span>/<span className="text-rose-700">▼</span> differs from all
              other cases in the same banner variable at 95% ({result.notes?.designUsed ? "t-test with design degrees of freedom, Taylor series variance" : "z-test on effective base, weights only"}; {correctionText(result.notes?.correction)}). Figures in grey italics rest on fewer than {reliableBase} cases: indicative only, not tested. A dash means fewer than {result.notes?.minBase ?? 10} cases, so no figure is shown.
              {result.notes?.designUsed && result.notes.designUsed.casesMissingDesign > 0 && (
                <span className="text-amber-700">
                  {" "}Warning: {result.notes.designUsed.casesMissingDesign} cases have no value for the survey design variables and were treated as unclustered, which can understate the standard errors.
                </span>
              )}
            </>
          )}
        </span>
        {exportHref && (
          <>
            <a href={`${exportHref}&measures=${(stack ? (["col", "row", "n", "count", "letters", "residual"] as const).filter((k) => measures[k]).concat(showResp && hasResp ? (["resp"] as never[]) : []) : stat === "count" ? ["count"] : stat === "row" ? ["row"] : ["col", "letters"]).join(",") || "col"}&net=${showNet ? 1 : 0}`} className="font-medium text-primary hover:underline">
              Download Excel
            </a>
            <a href={`${exportHref}&format=pptx`} className="font-medium text-primary hover:underline">
              PowerPoint
            </a>
            <a href={`${exportHref}&format=pdf`} className="font-medium text-primary hover:underline" title="Needs LibreOffice installed on this computer">
              PDF
            </a>
          </>
        )}
        {hiddenCount > 0 && (
          <button type="button" onClick={onReset} className="font-medium text-primary hover:underline">
            Show {hiddenCount} hidden
          </button>
        )}
      </div>
      {(result.notes?.dkNote || result.notes?.filterNote) && (
        <p className="text-[11px] text-muted">
          {result.notes?.filterNote && <>{result.notes.filterNote} </>}
          {result.notes?.dkNote}
        </p>
      )}
      {showChart && <QuickCharts result={result} hiddenCols={hiddenCols} />}
      {result.notes?.design && (
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer font-medium text-foreground">About these tests</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{result.notes.test}</li>
            <li>{result.notes.design}</li>
            {result.notes.overlap && <li>{result.notes.overlap}</li>}
            {result.notes.tableTest && <li>{result.notes.tableTest}</li>}
            {result.notes.degenerateUntested && <li data-testid="crosstab-degenerate-untested">{result.notes.degenerateUntested}</li>}
            <li>Letters beside a figure name the columns it is significantly higher than within the same banner variable (column-pair test, 95%).</li>
            <li>{result.notes.means}</li>
            {result.provenance && (
              <li>
                Built {new Date(result.provenance.builtAt).toLocaleString("en-ZA")} from {result.provenance.sourceFile} ({result.provenance.cases?.toLocaleString() ?? "?"} cases), engine{" "}
                {result.provenance.engine ?? "unknown"}, weight {result.provenance.weightVar ?? "none"}, correction {result.provenance.correction}, design {result.provenance.design ? (result.provenance.design.psu ? `PSU ${result.provenance.design.psu}${result.provenance.design.strata ? `, strata ${result.provenance.design.strata}` : ""}` : `strata ${result.provenance.design.strata} (no clustering variable)`) : "weights only"}
                {result.provenance.questionnaireLabels ? ", questionnaire labels applied" : ""}.
              </li>
            )}
          </ul>
        </details>
      )}
      <div className={`overflow-auto rounded-lg border border-border${showChart && chartsOnly ? " hidden" : ""}`}>
        {/* data-*: stable identity for reading a table (tests, the browser adapter): this is the
            result table, for these row questions; the nested descriptive-statistics table is not. */}
        <table
          className="w-full border-collapse text-left text-xs"
          data-testid="crosstab-result-table"
          data-question-keys={JSON.stringify(result.questions.map((q) => q.key))}
        >
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-border">
              <th className="px-3 py-1.5" />
              {stack && <th className="px-2 py-1.5" />}
              {blocks.map(({ b, span }) => (
                <th key={b.var} colSpan={span} className="border-l border-border px-3 py-1.5 text-center font-semibold text-foreground">
                  {b.label}
                </th>
              ))}
              {!overall && <th className="border-l border-border px-3 py-1.5" />}
            </tr>
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-semibold text-muted">Answer</th>
              {stack && <th className="px-2 py-2 font-semibold text-muted">Measure</th>}
              {layout.map((e) => {
                if (e.kind === "net") {
                  const nb = result.nets?.find((x) => x.block === e.block);
                  return (
                    <th key={`net-${e.block}`} className="border-l border-border bg-slate-100 px-3 py-2 align-bottom font-semibold text-foreground">
                      NET
                      <div className={`font-normal ${nb && nb.n < reliableBase ? "text-amber-700" : "text-muted"}`}>n={nb ? nb.n.toLocaleString() : "-"}</div>
                    </th>
                  );
                }
                const { c, j } = e;
                return (
                  <th
                    key={j}
                    className="px-3 py-2 align-bottom font-semibold text-foreground"
                    data-col-var={c.var}
                    data-raw-code={c.rawCode}
                    data-raw-codes={c.rawCodes ? JSON.stringify(c.rawCodes) : undefined}
                  >
                    <div className="flex items-start gap-1">
                      <span>
                        {c.letter && <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-muted">{c.letter}</span>}
                        {c.name}
                      </span>
                      <button type="button" aria-label={`Hide ${c.name}`} onClick={() => onToggleCol(j)} className="text-muted hover:text-danger">
                        ×
                      </button>
                    </div>
                    <div className={`font-normal ${c.n < reliableBase || c.nEff < LOW_BASE ? "text-amber-700" : "text-muted"}`}>
                      n={c.n.toLocaleString()}
                      {c.n < reliableBase ? " indicative only" : c.nEff < LOW_BASE ? " low base" : ""}
                    </div>
                  </th>
                );
              })}
              {!overall && (
                <th className="border-l border-border px-3 py-2 font-semibold text-foreground">
                  Total
                  <div className="font-normal text-muted">n={result.total.n.toLocaleString()}</div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {result.questions.map((q, qi) => {
              let rows = q.rows.map((r, ri) => ({ r, key: `${qi}:${ri}` })).filter(({ key }) => !hiddenRows.has(key));
              if (q.kind === "single") {
                const isAns = (r: { isBase?: boolean; isNet?: boolean }) => !r.isBase && !r.isNet;
                if (sortBy === "order") {
                  // Keep the order the engine gave, so subtotals and scores stay where they were placed.
                  if (hideEmpty) rows = rows.filter(({ r }) => !isAns(r) || (r.total.count ?? 0) > 0);
                } else {
                  let ans = rows.filter(({ r }) => isAns(r));
                  if (hideEmpty) ans = ans.filter(({ r }) => (r.total.count ?? 0) > 0);
                  if (sortBy === "label") ans = [...ans].sort((a, b) => a.r.label.localeCompare(b.r.label));
                  if (sortBy === "size") ans = [...ans].sort((a, b) => (b.r.total.count ?? 0) - (a.r.total.count ?? 0));
                  rows = [...rows.filter(({ r }) => r.isBase), ...ans, ...rows.filter(({ r }) => r.isNet)];
                }
              } else if (hideEmpty && q.kind === "multi") {
                rows = rows.filter(({ r }) => r.isBase || (r.total.count ?? 0) > 0);
              }
              if (rows.length === 0) return null;
              return (
                <QuestionRows
                  key={q.key}
                  title={`${q.label}${q.key.startsWith("nets-") ? " (a respondent counts once if they chose any of the options)" : q.kind === "multi" ? " (multiple response, each option on its own base)" : q.kind === "grid" ? " (averages)" : ""}`}
                  colSpan={layout.length + (stack ? 3 : 2) - (overall ? 1 : 0)}
                  note={noteFor(q, statTicks)}
                >
                  {rows.map(({ r, key }) => {
                    const keys = measureKeys(q.kind === "numeric" || q.kind === "grid" || !!r.isScore, r);
                    const totalCell: CellData = {
                      pct: r.total.pct,
                      respPct: r.total.respPct,
                      rowPct: q.kind === "numeric" || q.kind === "grid" || r.isScore ? null : 100,
                      count: r.total.count,
                      nCell: r.total.nCell,
                      base: r.total.base,
                      sig: 0,
                      letters: undefined,
                    };
                    return keys.map((mk, mi) => {
                      const last = mi === keys.length - 1;
                      const rowCls = r.isBase ? "bg-slate-50 italic text-muted" : r.isNet ? "bg-slate-50 font-semibold" : "";
                      return (
                        <tr key={`${key}:${mk}`} className={`${last ? "border-b border-border" : "border-b border-slate-100"} last:border-b-0 ${rowCls}`}>
                          {mi === 0 && (
                            <td
                              rowSpan={keys.length}
                              // Identity for browser checks: the answer's code, not its wording.
                              data-raw-code={r.rawCode ?? undefined}
                              className="px-3 py-1.5 align-top text-foreground"
                            >
                              <span className="flex items-start gap-1">
                                <button
                                  type="button"
                                  aria-label={`Hide ${r.label}`}
                                  onClick={() => onToggleRow(key)}
                                  className="text-muted hover:text-danger"
                                >
                                  ×
                                </button>
                                <span>
                                  {r.label}
                                  {q.kind === "multi" && !r.isBase && (
                                    <span className="ml-1 text-[10px] text-muted">n={r.total.base.n.toLocaleString()}</span>
                                  )}
                                </span>
                              </span>
                            </td>
                          )}
                          {stack && <td className="px-2 py-1 text-[11px] font-normal not-italic text-muted">{MEASURE_LABEL[mk]}</td>}
                          {layout.map((e) => {
                            const cell = cellOf(r, e);
                            const isNetCol = e.kind === "net";
                            const tdBase = `${isNetCol ? "border-l border-border bg-slate-50" : ""} px-3 ${stack ? "py-1" : "py-1.5"} tabular-nums`;
                            if (!cell) {
                              return <td key={isNetCol ? `net-${e.block}` : e.j} className={tdBase}>{isNetCol ? "" : "-"}</td>;
                            }
                            const thin = !r.isBase && cell.base.n < reliableBase;
                            const colMode = mk === "col";
                            const sig = colMode && !r.isBase ? cell.sig : 0;
                            const cls =
                              mk === "letters"
                                ? ""
                                : thin
                                  ? "italic text-muted"
                                  : sig > 0
                                    ? "bg-emerald-50 font-medium text-emerald-800"
                                    : sig < 0
                                      ? "bg-rose-50 font-medium text-rose-800"
                                      : "";
                            const showLetters = (!stack || lettersBeside) && colMode && !r.isBase && !!cell.letters;
                            const p = e.kind === "col" ? r.p[e.j] : null;
                            const selKey = `${q.key}|${key}|${e.kind === "col" ? e.j : `net${e.block}`}`;
                            const pickCell = () => {
                              if (r.isBase) return;
                              const blockIdx = e.kind === "col" ? e.c.block : e.block;
                              const peers = layout
                                .filter((x): x is Extract<LayoutEntry, { kind: "col" }> => x.kind === "col" && x.c.block === blockIdx)
                                .map((x) => {
                                  const cc = cellOf(r, x);
                                  return { label: x.c.name, pct: cc?.pct ?? null, n: cc?.base.n ?? 0 };
                                });
                              selectCell({
                                key: selKey,
                                question: q.label,
                                row: r.label,
                                column: e.kind === "col" ? e.c.name : "NET",
                                banner: e.kind === "col" ? e.c.blockLabel : (result.blocks[e.block]?.label ?? ""),
                                cell,
                                p,
                                pAdj: e.kind === "col" ? r.pAdj?.[e.j] : undefined,
                                totalPct: r.total.pct,
                                thin,
                                peers,
                              });
                            };
                            return (
                              <td
                                key={isNetCol ? `net-${e.block}` : e.j}
                                onClick={pickCell}
                                className={`${tdBase} ${cls} ${r.isBase ? "" : "cursor-pointer hover:bg-primary-light/40"} ${cellSelected?.key === selKey ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
                                title={
                                  r.isBase
                                    ? undefined
                                    : `base n=${cell.base.n.toLocaleString()}${isNetCol ? ", all valid cases" : p === null ? ", too small to test" : `, p=${p < 0.001 ? "<0.001" : p}`}`
                                }
                              >
                                {measureText(mk, q.kind === "numeric" || q.kind === "grid" || !!r.isScore, r, cell)}
                                {mk === "col" && sig > 0 ? " ▲" : mk === "col" && sig < 0 ? " ▼" : ""}
                                {showLetters && <span className="ml-1 text-[10px] font-semibold text-emerald-700">{cell.letters}</span>}
                              </td>
                            );
                          })}
                          {!overall && (
                            <td className={`border-l border-border px-3 ${stack ? "py-1" : "py-1.5"} tabular-nums text-muted`}>
                              {measureText(mk, q.kind === "numeric" || q.kind === "grid" || !!r.isScore, r, totalCell)}
                            </td>
                          )}
                        </tr>
                      );
                    });
                  })}
                  {q.kind === "single" && (() => {
                    // Total row: the answers added up, so a reader can see each column reach 100% and the cases add to the base.
                    const answers = q.rows.filter((r) => !r.isBase && !r.isNet); // all answers, even if some are hidden, so the total stays true
                    if (answers.length < 2) return null;
                    const sum = (vals: (number | null | undefined)[]): number | null => {
                      const v = vals.filter((x): x is number => typeof x === "number");
                      return v.length === 0 ? null : v.reduce((a, b) => a + b, 0);
                    };
                    const tkeys = measureKeys(false, { nCell: answers[0].nCell }).filter((m) => m !== "row" && m !== "letters");
                    const fmt = (mk: MeasureKey, v: number | null) =>
                      v === null ? "" : mk === "col" ? `${fmtPct(Math.abs(v - 100) <= 0.5 ? 100 : v)}%` : fmtInt(v); // the cells are rounded to one decimal, so a sum of 100.1 is rounding, not an error
                    const pick = (mk: MeasureKey, e: LayoutEntry | "total"): number | null =>
                      sum(
                        answers.map((r) => {
                          if (e === "total") return mk === "col" ? r.total.pct : mk === "n" ? r.total.nCell : r.total.count;
                          const c = cellOf(r, e);
                          return !c ? null : mk === "col" ? c.pct : mk === "n" ? c.nCell : c.count;
                        }),
                      );
                    return tkeys.map((mk, mi) => (
                      <tr key={`total:${qi}:${mk}`} className={`border-t-2 border-border bg-slate-50 font-semibold ${mi === tkeys.length - 1 ? "border-b border-border" : ""}`}>
                        {mi === 0 && (
                          <td rowSpan={tkeys.length} className="px-3 py-1.5 align-top text-foreground">Total</td>
                        )}
                        {stack && <td className="px-2 py-1 text-[11px] font-normal text-muted">{MEASURE_LABEL[mk]}</td>}
                        {layout.map((e) => (
                          <td key={e.kind === "net" ? `tn-${e.block}` : `tc-${e.j}`} className={`${e.kind === "net" ? "border-l border-border" : ""} px-3 py-1 tabular-nums`}>
                            {fmt(mk, pick(mk, e))}
                          </td>
                        ))}
                        {!overall && <td className="border-l border-border px-3 py-1 tabular-nums">{fmt(mk, pick(mk, "total"))}</td>}
                      </tr>
                    ));
                  })()}
                  {overall && (() => {
                    const items: { label: string; d: CrosstabDesc }[] = q.desc
                      ? [{ label: "Codes of the answers", d: q.desc }]
                      : q.rows.filter((r) => !r.isBase && r.desc).map((r) => ({ label: r.label, d: r.desc as CrosstabDesc }));
                    if (items.length === 0) return null;
                    return (
                      <tr className="border-b border-border">
                        <td colSpan={layout.length + (stack ? 2 : 1)} className="px-3 py-2">
                          <DescTable items={items} weighted={weighted} />
                        </td>
                      </tr>
                    );
                  })()}
                </QuestionRows>
              );
            })}
          </tbody>
        </table>
      </div>
      {caption && <p className="text-[11px] italic text-muted">{caption}</p>}
    </div>
  );
}

const f2 = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : v.toFixed(2));

/** The chi-square line of a table, followed by whichever association measures are ticked. */
function tableTestText(tests: TableTest[] | undefined, st: StatPrefs): string | undefined {
  if (!tests || tests.length === 0) return undefined;
  return tests
    .map((t) => {
      const bits: string[] = [];
      if (st.v && t.cramersV !== undefined) bits.push(t.phi !== undefined ? `phi ${f2(t.phi)}` : `Cramer's V ${f2(t.cramersV)}`);
      if (st.c && t.contingencyC !== undefined) bits.push(`C ${f2(t.contingencyC)}`);
      if (st.lambda && t.lambdaAnswer != null) bits.push(`lambda ${f2(t.lambdaAnswer)}`);
      if (st.gamma && t.gamma !== undefined) bits.push(`gamma ${f2(t.gamma)}`);
      if (st.tauB && t.tauB !== undefined) bits.push(`tau-b ${f2(t.tauB)}`);
      if (st.tauC && t.tauC !== undefined) bits.push(`tau-c ${f2(t.tauC)}`);
      if (st.somersD && t.somersD !== undefined) bits.push(`Somers' d ${f2(t.somersD)}`);
      const sparse = t.lowExpectedPct !== undefined && t.lowExpectedPct > 20 ? `; ${t.lowExpectedPct}% of cells have an expected count under 5, so treat the chi-square with care` : "";
      const fisher = t.fisherP !== undefined ? `; Fisher exact p=${t.fisherP < 0.001 ? "<0.001" : t.fisherP}` : "";
      return `${t.label}: overall ${t.p < 0.001 ? "p<0.001" : t.p < 0.05 ? `p=${t.p}` : "no clear difference"} (chi-square ${t.chi2}, df ${t.df})${bits.length ? `; ${bits.join(", ")}` : ""}${fisher}${sparse}`;
    })
    .join("; ");
}

type QuestionLike = { kind: string; tableTests?: TableTest[]; rows: { isBase?: boolean; eta?: { block: number; label: string; eta: number }[] }[] };
/** The note under a question title: whole-table test and association measures, or eta for an average. */
function noteFor(q: QuestionLike, st: StatPrefs): string | undefined {
  const t = tableTestText(q.tableTests, st);
  if (q.kind !== "numeric" || !st.eta) return t;
  const row = q.rows.find((r) => !r.isBase && r.eta && r.eta.length > 0);
  const e = row?.eta?.map((x) => `${x.label}: eta ${f2(x.eta)}`).join("; ");
  return [t, e].filter(Boolean).join("; ") || undefined;
}

const fmtD = (v: number | null | undefined): string =>
  v === null || v === undefined ? "-" : v.toLocaleString("en-ZA", { maximumFractionDigits: 2 });

/** Mean, spread and range, one line per variable. Weighted when the table is weighted. */
function DescTable({ items, weighted }: { items: { label: string; d: CrosstabDesc }[]; weighted: boolean }) {
  const heads = ["n", "Mean", "Std. deviation", "Variance", "Std. error", "Minimum", "10th pct", "25th pct", "Median", "75th pct", "90th pct", "Maximum", "Range", "Mode", "Sum", "Skewness", "Kurtosis"];
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] font-semibold text-foreground">
        Descriptive statistics{weighted ? " (weighted; n is the number of cases)" : ""}
      </p>
      <table className="w-full border-collapse text-[11px]" data-testid="crosstab-descriptives">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-1 pr-3 text-left font-semibold">Variable</th>
            {heads.map((h) => (
              <th key={h} className="px-2 py-1 text-right font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(({ label, d }) => (
            <tr key={label} className="border-b border-slate-100 last:border-b-0">
              <td className="py-1 pr-3 text-foreground">{label}</td>
              {[d.n.toLocaleString("en-ZA"), fmtD(d.mean), fmtD(d.sd), fmtD(d.variance), fmtD(d.sem), fmtD(d.min), fmtD(d.p10), fmtD(d.p25), fmtD(d.median), fmtD(d.p75), fmtD(d.p90), fmtD(d.max), fmtD(d.range), fmtD(d.mode), fmtD(d.sum), fmtD(d.skewness), fmtD(d.kurtosis)].map((t, i) => (
                <td key={i} className="px-2 py-1 text-right tabular-nums">{t}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {items.some(({ d }) => d.hist && d.hist.length > 0) && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {items.filter(({ d }) => d.hist && d.hist.length > 0).map(({ label, d }) => (
            <div key={label}>
              <p className="text-[11px] text-muted">{label}: distribution (% of cases)</p>
              <Histogram d={d} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionRows({ title, colSpan, note, children }: { title: string; colSpan: number; note?: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-slate-100">
        <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-semibold text-foreground">
          {title}
          {note && <span className="ml-2 font-normal text-muted">{note}</span>}
        </td>
      </tr>
      {children}
    </>
  );
}


/** Combine answer categories into groups (for example top-2 box, "two or more"). */
/** Choose which options of a multiple-response question make up an any-of net. */
function NetDialog({
  row,
  labelOf,
  onClose,
  onSave,
}: {
  row: CrosstabRowItem;
  labelOf: (name: string) => string;
  onClose: () => void;
  onSave: (label: string, vars: string[]) => void;
}) {
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const ready = pick.size >= 2 && name.trim().length > 0;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-label="Net for multiple responses">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-border bg-white shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <p className="text-base font-semibold text-foreground">Net: {row.label}</p>
          <p className="text-xs text-muted">
            Tick the options to combine. A person is in the net if they chose at least one of them, and is counted once.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-2 flex gap-3 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => setPick(new Set(row.vars))}>
              Tick all
            </button>
            <button type="button" className="text-muted hover:underline" onClick={() => setPick(new Set())}>
              Clear
            </button>
            <span className="ml-auto text-muted">{pick.size} ticked</span>
          </div>
          <div className="space-y-0.5">
            {row.vars.map((n) => (
              <label key={n} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={pick.has(n)} onChange={() => setPick((p) => toggleIn(p, n))} />
                <span className="min-w-0 flex-1 truncate" title={labelOf(n)}>
                  {labelOf(n)}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 border-t border-border px-4 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name of the net, e.g. Any government grant"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {pick.size < 2 ? "Tick at least two options." : !name.trim() ? "Now name the net." : "Ready."}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-slate-400">
                Cancel
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => onSave(name.trim(), row.vars.filter((n) => pick.has(n)))}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Add net
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function GroupDialog({
  runId,
  documentId,
  variable,
  target,
  initial,
  onClose,
  onSave,
}: {
  runId: string;
  documentId: string;
  variable: string;
  target: "col" | "row";
  initial: CrosstabGroup[];
  onClose: () => void;
  onSave: (groups: CrosstabGroup[]) => void;
}) {
  const [list, setList] = useState<CategoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<CrosstabGroup[]>(initial);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [minusPick, setMinusPick] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"net" | "score" | "mean">("net");
  const [place, setPlace] = useState<"end" | "above" | "below">("end");
  const [positiveLast, setPositiveLast] = useState(true);

  useEffect(() => {
    let live = true;
    loadCategoriesAction(runId, documentId, variable).then((r) => {
      if (!live) return;
      if (r.ok) setList(r.list);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [runId, documentId, variable]);

  const used = new Set(groups.flatMap((g) => g.cats));
  // Columns need separate groups; rows may reuse a category in several nets.
  const taken = (c: string) => target === "col" && used.has(c);

  const rowMode = target === "row";
  /** The group being built, once it has what its kind needs. */
  const draft = (): CrosstabGroup | null => {
    const label = name.trim();
    if (!label) return null;
    if (!rowMode || kind === "net") return pick.size >= 2 ? { label, cats: [...pick], ...(rowMode ? { place } : {}) } : null;
    if (kind === "score") {
      return pick.size >= 1 && minusPick.size >= 1 && ![...pick].some((c) => minusPick.has(c))
        ? { label, cats: [...pick], minus: [...minusPick], kind: "score", place }
        : null;
    }
    return { label, cats: [], kind: "mean", place };
  };
  function addGroup() {
    const g = draft();
    if (!g) return;
    setGroups((x) => [...x, g]);
    setPick(new Set());
    setMinusPick(new Set());
    setName("");
  }
  /** Top 2 box, bottom 2 box, net score and mean score for a rating scale, leaving out don't know style answers and the middle. */
  function addLikertSet() {
    if (!list) return;
    const scale = list.categories.map((c) => c.label).filter((c) => !/^(don['\u2019\u2018`]?t know|do not know|dk\b|refus|no response|no answer|not applicable|n\/?a\b|not stated|unknown|missing)/i.test(c.trim()));
    if (scale.length < 4) {
      setError("A rating set needs at least four answers apart from don't know.");
      return;
    }
    setError(null);
    const top = positiveLast ? scale.slice(-2) : scale.slice(0, 2);
    const bottom = positiveLast ? scale.slice(0, 2) : scale.slice(-2);
    setGroups((g) => [
      ...g,
      { label: "Top 2 box", cats: top, place: "end" },
      { label: "Bottom 2 box", cats: bottom, place: "end" },
      { label: "Top 2 minus bottom 2", cats: top, minus: bottom, kind: "score", place: "end" },
      { label: "scale", cats: [], kind: "mean", place: "end" },
    ]);
  }

  const pending: CrosstabGroup | null = draft();
  const finalGroups = pending ? [...groups, pending] : groups;
  const preview = (() => {
    if (!list || finalGroups.length === 0) return null;
    if (target === "row") {
      const labels = list.categories.map((c) => c.label);
      const out = [...labels];
      const word = (g: CrosstabGroup) => (g.kind === "score" ? `Net score: ${g.label}` : g.kind === "mean" ? `Mean score: ${g.label}` : `NET: ${g.label}`);
      const tail: string[] = [];
      for (const g of finalGroups) {
        const anchor = [...(g.cats ?? []), ...(g.minus ?? [])];
        const idx = out.map((l, i) => (anchor.includes(l) ? i : -1)).filter((i) => i >= 0);
        if (g.place === "above" && idx.length) out.splice(idx[0], 0, word(g));
        else if (g.place === "below" && idx.length) out.splice(idx[idx.length - 1] + 1, 0, word(g));
        else tail.push(word(g));
      }
      return `Rows: ${[...out, ...tail].join(", ")}`;
    }
    const member = new Map<string, number>();
    finalGroups.forEach((g, i) => g.cats.forEach((c) => member.set(c, i)));
    const out: string[] = [];
    const done = new Set<number>();
    for (const c of list.categories) {
      const gi = member.get(c.label);
      if (gi === undefined) out.push(c.label);
      else if (!done.has(gi)) {
        done.add(gi);
        out.push(finalGroups[gi].label);
      }
    }
    return `Columns: ${out.join(", ")}`;
  })();

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-label="Group categories" className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-surface shadow-xl">
        <div className="border-b border-border p-3">
          <p className="text-sm font-semibold text-foreground">Group categories: {list?.label ?? variable}</p>
          <p className="text-[11px] text-muted">
            {target === "col"
              ? "Grouped categories become one column; the rest stay as they are. A category can be in one group only."
              : "Add subtotals (NET), a net score (share positive minus share negative, in points) or a mean score, and choose where each row sits. Respondents with no valid answer are left out of the base."}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          {error && <p className="text-danger">{error}</p>}
          {!list && !error && <p className="text-muted">Loading categories...</p>}
          {rowMode && list && (
            <div className="space-y-2 rounded border border-border bg-slate-50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  Row type
                  <select value={kind} onChange={(e) => setKind(e.target.value as "net" | "score" | "mean")} className="rounded border border-border px-1 py-0.5">
                    <option value="net">Subtotal (NET)</option>
                    <option value="score">Net score (positive minus negative)</option>
                    <option value="mean">Mean score (average of the codes)</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Place
                  <select value={place} onChange={(e) => setPlace(e.target.value as "end" | "above" | "below")} className="rounded border border-border px-1 py-0.5">
                    <option value="end">After the answers</option>
                    <option value="above">Above the answers it covers</option>
                    <option value="below">Below the answers it covers</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={addLikertSet} className="rounded border border-border bg-white px-2 py-1 font-medium">
                  Add rating set: top 2, bottom 2, net score, mean
                </button>
                <label className="flex items-center gap-1">
                  Positive end is
                  <select value={positiveLast ? "last" : "first"} onChange={(e) => setPositiveLast(e.target.value === "last")} className="rounded border border-border px-1 py-0.5">
                    <option value="last">the last answer</option>
                    <option value="first">the first answer</option>
                  </select>
                </label>
              </div>
              {kind === "mean" && <p className="text-[11px] text-muted">Uses the numeric codes of the answers. Don&apos;t know style codes are left out.</p>}
              {kind === "score" && <p className="text-[11px] text-muted">Tick positive answers in the + column and negative answers in the − column.</p>}
            </div>
          )}
          {list && kind !== "mean" && (
            <ul className="space-y-1">
              {rowMode && kind === "score" && (
                <li className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="w-4 text-center">+</span>
                  <span className="w-4 text-center">−</span>
                </li>
              )}
              {list.categories.map((c) => (
                <li key={c.label}>
                  <label className={`flex items-center gap-2 ${taken(c.label) ? "text-muted" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={taken(c.label)}
                      checked={pick.has(c.label)}
                      onChange={() => {
                        setPick((p) => toggleIn(p, c.label));
                        setMinusPick((m) => { const n = new Set(m); n.delete(c.label); return n; });
                      }}
                    />
                    {rowMode && kind === "score" && (
                      <input
                        type="checkbox"
                        checked={minusPick.has(c.label)}
                        onChange={() => {
                          setMinusPick((m) => toggleIn(m, c.label));
                          setPick((p) => { const n = new Set(p); n.delete(c.label); return n; });
                        }}
                      />
                    )}
                    <span className="flex-1">{c.label}</span>
                    <span className="text-muted">n={c.n.toLocaleString()}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted">{pick.size}{kind === "score" ? ` + ${minusPick.size} −` : ""} ticked</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "mean" ? "Name, e.g. satisfaction" : "Group name, e.g. Top 2 box"}
              className="min-w-0 flex-1 rounded border border-border px-2 py-1"
            />
            <button
              type="button"
              disabled={!draft()}
              onClick={addGroup}
              className="rounded border border-border px-2 py-1 font-medium disabled:opacity-50"
            >
              Add group
            </button>
          </div>
          {pending && (
            <p className="text-[11px] text-muted">
              &quot;{pending.label}&quot; ({pending.kind === "mean" ? "all answers" : `${pending.cats.length + (pending.minus?.length ?? 0)} categories`}) will be added when you save.
            </p>
          )}
          {preview && <p className="rounded bg-slate-50 p-2 text-[11px] text-foreground">{preview}</p>}
          {groups.length > 0 && (
            <ul className="space-y-1">
              {groups.map((g, i) => (
                <li key={`${g.label}-${i}`} className="flex items-start justify-between gap-2 rounded bg-slate-100 px-2 py-1">
                  <span>
                    <span className="font-medium">{g.kind === "score" ? "Net score: " : g.kind === "mean" ? "Mean score: " : ""}{g.label}</span>
                    {g.kind === "mean" ? ": average of the codes" : <>: {g.cats.join(", ")}{g.minus?.length ? ` minus ${g.minus.join(", ")}` : ""}</>}
                    {g.place && g.place !== "end" ? ` (${g.place === "above" ? "above" : "below"} its answers)` : ""}
                  </span>
                  <button type="button" onClick={() => setGroups((x) => x.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-3 text-xs">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1">
            Cancel
          </button>
          <button type="button" onClick={() => onSave(finalGroups)} className="rounded bg-primary px-3 py-1 font-medium text-white">
            Save {finalGroups.length} group{finalGroups.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

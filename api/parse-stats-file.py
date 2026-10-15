"""Vercel Python serverless function: converts an SPSS (.sav), Stata (.dta),
or SAS (.sas7bdat) file into the same {headers, rows} shape parseTable.ts
already produces for CSV/Excel, so every downstream consumer in the
TypeScript app (the table preview, the banner-plan picker,
bannerPlanComputation.ts) needs no format-specific handling of its own.

This exists because there is no reliable JavaScript/Node reader for these
binary formats, and because the metadata these formats carry - variable
labels (e.g. the variable named "Q7a" meaning "Preferred channel") and
value labels (e.g. the code 1 meaning "Male") - is usually the actual
reason a dataset was produced in labelled stats software rather than a
plain spreadsheet, not optional decoration. pyreadstat is the Python
ecosystem's reader for all three formats and surfaces both label kinds, so
decoding happens once, here, rather than being reimplemented in every
place a header or a category value gets displayed or compared.

Request/response shape: the request body is a small JSON object naming
where the source file already lives in Supabase Storage
({storagePath, sourceFilename, bucket?}), not the file's bytes, and the
response is likewise just the storage path of a converted-result JSON
file this function wrote ({resultPath}), not the parsed table itself.
This function downloads the source file from storage and uploads its
result back to storage directly, rather than carrying either one through
the HTTP request/response body that invokes it, because Vercel serverless
functions cap both directions of that body at 4.5MB - comfortably smaller
than a real SPSS/Stata/SAS file's own size, let alone the size of its
fully label-decoded JSON equivalent. Caller (parseStatsFile.ts) downloads
the result from the path this returns using the same Supabase client it
already has, which has no such limit since that's an ordinary storage
download, not a function invocation payload.
"""

import csv
import hashlib
import json
import math
import os
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

import pyreadstat

READERS = {
    ".sav": pyreadstat.read_sav,
    ".dta": pyreadstat.read_dta,
    ".sas7bdat": pyreadstat.read_sas7bdat,
}

DEFAULT_BUCKET = "documents"


def _supabase_env() -> tuple[str, str]:
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SECRET_KEY"]
    return url, key


def _storage_download(bucket: str, path: str) -> bytes:
    base_url, key = _supabase_env()
    request = urllib.request.Request(
        f"{base_url}/storage/v1/object/{bucket}/{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Could not download {path} from storage ({exc.code}): {detail}") from exc


def _storage_upload(bucket: str, path: str, data: bytes, content_type: str) -> None:
    base_url, key = _supabase_env()
    request = urllib.request.Request(
        f"{base_url}/storage/v1/object/{bucket}/{path}",
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(request):
            pass
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Could not upload result to {path} ({exc.code}): {detail}") from exc


def _clean_value(value):
    """Turns a pandas/numpy cell value into something json.dumps can take.

    Covers the three shapes pyreadstat/pandas actually hand back: a plain
    Python scalar (passes through), a numpy scalar (unwrapped via .item()),
    and a float NaN (pandas' representation of a missing value in both
    numeric and, after read, originally-string columns) -> None. A
    date/datetime value (from a Stata/SPSS date-formatted variable) is
    rendered as its ISO string rather than dropped.
    """
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _resolve_value(raw_name, value, value_labels_by_var):
    """Decodes a coded value (e.g. 1.0) to its label (e.g. "Male") when
    this variable has value labels. SPSS stores numeric codes as floats
    even when they're conceptually integers, and pyreadstat's label-dict
    keys aren't consistently typed across the three formats, so this tries
    the value as given, then as an int, before giving up and leaving the
    raw code in place (better a visible code than a silently dropped row).
    """
    if value is None:
        return None
    labels_for_col = value_labels_by_var.get(raw_name)
    if not labels_for_col:
        return value
    if value in labels_for_col:
        return labels_for_col[value]
    if isinstance(value, float) and value.is_integer() and int(value) in labels_for_col:
        return labels_for_col[int(value)]
    return value


def _build_headers(raw_names, variable_labels):
    """Each column's display header is its variable label when it has one,
    else its raw SPSS/Stata/SAS variable name. Two variables sharing a
    label (uncommon, but labels aren't required to be unique the way
    variable names are) get the raw name appended to disambiguate, so two
    columns never collide into one. The disambiguated form is itself
    checked against what has already been used - appending the raw name
    once was not enough when that exact "label (raw_name)" combination was
    itself already taken by an earlier column (for example labels
    "Shared (b)", "Shared", "Shared" over raw names a, c, b all resolve to
    "Shared (b)" without this second check) - so a still-colliding result
    keeps counting up (", #2", ", #3", ...) until it is actually unique.
    """
    headers = []
    seen = set()
    for raw_name in raw_names:
        label = variable_labels.get(raw_name) or raw_name
        if label in seen:
            label = f"{label} ({raw_name})"
        n = 2
        base = label
        while label in seen:
            label = f"{base}, #{n}"
            n += 1
        seen.add(label)
        headers.append(label)
    return headers


# Rows are stored as one JSON object per case, keyed by each variable's full
# label, so a very wide file (FinScope: 5,600 cases x 3,776 variables with
# ~85 character labels) would come to roughly 2GB of JSON, far past what the
# Node side can hold in one string. Past this budget only the usable
# variables are kept, in file order, and the result says how many were left out.
MAX_RESULT_BYTES = 100_000_000
AVG_VALUE_BYTES = 12


def _select_columns(df, headers):
    """Returns the raw column names to keep. Everything is kept when the
    result fits the budget. Otherwise columns that cannot be compared
    (mostly empty, constant, free text or ID-like) are dropped, and the rest
    are kept in file order (demographics usually come first in a survey)
    until the size budget is reached."""
    n = len(df)
    names = list(df.columns)
    est = lambda h: n * (len(h) + AVG_VALUE_BYTES + 6)
    if sum(est(h) for h in headers) <= MAX_RESULT_BYTES:
        return names
    kept, used = [], 0
    for raw_name, header in zip(names, headers):
        col = df[raw_name]
        nonnull = int(col.notna().sum())
        if n == 0 or nonnull / n < 0.5:
            continue
        distinct = int(col.nunique(dropna=True))
        if distinct < 2:
            continue
        if col.dtype == object and (distinct > 50 or (distinct == nonnull and nonnull > 30)):
            continue
        cost = est(header)
        if used + cost > MAX_RESULT_BYTES:
            continue
        kept.append(raw_name)
        used += cost
    return kept


def _remove_quietly(path: str) -> None:
    """Delete a temp file. A file the OS still holds open (Windows) is left for the temp cleaner, not an error."""
    try:
        os.unlink(path)
    except OSError:
        pass


def convert(file_bytes: bytes, source_filename: str) -> dict:
    ext = os.path.splitext(source_filename.lower())[1]
    reader = READERS.get(ext)
    if reader is None:
        raise ValueError(f"Unsupported stats file extension: {ext or '(none)'}")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        df, meta = reader(tmp_path)
    finally:
        _remove_quietly(tmp_path)

    variable_labels = meta.column_names_to_labels or {}
    value_labels_by_var = meta.variable_value_labels or {}

    all_names = list(df.columns)
    all_headers = _build_headers(all_names, variable_labels)
    raw_names = _select_columns(df, all_headers)
    keep = set(raw_names)
    headers = [h for rn, h in zip(all_names, all_headers) if rn in keep]

    rows = []
    for _, record in df.iterrows():
        row = {}
        for raw_name, header in zip(raw_names, headers):
            value = _clean_value(record[raw_name])
            row[header] = _resolve_value(raw_name, value, value_labels_by_var)
        rows.append(row)

    result = {"headers": headers, "rows": rows}
    if len(raw_names) < len(all_names):
        result["totalVariables"] = len(all_names)
        result["keptVariables"] = len(raw_names)
    return result



# ---------------------------------------------------------------------------
# Variable dictionary and on-demand weighted crosstabs.
#
# A wide survey file (FinScope: 3,776 variables) cannot sensibly be loaded as
# one table. Instead the file stays in storage, `dictionary` lists its
# variables, and `crosstab` reads only the few variables a researcher picks.
# ---------------------------------------------------------------------------

import re

MAX_COLUMN_GROUPS = 15
MAX_ROW_CATEGORIES = 30
NUMERIC_AS_CATEGORIES_MAX = 25
# Bump when the dictionary changes shape, so saved copies are rebuilt.
DICTIONARY_VERSION = 6
ENGINE_VERSION = "2026.10.09-7"  # bump when a calculation or a rule changes; stored with every table
MIN_EFFECTIVE_BASE = 30
MIN_BASE_SUPPRESS = 10   # unweighted base under this: cell values are not shown (dash)
MIN_BASE_RELIABLE = 30   # unweighted base under this: figure shown as indicative only, never tested or turned into a finding
LOW_BASE_FLAG = 100      # kept for compatibility
SIG_LEVEL = 0.05
# Value labels that mean "no usable answer"; such codes never enter a mean.
_DK_RE = re.compile(r"^(don['\u2019\u2018`]?t know|do not know|dk\b|refus|no response|no answer|not applicable|n/?a\b|not stated|unknown|missing)", re.IGNORECASE)
_WEIGHT_RE = re.compile(r"weight|wgt|\bwt\b", re.IGNORECASE)


class _PlainMeta:
    """Stand-in for pyreadstat metadata on files that carry no labels (CSV, Excel).
    An Excel workbook can carry them on other sheets; see _excel_labels and
    _excel_codebook."""

    def __init__(self, labels=None, value_labels=None, used=None, mr_sets=None, variable_measure=None, missing_ranges=None, label_conflicts=None, unsupported_identifier_columns=None):
        self.column_names_to_labels = labels or {}
        self.variable_value_labels = value_labels or {}
        self.sheets = used or {}
        # variable name -> the multiple-response question it belongs to, read
        # straight from a codebook sheet's own "Multiple response set" column
        # rather than guessed from the variable name.
        self.mr_sets = mr_sets or {}
        # Both empty for a CSV/Excel file, which declares neither. For a
        # pyreadstat-read file carried through _read_raw's cache, these are
        # the real declared values (see _read_raw below) rather than always
        # empty, which they silently became on every cache hit before this.
        self.variable_measure = variable_measure or {}
        self.missing_ranges = missing_ranges or {}
        # A later sheet's (or the codebook's) label for the same variable or the same
        # value code used to silently overwrite an earlier one with no record of which
        # sheet or row won. Each entry here names the variable, what kind of label
        # collided, the value that was kept and the one that was discarded, so a
        # researcher can tell the import got the right one rather than guessing.
        self.label_conflicts = label_conflicts or []
        # IMP-SHIP-002 (Codex round 2): id-like columns whose Excel cell format this
        # pipeline could not faithfully reproduce on this side - see
        # _apply_zero_padded_id_formats. Empty for CSV (no cell-format concept) and for
        # any file where every id-like column was plain text, unformatted, or zero-padding.
        self.unsupported_identifier_columns = unsupported_identifier_columns or []


TABLE_EXTS = (".csv", ".tsv", ".xlsx", ".xls")

_DICT_SHEET_RE = re.compile(r"variable|dictionary|codebook|label|metadata|legend|value|code|lookup|readme|notes|schema", re.I)
_VAR_COL_RE = re.compile(r"^(variable( name)?|var( name)?|name|column( name)?|field( name)?|item|question ?id|qid|var ?id|code ?name)$", re.I)
_LABEL_COL_RE = re.compile(r"^((variable|question|var|item) )?(label|description|text|title|wording)$|^question$", re.I)
_VALUE_COL_RE = re.compile(r"^(value|code|key|answer ?code|option ?code|category ?code|numeric value)$", re.I)
_VLABEL_COL_RE = re.compile(r"^(value ?label|code ?label|answer|answer ?label|category|option|response|meaning|label of value|value ?description|value ?text)$", re.I)


def _classify_header(cells):
    """Positions of the variable, label, value and value-label columns in a header row."""
    pos = {"var": None, "label": None, "value": None, "vlabel": None}
    for i, c in enumerate(cells):
        if not c:
            continue
        if pos["var"] is None and _VAR_COL_RE.match(c):
            pos["var"] = i
        elif pos["value"] is None and _VALUE_COL_RE.match(c):
            pos["value"] = i
        elif pos["vlabel"] is None and _VLABEL_COL_RE.match(c):
            pos["vlabel"] = i
        elif pos["label"] is None and _LABEL_COL_RE.match(c):
            pos["label"] = i
    return pos


def _excel_labels(xl, other_sheets, data_columns, numeric_cols):
    """Reads variable labels and value labels from the workbook's other sheets.

    Understands the usual layouts: a sheet of [variable, label], a sheet of
    [variable, value, value label], and a combined sheet of
    [variable, label, value, value label] where the variable repeats or is
    left blank under its first row. Anything else is ignored."""
    import pandas as pd

    names = set(data_columns)
    var_labels, value_labels, used = {}, {}, {"variables": None, "values": None}
    var_label_sheet: dict[str, str] = {}
    conflicts: list[dict] = []
    for sheet in other_sheets:
        try:
            raw = xl.parse(sheet, header=None, dtype=object)
        except Exception:
            continue
        if raw.empty:
            continue
        found = None
        for r in range(min(6, len(raw))):
            cells = ["" if pd.isna(x) else str(x).strip().lower() for x in raw.iloc[r]]
            pos = _classify_header(cells)
            if pos["var"] is not None and (pos["label"] is not None or pos["vlabel"] is not None or pos["value"] is not None):
                found = (r, pos)
                break
        if not found:
            continue
        r, pos = found
        body = raw.iloc[r + 1:]
        vcol = body.iloc[:, pos["var"]].ffill() if pos["value"] is not None else body.iloc[:, pos["var"]]
        has_values = pos["value"] is not None and (pos["vlabel"] is not None or pos["label"] is not None)
        vl_pos = pos["vlabel"] if pos["vlabel"] is not None else pos["label"]
        for idx in body.index:
            name = vcol.loc[idx]
            if pd.isna(name):
                continue
            name = str(name).strip()
            if name not in names:
                continue
            if pos["label"] is not None and not (has_values and pos["vlabel"] is None):
                lab = body.loc[idx].iloc[pos["label"]]
                if not pd.isna(lab) and str(lab).strip():
                    lab = str(lab).strip()
                    if name not in var_labels:
                        var_labels[name] = lab
                        var_label_sheet[name] = sheet
                        used["variables"] = sheet
                    elif var_labels[name] != lab:
                        # First sheet to declare a label for this variable still wins (unchanged
                        # behaviour), but a later, different one is now recorded rather than
                        # dropped with no trace.
                        conflicts.append(
                            {
                                "variable": name,
                                "kind": "variable_label",
                                "keptSheet": var_label_sheet.get(name),
                                "kept": var_labels[name],
                                "discardedSheet": sheet,
                                "discarded": lab,
                            }
                        )
            if has_values:
                key = body.loc[idx].iloc[pos["value"]]
                lab = body.loc[idx].iloc[vl_pos]
                if pd.isna(key) or pd.isna(lab):
                    continue
                if name in numeric_cols:
                    try:
                        key = float(key)
                    except (TypeError, ValueError):
                        continue
                else:
                    key = str(key).strip()
                lab = str(lab).strip()
                existing = value_labels.setdefault(name, {})
                if key in existing and existing[key] != lab:
                    # Here the later sheet/row wins (unchanged behaviour); the earlier
                    # value is what gets discarded and recorded.
                    conflicts.append(
                        {
                            "variable": name,
                            "kind": "value_label",
                            "value": key,
                            "keptSheet": sheet,
                            "kept": lab,
                            "discardedSheet": used.get("values"),
                            "discarded": existing[key],
                        }
                    )
                existing[key] = lab
                used["values"] = sheet
    return var_labels, value_labels, used, conflicts



_CB_VAR_RE = re.compile(r"variable", re.I)
_CB_LABEL_RE = re.compile(r"label|question|wording|description", re.I)
_CB_CODES_RE = re.compile(r"response code|value code|missing value|coded value|value label", re.I)
_CB_SET_RE = re.compile(r"multiple response|mr ?set|multi.?response|question group", re.I)
# Finds "N=label" entries in a packed codes cell such as
# "0=Not selected; 1=Selected" or "0=None of listed brands used. 1=Platō Coffee.
# 2=Mugg & Bean", splitting on whichever separator (; or .) sits before the
# next code, so either style of codebook punctuation reads the same way.
_CODE_ENTRY_RE = re.compile(r"(-?\d+)\s*=\s*(.*?)(?=(?:[;.]\s*[A-Za-z0-9-]+\s*=)|$)")


def _parse_code_entries(text):
    """"0=Not selected; 1=Selected" -> {0.0: "Not selected", 1.0: "Selected"}."""
    out = {}
    if text is None:
        return out
    for m in _CODE_ENTRY_RE.finditer(str(text)):
        label = m.group(2).strip(" ;.\u2013-")
        if not label:
            continue
        try:
            out[float(m.group(1))] = label
        except ValueError:
            continue
    return out


def _excel_codebook(xl, other_sheets, data_columns):
    """A one-row-per-variable codebook sheet: a Variable column, a label
    column (however titled - "Variable label", "Variable label / question",
    "Question wording"...), and usually a single column packing every value's
    code and label together ("Response codes / missing values": "0=No;
    1=Yes"), rather than one row per value the way _excel_labels expects.
    Many teams document their own questionnaires this way; a documented
    "Multiple response set" column, when present, is a stronger signal than
    guessing a shared question from the variable names, so it is read too and
    returned separately for the caller to use as an override."""
    import pandas as pd

    names = set(data_columns)
    var_labels, value_labels, mr_sets = {}, {}, {}
    conflicts: list[dict] = []
    for sheet in other_sheets:
        try:
            raw = xl.parse(sheet, header=0, dtype=object)
        except Exception:
            continue
        if raw.empty:
            continue
        cols = {str(c).strip().lower(): c for c in raw.columns if not str(c).lower().startswith("unnamed")}
        # The variable-id column is matched strictly first (the same anchored pattern that
        # already handles the row-per-value layout: "Variable", "Variable Name", "Var ID"...),
        # since a loose "contains variable" search also matches compound headers like "Variable
        # label / question" or "Variable type" and, on some sheets, picks the wrong one. Only a
        # sheet with no strict match falls back to that loose search, and even then never onto
        # something that already looks like a label/code/question column.
        var_col = next((c for k, c in cols.items() if _VAR_COL_RE.match(k)), None)
        if var_col is None:
            var_col = next(
                (c for k, c in cols.items() if _CB_VAR_RE.search(k) and not any(x in k for x in ("label", "code", "question"))),
                None,
            )
        if var_col is None:
            continue
        label_col = next((c for k, c in cols.items() if _CB_LABEL_RE.search(k) and "set" not in k and "code" not in k), None)
        codes_col = next((c for k, c in cols.items() if _CB_CODES_RE.search(k)), None)
        set_col = next((c for k, c in cols.items() if _CB_SET_RE.search(k)), None)
        if label_col is None and codes_col is None:
            continue
        found_any = False
        for _, row in raw.iterrows():
            name = row.get(var_col)
            if pd.isna(name):
                continue
            name = str(name).strip()
            if name not in names:
                continue
            found_any = True
            if label_col is not None:
                lab = row.get(label_col)
                if not pd.isna(lab) and str(lab).strip():
                    lab = str(lab).strip()
                    # A duplicate variable row within the same codebook sheet: the last
                    # row still wins (unchanged behaviour), the earlier one is recorded.
                    if name in var_labels and var_labels[name] != lab:
                        conflicts.append(
                            {
                                "variable": name,
                                "kind": "variable_label",
                                "keptSheet": sheet,
                                "kept": lab,
                                "discardedSheet": sheet,
                                "discarded": var_labels[name],
                            }
                        )
                    var_labels[name] = lab
            if codes_col is not None:
                entries = _parse_code_entries(row.get(codes_col))
                if entries:
                    if name in value_labels and value_labels[name] != entries:
                        conflicts.append(
                            {
                                "variable": name,
                                "kind": "value_label",
                                "keptSheet": sheet,
                                "kept": entries,
                                "discardedSheet": sheet,
                                "discarded": value_labels[name],
                            }
                        )
                    value_labels[name] = entries
            if set_col is not None:
                key = row.get(set_col)
                if not pd.isna(key) and str(key).strip():
                    mr_sets[name] = str(key).strip()
        if found_any:
            break  # one codebook sheet is the normal case; stop once we've read one
    return var_labels, value_labels, mr_sets, conflicts


# pandas' default read_csv/read_excel NA-token matching (pandas.io.parsers.STR_NA_VALUES)
# does not strip surrounding whitespace before comparing, so a literal "NA " (trailing
# space) survives as a real string value instead of becoming missing - unlike
# parseTable.ts's preview path, which strips the cell text before checking the same
# token list. Keeping a second, stripped pass here after the read keeps both paths
# producing the same missing cells for the same file.
_NA_STRING_TOKENS = {
    "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan",
    "1.#IND", "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
}


def _normalize_na_strings(df):
    import pandas as pd

    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].map(lambda v: None if isinstance(v, str) and v.strip() in _NA_STRING_TOKENS else v)
    return df


# A header naming an identifier ("ID", "Respondent ID", "Case_ID", "RespID", "UUID")
# is read as text so a leading-zero identifier like "001" keeps its zero, instead of
# pandas' usual column-wide numeric inference silently reading it as the integer 1.
# Matched by whole token, not substring, so an ordinary word that happens to end in
# "id" (Avoid, Valid, Solid, Void) is left to its normal, inferred dtype.
_ID_HEADER_TOKENS = {"id", "ids", "uuid", "guid"}


def _header_tokens(name):
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(name))
    s = re.sub(r"[^A-Za-z0-9]+", " ", s)
    return [t.lower() for t in s.split() if t]


def _is_id_like_header(name):
    return any(t in _ID_HEADER_TOKENS for t in _header_tokens(name))


def _dedupe_header_names(headers: list[str]) -> list[str]:
    """IMP-003: disambiguates a repeated header ("q, q, q (2)" -> "q", "q (2)", "q (3)"),
    ported statement-for-statement from src/lib/parseTable.ts's dedupeHeaders() so the two
    sides can never assign a colliding header a different canonical name.

    MUST run on the raw header text before pandas ever constructs a DataFrame from it:
    pd.read_csv/pd.ExcelFile.parse unconditionally rename a genuine duplicate column to
    pandas' own "name", "name.1", "name.2" convention the moment they build the column
    index (there is no way to opt out of this in current pandas), which silently replaced
    this function's own job before it ever ran - df.columns.duplicated() downstream always
    came back empty, because pandas had already resolved every duplicate under a DIFFERENT
    naming convention than this one, before this function's own loop ever got a chance.
    Calling this directly on the worksheet's own first row - read with header=None so
    pandas never gets to name the columns itself - is the only way the two readers can
    still agree on a collision's resulting name.
    """
    if len(set(headers)) == len(headers):
        return list(headers)
    used: set[str] = set(headers)
    counts: dict[str, int] = {}
    renamed: list[str] = []
    for h in headers:
        counts[h] = counts.get(h, 0) + 1
        if counts[h] == 1:
            renamed.append(h)
            continue
        n = counts[h]
        candidate = f"{h} ({n})"
        while candidate in used:
            n += 1
            candidate = f"{h} ({n})"
        counts[h] = n
        used.add(candidate)
        renamed.append(candidate)
    return renamed


# IMP-SHIP-002 (Excel-specific residual gap, narrowed rather than eliminated): a numeric
# cell whose leading zero comes only from a custom Excel number format (e.g. a respondent
# ID column formatted "0000" so 7 displays as "0007") has no pandas equivalent - pandas
# reads the underlying numeric value only, never the format code, so forcing dtype=str
# there just stringifies the raw number ("7"), unlike a cell that stores "0007" as
# literal text (which dtype=str already preserves exactly, no special handling needed).
# This covers only the plain all-zero-digit-placeholder case ("0", "00", "0000", ...),
# which is the realistic shape for a fixed-width ID column; a more elaborate custom
# number format on an id-like column (thousands separators, conditional sections, text
# sections) is a disclosed, narrower gap this does not attempt to re-derive.
_ZERO_PAD_FORMAT_RE = re.compile(r"^0+$")
GENERAL_FORMAT_RE = re.compile(r"^general$", re.I)


# IMP-SHIP-001 (Codex round 2, "a missing selected sheet must produce an explicit
# recovery state, never automatic substitution"): the Python counterpart of
# src/lib/parseTable.ts's SheetSelectionLostError. Raised only when `selected_sheet` is a
# non-empty name that no longer exists in this workbook; a `selected_sheet` of None/""
# (nothing persisted yet for this document) is not an error and still resolves via the
# normal ranking rule below.
class SheetSelectionLostError(ValueError):
    def __init__(self, document_sheet_name, available_sheets):
        self.code = "SHEET_SELECTION_LOST"
        self.document_sheet_name = document_sheet_name
        self.available_sheets = list(available_sheets)
        super().__init__(
            f'This document\'s previously selected sheet "{document_sheet_name}" no longer exists in the '
            f'workbook (available sheets: {", ".join(available_sheets) or "(none)"}). The file was likely '
            "re-uploaded with a different layout. Re-confirm which sheet holds this document's data before "
            "reading it again."
        )


# IMP-SHIP-001 (Codex round 2): counts a sheet's actual DATA rows (any row, after the
# header row, with at least one non-blank cell) - mirrors src/lib/parseTable.ts's
# countDataRows() exactly. This replaced ranking candidate sheets by
# `xl.parse(n, header=None).size` (the parsed dataframe's cell count, which still counts
# every cell in the sheet's used range whether or not it actually holds a value), which
# Codex's Sparse/Dense fixture showed could disagree with the TS preview's old
# `!ref`-extent ranking in the same direction: a sheet formatted out to a large empty
# range (for example formatting applied across A1:J101 with only one real row of data)
# inflates its apparent size on EITHER of the old per-side heuristics, independently of
# the other. Counting only rows that actually contain a value removes the disagreement at
# its source - both sides now rank by the same real quantity - rather than relying solely
# on provenance persistence to paper over two different answers.
def _is_blank_or_na_token(value) -> bool:
    """Codex round 3: the canonical "missing for ranking purposes" rule, shared with
    parseTable.ts's `countDataRows`. A plain pandas `.notna()` check is not enough here:
    it does not strip whitespace before comparing against pandas' own default NA-token
    list (so "NA " with a trailing space survives as a real string instead of becoming
    missing), and the TypeScript preview's own ranking path strips the cell text before
    checking the same token list. Reusing `_NA_STRING_TOKENS` (already applied elsewhere
    in this file via `_normalize_na_strings`) after a trim keeps both readers counting
    the same rows as "has data" for the identical file."""
    try:
        import pandas as pd

        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    return text == "" or text in _NA_STRING_TOKENS


def _count_data_rows(xl, sheet_name) -> int:
    raw = xl.parse(sheet_name, header=None)
    if raw.shape[0] <= 1:
        return 0
    body = raw.iloc[1:]
    count = 0
    for _, row in body.iterrows():
        if any(not _is_blank_or_na_token(v) for v in row):
            count += 1
    return count


def _apply_zero_padded_id_formats(path, sheet_name, headers, df):
    """IMP-SHIP-002: reconstructs a plain zero-padded display value (e.g. "0007" for the
    stored number 7, formatted "0000") that pandas' own dtype=str forcing cannot - pandas
    only ever sees the underlying numeric value, never the Excel format code. Also
    collects, and returns, every id-like column whose cell carries some OTHER non-general
    numeric format: Codex round 2 asked for "identical canonical IDs, or an explicit
    unsupported-state response" rather than this pipeline silently guessing at formats
    it cannot faithfully reproduce (thousands separators, conditional/text sections,
    non-digit placeholders). Returns the set of such column names; an empty set means
    every id-like column was either unformatted, zero-padding, or already literal text."""
    id_positions = [i for i, h in enumerate(headers) if _is_id_like_header(h)]
    unsupported: set[str] = set()
    if not id_positions:
        return unsupported
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        ws = wb[sheet_name]
    except Exception:
        return unsupported  # best effort: a read failure here just leaves the plain numeric string
    try:
        for col_idx in id_positions:
            for row_i in range(len(df)):
                sheet_row = row_i + 2  # row 1 is the header row this file already consumed
                cell = ws.cell(row=sheet_row, column=col_idx + 1)
                fmt = cell.number_format or ""
                value = cell.value
                if not isinstance(value, (int, float)) or GENERAL_FORMAT_RE.match(fmt or "General"):
                    continue
                if _ZERO_PAD_FORMAT_RE.match(fmt):
                    try:
                        as_int = int(value)
                    except (TypeError, ValueError):
                        continue
                    if as_int == value:
                        df.iat[row_i, col_idx] = str(as_int).zfill(len(fmt))
                else:
                    # Codex round 3, "prevent affected identifiers from silently entering
                    # inconsistent calculations": this pipeline cannot faithfully
                    # reproduce this cell's Excel display format, so the dtype=str
                    # forced value sitting in `df` right now (the bare digits, with no
                    # separators/padding) is not a value this reader can vouch for - it
                    # may not match what a researcher saw in the preview, or what any
                    # other consumer of this same file would compute. Rather than leave
                    # that unverifiable guess in place where a crosstab, join or export
                    # could silently use it as if it were a confirmed identifier, this
                    # cell is nulled out: a missing value is an explicit, visible gap
                    # that downstream code already has to handle, not a wrong answer
                    # that looks like a right one. `unsupportedIdentifierColumns` (now
                    # threaded to the UI's import-quality panel) is what explains why.
                    unsupported.add(headers[col_idx])
                    df.iat[row_i, col_idx] = None
    finally:
        wb.close()
    return unsupported


def _read_plain(path: str, ext: str, usecols=None, layout=None, selected_sheet=None):
    """CSV, TSV and Excel case-level files: one row per case, header row of names.
    No variable labels or value labels exist, so names stand in for labels and
    coded answers stay as they are (the dictionary treats a numeric column with
    few distinct values as categories)."""
    import pandas as pd

    unsupported_id_formats: set[str] = set()  # CSV has no cell-format concept; only Excel can populate this
    if ext in (".csv", ".tsv"):
        if ext == ".tsv":
            sep = "\t"
        else:
            # A plain "," default used to mean a semicolon-delimited CSV (the common export
            # format wherever the system locale uses a comma as the decimal separator) silently
            # became a single column, with every field crammed into one header. Sniffed instead,
            # the same way a researcher's own spreadsheet software would read it, from whichever
            # of the two delimiters is more consistent across the file's first several lines.
            with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
                sample = "".join(fh.readline() for _ in range(10))
            try:
                sep = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
            except csv.Error:
                sep = ","
        last = None
        for enc in ("utf-8-sig", "latin-1"):
            try:
                # IMP-003: header=None + nrows=1 reads the header row AS DATA, so pandas never
                # gets a chance to apply its own "name", "name.1", "name.2" mangling to a
                # duplicate column before this file's own disambiguation runs - see
                # _dedupe_header_names for why that matters. The real data read below
                # likewise uses header=None (skipping that same row) so the final column
                # names are entirely this file's own choice, not pandas'.
                raw_row = pd.read_csv(path, sep=sep, encoding=enc, header=None, nrows=1).iloc[0].tolist()
                raw_headers = ["" if pd.isna(v) else str(v).strip() for v in raw_row]
                headers = _dedupe_header_names(raw_headers)
                id_dtype = {i: str for i, h in enumerate(headers) if _is_id_like_header(h)} or None
                df = pd.read_csv(
                    path, sep=sep, encoding=enc, low_memory=False, header=None, skiprows=1, dtype=id_dtype
                )
                df.columns = headers
                break
            except UnicodeDecodeError as exc:
                last = exc
        else:
            raise last
        xl = None
    else:
        xl = pd.ExcelFile(path)
        sheets = list(xl.sheet_names)
        # IMP-SHIP-001 (Codex round 2): a sheet choice a prior read of this same document
        # already resolved (persisted on documents.selected_sheet) is used directly rather
        # than re-derived. If it no longer names a real sheet in this workbook (a
        # re-uploaded file could have dropped it), this raises SheetSelectionLostError
        # instead of silently falling back to an independently re-derived sheet - "a
        # missing selected sheet must produce an explicit recovery state, never automatic
        # substitution". A selected_sheet of None/"" (nothing persisted for this document
        # yet) is the legitimate first-ever read and still resolves via the ranking rule.
        if selected_sheet:
            if selected_sheet not in sheets:
                raise SheetSelectionLostError(selected_sheet, sheets)
            data_sheet = selected_sheet
        else:
            candidates = [n for n in sheets if not _DICT_SHEET_RE.search(n)] or sheets
            data_sheet = max(candidates, key=lambda n: _count_data_rows(xl, n))
        # IMP-003: same reasoning as the CSV branch above - xl.parse(..., header=0) would let
        # pandas mangle a duplicate header to its own "name"/"name.1" convention before this
        # file's own _dedupe_header_names ever ran. header=None + nrows=1 reads the header
        # row as plain data instead, so this file keeps full control of the resulting name.
        raw_row = xl.parse(data_sheet, header=None, nrows=1).iloc[0].tolist()
        raw_headers = ["" if pd.isna(v) else str(v).strip() for v in raw_row]
        headers = _dedupe_header_names(raw_headers)
        id_dtype = {i: str for i, h in enumerate(headers) if _is_id_like_header(h)} or None
        df = xl.parse(data_sheet, header=None, skiprows=1, dtype=id_dtype)
        df.columns = headers
        unsupported_id_formats = _apply_zero_padded_id_formats(path, data_sheet, headers, df)
    df = _normalize_na_strings(df)
    df = df.dropna(how="all")
    meta = _PlainMeta(unsupported_identifier_columns=sorted(unsupported_id_formats))
    if xl is not None and len(sheets) > 1:
        numeric_cols = {c for c in df.columns if df[c].dtype.kind in "fiu"}
        other = [n for n in sheets if n != data_sheet]
        labs, vlabs, used, conflicts = _excel_labels(xl, other, list(df.columns), numeric_cols)
        # A one-row-per-variable codebook sheet (see _excel_codebook) is a
        # different shape from the row-per-value layout _excel_labels reads,
        # so it is tried separately; where both find something for the same
        # variable the codebook's own column wins, since it is the more
        # deliberately authored source. That preference is itself a kind of
        # override, so a difference between the two sources is recorded here
        # too, not just overwrites within one source.
        cb_labs, cb_vlabs, mr_sets, cb_conflicts = _excel_codebook(xl, other, list(df.columns))
        conflicts = conflicts + cb_conflicts
        if cb_labs:
            for name, lab in cb_labs.items():
                if name in labs and labs[name] != lab:
                    conflicts.append(
                        {
                            "variable": name,
                            "kind": "variable_label",
                            "keptSheet": "codebook",
                            "kept": lab,
                            "discardedSheet": used.get("variables"),
                            "discarded": labs[name],
                        }
                    )
            labs = {**labs, **cb_labs}
            used["variables"] = "codebook"
        if cb_vlabs:
            for name, entries in cb_vlabs.items():
                if name in vlabs and vlabs[name] != entries:
                    conflicts.append(
                        {
                            "variable": name,
                            "kind": "value_label",
                            "keptSheet": "codebook",
                            "kept": entries,
                            "discardedSheet": used.get("values"),
                            "discarded": vlabs[name],
                        }
                    )
            vlabs = {**vlabs, **cb_vlabs}
            used["values"] = "codebook"
        used["data"] = data_sheet
        meta = _PlainMeta(labs, vlabs, used, mr_sets, label_conflicts=conflicts)
    if xl is not None:
        xl.close()  # Windows will not delete a temp file that is still open
    if layout == "columns_are_cases":
        # A raw file laid out with variables in rows and cases in columns, flipped here the same
        # way transposeTable (dataSetup.ts) flips the stored preview table - so the dictionary,
        # crosstab and driver actions below see the same one-row-per-case shape the preview does,
        # instead of silently reading the original, unflipped orientation as before this fix.
        # Any variable/value labels read above came from the ORIGINAL (pre-flip) column names and
        # are not re-targeted at the new ones; a workbook that both needs this flip and carries a
        # separate codebook sheet is a narrow enough combination that this is a known, documented
        # gap rather than a blocker on the much more common single-orientation-mismatch case.
        key_col = df.columns[0]
        # Same collision this file's plain-header renamer had (see the `used` set above): counting
        # occurrences of a base name alone can generate "X (2)" for a second "X" even when a real,
        # distinct case already used that literal value as its own key. Tracking every name already
        # claimed, not just a per-base-name count, keeps a generated name from landing on one.
        used_names: set[str] = set()
        for v in df[key_col].tolist():
            base = str(v).strip() if v is not None and str(v).strip() else None
            if base:
                used_names.add(base)
        seen: dict[str, int] = {}
        names = []
        for i, v in enumerate(df[key_col].tolist()):
            base = str(v).strip() if v is not None and str(v).strip() else f"Variable {i + 1}"
            seen[base] = seen.get(base, 0) + 1
            if seen[base] == 1:
                names.append(base)
                continue
            n = seen[base]
            candidate = f"{base} ({n})"
            while candidate in used_names:
                n += 1
                candidate = f"{base} ({n})"
            seen[base] = n
            used_names.add(candidate)
            names.append(candidate)
        flipped = df.drop(columns=[key_col]).transpose()
        flipped.columns = names
        flipped = flipped.reset_index(drop=True)
        df = flipped
    if usecols:
        df = df[[c for c in usecols if c in df.columns]]
    return df, meta


# Reading a data file is the slow part of every call. A long-lived process
# (the local worker, or a warm serverless instance) keeps the last couple of
# files it read, keyed by their content, so the next table built from the same
# file starts from memory. Only the labels are copied out per call, because the
# questionnaire overlay edits them; a column slice is already a copy.
_READ_CACHE: dict = {}
_READ_CACHE_FILES = 2
_READ_CACHE_MAX_MB = 400


def _read_raw(file_bytes: bytes, source_filename: str, usecols=None, layout=None, selected_sheet=None):
    ext = os.path.splitext(source_filename.lower())[1]
    # layout is part of the cache key too: the same bytes read once with no layout set and once
    # with "columns_are_cases" are two different tables, not the same one served twice.
    # IMP-SHIP-001: selected_sheet is part of the key for the same reason - a cached read from
    # before a sheet choice was persisted, or read under a DIFFERENT persisted choice, must never
    # be served back for a call that now names a sheet, or a stale cache entry could silently
    # reintroduce the preview/calculation sheet-disagreement this column exists to prevent.
    key = hashlib.sha1(file_bytes).hexdigest() + ext + (f"|{layout}" if layout else "") + (f"|sheet={selected_sheet}" if selected_sheet else "")
    hit = _READ_CACHE.get(key)
    if hit is None:
        df, meta = _read_raw_uncached(file_bytes, source_filename, None, layout, selected_sheet)
        size_mb = float(df.memory_usage(deep=False).sum()) / (1024 * 1024)
        if size_mb > _READ_CACHE_MAX_MB:
            # Too big to keep: answer this call from the full read and move on.
            return _slice_read(df, meta, usecols)
        while len(_READ_CACHE) >= _READ_CACHE_FILES:
            _READ_CACHE.pop(next(iter(_READ_CACHE)))
        hit = (
            df,
            dict(getattr(meta, "column_names_to_labels", None) or {}),
            dict(getattr(meta, "variable_value_labels", None) or {}),
            dict(getattr(meta, "sheets", None) or {}),
            dict(getattr(meta, "mr_sets", None) or {}),
            dict(getattr(meta, "variable_measure", None) or {}),
            dict(getattr(meta, "missing_ranges", None) or {}),
            # A contradiction between two label sources (two sheets disagreeing on what code 1
            # means) is itself a finding worth surfacing every time the dictionary is read, not
            # just the first time this file happens to be read cold. Reconstructing meta from the
            # cache without it used to mean the very same file, re-read from the warm cache,
            # silently stopped reporting a conflict it had reported moments before.
            list(getattr(meta, "label_conflicts", None) or []),
            list(getattr(meta, "unsupported_identifier_columns", None) or []),
        )
        _READ_CACHE[key] = hit
    df, labels, vlabels, sheets, mr_sets, measure, missing_ranges, label_conflicts, unsupported_identifier_columns = hit
    return _slice_read(
        df,
        _PlainMeta(
            dict(labels), dict(vlabels), dict(sheets), dict(mr_sets), dict(measure), dict(missing_ranges),
            label_conflicts=list(label_conflicts),
            unsupported_identifier_columns=list(unsupported_identifier_columns),
        ),
        usecols,
    )


def _slice_read(df, meta, usecols):
    if usecols:
        return df[[c for c in usecols if c in df.columns]], meta
    return df.copy(), meta


def _read_raw_uncached(file_bytes: bytes, source_filename: str, usecols=None, layout=None, selected_sheet=None):
    ext = os.path.splitext(source_filename.lower())[1]
    reader = READERS.get(ext)
    if reader is None and ext in TABLE_EXTS:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            return _read_plain(tmp_path, ext, usecols, layout, selected_sheet)
        finally:
            _remove_quietly(tmp_path)
    if reader is None:
        raise ValueError(f"Unsupported data file extension: {ext or '(none)'}")
    if layout == "columns_are_cases":
        # The flip _read_plain applies for a plain CSV/Excel file assumes a lone key column of
        # case identifiers and no pre-existing variable/value labels to re-target. An SPSS/Stata/
        # SAS file already declares its own row-is-a-case structure, with labels and measurement
        # levels keyed to that structure by pyreadstat - silently reading it unflipped while every
        # caller (dictionary, crosstab, driver columns) believes the flip happened would make the
        # reported labels, case counts and calculations disagree with what the file actually holds.
        # Failing closed here, rather than guessing at a transpose with no labels to carry over, is
        # the safer gap until this format's own flip (with proper label re-targeting) is built.
        raise ValueError(
            "This file's layout is set to \"columns_are_cases\", but that flip is only supported "
            "for plain CSV/TSV/Excel files, not SPSS (.sav), Stata (.dta) or SAS (.sas7bdat) files, "
            "which already declare their own case/variable structure. Set the layout back to "
            "\"rows_are_cases\" for this file, or re-export it as CSV/Excel first if it genuinely "
            "needs flipping."
        )
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        kwargs = {"usecols": list(usecols)} if usecols else {}
        return reader(tmp_path, **kwargs)
    finally:
        _remove_quietly(tmp_path)


def _overlay_key(col, code):
    """The dictionary key under which a questionnaire answer code matches the column's own values."""
    if col.dtype.kind in "iuf":
        try:
            f = float(str(code).strip())
        except ValueError:
            return None
        return int(f) if f.is_integer() else f
    return str(code).strip()


def _apply_overlay(df, meta, overlay):
    """Fills in labels the data file lacks from a confirmed questionnaire. Never
    replaces a label the file already has: variable labels are only used where
    the file has none (or just repeats the variable name), and value labels
    only for variables with no value labels of their own."""
    if not overlay:
        return
    labels = getattr(meta, "column_names_to_labels", None)
    if labels is None:
        labels = {}
        meta.column_names_to_labels = labels
    vlabels = getattr(meta, "variable_value_labels", None)
    if vlabels is None:
        vlabels = {}
        meta.variable_value_labels = vlabels
    cols = set(df.columns)
    for name, text in (overlay.get("variableLabels") or {}).items():
        if name in cols and text and (not labels.get(name) or labels.get(name) == name):
            labels[name] = str(text)
    for name, mapping in (overlay.get("valueLabels") or {}).items():
        if name not in cols or vlabels.get(name):
            continue
        mapped = {}
        for code, label in (mapping or {}).items():
            key = _overlay_key(df[name], code)
            if key is not None and label:
                mapped[key] = str(label)
        if mapped:
            vlabels[name] = mapped


def _read(file_bytes: bytes, source_filename: str, usecols=None, overlay=None, layout=None, selected_sheet=None):
    df, meta = _read_raw(file_bytes, source_filename, usecols, layout, selected_sheet)
    _apply_overlay(df, meta, overlay)
    return df, meta


_YES_RE = re.compile(r"^(yes|selected|mentioned|ticked|checked|chosen|true)\b", re.IGNORECASE)
_NO_RE = re.compile(r"^(no\b|not (selected|mentioned|ticked|checked|chosen)|unchecked|false)", re.IGNORECASE)
# A trailing short letter tag before the number (brand trackers commonly
# suffix a per-brand flag "_b1", "_b2" rather than a bare "_1", "_2") still
# counts as one option of the same multi-response question.
_SET_NAME_RE = re.compile(r"^(.+?)_([A-Za-z]{0,3}\d+)$")
_LEAD_CODE_RE = re.compile(r"^[A-Za-z0-9_]+\.\s*")


def _single_valued_code(col, v, labels, trust_domain=False):
    """An option nobody chose (or everybody chose) has only one value in the
    file. It is still an option of its question and must keep its row, at 0%
    (or 100%), so work out which code means "selected" from the labels.
    trust_domain mirrors the flag of the same name on _selected_code: for a
    variable a codebook already names as part of a multiple-response set, its
    value labels may use domain-specific wording ("Associated" / "Not
    associated") rather than the fixed yes/no vocabulary below, so once that
    text fails to resolve, a plain 0/1 domain is still trusted as meaning
    "selected"/"not selected" (IMP-011: previously this branch ignored
    trust_domain entirely and such an option was always reported as None,
    i.e. dropped from its own declared set)."""
    if labels:
        def lab_of(k):
            lab = labels.get(k)
            if lab is None and isinstance(k, float) and k.is_integer():
                lab = labels.get(int(k))
            return lab
        lab = lab_of(v)
        if lab is not None:
            if _YES_RE.match(str(lab)):
                return v
            if _NO_RE.match(str(lab)):
                others = [k for k, l in labels.items()
                          if k != v and not _NO_RE.match(str(l)) and not _DK_RE.match(str(l).strip())]
                if len(others) == 1:
                    return others[0]
                yes = [k for k in others if _YES_RE.match(str(labels[k]))]
                if len(yes) == 1:
                    return yes[0]
        if trust_domain:
            try:
                domain = set(float(k) for k in labels.keys())
            except (TypeError, ValueError):
                domain = set()
            if domain == {0.0, 1.0}:
                return 1 if col.dtype.kind in "iu" else 1.0
        return None
    if col.dtype.kind in "fiu" and float(v) in (0.0, 1.0):
        return 1 if col.dtype.kind in "iu" else 1.0
    return None


def _selected_code(col, labels, trust_domain=False):
    """The value that means "selected" in a yes/no style option variable, or
    None when the variable is not a two-value flag. trust_domain is for a
    variable a codebook already names as part of a multiple-response set: its
    value labels may not use the fixed yes/no vocabulary ("Associated" /
    "Not associated", say), so a plain 0/1 domain is trusted outright rather
    than only when unlabelled."""
    present = [v for v in col.dropna().unique()]
    if len(present) == 1:
        return _single_valued_code(col, present[0], labels, trust_domain=trust_domain)
    if len(present) != 2:
        return None
    if labels:
        for v in present:
            lab = labels.get(v)
            if lab is None and isinstance(v, float) and v.is_integer():
                lab = labels.get(int(v))
            if lab is not None and _YES_RE.match(str(lab)):
                return v
        # "Yes" may be labelled with a name (e.g. a bank). Then the other value
        # is a "no"-style label and this one is the selection.
        for v in present:
            other = [o for o in present if o is not v][0]
            olab = labels.get(other)
            if olab is None and isinstance(other, float) and other.is_integer():
                olab = labels.get(int(other))
            if olab is not None and _NO_RE.match(str(olab)):
                return v
        if not trust_domain:
            return None
    if col.dtype.kind in "fiu" and set(float(x) for x in present) == {0.0, 1.0}:
        return 1 if 1 in present else 1.0
    return None


def _stem(labels_list):
    cleaned = [_LEAD_CODE_RE.sub("", l) for l in labels_list]
    prefix = os.path.commonprefix(cleaned)
    cut = max(prefix.rfind(sep) for sep in (" - ", "- ", ": ", " -", ":", "-")) if prefix else -1
    stem = prefix[:cut] if cut > 3 else prefix
    return stem.strip(" -:.\u2013"), cleaned


def _audit(df, meta, variables, value_labels):
    """Weights and missing-code audit shown in the data quality report."""
    import numpy as np

    out = {"weights": [], "dk": None}
    n = len(df)
    for v in variables:
        if not v["weightLike"]:
            continue
        x = df[v["name"]].astype(float).to_numpy()
        valid = np.isfinite(x) & (x > 0)
        wi = x[valid]
        if wi.size == 0:
            out["weights"].append({"name": v["name"], "label": v["label"], "nInvalid": n, "nValid": 0})
            continue
        sw = float(wi.sum())
        n_eff = sw**2 / float((wi**2).sum())
        top = max(1, int(round(wi.size * 0.01)))
        out["weights"].append(
            {
                "name": v["name"],
                "label": v["label"],
                "nValid": int(wi.size),
                "nInvalid": int(n - wi.size),
                "sum": round(sw, 2),
                "min": round(float(wi.min()), 4),
                "max": round(float(wi.max()), 4),
                "median": round(float(np.median(wi)), 4),
                "maxOverMedian": round(float(wi.max() / np.median(wi)), 1),
                "nEff": round(n_eff, 1),
                "deff": round(wi.size / n_eff, 3),
                "efficiencyPct": round(100 * n_eff / wi.size, 1),
                "topOnePctShare": round(100 * float(np.sort(wi)[-top:].sum()) / sw, 1),
            }
        )
    declared = len(getattr(meta, "missing_ranges", None) or {})
    rows = []
    for v in variables:
        vl = value_labels.get(v["name"]) or {}
        codes = [(k, lab) for k, lab in vl.items() if _DK_RE.match(str(lab).strip())]
        if not codes or v["name"] not in df.columns:
            continue
        cases = int(df[v["name"]].isin([c for c, _ in codes]).sum())
        if cases == 0:
            continue
        rows.append(
            {
                "variable": v["name"],
                "label": v["label"],
                "codes": "; ".join(f"{int(c) if float(c).is_integer() else c} = {lab}" for c, lab in codes),
                "cases": cases,
            }
        )
    rows.sort(key=lambda r: -r["cases"])
    out["dk"] = {
        "declaredMissing": declared,
        "variables": len(rows),
        "cases": int(sum(r["cases"] for r in rows)),
        "top": rows[:15],
    }
    return out


def dictionary(file_bytes: bytes, source_filename: str, args: dict | None = None) -> dict:
    df, meta = _read(file_bytes, source_filename, layout=(args or {}).get("layout"), selected_sheet=(args or {}).get("selectedSheet"))
    n = len(df)
    labels = meta.column_names_to_labels or {}
    value_labels = meta.variable_value_labels or {}
    # A codebook sheet's own "Multiple response set" column, when the file has
    # one, names each variable's question group directly rather than leaving
    # it to be guessed from a shared name stem.
    mr_sets = getattr(meta, "mr_sets", None) or {}
    variables = []
    flags = {}
    for name in df.columns:
        col = df[name]
        n_valid = int(col.notna().sum())
        label = labels.get(name) or name
        numeric = col.dtype.kind in "fiu"
        is_flag = _selected_code(col, value_labels.get(name), trust_domain=bool(mr_sets.get(name))) is not None
        flags[name] = is_flag
        m = _SET_NAME_RE.match(name)
        variables.append(
            {
                "name": name,
                "label": label,
                "numeric": numeric,
                "nValid": n_valid,
                "pctValid": round(100 * n_valid / n, 1) if n else 0,
                "nDistinct": int(col.nunique(dropna=True)),
                "labelled": bool(value_labels.get(name)),
                "weightLike": bool(numeric and (_WEIGHT_RE.search(name) or _WEIGHT_RE.search(label))),
                "isFlag": is_flag,
                "text": bool(not numeric and not value_labels.get(name)),
                "setKey": mr_sets.get(name) or (m.group(1) if m else None),
            }
        )
    # Multiple-response sets: two or more yes/no option variables sharing a
    # name stem (C1_2, C1_3, ...). Every option stays its own row.
    groups = {}
    text_groups = {}
    for v in variables:
        if not v["isFlag"]:
            continue
        if v["setKey"]:
            groups.setdefault(v["setKey"], []).append(v)
        elif "_" in v["name"] and len(v["name"].rsplit("_", 1)[0]) >= 4:
            # Flags named by a word instead of a number (CallReason_Billing,
            # CallReason_Complaint): three or more sharing the part before the
            # last underscore are one question.
            text_groups.setdefault(v["name"].rsplit("_", 1)[0], []).append(v)
    for key, members in text_groups.items():
        if len(members) >= 3 and key not in groups:
            groups[key] = members
    sets = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        stem, cleaned = _stem([m["label"] for m in members])
        for m in members:
            m["inSet"] = key
        sets.append(
            {
                "key": key,
                "kind": "multi",
                "label": stem.strip("_ ") if len(stem.strip("_ ")) >= 4 else key,
                "vars": [m["name"] for m in members],
                "nValid": max(m["nValid"] for m in members),
                "pctValid": max(m["pctValid"] for m in members),
            }
        )
    # Batteries: three or more other variables sharing a name stem and a label
    # stem. Numeric ones with no value labels are a grid (averages). The rest
    # are a scale or product battery, tabulated as one question per item.
    rest = {}
    for v in variables:
        if not v.get("inSet") and v["setKey"] and not v["weightLike"]:
            rest.setdefault(v["setKey"], []).append(v)
    for key, members in rest.items():
        if len(members) < 3:
            continue
        stem, _cleaned = _stem([m["label"] for m in members])
        # 8 chars excluded short-but-real question stems ("Opinion", "Rating");
        # 5 still screens out coincidental 1-4 char code-name overlaps.
        if len(stem) < 5:
            continue
        grid = all(m["numeric"] and not m["labelled"] for m in members)
        for m in members:
            m["inSet"] = key
        sets.append(
            {
                "key": key,
                "kind": "grid" if grid else "battery",
                "label": stem,
                "vars": [m["name"] for m in members],
                "nValid": max(m["nValid"] for m in members),
                "pctValid": max(m["pctValid"] for m in members),
            }
        )
    # Families whose names do not follow the NAME_1, NAME_2 pattern (for example
    # Q6107#, Q6108# ...) but whose labels share a lead-in: "Banking institution
    # - ABSA", "Banking institution - Capitec". Grouped by that lead-in.
    by_label = {}
    for v in variables:
        if v.get("inSet") or v["weightLike"] or not v["numeric"]:
            continue
        lab = _LEAD_CODE_RE.sub("", v["label"] or "")
        if " - " not in lab:
            continue
        prefix = lab.split(" - ", 1)[0].strip()
        if len(prefix) >= 8:
            by_label.setdefault(prefix, []).append(v)
    for prefix, members in by_label.items():
        if len(members) < 3:
            continue
        key = "grp:" + prefix
        if all(m["isFlag"] for m in members):
            kind = "multi"
        elif all(m["numeric"] and not m["labelled"] for m in members):
            kind = "grid"
        else:
            kind = "battery"
        for m in members:
            m["inSet"] = key
        sets.append(
            {
                "key": key,
                "kind": kind,
                "label": prefix,
                "vars": [m["name"] for m in members],
                "nValid": max(m["nValid"] for m in members),
                "pctValid": max(m["pctValid"] for m in members),
            }
        )
    out = {
        "version": DICTIONARY_VERSION,
        "nCases": n,
        "variables": variables,
        "sets": sets,
        # Exact duplicate cases across every variable in the file (not just the
        # kept subset), so the import quality report can report this uncapped
        # too: pandas' own fast row-hash dedup, same full `df` as above.
        "duplicateCases": int(df.duplicated(keep="first").sum()),
    }
    try:
        out["audit"] = _audit(df, meta, variables, value_labels)
    except Exception:  # the audit is a convenience; the dictionary must still load
        out["audit"] = None
    if getattr(meta, "sheets", None):
        out["sheets"] = meta.sheets
    # Codex round 2, "define supported identifier-format behavior": surfaced so a caller
    # can report "this identifier column's formatting may not match the preview" instead
    # of the two sides silently disagreeing with no signal either side was even aware of a risk.
    if getattr(meta, "unsupported_identifier_columns", None):
        out["unsupportedIdentifierColumns"] = list(meta.unsupported_identifier_columns)
    # A label-source workbook with conflicting definitions for the same variable or value,
    # across sheets or against the codebook, used to just silently pick one with nothing to
    # show for it. Capped: a badly structured workbook could otherwise produce one entry per
    # row, and this is a diagnostic, not a full audit trail.
    conflicts = getattr(meta, "label_conflicts", None)
    if conflicts:
        out["labelConflicts"] = conflicts[:50]
    return out


def _decode(series, labels):
    if not labels:
        return series.map(lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else v)

    def f(v):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        if v in labels:
            return labels[v]
        if isinstance(v, float) and v.is_integer() and int(v) in labels:
            return labels[int(v)]
        return str(v)

    return series.map(f)


def _ordered_categories(decoded, labels, include_unobserved=False):
    """include_unobserved keeps a declared category with zero observed cases in the result (at the
    end of its default position it would occupy if sample attrition hadn't hidden it). Off by
    default to avoid widening every crosstab row/column this already feeds (that is a bigger change,
    reviewed in its own right); on for `categories()`, the group/top-box picker, where a researcher
    choosing which answers to combine needs to see a scale's full declared domain, not just whichever
    of its points this particular sample happened to use."""
    present = [c for c in decoded.dropna().unique()]
    if labels:
        domain = [labels[k] for k in sorted(labels)]
        if include_unobserved:
            # Every declared category in its declared domain position, observed or not - a
            # middle category sample attrition hid (declared order Low/Middle/High, nothing
            # observed for Middle) used to be filtered out of `order` here and then appended
            # at the very end ("Low, High, Middle"), rather than left in the slot it would
            # have occupied ("Low, Middle, High"). Starting from the full domain, instead of
            # the present-only list filtered against it, keeps that declared order intact.
            order = list(domain)
            order += [c for c in present if c not in order]
            return order
        order = [c for c in domain if c in present]
        order += [c for c in present if c not in order]
        return order
    try:
        return sorted(present)
    except TypeError:
        return sorted(present, key=str)


def _raw_key(v, labels):
    """The exact key _decode's own lookup would use for v against `labels` - v itself when it
    (or its integer-valued float form) matches a declared code, otherwise v unchanged. Mirrors
    _decode's f() branching exactly, so cat in labels here always agrees with whether _decode
    would have found a label for the same value. Used to build raw-code category identity
    (ANA-BRAND-002 / IMP-003) alongside _decode's label TEXT, which two distinct codes can share."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if v in labels:
        return v
    if isinstance(v, float) and v.is_integer() and int(v) in labels:
        return int(v)
    return v


def _ordered_categories_raw(ident_valid, labels, include_unobserved=False):
    """Like _ordered_categories, but category identity is the raw declared/observed CODE (as
    _raw_key resolves it), not the decoded label text. Two different codes that happen to share
    the same display label (a codebook with code 1 and code 2 both labelled "Good") stay two
    distinct categories here instead of silently merging into one - the bug _ordered_categories
    has when label text is used as identity. include_unobserved mirrors _ordered_categories'
    own flag: every declared code from `labels`, in declared order, including ones with zero
    observed cases this sample, is kept rather than only the codes actually present."""
    present = [c for c in ident_valid.dropna().unique()]
    if labels:
        domain = sorted(labels.keys())
        if include_unobserved:
            order = list(domain)
            order += [c for c in present if c not in order]
            return order
        order = [c for c in domain if c in present]
        order += [c for c in present if c not in order]
        return order
    try:
        return sorted(present)
    except TypeError:
        return sorted(present, key=str)


def _p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2))


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Numerical Recipes, betacf)."""
    maxit, eps, fpmin = 200, 3e-16, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, maxit + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = fpmin if abs(d) < fpmin else d
        c = 1.0 + aa / c
        c = fpmin if abs(c) < fpmin else c
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = fpmin if abs(d) < fpmin else d
        c = 1.0 + aa / c
        c = fpmin if abs(c) < fpmin else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta function I_x(a, b) (Numerical Recipes, betai)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def _p_two_sided_t(t: float, df: float) -> float:
    """Two-sided p-value of a Student's t statistic with df degrees of freedom, via the
    identity P(|T| > |t|) = I_{df / (df + t^2)}(df/2, 1/2). Falls back to the normal
    (z) reference when df is not usable (zero or negative)."""
    if df is None or df <= 0 or not math.isfinite(t):
        return _p_two_sided(t)
    x = df / (df + t * t)
    return _betai(df / 2.0, 0.5, x)


def _p_two_sided_design(z: float, dsg) -> float:
    """ANA-XTAB-002: a linearised design-based standard error (Taylor series over PSUs,
    optionally within strata) does not make a z-statistic asymptotically normal the way an
    i.i.d. sample does - with few PSUs the reference distribution needs fattened tails, the
    same correction R's survey package and Stata's svy commands apply by using the design
    degrees of freedom (PSUs minus strata) as a Student's t reference rather than the normal.
    Used only where the paired standard error itself already came from dsg.var_totals; an
    unweighted/undesigned comparison keeps the plain normal reference in _p_two_sided."""
    if dsg is None:
        return _p_two_sided(z)
    df = dsg.info.get("nPsu", 0) - dsg.info.get("nStrata", 0)
    return _p_two_sided_t(z, df)


def _se_prop(p, n_eff):
    return math.sqrt(p * (1 - p) / n_eff)


def categories(file_bytes: bytes, source_filename: str, variable: str, overlay=None, layout=None, selected_sheet=None) -> dict:
    """Answer categories of one variable (label and unweighted count), in code
    order, for building groups such as top-2 box."""
    df, meta = _read(file_bytes, source_filename, usecols=[variable], overlay=overlay, layout=layout, selected_sheet=selected_sheet)
    vl = (meta.variable_value_labels or {}).get(variable)
    dec = _decode(df[variable], vl)
    cats = _ordered_categories(dec.dropna(), vl, include_unobserved=True)
    counts = dec.value_counts()
    return {
        "variable": variable,
        "label": (meta.column_names_to_labels or {}).get(variable) or variable,
        "categories": [{"label": str(c), "n": int(counts.get(c, 0))} for c in cats][:200],
    }


def driver_columns(file_bytes: bytes, source_filename: str, args: dict) -> dict:
    """The chosen outcome and predictor columns as numbers, case by case, for driver analysis.
    args: outcome, predictors [names], weightVar, optional groupVar. Codes whose label means "no
    usable answer" (don't know, refused, not applicable) become missing, as they do in a crosstab
    mean. A variable whose answers are text rather than numbers is skipped with the reason. When
    groupVar is given, its decoded category per case is also returned (group/groupValues), so the
    caller can run the same analysis separately within each category without a second file read."""
    import numpy as np
    import pandas as pd

    outcome = args["outcome"]
    predictors = [v for v in args.get("predictors", []) if v != outcome]
    weight_var = args.get("weightVar") or None
    group_var = args.get("groupVar") or None
    if group_var in (outcome, *predictors):
        group_var = None  # can't segment by the outcome or a predictor itself
    wanted = list(dict.fromkeys([outcome] + predictors + ([weight_var] if weight_var else []) + ([group_var] if group_var else [])))
    df, meta = _read(file_bytes, source_filename, usecols=wanted, overlay=args.get("overlay"), layout=args.get("layout"), selected_sheet=args.get("selectedSheet"))
    labels = meta.column_names_to_labels or {}
    vlabels = meta.variable_value_labels or {}
    n_rows = len(df)

    def numeric(var):
        raw = df[var]
        s = pd.to_numeric(raw, errors="coerce").to_numpy(dtype=float)
        answered = int(raw.notna().sum())
        if answered > 0 and int(np.isfinite(s).sum()) < 0.5 * answered:
            return None, "the answers are text, not numbers"
        dk = [k for k, v in (vlabels.get(var) or {}).items() if _DK_RE.match(str(v).strip())]
        if dk:
            s = np.where(np.isin(s, np.array([float(k) for k in dk])), np.nan, s)
        if not np.isfinite(s).any():
            return None, "no usable answers"
        return s, None

    def describe(var, arr):
        finite = arr[np.isfinite(arr)]
        codes = sorted(set(float(v) for v in finite))
        vl = vlabels.get(var) or {}
        shown = {}
        if len(codes) <= 12:
            for c in codes:
                lab = vl.get(c) if c in vl else vl.get(int(c)) if float(c).is_integer() else None
                if lab is not None:
                    shown[str(int(c)) if float(c).is_integer() else str(c)] = str(lab)
        return {"name": var, "label": labels.get(var) or var, "min": float(finite.min()), "max": float(finite.max()),
                "distinct": len(codes), "valueLabels": shown}

    skipped = []
    y_arr, why = numeric(outcome)
    if y_arr is None:
        raise ValueError(f"The outcome {labels.get(outcome) or outcome} cannot be used: {why}.")
    used, cols = [], []
    for v in predictors:
        arr, why = numeric(v)
        if arr is None:
            skipped.append({"variable": v, "reason": why})
            continue
        used.append(describe(v, arr))
        cols.append(arr)
    if weight_var:
        w = pd.to_numeric(df[weight_var], errors="coerce").to_numpy(dtype=float)
        w = np.where(np.isfinite(w) & (w > 0), w, np.nan)
    else:
        w = None

    def clean(arr):
        return [None if not math.isfinite(float(v)) else float(v) for v in arr]

    x = np.column_stack(cols) if cols else np.empty((n_rows, 0))

    group = None
    group_values = None
    if group_var:
        g_labels = vlabels.get(group_var)
        dec = _decode(df[group_var], g_labels)
        cats = _ordered_categories(dec, g_labels)
        group_values = [None if v is None else str(v) for v in dec.tolist()]
        group = {"name": group_var, "label": labels.get(group_var) or group_var, "categories": [str(c) for c in cats]}

    return {
        "outcome": describe(outcome, y_arr),
        "predictors": used,
        "y": clean(y_arr),
        "x": [clean(r) for r in x],
        "weights": clean(w) if w is not None else None,
        "n": n_rows,
        "skipped": skipped,
        "group": group,
        "groupValues": group_values,
    }


def _chi2_sf(x, df):
    """Upper tail of the chi-square distribution (regularised upper incomplete gamma)."""
    if x <= 0 or df <= 0:
        return 1.0
    a = df / 2.0
    xx = x / 2.0
    if xx < a + 1:
        term = 1.0 / a
        total = term
        n = a
        for _ in range(500):
            n += 1
            term *= xx / n
            total += term
            if abs(term) < abs(total) * 1e-14:
                break
        p_lower = total * math.exp(-xx + a * math.log(xx) - math.lgamma(a))
        return max(0.0, min(1.0, 1.0 - p_lower))
    tiny = 1e-300
    b = xx + 1.0 - a
    c = 1.0 / tiny
    d = 1.0 / b
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        d = tiny if abs(d) < tiny else d
        c = b + an / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return max(0.0, min(1.0, math.exp(-xx + a * math.log(xx) - math.lgamma(a)) * h))


class _Design:
    """Complex-sample design for Taylor series (linearised) variance: primary
    sampling units nested within strata, no finite population correction, the
    same estimator as R survey::svydesign(ids, strata, nest = TRUE). A
    subpopulation (a banner column) is handled as a domain: cases outside it
    stay in the design with zero contribution, so the PSU structure is kept.
    A stratum with a single PSU cannot give a variance of its own; such strata
    are pooled into one stratum, which can only widen the interval."""

    def __init__(self, pid, ps_stratum, n_stratum, info):
        self.pid = pid
        self.P = len(ps_stratum)
        self.ps_stratum = ps_stratum
        self.n_h = n_stratum
        self.info = info

    @staticmethod
    def build(df, psu_var, strata_var, n_rows):
        import numpy as np
        for _v in (psu_var, strata_var):
            if _v and _v not in df.columns:
                raise ValueError(f"The survey design variable '{_v}' is not in the data file.")
        # Counter-review on ANA-XTAB-002: a declared stratification with no separate
        # clustering variable (an ordinary stratified-random-sample design, no multi-stage
        # clustering) used to build no design at all, because the caller only invoked this
        # when a PSU variable was supplied - silently falling back to plain SRS variance and
        # losing the precision gain (or loss) stratification itself produces, with no warning
        # that the declared design was never used. The standard treatment when no clustering
        # variable exists is to treat each case as its own primary sampling unit (the same
        # default R's survey::svydesign(ids = ~1, strata = ~stratum) takes), which still lets
        # the Taylor-series machinery below account for the stratification correctly.
        if psu_var:
            psu = df[psu_var].astype(str).to_numpy()
            psu_missing = df[psu_var].isna().to_numpy()
        else:
            psu = np.arange(n_rows).astype(str)
            psu_missing = np.zeros(n_rows, dtype=bool)
        strata = df[strata_var].astype(str).to_numpy() if strata_var else np.array(["all"] * n_rows)
        missing = psu_missing | (df[strata_var].isna().to_numpy() if strata_var else np.zeros(n_rows, dtype=bool))
        # A case with no PSU (or no stratum) cannot be placed in a cluster. It is
        # given a PSU of its own, which treats it as unclustered; the count is
        # reported so the interface can warn.
        psu = np.where(missing, np.array([f"__missing_{i}" for i in range(n_rows)]), psu)
        strata = np.where(missing, "__missing", strata)
        key_psu = np.char.add(np.char.add(strata.astype(str), "\u0001"), psu.astype(str))
        s_codes, s_inv = np.unique(strata, return_inverse=True)
        p_codes, p_inv = np.unique(key_psu, return_inverse=True)
        P = len(p_codes)
        ps_stratum = np.zeros(P, dtype=int)
        ps_stratum[p_inv] = s_inv
        n_h = np.bincount(ps_stratum, minlength=len(s_codes))
        lonely = np.where(n_h < 2)[0]
        pooled = 0
        if len(lonely):
            pooled = int(n_h[lonely].sum())
            new_id = len(s_codes)
            for h in lonely:
                ps_stratum[ps_stratum == h] = new_id
            # re-index to consecutive ids
            _, ps_stratum = np.unique(ps_stratum, return_inverse=True)
            n_h = np.bincount(ps_stratum)
            if (n_h < 2).any():
                # the pool itself has one PSU: attach it to the largest stratum
                small = int(np.where(n_h < 2)[0][0])
                big = int(np.argmax(n_h))
                ps_stratum[ps_stratum == small] = big
                _, ps_stratum = np.unique(ps_stratum, return_inverse=True)
                n_h = np.bincount(ps_stratum)
        if P < 2 or len(n_h) == 0:
            raise ValueError("The survey design needs at least two primary sampling units.")
        info = {"psu": psu_var, "strata": strata_var, "nPsu": int(P), "nStrata": int(len(n_h)),
                "pooledPsus": pooled, "casesMissingDesign": int(missing.sum())}
        return _Design(p_inv, ps_stratum, n_h, info)

    def totals(self, z):
        import numpy as np
        return np.bincount(self.pid, weights=z, minlength=self.P)

    def var_totals(self, t):
        import numpy as np
        t = np.asarray(t, dtype=float)
        mean_h = np.bincount(self.ps_stratum, weights=t, minlength=len(self.n_h)) / self.n_h
        dev = t - mean_h[self.ps_stratum]
        f = (self.n_h / (self.n_h - 1.0))[self.ps_stratum]
        return float((f * dev * dev).sum())


CORRECTIONS = ("none", "bonferroni", "fdr")


def _adjust_p(ps, method):
    """Adjusted p-values for one family of tests. fdr is Benjamini-Hochberg."""
    m = len(ps)
    if method == "bonferroni":
        return [min(1.0, p * m) for p in ps]
    order = sorted(range(m), key=lambda i: ps[i])
    out = [0.0] * m
    running = 1.0
    for rank in range(m - 1, -1, -1):
        i = order[rank]
        running = min(running, ps[i] * m / (rank + 1))
        out[i] = running
    return out


def _fisher_exact_2x2(a, b, c, d):
    """Two-sided Fisher exact p for integer counts [[a, b], [c, d]]: the sum of
    the probabilities of all tables with the same margins that are no more
    likely than the observed one."""
    a, b, c, d = int(round(a)), int(round(b)), int(round(c)), int(round(d))
    r1, r2, c1 = a + b, c + d, a + c
    n = r1 + r2
    if n <= 0 or min(r1, r2, c1, n - c1) < 0:
        return None

    def lf(k):
        return math.lgamma(k + 1)

    def logp(x):
        return lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x)

    lo, hi = max(0, c1 - r2), min(r1, c1)
    lp0 = logp(a)
    tot = 0.0
    for x in range(lo, hi + 1):
        lp = logp(x)
        if lp <= lp0 + 1e-7:
            tot += math.exp(lp)
    return float(min(1.0, tot))


def _association(T):
    """Association measures of a weighted r x c table whose rows and columns are in
    their displayed order. Every measure is a function of the proportions, so it does
    not depend on how the weights are scaled. Ordinal measures (gamma, tau, Somers d)
    assume both variables are ordered as shown. Rows are the answer, columns the banner."""
    import numpy as np

    P = np.asarray(T, dtype=float)
    tot = P.sum()
    if tot <= 0 or P.shape[0] < 2 or P.shape[1] < 2:
        return None
    P = P / tot
    r, c = P.shape
    pr, pc_ = P.sum(axis=1), P.sum(axis=0)
    E = np.outer(pr, pc_)
    x2p = float(((P - E) ** 2 / E).sum())          # chi-square divided by n
    m = min(r, c)
    out = {"cramersV": round(math.sqrt(x2p / (m - 1)), 4), "contingencyC": round(math.sqrt(x2p / (1 + x2p)), 4)}
    if r == 2 and c == 2:
        det = P[0, 0] * P[1, 1] - P[0, 1] * P[1, 0]
        out["phi"] = round(math.copysign(math.sqrt(x2p), det), 4)
    # Goodman and Kruskal lambda
    mr, mc = float(pr.max()), float(pc_.max())
    row_best = float(P.max(axis=0).sum())          # best guess of the answer within each column
    col_best = float(P.max(axis=1).sum())          # best guess of the column within each answer
    out["lambdaAnswer"] = round((row_best - mr) / (1 - mr), 4) if mr < 1 else None
    out["lambdaBanner"] = round((col_best - mc) / (1 - mc), 4) if mc < 1 else None
    den = 2 - mr - mc
    out["lambdaSym"] = round((row_best + col_best - mr - mc) / den, 4) if den > 0 else None
    # Concordant and discordant pairs (unordered, as a share of n squared)
    pcn = 0.0
    pdn = 0.0
    for i in range(r):
        for j in range(c):
            pcn += P[i, j] * P[i + 1:, j + 1:].sum()
            pdn += P[i, j] * P[i + 1:, :j].sum()
    if pcn + pdn > 0:
        out["gamma"] = round((pcn - pdn) / (pcn + pdn), 4)
    dr = 1 - float((pr ** 2).sum())
    dc = 1 - float((pc_ ** 2).sum())
    if dr > 0 and dc > 0:
        out["tauB"] = round(2 * (pcn - pdn) / math.sqrt(dr * dc), 4)
        out["somersD"] = round(2 * (pcn - pdn) / dc, 4)    # answer depends on banner
    out["tauC"] = round(2 * m * (pcn - pdn) / (m - 1), 4)
    return out


_ORDER_RE = re.compile(
    r"agree|disagree|satisf|likel|often|never|always|sometimes|good|poor|excellent|important|"
    r"confident|trust|easy|difficult|strongly|very |not at all|a lot|a little|extent|worse|better|"
    r"increase|decrease|frequent|rarely|high|low", re.I)


def _is_ordered_scale(var, labels, measures):
    """True when the coded answers of a single question form an ordered scale, so the mean and
    spread of the codes are meaningful. Uses the measurement level stored in the file when it says
    nominal or ordinal; otherwise it falls back to the wording of the answer labels."""
    m = str((measures or {}).get(var) or "").lower()
    if m == "nominal":
        return False
    if m == "ordinal":
        return True
    # "scale" is SPSS's default for any numeric column, so it proves nothing about labelled codes.
    subst = [str(v) for v in (labels or {}).values() if not _DK_RE.match(str(v).strip())]
    if len(subst) < 3:
        return False
    return sum(1 for v in subst if _ORDER_RE.search(v)) >= max(2, len(subst) // 2)



def _tidy_option(lab):
    """Option labels often arrive wrapped as "(MTN)" or "(Afrihost (Airmobile))", sometimes with a stray
    closing bracket. Unwrap the leading bracket and drop closing brackets that have no opener."""
    t = (lab or "").strip()
    if not t.startswith("("):
        return lab
    t = t[1:]
    while t.endswith(")") and t.count(")") > t.count("("):
        t = t[:-1]
    return t.strip() or lab


def _resolve_set_vars(df, meta, set_key):
    """Finds the member variables of a multiple-response set, by the same grouping
    rules dictionary() uses to discover sets in the first place (an explicit
    multi-response-set mapping from the codebook, a shared NAME_1/NAME_2 name stem,
    or a shared label lead-in such as "Banking institution - ABSA" / "... - Capitec"),
    scoped to one requested key. Lets a banner or row reference to "set:<key>" be
    resolved without re-deriving every set in the file. Returns [(variable, label), ...]
    in column order, or an empty list if the key does not resolve to two or more
    yes/no option variables."""
    labels = meta.column_names_to_labels or {}
    value_labels = meta.variable_value_labels or {}
    mr_sets = getattr(meta, "mr_sets", None) or {}
    by_stem: dict = {}
    for name in df.columns:
        col = df[name]
        label = labels.get(name) or name
        is_flag = _selected_code(col, value_labels.get(name), trust_domain=bool(mr_sets.get(name))) is not None
        if not is_flag:
            continue
        m = _SET_NAME_RE.match(name)
        key = mr_sets.get(name) or (m.group(1) if m else None)
        if key:
            by_stem.setdefault(key, []).append((name, label))
            continue
        if "_" in name and len(name.rsplit("_", 1)[0]) >= 4:
            by_stem.setdefault(name.rsplit("_", 1)[0], []).append((name, label))
    exact = by_stem.get(set_key) or []
    if len(exact) >= 2:
        return exact
    # Fall back to the label lead-in grouping ("grp:<prefix>" keys, matching dictionary()'s
    # "Families whose names do not follow a NAME_1, NAME_2 pattern" case).
    if set_key.startswith("grp:"):
        prefix = set_key[4:]
        members = []
        for name in df.columns:
            col = df[name]
            label = labels.get(name) or name
            if col.dtype.kind not in "fiu":
                continue
            if _selected_code(col, value_labels.get(name), trust_domain=bool(mr_sets.get(name))) is None:
                continue
            lab = _LEAD_CODE_RE.sub("", label or "")
            if " - " in lab and lab.split(" - ", 1)[0].strip() == prefix:
                members.append((name, label))
        if len(members) >= 2:
            return members
    return exact


def crosstab(file_bytes: bytes, source_filename: str, args: dict) -> dict:
    """Weighted crosstab. args: columnVars [names], rowItems [{key,label,vars}],
    weightVar. Several banner variables sit side by side. A row item with more
    than one variable that are all yes/no options is a multiple-response
    question: every option is kept as a row, and each option is based on the
    cases that answered that option, not on everyone."""
    import numpy as np
    import pandas as pd

    column_vars = [v for v in args["columnVars"]]
    raw_items = args["rowItems"]
    items = []
    for it in raw_items:
        if it.get("kind") == "battery":
            # One question per item, each on its own base.
            for v in it["vars"]:
                items.append({"key": v, "label": None, "vars": [v], "battery": it["label"]})
        else:
            items.append(it)
    weight_var = args.get("weightVar") or None
    correction = args.get("correction") or "none"
    if correction not in CORRECTIONS:
        raise ValueError(f"Unknown multiple-comparison correction: {correction}")
    # A researcher's data-type correction (Import screen): variable name -> "categorical" |
    # "discrete" | "continuous". Only consulted for the single-variable mean-vs-frequency
    # decision below (`categorical = ...`); it does not affect set/grid/battery detection, which
    # is a question-type correction's job, not a data-type one's (see variableOverrides.ts).
    type_overrides = args.get("typeOverrides") or {}
    row_vars = []
    for it in items:
        row_vars.extend(it["vars"])
        for net in it.get("nets") or []:
            row_vars.extend(net["vars"])
    design_arg = args.get("design") or {}
    psu_var = design_arg.get("psu") or None
    strata_var = design_arg.get("strata") or None
    exclude_dk = args.get("excludeDk", True) is not False
    # Filters: all conditions must hold (AND). op "in" / "notIn" take answer labels; "between" takes
    # numeric min and/or max (inclusive). The older single `layer` is read as one "in" filter.
    filters_arg = [dict(f) for f in (args.get("filters") or []) if f.get("variable")]
    layer_arg = args.get("layer") or {}
    if layer_arg.get("variable") and layer_arg.get("category") not in (None, ""):
        filters_arg.append({"variable": layer_arg["variable"], "op": "in", "values": [layer_arg["category"]]})
    for f in filters_arg:
        if f.get("op", "in") not in ("in", "notIn", "between"):
            raise ValueError(f"Unknown filter type: {f.get('op')}")
    filter_vars = [f["variable"] for f in filters_arg]
    # A banner variable can be a plain categorical column, or ("set:<key>") a multiple-response
    # set used as the banner: every option of the set becomes its own column, SPSS's Multiple
    # Response Crosstabs. Resolving a set needs the file's full column list, so when the banner
    # references one this does an extra read, which the cache makes free (same file already read).
    set_refs = sorted({v[4:] for v in column_vars if v.startswith("set:")})
    set_members: dict = {}
    if set_refs:
        full_df, full_meta = _read(file_bytes, source_filename, usecols=None, overlay=args.get("overlay"), layout=args.get("layout"), selected_sheet=args.get("selectedSheet"))
        for key in set_refs:
            members = _resolve_set_vars(full_df, full_meta, key)
            if len(members) < 2:
                raise ValueError(f'Could not find two or more yes/no options for the multiple-response set "{key}".')
            set_members[key] = members
    set_wanted = [name for v in column_vars if v.startswith("set:") for name, _ in set_members[v[4:]]]
    plain_column_vars = [v for v in column_vars if not v.startswith("set:")]
    wanted = list(dict.fromkeys(plain_column_vars + set_wanted + row_vars + ([weight_var] if weight_var else []) + [v for v in (psu_var, strata_var) if v] + filter_vars))
    df, meta = _read(file_bytes, source_filename, usecols=wanted, overlay=args.get("overlay"), layout=args.get("layout"), selected_sheet=args.get("selectedSheet"))
    labels = meta.column_names_to_labels or {}
    vlabels = meta.variable_value_labels or {}
    n_rows = len(df)

    if weight_var:
        w = df[weight_var].astype(float).to_numpy()
        w_ok = np.isfinite(w) & (w > 0)
    else:
        w = np.ones(n_rows)
        w_ok = np.ones(n_rows, dtype=bool)
    filters_info = []
    for f in filters_arg:
        fv = f["variable"]
        flab = labels.get(fv) or fv
        op = f.get("op", "in")
        if op == "between":
            xf = pd.to_numeric(df[fv], errors="coerce").to_numpy(dtype=float)
            fm = np.isfinite(xf)
            dk_f = [k for k, v in (vlabels.get(fv) or {}).items() if _DK_RE.match(str(v).strip())]
            if dk_f:
                fm &= ~np.isin(xf, np.array([float(k) for k in dk_f]))
            lo, hi = f.get("min"), f.get("max")
            if lo is None and hi is None:
                raise ValueError(f"Filter on {flab} needs a minimum, a maximum, or both.")
            if lo is not None:
                fm &= xf >= float(lo)
            if hi is not None:
                fm &= xf <= float(hi)
            text = (f"{flab} from {lo:g} to {hi:g}" if lo is not None and hi is not None
                    else f"{flab} at least {lo:g}" if lo is not None else f"{flab} at most {hi:g}")
        else:
            vals = [str(v) for v in (f.get("values") or [])]
            if not vals:
                raise ValueError(f"Filter on {flab} needs at least one answer.")
            fd = _decode(df[fv], vlabels.get(fv))
            farr = fd.to_numpy(dtype=object)
            inset = np.array([str(x) in vals for x in farr], dtype=bool)
            known = np.array([x is not None and not (isinstance(x, float) and math.isnan(x)) for x in farr], dtype=bool)
            fm = inset if op == "in" else (~inset & known)
            text = f"{flab} {'is' if op == 'in' else 'is not'} " + " or ".join(vals)
        if not (fm & w_ok).any():
            raise ValueError(f"No cases satisfy the filter: {text}.")
        w_ok = w_ok & fm
        filters_info.append({"variable": fv, "label": flab, "op": op, "text": text})
    if filters_arg and not w_ok.any():
        raise ValueError("No cases satisfy all of the filters together.")
    wv = np.where(w_ok, w, 0.0)

    dsg = _Design.build(df, psu_var, strata_var, n_rows) if (psu_var or strata_var) else None
    # ANA-NPS-003: _Design.build still succeeds when EVERY case is missing its PSU (and strata,
    # if given) - each such case is given a one-case PSU of its own precisely so P >= 2 holds and
    # the Taylor-series machinery below never divides by zero (see the comment on `missing` in
    # _Design.build). But a "design" built entirely from cases with no real PSU/strata information
    # carries no genuine clustering signal at all: its Taylor-series SE is statistically
    # indistinguishable from the plain SRS formula, so reporting it as a validated complex-sample
    # design - an "exact" design-based interval - would overstate what the data actually support.
    # The counter-review's fixture (all 160 PSU values missing) is exactly this case: a contrast SE
    # was returned as if design-based while casesMissingDesign reported every case missing, and
    # that qualification never reached the caller. design_requested_but_invalid keeps the request's
    # own psu/strata names and the missing count for the output notes below; dsg itself is set back
    # to None so every other design-based branch in this function (`dsg is not None`) correctly
    # falls back to the plain weighted/SRS formula, exactly as if no design had been supplied.
    design_requested_but_invalid = None
    if dsg is not None and dsg.info.get("casesMissingDesign", 0) >= n_rows:
        design_requested_but_invalid = dsg.info
        dsg = None

    # Banner: flat list of columns across all column variables.
    columns, col_masks, blocks = [], [], []
    # With no banner variable the table describes everyone: one column of all cases.
    # Tests and letters need two groups, so none are produced.
    overall = len(column_vars) == 0
    if overall:
        blocks.append({"var": "", "label": "All respondents"})
        columns.append({"block": 0, "blockLabel": "All respondents", "name": "All respondents"})
        col_masks.append(np.ones(n_rows, dtype=bool))
    for bi, cv in enumerate(column_vars):
        if cv.startswith("set:"):
            key = cv[4:]
            members = set_members[key]
            if len(members) > MAX_COLUMN_GROUPS:
                raise ValueError(f"The set has {len(members)} options; choose a set with {MAX_COLUMN_GROUPS} or fewer for a banner.")
            stem, _cleaned = _stem([m_label for _n, m_label in members])
            set_label = stem.strip("_ ") if len(stem.strip("_ ")) >= 4 else key
            blocks.append({"var": cv, "label": set_label})
            for name, mlabel in members:
                col = df[name]
                code = _selected_code(col, vlabels.get(name), trust_domain=True)
                mask = (col == code).to_numpy() if code is not None else np.zeros(n_rows, dtype=bool)
                clean = _tidy_option(_LEAD_CODE_RE.sub("", mlabel or name)) or name
                columns.append({"block": bi, "blockLabel": set_label, "name": clean})
                col_masks.append(mask)
            continue
        dec = _decode(df[cv], vlabels.get(cv))
        if exclude_dk:
            dk_c = [c for c in dec.dropna().unique() if _DK_RE.match(str(c).strip())]
            if dk_c:
                dec = dec.where(~dec.isin(dk_c))
        # Banner columns use raw-code identity (ANA-BRAND-002 / IMP-003), not decoded label
        # text: two distinct codes sharing one display label must stay two separate columns,
        # not silently merge into one. Saved column-group config (`columnGroups`) still
        # matches on label TEXT, same as the NET/score/mean group logic in the row builder -
        # that is a separate, already-shipped feature keyed on what a researcher sees, not
        # touched by this fix.
        cv_labels = vlabels.get(cv) or {}
        ident = df[cv].map(lambda v: _raw_key(v, cv_labels))
        # Keep ident in lockstep with dec: a case dec excluded (missing, or a DK response
        # scrubbed above) must not surface in ident either, or it would wrongly land in a
        # banner column by raw code even though its decoded value was dropped.
        ident = ident.where(dec.notna())
        valid_mask = dec.notna()
        cats = _ordered_categories_raw(ident[valid_mask], cv_labels)
        if len(cats) < 2:
            raise ValueError(f"{labels.get(cv) or cv} needs at least two groups to compare across.")
        if len(cats) > MAX_COLUMN_GROUPS:
            raise ValueError(f"{labels.get(cv) or cv} has {len(cats)} groups; choose one with {MAX_COLUMN_GROUPS} or fewer.")
        blocks.append({"var": cv, "label": labels.get(cv) or cv})
        ident_arr = ident.to_numpy(dtype=object)

        def _col_label_of_code(c):
            if cv_labels and c in cv_labels:
                return str(cv_labels[c])
            return str(c)

        # ANA-BRAND-002 / IMP-003: banner column groups (`columnGroups`), like the row NET/
        # score/mean groups fixed above, are saved as LABEL text the researcher picked in the
        # crosstab builder UI (the categories picker only ever exposes labels, never raw codes -
        # src/app/runs/[id]/CrosstabWorkspace.tsx shares the same picker component for rows and
        # columns). `_col_label_to_codes` resolves each picked label back to the raw code(s) it
        # actually denotes for this banner variable's own data; a label that denotes more than
        # one code (two distinct codes sharing one display label) is an ambiguous pick that
        # cannot be told apart by label alone, so it is rejected outright rather than silently
        # combined - this closes the same "base of 100 built from separately-coded 40+60 cases"
        # bug for the banner path that the row-level fix above closed for NET/score/mean rows;
        # the counter-review's "Picked Good" fixture is the exact case this guards against.
        # A label with no current match (a stale saved group referencing a category that no
        # longer exists) resolves to an empty set, same as before this fix - it simply matches
        # no column, rather than being treated as an error.
        _col_label_to_codes: dict = {}
        for _cat in cats:
            _col_label_to_codes.setdefault(_col_label_of_code(_cat), set()).add(_cat)

        def _resolve_col_group_labels(label_list, g_label):
            resolved = set()
            for lbl in label_list:
                codes_for_label = _col_label_to_codes.get(lbl, set())
                if len(codes_for_label) > 1:
                    raise ValueError(
                        f'In {labels.get(cv) or cv}, "{g_label}" ("{lbl}") matches more than one '
                        "answer code that shares this label; grouping by label cannot tell them "
                        "apart, so this banner group cannot be built."
                    )
                resolved |= codes_for_label
            return resolved

        groups = (args.get("columnGroups") or {}).get(cv) or []
        member_of = {}
        group_codes: list = []
        for gi, g in enumerate(groups):
            resolved_codes = _resolve_col_group_labels(g.get("cats", []), g.get("label") or "")
            group_codes.append(resolved_codes)
            for code in resolved_codes:
                if code in member_of:
                    raise ValueError(f'In {labels.get(cv) or cv}, "{_col_label_of_code(code)}" is in more than one group.')
                member_of[code] = gi
        emitted = set()
        for c in cats:
            gi = member_of.get(c)
            if gi is None:
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": _col_label_of_code(c)})
                col_masks.append(np.array([x == c for x in ident_arr], dtype=bool))
            elif gi not in emitted:
                emitted.add(gi)
                members = group_codes[gi]
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": groups[gi]["label"], "isGroup": True})
                col_masks.append(np.array([x in members for x in ident_arr], dtype=bool))
    if len(columns) > 60:
        raise ValueError("Too many banner columns in total (limit 60). Use fewer or smaller column variables.")
    K = len(columns)
    block_of_col = [c["block"] for c in columns]
    block_any = {}
    for k in range(K):
        b = block_of_col[k]
        block_any[b] = block_any.get(b, np.zeros(n_rows, dtype=bool)) | col_masks[k]

    def base_stats(mask):
        m = mask & w_ok
        wi = w[m]
        n = int(m.sum())
        sw = float(wi.sum())
        n_eff = float(sw**2 / (wi**2).sum()) if n and (wi**2).sum() > 0 else 0.0
        return n, sw, n_eff

    def prop_row(sel_mask, valid_mask):
        """Per column and total: weighted selected count, base, pct, p, sig."""
        counts, bases, pcts, ncell = [], [], [], []
        tot_n, tot_w, tot_eff = base_stats(valid_mask)
        tot_sel = float(wv[valid_mask & sel_mask].sum())
        pt = tot_sel / tot_w if tot_w > 0 else float("nan")
        ps, sigs, ests, ses = [], [], [], []
        for k in range(K):
            vm = valid_mask & col_masks[k]
            n, sw, n_eff = base_stats(vm)
            sel = float(wv[vm & sel_mask].sum())
            counts.append(round(sel, 1))
            bases.append({"n": n, "w": round(sw, 1), "nEff": round(n_eff, 1)})
            ncell.append(int((vm & sel_mask & w_ok).sum()))
            pj = sel / sw if sw > 0 else float("nan")
            suppressed = n < MIN_BASE_SUPPRESS
            pcts.append(None if (math.isnan(pj) or suppressed) else round(pj * 100, 1))
            p, sg = None, 0
            # Test this column against everyone else in the same banner
            # variable (the complement), never against a total that contains it.
            cm = valid_mask & block_any[block_of_col[k]] & ~col_masks[k]
            _, csw, c_eff = base_stats(cm)
            csel = float(wv[cm & sel_mask].sum())
            pc = csel / csw if csw > 0 else float("nan")
            tk = None
            if dsg is not None and sw > 0:
                yk = (sel_mask & vm).astype(float)
                tk = dsg.totals(np.where(vm, wv * (yk - pj) / sw, 0.0))
            if not math.isnan(pj) and n >= MIN_BASE_SUPPRESS and n_eff > 0:
                se_k = math.sqrt(dsg.var_totals(tk)) if (dsg is not None and tk is not None) else math.sqrt(pj * (1 - pj) / n_eff)
                ses.append(round(se_k * 100, 2))
            else:
                ses.append(None)
            if (n >= MIN_BASE_RELIABLE and not math.isnan(pj) and not math.isnan(pc)
                    and n_eff >= MIN_EFFECTIVE_BASE and c_eff >= MIN_EFFECTIVE_BASE):
                if dsg is not None:
                    yc = (sel_mask & cm).astype(float)
                    tc = dsg.totals(np.where(cm, wv * (yc - pc) / csw, 0.0))
                    se = math.sqrt(dsg.var_totals(tk - tc))
                else:
                    se = math.sqrt(pj * (1 - pj) / n_eff + pc * (1 - pc) / c_eff)
                if se > 0:
                    z = (pj - pc) / se
                    p = _p_two_sided_design(z, dsg)
                    if p < SIG_LEVEL:
                        sg = 1 if z > 0 else -1
            ps.append(None if p is None else round(p, 4))
            sigs.append(sg)
            ok_pair = n >= MIN_BASE_RELIABLE and not math.isnan(pj) and n_eff >= MIN_EFFECTIVE_BASE
            ests.append(((pj, pj * (1 - pj) / n_eff, None if tk is None else tk.astype(np.float32)) if ok_pair else None))
        # NET column of each banner variable: everyone with a valid answer to the
        # question and to that banner variable. Never tested, so no p, flag or letter.
        nets = []
        for b in sorted(set(block_of_col)):
            vm_b = valid_mask & block_any[b]
            nb, swb, neb = base_stats(vm_b)
            selb = float(wv[vm_b & sel_mask].sum())
            pb = selb / swb if swb > 0 else float("nan")
            nets.append({
                "block": b,
                "count": round(selb, 1),
                "pct": None if (math.isnan(pb) or nb < MIN_BASE_SUPPRESS) else round(pb * 100, 1),
                "rowPct": 100.0 if (selb > 0 and nb >= MIN_BASE_SUPPRESS) else None,
                "nCell": int((vm_b & sel_mask & w_ok).sum()),
                "base": {"n": nb, "w": round(swb, 1), "nEff": round(neb, 1)},
            })
        return {
            "_est": ests,
            "se": ses,
            "count": counts,
            "nCell": ncell,
            "pct": pcts,
            "p": ps,
            "sig": sigs,
            "base": bases,
            "net": nets,
            "total": {"count": round(tot_sel, 1), "pct": None if math.isnan(pt) else round(pt * 100, 1),
                      "nCell": int((valid_mask & sel_mask & w_ok).sum()),
                      "base": {"n": tot_n, "w": round(tot_w, 1), "nEff": round(tot_eff, 1)}},
        }

    def add_row_pct(row, block_of_col):
        """Row % = share of this answer's total that falls in each column of the
        same banner variable."""
        totals = {}
        for k, cnt in enumerate(row["count"]):
            totals[block_of_col[k]] = totals.get(block_of_col[k], 0.0) + cnt
        row["rowPct"] = [
            None if (totals[block_of_col[k]] <= 0 or row["base"][k]["n"] < MIN_BASE_SUPPRESS)
            else round(row["count"][k] / totals[block_of_col[k]] * 100, 1)
            for k in range(K)
        ]

    def table_tests(arr, r_valid, cats):
        """Whole-table test of the answer against each banner variable: Pearson chi-square on
        weighted counts rescaled to the effective base, a first-order Rao-Scott adjustment. When a
        survey design (PSUs, optionally strata) was supplied (dsg is not None), the design effect
        behind that rescaling - dfull below - is the actual Taylor-linearised design effect
        averaged over the table's cells, so strata and clusters ARE modelled here, same as the
        mean/proportion standard errors elsewhere in this file; this corrected an earlier version
        of this docstring that still said the opposite. With no design supplied, dfull falls back
        to the weights-only Kish design effect (n / effective n), which genuinely does not know
        about strata or clusters - see the "designUsed" note in the table's own output for which
        of the two applies to a given run. Alongside the block-level test, also returns the
        per-cell standardized and adjusted residuals (SPSS Crosstabs' "Residuals" option), built
        from the exact same rescaled observed/expected counts so the two always agree with each
        other."""
        out = []
        cell_resid: dict = {str(c): {} for c in cats}
        sels = {cat: np.array([x == cat for x in arr], dtype=bool) for cat in cats}
        for b in sorted(set(block_of_col)):
            ks = [k for k in range(K) if block_of_col[k] == b]
            mask = r_valid & block_any[b]
            n_, sw_, ne_ = base_stats(mask)
            if len(ks) < 2 or ne_ < MIN_EFFECTIVE_BASE or sw_ <= 0:
                continue
            T = np.array([[wv[mask & col_masks[k] & sels[cat]].sum() for k in ks] for cat in cats], dtype=float)
            U = np.array([[int((mask & col_masks[k] & sels[cat] & w_ok).sum()) for k in ks] for cat in cats], dtype=float)
            rk, ck = T.sum(axis=1) > 0, T.sum(axis=0) > 0
            cats_kept = [cats[i] for i in range(len(cats)) if rk[i]]
            ks_kept = [ks[j] for j in range(len(ks)) if ck[j]]
            T = T[rk][:, ck]
            U = U[rk][:, ck]
            if T.shape[0] < 2 or T.shape[1] < 2:
                continue
            assoc = dict(_association(T) or {})
            if U.sum() > 0:
                En = np.outer(U.sum(axis=1), U.sum(axis=0)) / U.sum()
                assoc["lowExpectedPct"] = round(float((En < 5).mean() * 100), 1)
                assoc["minExpected"] = round(float(En.min()), 2)
                if U.shape == (2, 2):
                    fp = _fisher_exact_2x2(U[0, 0], U[0, 1], U[1, 0], U[1, 1])
                    if fp is not None:
                        assoc["fisherP"] = round(fp, 4)
            dfull = None
            if dsg is not None:
                # Average design effect over the cells of the table (variance from
                # the design over variance of a simple random sample of the same
                # size), then chi-square on counts scaled to n, divided by it.
                ds = []
                for k in ks:
                    vm = mask & col_masks[k]
                    nk, swk, _ = base_stats(vm)
                    if nk < MIN_BASE_RELIABLE or swk <= 0:
                        continue
                    for cat in cats:
                        y = (vm & sels[cat]).astype(float)
                        pk = float((wv * y).sum() / swk)
                        if 0.01 < pk < 0.99:
                            v = dsg.var_totals(dsg.totals(np.where(vm, wv * (y - pk) / swk, 0.0)))
                            ds.append(v / (pk * (1 - pk) / nk))
                dfull = float(np.mean(ds)) if ds else None
            if dfull:
                T = T * (n_ / T.sum())
            else:
                T = T * (ne_ / T.sum())
            row_tot = T.sum(axis=1)
            col_tot = T.sum(axis=0)
            grand = T.sum()
            E = np.outer(row_tot, col_tot) / grand
            x2 = float(((T - E) ** 2 / E).sum())
            if dfull:
                x2 = x2 / max(dfull, 1e-9)
            dfree = (T.shape[0] - 1) * (T.shape[1] - 1)
            out.append({**(assoc or {}), "block": b, "label": columns[ks[0]]["blockLabel"], "chi2": round(x2, 2), "df": int(dfree),
                        "p": round(_chi2_sf(x2, dfree), 4),
                        "nEff": round(n_ / dfull, 1) if dfull else round(ne_, 1),
                        "deff": round(dfull, 2) if dfull else (round(n_ / ne_, 2) if ne_ else None)})
            # Standardized residual: (observed - expected) / sqrt(expected). Adjusted residual
            # divides that further by sqrt((1 - row share)(1 - column share)), the usual correction
            # for the margins themselves being estimated from the table (SPSS's "adjusted residual").
            with np.errstate(divide="ignore", invalid="ignore"):
                std = (T - E) / np.sqrt(E)
                rfrac = 1 - row_tot / grand if grand > 0 else np.zeros_like(row_tot)
                cfrac = 1 - col_tot / grand if grand > 0 else np.zeros_like(col_tot)
                denom = np.sqrt(np.outer(rfrac, cfrac))
                adj = np.where(denom > 0, std / denom, np.nan)
            for i, cat in enumerate(cats_kept):
                for j, k in enumerate(ks_kept):
                    sres, ares = std[i, j], adj[i, j]
                    cell_resid[str(cat)][k] = {
                        "std": None if not np.isfinite(sres) else round(float(sres), 2),
                        "adj": None if not np.isfinite(ares) else round(float(ares), 2),
                    }
        return out, cell_resid

    def describe(x, valid):
        """Descriptive statistics of a numeric variable for the valid cases, weighted.
        Variance and standard deviation use the reliability-weights form with the
        Kish effective base, so unweighted data gives the ordinary sample variance."""
        n = int(valid.sum())
        wi = wv[valid]
        xi = x[valid]
        sw = float(wi.sum())
        if n == 0 or sw <= 0:
            return None
        n_eff = float(sw ** 2 / (wi ** 2).sum())
        mean = float((wi * xi).sum() / sw)
        var = float((wi * (xi - mean) ** 2).sum() / sw) * n_eff / (n_eff - 1) if n_eff > 1 else None
        sd = math.sqrt(var) if var is not None else None
        order = np.argsort(xi, kind="mergesort")
        xs, cw = xi[order], np.cumsum(wi[order])

        def wq(q):
            return float(xs[min(int(np.searchsorted(cw, q * sw)), len(xs) - 1)])

        mn, mx = float(xi.min()), float(xi.max())

        def r3(v):
            return None if v is None else round(float(v), 3)

        # Shape: weighted moments, with the small-sample adjustment SPSS uses on the effective base.
        m2 = float((wi * (xi - mean) ** 2).sum() / sw)
        skew = kurt = None
        if m2 > 0:
            g1 = float((wi * (xi - mean) ** 3).sum() / sw) / m2 ** 1.5
            g2 = float((wi * (xi - mean) ** 4).sum() / sw) / m2 ** 2 - 3.0
            if n_eff > 2:
                skew = g1 * math.sqrt(n_eff * (n_eff - 1)) / (n_eff - 2)
            if n_eff > 3:
                kurt = (n_eff - 1) / ((n_eff - 2) * (n_eff - 3)) * ((n_eff + 1) * g2 + 6.0)
        uv, inv = np.unique(xi, return_inverse=True)
        wsum = np.bincount(inv, weights=wi)
        mode = float(uv[int(np.argmax(wsum))])
        if len(uv) <= 12:
            hist = [{"lo": r3(v), "hi": r3(v), "pct": round(float(wv_ / sw * 100), 1)} for v, wv_ in zip(uv, wsum)]
        else:
            edges = np.linspace(mn, mx, 11)
            bi = np.clip(np.searchsorted(edges, xi, side="right") - 1, 0, 9)
            hb = np.bincount(bi, weights=wi, minlength=10)
            hist = [{"lo": r3(edges[i]), "hi": r3(edges[i + 1]), "pct": round(float(hb[i] / sw * 100), 1)} for i in range(10)]
        extra_p = []
        for q_ in (args.get("percentiles") or []):
            try:
                qf = float(q_)
            except (TypeError, ValueError):
                continue
            if 0 < qf < 100:
                extra_p.append({"p": qf, "v": r3(wq(qf / 100))})
        # ANA-XTAB-001: the Kish-effective-base SEM above (sd / sqrt(n_eff)) is a simple-random-sample
        # formula - it has no way to see that a cluster design inflates variance beyond what the
        # effective base already captures. When a design (PSUs, optionally strata) was supplied for
        # this run, the mean's standard error is instead linearised the same way mean_row's banner
        # comparisons are (dsg.totals / dsg.var_totals on the per-case deviation from the mean), which
        # is sensitive to within-cluster correlation; sem falls back to the SRS figure only when no
        # design was supplied or the linearisation comes back degenerate.
        srs_sem = sd / math.sqrt(n_eff) if sd is not None else None
        design_sem = None
        if dsg is not None and sd is not None and sw > 0:
            tk = dsg.totals(np.where(valid, wv * (np.nan_to_num(x) - mean) / sw, 0.0))
            if tk is not None:
                dv = dsg.var_totals(tk)
                if dv is not None and np.isfinite(dv) and dv >= 0:
                    design_sem = math.sqrt(dv)
        return {"p10": r3(wq(0.10)), "p90": r3(wq(0.90)), "sum": r3(float((wi * xi).sum())), "mode": r3(mode),
                "skewness": r3(skew), "kurtosis": r3(kurt), "hist": hist, "percentiles": extra_p,
                "n": n, "nEff": round(n_eff, 1), "mean": r3(mean), "sd": r3(sd), "variance": r3(var),
                "sem": r3(design_sem if design_sem is not None else srs_sem),
                "semDesignBased": dsg is not None and design_sem is not None,
                "min": r3(mn), "max": r3(mx), "range": r3(mx - mn),
                "p25": r3(wq(0.25)), "median": r3(wq(0.5)), "p75": r3(wq(0.75))}

    def mean_row(rv, x_in=None, valid_in=None):
        """Mean of a numeric variable per column, tested against the other columns of the
        banner. x_in and valid_in let a computed score (net score, mean score) use the same
        machinery: the values and the cases they apply to are then given directly."""
        if x_in is not None:
            x = x_in
            valid = valid_in & np.isfinite(x) & w_ok
        else:
            x = df[rv].astype(float).to_numpy()
            valid = np.isfinite(x) & w_ok
            dk_codes = [k for k, v in (vlabels.get(rv) or {}).items() if _DK_RE.match(str(v).strip())]
            if dk_codes:
                valid &= ~np.isin(x, np.array([float(k) for k in dk_codes]))
        if wv[valid].sum() <= 0:
            return None
        gm = float((wv[valid] * x[valid]).sum() / wv[valid].sum())
        desc = describe(x, valid)

        def mv(m):
            n, sw, n_eff = base_stats(m)
            if sw <= 0:
                return n, sw, n_eff, None, None
            mj = float((wv[m] * x[m]).sum() / sw)
            var = None
            if n_eff > 1:
                var = float((wv[m] * (x[m] - mj) ** 2).sum() / sw) * n_eff / (n_eff - 1)
            return n, sw, n_eff, mj, var

        means, sigs, ps, bases, ests = [], [], [], [], []
        for k in range(K):
            m = valid & col_masks[k]
            n, sw, n_eff, mj, var = mv(m)
            bases.append({"n": n, "w": round(sw, 1), "nEff": round(n_eff, 1)})
            if mj is None or n < MIN_BASE_SUPPRESS:
                means.append(None); sigs.append(0); ps.append(None); ests.append(None); continue
            tk = dsg.totals(np.where(m, wv * (np.nan_to_num(x) - mj) / sw, 0.0)) if dsg is not None and sw > 0 else None
            ests.append((mj, var / n_eff, None if tk is None else tk.astype(np.float32)) if (n >= MIN_BASE_RELIABLE and var is not None and n_eff >= MIN_EFFECTIVE_BASE) else None)
            p, sg = None, 0
            cmask = valid & block_any[block_of_col[k]] & ~col_masks[k]
            cn, csw, c_eff, mc, cvar = mv(cmask)
            if (n >= MIN_BASE_RELIABLE and mc is not None and var is not None and cvar is not None
                    and n_eff >= MIN_EFFECTIVE_BASE and c_eff >= MIN_EFFECTIVE_BASE):
                if dsg is not None and tk is not None:
                    tc = dsg.totals(np.where(cmask, wv * (np.nan_to_num(x) - mc) / csw, 0.0))
                    se = math.sqrt(dsg.var_totals(tk - tc))
                else:
                    se = math.sqrt(var / n_eff + cvar / c_eff)
                if se > 0:
                    z = (mj - mc) / se
                    p = _p_two_sided_design(z, dsg)
                    if p < SIG_LEVEL:
                        sg = 1 if z > 0 else -1
            means.append(round(mj, 2)); sigs.append(sg); ps.append(None if p is None else round(p, 4))
        tn, tw, te = base_stats(valid)
        # Eta: share of the variation in the answer that lies between the groups of a banner variable.
        etas = []
        for b in sorted(set(block_of_col)):
            vb = valid & block_any[b]
            swb_ = float(wv[vb].sum())
            if swb_ <= 0:
                continue
            mb_ = float((wv[vb] * x[vb]).sum() / swb_)
            sst = float((wv[vb] * (x[vb] - mb_) ** 2).sum())
            ssb = 0.0
            for k in range(K):
                if block_of_col[k] != b:
                    continue
                mk_ = vb & col_masks[k]
                swk_ = float(wv[mk_].sum())
                if swk_ > 0:
                    ssb += swk_ * (float((wv[mk_] * x[mk_]).sum() / swk_) - mb_) ** 2
            if sst > 0 and len([k for k in range(K) if block_of_col[k] == b]) >= 2:
                etas.append({"block": b, "label": columns[[k for k in range(K) if block_of_col[k] == b][0]]["blockLabel"],
                             "eta": round(math.sqrt(min(1.0, ssb / sst)), 4)})
        nets = []
        for b in sorted(set(block_of_col)):
            nb, swb, neb, mb, _ = mv(valid & block_any[b])
            nets.append({"block": b, "count": None, "pct": None if (mb is None or nb < MIN_BASE_SUPPRESS) else round(mb, 2),
                         "rowPct": None, "nCell": None, "base": {"n": nb, "w": round(swb, 1), "nEff": round(neb, 1)}})
        return {"desc": desc, "eta": etas, "_est": ests, "count": [None] * K, "nCell": [None] * K, "pct": means, "rowPct": [None] * K, "p": ps, "sig": sigs, "base": bases,
                "net": nets,
                "total": {"count": None, "nCell": None, "pct": round(gm, 2), "base": {"n": tn, "w": round(tw, 1), "nEff": round(te, 1)}}}

    def base_src(valid_mask):
        """Bases only (no tests), for the base rows of a question."""
        bases = []
        for k in range(K):
            n, sw, ne = base_stats(valid_mask & col_masks[k])
            bases.append({"n": n, "w": round(sw, 1), "nEff": round(ne, 1)})
        nets = []
        for b in sorted(set(block_of_col)):
            n, sw, ne = base_stats(valid_mask & block_any[b])
            nets.append({"block": b, "base": {"n": n, "w": round(sw, 1), "nEff": round(ne, 1)}})
        tn_, tw_, te_ = base_stats(valid_mask)
        return {"base": bases, "net": nets, "total": {"base": {"n": tn_, "w": round(tw_, 1), "nEff": round(te_, 1)}}}

    def base_rows(label, src):
        """The base row of a question: unweighted n of valid answers in each column.
        When a weight is applied, a second row gives the effective base."""
        def mk(lab, get, eff):
            row = {
                "label": lab, "isBase": True,
                "count": [get(b) for b in src["base"]],
                "nCell": [None] * K, "pct": [None] * K, "p": [None] * K, "sig": [0] * K, "rowPct": [None] * K,
                "base": src["base"],
                "net": [{"block": nt["block"], "count": get(nt["base"]), "pct": None, "rowPct": None, "nCell": None, "base": nt["base"]}
                        for nt in src["net"]],
                "total": {"count": get(src["total"]["base"]), "nCell": None, "pct": None, "base": src["total"]["base"]},
            }
            if eff:
                row["isEffBase"] = True
            return row
        out = [mk(label, lambda b: b["n"], False)]
        if weight_var:
            out.append(mk("Effective base", lambda b: int(round(b["nEff"])), True))
        return out

    questions, skipped = [], []
    for it in items:
        vars_ = it["vars"]
        if it.get("kind") == "nets":
            # Researcher-defined nets: a respondent is in a net when they chose
            # at least one of its options. The base is everyone who answered at
            # least one of those options.
            rows = []
            all_valid = np.zeros(n_rows, dtype=bool)
            for net in it["nets"]:
                sel_any = np.zeros(n_rows, dtype=bool)
                valid_any = np.zeros(n_rows, dtype=bool)
                usable = 0
                for ov in net["vars"]:
                    col = df[ov]
                    code = _selected_code(col, vlabels.get(ov), trust_domain=True)
                    if code is None:
                        skipped.append({"variable": ov, "reason": "Not a yes/no option variable, so it cannot be netted."})
                        continue
                    usable += 1
                    valid_any |= col.notna().to_numpy()
                    sel_any |= (col == code).to_numpy()
                if not usable:
                    continue
                all_valid |= valid_any
                row = prop_row(sel_any, valid_any)
                add_row_pct(row, block_of_col)
                row["label"] = f"NET: {net['label']}"
                row["variable"] = ",".join(net["vars"])
                rows.append(row)
            if rows:
                questions.append({"key": it["key"], "label": it["label"], "kind": "multi",
                                  "rows": base_rows("Base: answered any of these options", base_src(all_valid)) + rows})
            continue
        if it.get("kind") == "grid":
            rows = []
            grid_valid = np.zeros(n_rows, dtype=bool)
            for ov in vars_:
                row = mean_row(ov)
                if row is None:
                    skipped.append({"variable": ov, "reason": "No valid weighted cases."})
                    continue
                grid_valid |= np.isfinite(df[ov].astype(float).to_numpy()) & w_ok
                lab = _LEAD_CODE_RE.sub("", labels.get(ov) or ov)
                stem = it.get("stem") or ""
                if stem and lab.lower().startswith(stem.lower()):
                    lab = lab[len(stem):].lstrip(" -:.\u2013")
                lab = _tidy_option(lab)
                row["label"] = lab or ov
                row["variable"] = ov
                rows.append(row)
            if rows:
                questions.append({"key": it["key"], "label": it["label"], "kind": "grid",
                                  "rows": base_rows("Base: answered any of these items", base_src(grid_valid)) + rows})
            continue
        if len(vars_) > 1:
            # Multiple response: every option is kept, each on its own base.
            rows = []
            any_valid = np.zeros(n_rows, dtype=bool)
            for ov in vars_:
                col = df[ov]
                code = _selected_code(col, vlabels.get(ov), trust_domain=True)
                if code is None:
                    skipped.append({"variable": ov, "reason": "Not a yes/no option variable."})
                    continue
                valid = col.notna().to_numpy()
                any_valid |= valid
                sel = (col == code).to_numpy()
                row = prop_row(sel, valid)
                add_row_pct(row, block_of_col)
                lab = _LEAD_CODE_RE.sub("", labels.get(ov) or ov)
                stem = it.get("stem") or ""
                if stem and lab.lower().startswith(stem.lower()):
                    lab = lab[len(stem):].lstrip(" -:.\u2013")
                lab = _tidy_option(lab)
                row["label"] = lab or ov
                row["variable"] = ov
                rows.append(row)
            if not rows:
                continue
            questions.append({"key": it["key"], "label": it["label"], "kind": "multi",
                              "rows": base_rows("Base: answered this question", base_src(any_valid)) + rows})
            continue

        rv = vars_[0]
        if it.get("label") is None:
            it = dict(it)
            it["label"] = _LEAD_CODE_RE.sub("", labels.get(rv) or rv)
        r_labels = vlabels.get(rv)
        raw = df[rv]
        distinct = int(raw.nunique(dropna=True))
        numeric_dtype = raw.dtype.kind in "fiu"
        type_override = type_overrides.get(rv)
        if type_override == "categorical":
            # The researcher's correction wins over the heuristic below: tabulate as a
            # frequency table even for a variable the heuristic would otherwise have called
            # continuous (a numeric code with many distinct values, e.g. a product SKU).
            categorical = True
        elif type_override in ("discrete", "continuous") and numeric_dtype:
            # The reverse correction: treat this variable purely as a mean, skipping the
            # frequency breakdown, even where it carries value labels or few distinct values
            # (a coded Likert scale the researcher wants summarised as an average, not counted
            # option by option). Only honoured on a numeric column - averaging text answer
            # codes is not a coherent number, so on a text variable this override is silently
            # not applied here even though it still shows as saved on the Import screen.
            categorical = False
        else:
            categorical = bool(r_labels) or not numeric_dtype or distinct <= NUMERIC_AS_CATEGORIES_MAX
        if categorical:
            dec = _decode(raw, r_labels)
            if exclude_dk:
                dk_r = [c for c in dec.dropna().unique() if _DK_RE.match(str(c).strip())]
                if dk_r:
                    dec = dec.where(~dec.isin(dk_r))
            r_valid = dec.notna().to_numpy()
            # IMP-004: a declared category with zero observed cases (sample attrition hid every
            # "7" on an 0-10 NPS scale, say) used to simply not appear here, because this call
            # only asked for the categories actually present in the data. That silently shrank a
            # scale's reported domain to whatever the sample happened to use, with two concrete
            # downstream failures: computeNps() requires all 11 points of 0-10 to be present
            # before it will even recognise the question as an NPS scale, so a sparse-but-valid
            # NPS scale was rejected outright; and a top-box/top-two-box score (csmMetrics.ts'
            # summarizeSeries, which ranks by declared numeric code) silently promoted the next
            # category down to fill the missing top slot, overstating the score (a 5-point
            # satisfaction scale with zero "5"s reported top-two as categories 4+3 instead of the
            # correct 4+(0% for 5)). Declared categories now always reach this table, each
            # reported honestly as 0% where sample attrition hid them, rather than omitted.
            # ANA-BRAND-002 / IMP-003: category identity for this table's own answer rows is
            # the raw declared/observed CODE (via _raw_key/_ordered_categories_raw), never the
            # decoded label text _ordered_categories/`dec` use - two distinct codes sharing one
            # label (a codebook with code 1 and code 2 both labelled "Good") used to collapse
            # into a single merged row here, silently combining their counts, because `cats` and
            # `arr` were both built from decoded text and "Good" can only ever be one category
            # to a plain string comparison. `ident`/`ident_arr` carry the raw code instead; `dec`
            # and `arr` (decoded text) are kept for the DK filter above and for the NET/score/mean
            # group logic below, whose group definitions (`g["cats"]`) are saved as the label
            # text researchers picked in the crosstab builder UI, not raw codes - changing that
            # feature's own stored-config format is a separate, out-of-scope concern from the
            # identity bug this fixes.
            ident = raw.map(lambda v: _raw_key(v, r_labels or {}))
            cats = _ordered_categories_raw(ident[r_valid], r_labels, include_unobserved=True)
            if len(cats) < 2:
                skipped.append({"variable": rv, "reason": "Fewer than two answer categories among valid cases."})
                continue
            if len(cats) > MAX_ROW_CATEGORIES:
                skipped.append({"variable": rv, "reason": f"{len(cats)} answer categories (limit {MAX_ROW_CATEGORIES})."})
                continue
            arr = dec.to_numpy(dtype=object)
            ident_arr = ident.to_numpy(dtype=object)
            table_tests_out, cell_resid = table_tests(ident_arr, r_valid, cats)

            def _label_of_code(c):
                if r_labels and c in r_labels:
                    return str(r_labels[c])
                return str(c)

            rows = []
            for cat in cats:
                sel = np.array([x == cat for x in ident_arr], dtype=bool)
                row = prop_row(sel, r_valid)
                add_row_pct(row, block_of_col)
                row["label"] = _label_of_code(cat)
                row["rawCode"] = str(cat)
                res = cell_resid.get(str(cat)) or {}
                if res:
                    row["residual"] = [res.get(k, {}).get("std") for k in range(K)]
                    row["adjResidual"] = [res.get(k, {}).get("adj") for k in range(K)]
                rows.append(row)
            # Subtotals (NET), net scores and mean scores. Each can be placed at the end, or
            # above or below the answers it summarises.
            #
            # ANA-BRAND-002 / IMP-003: a group's own `cats`/`minus` are the LABEL text researchers
            # picked in the crosstab builder UI (the categories picker only ever exposed labels -
            # see CategoryList above), not raw codes, and the raw-code identity fix a few lines up
            # (`ident`/`ident_arr`) did not reach this block: NET/score selection below used to
            # test `str(x) in plus` against `arr`, the DECODED label text, so two distinct raw
            # codes sharing one label (a codebook with code 1 and code 2 both labelled "Good")
            # were indistinguishable to that test and got silently counted together as a single
            # NET - exactly the "base of 100" the counter-review's fixture produced. `_label_to_codes`
            # resolves each picked label back to the raw code(s) it actually denotes for this
            # variable's own data; `_resolve_group_labels` below refuses to resolve a label that
            # denotes more than one code (an ambiguous pick), reporting it as a skip reason - the
            # same `skipped` list and shape this function already uses elsewhere in this block -
            # rather than silently combining them. `anchor` stays label-based: it only decides
            # where the finished NET/score row is inserted next to the matching answer rows
            # (`rows[i]["label"]`, itself decoded text), a placement nicety, not a count.
            _label_to_codes: dict = {}
            for _cat in cats:
                _label_to_codes.setdefault(_label_of_code(_cat), set()).add(_cat)

            def _resolve_group_labels(label_set, g_label, which):
                resolved = set()
                for lbl in label_set:
                    codes_for_label = _label_to_codes.get(lbl, set())
                    if len(codes_for_label) > 1:
                        skipped.append({
                            "variable": rv,
                            "reason": f"\"{g_label}\" ({which} \"{lbl}\") matches more than one answer code that shares this label; grouping by label cannot tell them apart, so this group was not built.",
                        })
                        return None
                    resolved |= codes_for_label
                return resolved

            group_rows = []
            for g in it.get("groups") or []:
                kind = g.get("kind") or "net"
                plus_labels = set(g.get("cats", []))
                minus_labels = set(g.get("minus", []))
                plus = _resolve_group_labels(plus_labels, g.get("label", ""), "positive answers")
                if plus is None:
                    continue
                minus = _resolve_group_labels(minus_labels, g.get("label", ""), "negative answers") if minus_labels else set()
                if minus is None:
                    continue
                if kind == "net":
                    sel = np.array([x in plus for x in ident_arr], dtype=bool)
                    row = prop_row(sel, r_valid)
                    add_row_pct(row, block_of_col)
                    row["label"] = f"NET: {g['label']}"
                    row["isNet"] = True
                    anchor = plus_labels
                elif kind == "score":
                    if not plus or not minus or plus & minus:
                        skipped.append({"variable": rv, "reason": f"Net score {g['label']} needs positive and negative answers that do not overlap."})
                        continue
                    # Net score: share positive minus share negative, in percentage points. It is the mean of
                    # +100 / 0 / -100, so it is tested like an average.
                    yv = np.array([100.0 if x in plus else (-100.0 if x in minus else 0.0) for x in ident_arr])
                    row = mean_row(None, yv, r_valid)
                    if row is None:
                        continue
                    row.pop("desc", None)
                    row.pop("eta", None)
                    row["label"] = f"Net score: {g['label']}"
                    row["isNet"] = True
                    row["isScore"] = True
                    anchor = plus_labels | minus_labels
                elif kind == "mean":
                    if raw.dtype.kind not in "fiu":
                        skipped.append({"variable": rv, "reason": f"Mean score {g['label']} needs numeric answer codes."})
                        continue
                    xq = raw.astype(float).to_numpy()
                    vq = r_valid & np.isfinite(xq)
                    dk_m = [k for k, v in (r_labels or {}).items() if _DK_RE.match(str(v).strip())]
                    if dk_m:
                        vq &= ~np.isin(xq, np.array([float(k) for k in dk_m]))
                    row = mean_row(None, xq, vq)
                    if row is None:
                        continue
                    row.pop("desc", None)
                    row.pop("eta", None)
                    row["label"] = f"Mean score: {g['label']}"
                    row["isNet"] = True
                    row["isScore"] = True
                    row["isMean"] = True
                    anchor = set(_label_of_code(c) for c in cats)
                else:
                    continue
                group_rows.append((row, g.get("place") or "end", anchor))
            for row, place, anchor in group_rows:
                idx = [i for i, a in enumerate(rows) if not a.get("isNet") and a["label"] in anchor]
                if place == "above" and idx:
                    rows.insert(idx[0], row)
                elif place == "below" and idx:
                    rows.insert(idx[-1] + 1, row)
                else:
                    rows.append(row)
            rows = base_rows("Base: answered this question", base_src(r_valid)) + rows
            q_single = {"key": it["key"], "label": it["label"], "kind": "single", "rows": rows,
                        "tableTests": table_tests_out}
            # ANA-NPS-003: when this question is an 11-point 0-10 NPS scale and a sampling design
            # was supplied, compute the actual Taylor-linearised standard error of the promoters-
            # minus-detractors CONTRAST directly, with the same per-case linear-combination trick
            # used for every other design-based total in this file (dsg.totals/var_totals): the
            # indicator d_i = +1 for a promoter (9 or 10), -1 for a detractor (0-6), 0 otherwise
            # (passives 7-8, or anything outside the scale) is itself a linear statistic, so its
            # design-based variance already captures Var(P)+Var(D)-2*Cov(P,D) in one pass - no
            # separate covariance term needed, and no averaging over each category's own design
            # effect (which cannot recover that covariance and is what produced a nonzero interval
            # on a zero-variance fixture). Only computed when dsg is available; computeNps() in
            # src/lib/descriptiveFindings.ts falls back to its SRS/avg-design-effect approximation
            # whenever this is absent, same as before this fix.
            def _leading_int(label):
                m = re.match(r"^\s*(-?\d+)(?:\.\d+)?\b", label)
                return int(m.group(1)) if m else None

            cat_k = {cat: _leading_int(_label_of_code(cat)) for cat in cats}
            is_nps_scale = (
                len(cats) >= 11
                and all(v is not None for v in cat_k.values())
                and 0 in cat_k.values()
                and 10 in cat_k.values()
            )
            if is_nps_scale and dsg is not None:
                d = np.zeros(n_rows, dtype=float)
                for cat, k in cat_k.items():
                    sel = np.array([x == cat for x in ident_arr], dtype=bool)
                    if 0 <= k <= 6:
                        d[sel] = -1.0
                    elif k in (9, 10):
                        d[sel] = 1.0
                contrast_total = None
                n_t, sw_t, neff_t = base_stats(r_valid)
                if sw_t > 0:
                    dt = float((wv[r_valid] * d[r_valid]).sum() / sw_t)
                    tk_t = dsg.totals(np.where(r_valid, wv * (d - dt) / sw_t, 0.0))
                    contrast_total = round(math.sqrt(dsg.var_totals(tk_t)) * 100, 2)
                contrast_cols = []
                for k_col in range(K):
                    vm = r_valid & col_masks[k_col]
                    _, sw_c, _ = base_stats(vm)
                    if sw_c > 0:
                        dc = float((wv[vm] * d[vm]).sum() / sw_c)
                        tk = dsg.totals(np.where(vm, wv * (d - dc) / sw_c, 0.0))
                        contrast_cols.append(round(math.sqrt(dsg.var_totals(tk)) * 100, 2))
                    else:
                        contrast_cols.append(None)
                q_single["npsContrastSe"] = {"total": contrast_total, "columns": contrast_cols}
            if raw.dtype.kind in "fiu" and _is_ordered_scale(rv, r_labels, getattr(meta, "variable_measure", None)):
                # A coded scale (for example 1 to 5): mean, spread and range of the codes, don't know excluded.
                # Not for nominal categories such as gender or province, where a mean of the codes means nothing.
                xq = raw.astype(float).to_numpy()
                vq = np.isfinite(xq) & w_ok
                dk_q = [k for k, v in (r_labels or {}).items() if _DK_RE.match(str(v).strip())]
                if dk_q:
                    vq &= ~np.isin(xq, np.array([float(k) for k in dk_q]))
                dq = describe(xq, vq)
                if dq:
                    q_single["desc"] = dq
            questions.append(q_single)
        else:
            row = mean_row(rv)
            if row is None:
                skipped.append({"variable": rv, "reason": "No valid weighted cases."})
                continue
            row["label"] = "Average"
            # Counter-review on ANA-XTAB-001/OBJ-REV-005: this row's "pct" field holds a mean
            # (mean_row's gm/means), not a share of respondents, same as the "Mean score: ..."
            # group rows built elsewhere in this file, which already set isMean for exactly
            # this reason. Without it, every downstream reader that branches on isMean to tell
            # a mean apart from a percentage (descriptiveFindings.ts's automatic finding
            # generation, evidenceStance.ts's measure classification) silently treated a plain
            # numeric variable's own average as a percentage instead - a mean of 1.5 read back
            # as "1.5%" - and no automatic "average" finding was ever generated for it, since
            # that finding path also requires isMean to recognise the row at all.
            row["isMean"] = True
            questions.append({"key": it["key"], "label": it["label"], "kind": "numeric",
                              "rows": base_rows("Base: answered this question", row) + [row]})

    # Share of responses (mentions): each option's count over all mentions in that column.
    for q_ in questions:
        if q_.get("kind") != "multi":
            continue
        opt = [r for r in q_["rows"] if not r.get("isBase") and not str(r.get("label", "")).startswith("NET:")]
        if len(opt) < 2:
            continue
        den = [sum(r["count"][k] for r in opt) for k in range(K)]
        tden = sum(r["total"]["count"] for r in opt)
        bden = {}
        for r in opt:
            for nt in r["net"]:
                bden[nt["block"]] = bden.get(nt["block"], 0.0) + nt["count"]
        for r in opt:
            r["respPct"] = [None if (den[k] <= 0 or r["base"][k]["n"] < MIN_BASE_SUPPRESS) else round(r["count"][k] / den[k] * 100, 1) for k in range(K)]
            r["total"]["respPct"] = None if tden <= 0 else round(r["total"]["count"] / tden * 100, 1)
            for nt in r["net"]:
                d_ = bden.get(nt["block"], 0.0)
                nt["respPct"] = None if (d_ <= 0 or nt["base"]["n"] < MIN_BASE_SUPPRESS) else round(nt["count"] / d_ * 100, 1)

    # Column-pair letters. Each column is tested against every other column of the
    # same banner variable; a cell shows the letters of the columns it is
    # significantly higher than. The correction setting applies to the pairs of
    # one row within one banner variable.
    def _col_letter(i):
        out = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            out = chr(65 + r) + out
        return out

    for k in range(K):
        columns[k]["letter"] = _col_letter(k)
    for q_ in questions:
        for row in q_["rows"]:
            est = row.pop("_est", None)
            if est is None or row.get("isBase"):
                continue
            letters_ = [""] * K
            for b in set(block_of_col):
                idx = [k for k in range(K) if block_of_col[k] == b and est[k] is not None]
                pairs = []
                for a_i in range(len(idx)):
                    for b_i in range(a_i + 1, len(idx)):
                        ja, jb = idx[a_i], idx[b_i]
                        if dsg is not None and est[ja][2] is not None and est[jb][2] is not None:
                            se = math.sqrt(dsg.var_totals(est[ja][2].astype(float) - est[jb][2].astype(float)))
                        else:
                            se = math.sqrt(est[ja][1] + est[jb][1])
                        if se > 0:
                            z = (est[ja][0] - est[jb][0]) / se
                            pairs.append((ja, jb, z, _p_two_sided_design(z, dsg)))
                if not pairs:
                    continue
                adj = _adjust_p([x[3] for x in pairs], correction) if correction != "none" else [x[3] for x in pairs]
                for (ja, jb, z, _), a in zip(pairs, adj):
                    if a < SIG_LEVEL:
                        hi, lo = (ja, jb) if z > 0 else (jb, ja)
                        letters_[hi] += columns[lo]["letter"]
            row["letters"] = letters_

    # Multiple-comparison correction. The family is one row within one banner
    # variable (the Q convention): the columns of that variable tested for that
    # answer. A correction can only switch a flag off, never on.
    if correction != "none":
        for q_ in questions:
            for row in q_["rows"]:
                if row.get("isBase") or "p" not in row:
                    continue
                row["pAdj"] = [None] * K
                for b in set(block_of_col):
                    idx = [k for k in range(K) if block_of_col[k] == b and row["p"][k] is not None]
                    if not idx:
                        continue
                    adj = _adjust_p([row["p"][k] for k in idx], correction)
                    for k, a in zip(idx, adj):
                        row["pAdj"][k] = round(a, 4)
                        if a >= SIG_LEVEL:
                            row["sig"][k] = 0

    for k in range(K):
        n, sw, n_eff = base_stats(col_masks[k])
        columns[k].update({"n": n, "w": round(sw, 1), "nEff": round(n_eff, 1)})
    tn, tw, te = base_stats(np.ones(n_rows, dtype=bool))
    net_cols = []
    for b in sorted(set(block_of_col)):
        nb, swb, neb = base_stats(block_any[b])
        net_cols.append({"block": b, "blockLabel": next(c["blockLabel"] for c in columns if c["block"] == b),
                         "n": nb, "w": round(swb, 1), "nEff": round(neb, 1)})
    return {
        "version": 2,
        "engine": ENGINE_VERSION,
        # Engineering brief round 4 (criterion 4, "persist the authoritative sheet
        # explicitly in calculation provenance"): meta.sheets["data"] is the sheet this
        # exact read actually used (set in _read_plain's used["data"] = data_sheet; absent
        # for a CSV/stats file, which has no sheet concept). The TS caller (buildCrosstab,
        # crosstabs.ts) threads this into CrosstabProvenance so a saved table's number can
        # always be traced back to which sheet actually produced it, not just whichever
        # sheet documents.selected_sheet happens to hold by the time someone looks.
        "selectedSheet": meta.sheets.get("data") if meta.sheets else None,
        "weightVar": weight_var,
        "weightLabel": (labels.get(weight_var) or weight_var) if weight_var else None,
        "overall": overall,
        "excludeDk": exclude_dk,
        "filters": filters_info,
        "blocks": blocks,
        "columns": columns,
        "nets": net_cols,
        "total": {"n": tn, "w": round(tw, 1), "nEff": round(te, 1)},
        "questions": questions,
        "skipped": skipped,
        "notes": {
            "test": "No banner variable was chosen, so this table describes all respondents and has no comparison tests." if overall else "Each column is compared with all other cases in the same banner variable ("
            + ("t-test (design degrees of freedom) on the linearised difference of two domain estimates" if dsg is not None else "two-proportion z-test on effective bases")
            + "; difference of means for averages), 95% level, "
            + {
                "none": "not corrected for multiple comparisons.",
                "bonferroni": "with a Bonferroni correction across the columns of each banner variable, for each row.",
                "fdr": "with a Benjamini-Hochberg false discovery rate correction across the columns of each banner variable, for each row.",
            }[correction],
            "correction": correction,
            "design": (
                (
                    f"Standard errors use Taylor series linearisation for a stratified cluster sample: primary sampling units {dsg.info['psu']}"
                    if dsg.info["psu"] else
                    "Standard errors use Taylor series linearisation for a stratified sample (no clustering variable given, so each case is its own primary sampling unit)"
                )
                + (f" within strata {dsg.info['strata']}" if dsg.info["strata"] else " (no strata given, so the whole sample is one stratum)")
                + f", {dsg.info['nPsu']:,} units in {dsg.info['nStrata']:,} strata, no finite population correction."
                + (f" {dsg.info['pooledPsus']} unit(s) in single-unit strata were pooled, which can only widen intervals." if dsg.info["pooledPsus"] else "")
                + " A banner column is a domain of the full design, so the cluster structure is kept."
            ) if dsg is not None else (
                f"A survey design was requested (primary sampling unit {design_requested_but_invalid['psu'] or '(none)'}"
                + (f", strata {design_requested_but_invalid['strata']}" if design_requested_but_invalid["strata"] else "")
                + ") but every case was missing its design information, so no usable clustering signal exists. "
                "Standard errors fall back to the plain weighted/Kish effective-base formula, not a validated design-based estimate."
            ) if design_requested_but_invalid is not None else "Weights are applied, but the sampling design (strata and clusters) is not modelled. Standard errors use the Kish effective base, so differences can look more certain than they are.",
            "associationNote": "Cramer's V, the contingency coefficient and lambda treat both variables as unordered. Gamma, Kendall's tau-b and tau-c and Somers' d assume the answer categories and the banner groups are ordered as shown, so read them only for ordered variables. They are descriptive sizes of association from the weighted table; only the chi-square has a significance test. Eta is the share of the variation in an average that lies between the banner groups.",
            "tableTest": (
                "The whole-table test is a first-order Rao-Scott chi-square: Pearson chi-square on weighted counts scaled to the sample size, divided by the average design effect of the table cells (Taylor series)."
                if dsg is not None else
                "The whole-table test is a Pearson chi-square on weighted counts rescaled to the effective base (first-order Rao-Scott adjustment). The design effect comes from the weights only, so it is optimistic for a clustered, stratified sample."
            ),
            # ANA-NPS-003: designUsed is the caller's only window into what survey-design
            # information this table actually had. dsg.info covers the normal, valid-design case;
            # design_requested_but_invalid covers the degenerate "requested but every case was
            # missing" case above, so the caller/researcher still learns that a design was asked
            # for and why it could not be applied, rather than seeing a bare null that looks
            # identical to "no design was ever requested."
            "designUsed": dsg.info if dsg is not None else design_requested_but_invalid,
            # ANA-NPS-003 (second counter-review): designUsed alone cannot tell a consumer whether
            # THIS table's per-category standard errors (`se` on each row) are design-based or a
            # plain SRS/Kish fallback, because design_requested_but_invalid carries the same shape
            # as a genuinely applied design - only nPsu/casesMissingDesign differ, and a caller
            # would have to re-derive "was it actually applied" from those numbers itself. Every
            # row's `se` above falls back to math.sqrt(pj*(1-pj)/n_eff) whenever dsg is None,
            # including the abandoned-design case, so that fallback SE is numerically a plain SRS
            # SE even though a design was requested. computeNps() in descriptiveFindings.ts used to
            # treat the mere presence of a category SE as proof a design correction applied (an
            # SRS SE for every category simply produces an average design effect of 1, never
            # "no design"), silently mislabelling an abandoned design as design-based. This flag is
            # the one unambiguous signal: true only when dsg is not None, i.e. a design was
            # actually used to compute every design-aware figure in this table.
            "designApplied": dsg is not None,
            # ANA-NPS-003: the interval method actually used for every design-based and SRS/Kish
            # standard error in this table - persisted as explicit output metadata rather than
            # only living in this file's own comments, so a consumer (a saved finding, an export)
            # can state the basis of its interval without re-deriving it from `design`'s prose.
            "intervalMethod": "normal_approximation_1.96",
            "overlap": "Columns are compared within their own banner variable only. A respondent belongs to one column of each banner variable, so columns of different banner variables overlap and are not compared with each other. A column is never compared with a total that contains it.",
            "minBase": MIN_BASE_SUPPRESS,
            "minReliable": MIN_BASE_RELIABLE,
            "lowBase": LOW_BASE_FLAG,
            "multiBase": "Multiple-response percentages are of respondents (cases) who answered the question, so they can add to more than 100%. A net counts a respondent once if they chose at least one of its options.",
            "means": "Averages exclude don't know, refused and not applicable codes.",
            "dkNote": ("Don't know, refused and not applicable answers are left out of the percentage bases, so percentages are of respondents who gave a substantive answer."
                       if exclude_dk else
                       "Don't know, refused and not applicable answers are kept in the percentage bases, so they take a share of every row."),
            "filterNote": ("Filtered to " + "; ".join(f["text"] for f in filters_info) + ". Cases outside the filter stay in the design with zero weight, so variances stay correct.") if filters_info else None,
            "expectedNote": "Chi-square is approximate when many cells have an expected count under 5 (counted on unweighted cases). Fisher's exact test is shown for 2 by 2 tables.",
            "respNote": "Share of responses divides each option by the total number of mentions in the column, so the options add to 100%. Share of cases divides by respondents.",
        },
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # This function is reachable at a public Vercel URL with no session or login of its
            # own, and it downloads with the Supabase service-role key, which bypasses row-level
            # security entirely - so without this check, anyone who can reach this URL at all can
            # read any tenant's stored file by guessing or observing its storage path.
            # PARSE_STATS_SHARED_SECRET must be set to the same value the Next.js app sends (see
            # parseStatsFile.ts), and a request without the matching header is refused before
            # anything is downloaded. This used to run with no check at all whenever the secret
            # was left unset, which is exactly the unprotected state an operator who forgot to
            # configure it would be in - the one case this exists to catch. The secret being
            # unset is now treated the same as a wrong one: refused, not waved through.
            secret = os.environ.get("PARSE_STATS_SHARED_SECRET")
            if not secret or self.headers.get("x-parse-stats-secret") != secret:
                self._send_json(401, {"error": "Unauthorized"})
                return
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            storage_path = body["storagePath"]
            source_filename = body.get("sourceFilename", "upload.sav")
            bucket = body.get("bucket", DEFAULT_BUCKET)

            file_bytes = _storage_download(bucket, storage_path)
            action = body.get("action", "convert")
            if action == "dictionary":
                self._send_json(200, {"result": dictionary(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "categories":
                self._send_json(200, {"result": categories(file_bytes, source_filename, (body.get("args") or {})["variable"], (body.get("args") or {}).get("overlay"), (body.get("args") or {}).get("layout"), (body.get("args") or {}).get("selectedSheet"))})
                return
            if action == "columns":
                self._send_json(200, {"result": driver_columns(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "crosstab":
                self._send_json(200, {"result": crosstab(file_bytes, source_filename, body.get("args") or {})})
                return
            result = convert(file_bytes, source_filename)

            result_path = f"{storage_path}.converted.json"
            _storage_upload(bucket, result_path, json.dumps(result).encode("utf-8"), "application/json")

            self._send_json(200, {"resultPath": result_path})
        except Exception as exc:  # noqa: BLE001 - surfaced to the Node caller as a clear parse failure
            self._send_json(500, {"error": str(exc)})

    def _send_json(self, status: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
    columns never collide into one.
    """
    headers = []
    seen = set()
    for raw_name in raw_names:
        label = variable_labels.get(raw_name) or raw_name
        if label in seen:
            label = f"{label} ({raw_name})"
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
DICTIONARY_VERSION = 5
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
    An Excel workbook can carry them on other sheets; see _excel_labels."""

    def __init__(self, labels=None, value_labels=None, used=None):
        self.column_names_to_labels = labels or {}
        self.variable_value_labels = value_labels or {}
        self.sheets = used or {}


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
                if not pd.isna(lab) and str(lab).strip() and name not in var_labels:
                    var_labels[name] = str(lab).strip()
                    used["variables"] = sheet
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
                value_labels.setdefault(name, {})[key] = str(lab).strip()
                used["values"] = sheet
    return var_labels, value_labels, used



def _read_plain(path: str, ext: str, usecols=None):
    """CSV, TSV and Excel case-level files: one row per case, header row of names.
    No variable labels or value labels exist, so names stand in for labels and
    coded answers stay as they are (the dictionary treats a numeric column with
    few distinct values as categories)."""
    import pandas as pd

    if ext in (".csv", ".tsv"):
        sep = "\t" if ext == ".tsv" else ","
        last = None
        for enc in ("utf-8-sig", "latin-1"):
            try:
                df = pd.read_csv(path, sep=sep, encoding=enc, low_memory=False)
                break
            except UnicodeDecodeError as exc:
                last = exc
        else:
            raise last
        xl = None
    else:
        xl = pd.ExcelFile(path)
        sheets = list(xl.sheet_names)
        candidates = [n for n in sheets if not _DICT_SHEET_RE.search(n)] or sheets
        data_sheet = max(candidates, key=lambda n: xl.parse(n, header=None).size)
        df = xl.parse(data_sheet)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.loc[:, ~df.columns.duplicated()]
    df = df.dropna(how="all")
    meta = _PlainMeta()
    if xl is not None and len(sheets) > 1:
        numeric_cols = {c for c in df.columns if df[c].dtype.kind in "fiu"}
        labs, vlabs, used = _excel_labels(xl, [n for n in sheets if n != data_sheet], list(df.columns), numeric_cols)
        used["data"] = data_sheet
        meta = _PlainMeta(labs, vlabs, used)
    if xl is not None:
        xl.close()  # Windows will not delete a temp file that is still open
    if usecols:
        df = df[[c for c in usecols if c in df.columns]]
    return df, meta


def _read_raw(file_bytes: bytes, source_filename: str, usecols=None):
    ext = os.path.splitext(source_filename.lower())[1]
    reader = READERS.get(ext)
    if reader is None and ext in TABLE_EXTS:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            return _read_plain(tmp_path, ext, usecols)
        finally:
            _remove_quietly(tmp_path)
    if reader is None:
        raise ValueError(f"Unsupported data file extension: {ext or '(none)'}")
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


def _read(file_bytes: bytes, source_filename: str, usecols=None, overlay=None):
    df, meta = _read_raw(file_bytes, source_filename, usecols)
    _apply_overlay(df, meta, overlay)
    return df, meta


_YES_RE = re.compile(r"^(yes|selected|mentioned|ticked|checked|chosen|true)\b", re.IGNORECASE)
_NO_RE = re.compile(r"^(no\b|not (selected|mentioned|ticked|checked|chosen)|unchecked|false)", re.IGNORECASE)
_SET_NAME_RE = re.compile(r"^(.+?)_(\d+)$")
_LEAD_CODE_RE = re.compile(r"^[A-Za-z0-9_]+\.\s*")


def _single_valued_code(col, v, labels):
    """An option nobody chose (or everybody chose) has only one value in the
    file. It is still an option of its question and must keep its row, at 0%
    (or 100%), so work out which code means "selected" from the labels."""
    if labels:
        def lab_of(k):
            lab = labels.get(k)
            if lab is None and isinstance(k, float) and k.is_integer():
                lab = labels.get(int(k))
            return lab
        lab = lab_of(v)
        if lab is None:
            return None
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
        return None
    if col.dtype.kind in "fiu" and float(v) in (0.0, 1.0):
        return 1 if col.dtype.kind in "iu" else 1.0
    return None


def _selected_code(col, labels):
    """The value that means "selected" in a yes/no style option variable, or
    None when the variable is not a two-value flag."""
    present = [v for v in col.dropna().unique()]
    if len(present) == 1:
        return _single_valued_code(col, present[0], labels)
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


def dictionary(file_bytes: bytes, source_filename: str) -> dict:
    df, meta = _read(file_bytes, source_filename)
    n = len(df)
    labels = meta.column_names_to_labels or {}
    value_labels = meta.variable_value_labels or {}
    variables = []
    flags = {}
    for name in df.columns:
        col = df[name]
        n_valid = int(col.notna().sum())
        label = labels.get(name) or name
        numeric = col.dtype.kind in "fiu"
        is_flag = _selected_code(col, value_labels.get(name)) is not None
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
                "setKey": m.group(1) if m else None,
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
        if len(stem) < 8:
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
    out = {"version": DICTIONARY_VERSION, "nCases": n, "variables": variables, "sets": sets}
    try:
        out["audit"] = _audit(df, meta, variables, value_labels)
    except Exception:  # the audit is a convenience; the dictionary must still load
        out["audit"] = None
    if getattr(meta, "sheets", None):
        out["sheets"] = meta.sheets
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


def _ordered_categories(decoded, labels):
    present = [c for c in decoded.dropna().unique()]
    if labels:
        order = [labels[k] for k in sorted(labels) if labels[k] in present]
        order += [c for c in present if c not in order]
        return order
    try:
        return sorted(present)
    except TypeError:
        return sorted(present, key=str)


def _p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2))


def _se_prop(p, n_eff):
    return math.sqrt(p * (1 - p) / n_eff)


def categories(file_bytes: bytes, source_filename: str, variable: str, overlay=None) -> dict:
    """Answer categories of one variable (label and unweighted count), in code
    order, for building groups such as top-2 box."""
    df, meta = _read(file_bytes, source_filename, usecols=[variable], overlay=overlay)
    vl = (meta.variable_value_labels or {}).get(variable)
    dec = _decode(df[variable], vl)
    cats = _ordered_categories(dec.dropna(), vl)
    counts = dec.value_counts()
    return {
        "variable": variable,
        "label": (meta.column_names_to_labels or {}).get(variable) or variable,
        "categories": [{"label": str(c), "n": int(counts.get(c, 0))} for c in cats][:200],
    }


def driver_columns(file_bytes: bytes, source_filename: str, args: dict) -> dict:
    """The chosen outcome and predictor columns as numbers, case by case, for driver analysis.
    args: outcome, predictors [names], weightVar. Codes whose label means "no usable answer"
    (don't know, refused, not applicable) become missing, as they do in a crosstab mean. A
    variable whose answers are text rather than numbers is skipped with the reason."""
    import numpy as np
    import pandas as pd

    outcome = args["outcome"]
    predictors = [v for v in args.get("predictors", []) if v != outcome]
    weight_var = args.get("weightVar") or None
    wanted = list(dict.fromkeys([outcome] + predictors + ([weight_var] if weight_var else [])))
    df, meta = _read(file_bytes, source_filename, usecols=wanted, overlay=args.get("overlay"))
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
    return {
        "outcome": describe(outcome, y_arr),
        "predictors": used,
        "y": clean(y_arr),
        "x": [clean(r) for r in x],
        "weights": clean(w) if w is not None else None,
        "n": n_rows,
        "skipped": skipped,
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
        psu = df[psu_var].astype(str).to_numpy()
        strata = df[strata_var].astype(str).to_numpy() if strata_var else np.array(["all"] * n_rows)
        missing = df[psu_var].isna().to_numpy() | (df[strata_var].isna().to_numpy() if strata_var else np.zeros(n_rows, dtype=bool))
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
    wanted = list(dict.fromkeys(column_vars + row_vars + ([weight_var] if weight_var else []) + [v for v in (psu_var, strata_var) if v] + filter_vars))
    df, meta = _read(file_bytes, source_filename, usecols=wanted, overlay=args.get("overlay"))
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

    dsg = _Design.build(df, psu_var, strata_var, n_rows) if psu_var else None

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
        dec = _decode(df[cv], vlabels.get(cv))
        if exclude_dk:
            dk_c = [c for c in dec.dropna().unique() if _DK_RE.match(str(c).strip())]
            if dk_c:
                dec = dec.where(~dec.isin(dk_c))
        cats = _ordered_categories(dec, vlabels.get(cv))
        if len(cats) < 2:
            raise ValueError(f"{labels.get(cv) or cv} needs at least two groups to compare across.")
        if len(cats) > MAX_COLUMN_GROUPS:
            raise ValueError(f"{labels.get(cv) or cv} has {len(cats)} groups; choose one with {MAX_COLUMN_GROUPS} or fewer.")
        blocks.append({"var": cv, "label": labels.get(cv) or cv})
        arr = dec.to_numpy(dtype=object)
        groups = (args.get("columnGroups") or {}).get(cv) or []
        member_of = {}
        for gi, g in enumerate(groups):
            for c in g.get("cats", []):
                if c in member_of:
                    raise ValueError(f'In {labels.get(cv) or cv}, "{c}" is in more than one group.')
                member_of[c] = gi
        emitted = set()
        for c in cats:
            gi = member_of.get(str(c))
            if gi is None:
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": str(c)})
                col_masks.append(np.array([x == c for x in arr], dtype=bool))
            elif gi not in emitted:
                emitted.add(gi)
                members = set(groups[gi]["cats"])
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": groups[gi]["label"], "isGroup": True})
                col_masks.append(np.array([str(x) in members for x in arr], dtype=bool))
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
                    p = _p_two_sided(z)
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
        """Whole-table test of the answer against each banner variable: Pearson
        chi-square on weighted counts rescaled to the effective base, which is the
        first-order Rao-Scott adjustment using the design effect from the weights
        only (strata and clusters are not modelled)."""
        out = []
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
            E = np.outer(T.sum(axis=1), T.sum(axis=0)) / T.sum()
            x2 = float(((T - E) ** 2 / E).sum())
            if dfull:
                x2 = x2 / max(dfull, 1e-9)
            dfree = (T.shape[0] - 1) * (T.shape[1] - 1)
            out.append({**(assoc or {}), "block": b, "label": columns[ks[0]]["blockLabel"], "chi2": round(x2, 2), "df": int(dfree),
                        "p": round(_chi2_sf(x2, dfree), 4),
                        "nEff": round(n_ / dfull, 1) if dfull else round(ne_, 1),
                        "deff": round(dfull, 2) if dfull else (round(n_ / ne_, 2) if ne_ else None)})
        return out

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
        return {"p10": r3(wq(0.10)), "p90": r3(wq(0.90)), "sum": r3(float((wi * xi).sum())), "mode": r3(mode),
                "skewness": r3(skew), "kurtosis": r3(kurt), "hist": hist, "percentiles": extra_p,
                "n": n, "nEff": round(n_eff, 1), "mean": r3(mean), "sd": r3(sd), "variance": r3(var),
                "sem": r3(sd / math.sqrt(n_eff)) if sd is not None else None,
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
                    p = _p_two_sided(z)
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
                    code = _selected_code(col, vlabels.get(ov))
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
                code = _selected_code(col, vlabels.get(ov))
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
        categorical = bool(r_labels) or raw.dtype.kind not in "fiu" or distinct <= NUMERIC_AS_CATEGORIES_MAX
        if categorical:
            dec = _decode(raw, r_labels)
            if exclude_dk:
                dk_r = [c for c in dec.dropna().unique() if _DK_RE.match(str(c).strip())]
                if dk_r:
                    dec = dec.where(~dec.isin(dk_r))
            r_valid = dec.notna().to_numpy()
            cats = _ordered_categories(dec[r_valid], r_labels)
            if len(cats) < 2:
                skipped.append({"variable": rv, "reason": "Fewer than two answer categories among valid cases."})
                continue
            if len(cats) > MAX_ROW_CATEGORIES:
                skipped.append({"variable": rv, "reason": f"{len(cats)} answer categories (limit {MAX_ROW_CATEGORIES})."})
                continue
            arr = dec.to_numpy(dtype=object)
            rows = []
            for cat in cats:
                sel = np.array([x == cat for x in arr], dtype=bool)
                row = prop_row(sel, r_valid)
                add_row_pct(row, block_of_col)
                row["label"] = str(cat)
                rows.append(row)
            # Subtotals (NET), net scores and mean scores. Each can be placed at the end, or
            # above or below the answers it summarises.
            group_rows = []
            for g in it.get("groups") or []:
                kind = g.get("kind") or "net"
                plus = set(g.get("cats", []))
                minus = set(g.get("minus", []))
                if kind == "net":
                    sel = np.array([str(x) in plus for x in arr], dtype=bool)
                    row = prop_row(sel, r_valid)
                    add_row_pct(row, block_of_col)
                    row["label"] = f"NET: {g['label']}"
                    row["isNet"] = True
                    anchor = plus
                elif kind == "score":
                    if not plus or not minus or plus & minus:
                        skipped.append({"variable": rv, "reason": f"Net score {g['label']} needs positive and negative answers that do not overlap."})
                        continue
                    # Net score: share positive minus share negative, in percentage points. It is the mean of
                    # +100 / 0 / -100, so it is tested like an average.
                    yv = np.array([100.0 if str(x) in plus else (-100.0 if str(x) in minus else 0.0) for x in arr])
                    row = mean_row(None, yv, r_valid)
                    if row is None:
                        continue
                    row.pop("desc", None)
                    row.pop("eta", None)
                    row["label"] = f"Net score: {g['label']}"
                    row["isNet"] = True
                    row["isScore"] = True
                    anchor = plus | minus
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
                    anchor = set(str(c) for c in cats)
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
                        "tableTests": table_tests(arr, r_valid, cats)}
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
                            pairs.append((ja, jb, z, _p_two_sided(z)))
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
            + ("z-test on the linearised difference of two domain estimates" if dsg is not None else "two-proportion z-test on effective bases")
            + "; difference of means for averages), 95% level, "
            + {
                "none": "not corrected for multiple comparisons.",
                "bonferroni": "with a Bonferroni correction across the columns of each banner variable, for each row.",
                "fdr": "with a Benjamini-Hochberg false discovery rate correction across the columns of each banner variable, for each row.",
            }[correction],
            "correction": correction,
            "design": (
                f"Standard errors use Taylor series linearisation for a stratified cluster sample: primary sampling units {dsg.info['psu']}"
                + (f" within strata {dsg.info['strata']}" if dsg.info["strata"] else " (no strata given, so the whole sample is one stratum)")
                + f", {dsg.info['nPsu']:,} units in {dsg.info['nStrata']:,} strata, no finite population correction."
                + (f" {dsg.info['pooledPsus']} unit(s) in single-unit strata were pooled, which can only widen intervals." if dsg.info["pooledPsus"] else "")
                + " A banner column is a domain of the full design, so the cluster structure is kept."
            ) if dsg is not None else "Weights are applied, but the sampling design (strata and clusters) is not modelled. Standard errors use the Kish effective base, so differences can look more certain than they are.",
            "associationNote": "Cramer's V, the contingency coefficient and lambda treat both variables as unordered. Gamma, Kendall's tau-b and tau-c and Somers' d assume the answer categories and the banner groups are ordered as shown, so read them only for ordered variables. They are descriptive sizes of association from the weighted table; only the chi-square has a significance test. Eta is the share of the variation in an average that lies between the banner groups.",
            "tableTest": (
                "The whole-table test is a first-order Rao-Scott chi-square: Pearson chi-square on weighted counts scaled to the sample size, divided by the average design effect of the table cells (Taylor series)."
                if dsg is not None else
                "The whole-table test is a Pearson chi-square on weighted counts rescaled to the effective base (first-order Rao-Scott adjustment). The design effect comes from the weights only, so it is optimistic for a clustered, stratified sample."
            ),
            "designUsed": dsg.info if dsg is not None else None,
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
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            storage_path = body["storagePath"]
            source_filename = body.get("sourceFilename", "upload.sav")
            bucket = body.get("bucket", DEFAULT_BUCKET)

            file_bytes = _storage_download(bucket, storage_path)
            action = body.get("action", "convert")
            if action == "dictionary":
                self._send_json(200, {"result": dictionary(file_bytes, source_filename)})
                return
            if action == "categories":
                self._send_json(200, {"result": categories(file_bytes, source_filename, (body.get("args") or {})["variable"], (body.get("args") or {}).get("overlay"))})
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

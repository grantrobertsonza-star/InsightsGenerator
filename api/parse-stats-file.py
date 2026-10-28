"""Vercel Python serverless function: the app's reader of data files. It converts
an SPSS (.sav), Stata (.dta) or SAS (.sas7bdat) file into a {headers, rows}
table ("convert"), and since batch 26 is also the only reader of CSV, TSV and
Excel files ("table", read_table): the stored preview and every dictionary,
cross tab and driver calculation are built from the same read, so every
downstream consumer in the TypeScript app (the table preview, the banner-plan
picker, bannerPlanComputation.ts) needs no format-specific handling of its own.

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
import datetime
import hashlib
import io
import json
import math
import os
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

import pyreadstat

# Shared with the upload boundary: these are the owner's declared initial release limits.
with open(os.path.join(os.path.dirname(__file__), "import-limits.json"), encoding="utf-8") as _limits_file:
    IMPORT_LIMITS = json.load(_limits_file)


# Built from the limits so the wording matches src/lib/importLimits.ts and the limit actually enforced.
FILE_LIMIT_MESSAGE = (
    f"This file exceeds the supported {round(IMPORT_LIMITS['maxFileBytes'] / 1_000_000)} MB limit "
    f"({IMPORT_LIMITS['maxFileBytes']:,} bytes). Split it into smaller files, then retry."
)
CASE_LIMIT_MESSAGE = (
    f"This file exceeds the supported {IMPORT_LIMITS['maxCases']:,} case limit. "
    "Split it into smaller files, then retry; no partial result was published."
)


def _check_import_limits(file_bytes, cases=None):
    if len(file_bytes) > IMPORT_LIMITS["maxFileBytes"]:
        raise ValueError(FILE_LIMIT_MESSAGE)
    if cases is not None and cases > IMPORT_LIMITS["maxCases"]:
        raise ValueError(CASE_LIMIT_MESSAGE)

def _beyond_exact_whole(series) -> bool:
    """True when an integer column holds a value a double cannot hold exactly (|v| > 2^53)."""
    present = series.dropna()
    if len(present) == 0:
        return False
    return bool((present.astype(object).map(lambda v: abs(int(v)) > _MAX_EXACT_WHOLE)).any())


def _exact_whole_numbers(series):
    """The final step for every R or Parquet column, whatever its dtype became (B38-F01, Codex): a
    column of whole numbers holding any value a double cannot hold exactly (|v| > 2^53) is written as
    exact text, each value as its digits, as the plain-text readers do (_MAX_EXACT_WHOLE). Before this,
    only some dtype branches checked: a categorical of such integers became objects, went out as JSON
    numbers, and the app's JSON parse rounded 9007199254740993 to ...992, so the stored preview merged two
    identifiers the calculation kept apart. Bools are not numbers here; a column with any non-integer
    value (a float, text) is left as it is."""
    import numbers

    import pandas as pd

    if series.dtype != object and not pd.api.types.is_integer_dtype(series.dtype):
        return series
    present = [v for v in series.tolist() if v is not None and v is not pd.NA and not (isinstance(v, float) and v != v)]
    if not present or not all(isinstance(v, numbers.Integral) and not isinstance(v, bool) for v in present):
        return series
    if not any(abs(int(v)) > _MAX_EXACT_WHOLE for v in present):
        return series
    return pd.Series(
        [None if (v is None or v is pd.NA or (isinstance(v, float) and v != v)) else str(int(v)) for v in series.tolist()],
        index=series.index,
        dtype=object,
    )


def _r_and_parquet_frame(df, data_sheet=None, usecols=None, factor_codes=False):
    """A data frame from R or Parquet as the readers' (data, meta) pair. An R factor (a pandas
    Categorical of text levels) becomes its R codes 1, 2, ... with each level as the code's label, as
    an SPSS variable with value labels is read, so a factor's identity is its code and its wording a
    label. A Parquet categorical keeps its own values (numbers stay numbers, text stays text): its codes
    are pandas' storage, not the data's. Columns keep their names; R and Parquet carry no variable
    labels."""
    import pandas as pd

    value_labels = {}
    out = {}
    for col in df.columns:
        series = df[col]
        if isinstance(series.dtype, pd.CategoricalDtype):
            if factor_codes:
                codes = series.cat.codes.astype("float64").where(series.cat.codes >= 0) + 1
                value_labels[str(col)] = {float(i + 1): str(level) for i, level in enumerate(series.cat.categories)}
                out[str(col)] = codes
                continue
            series = series.astype(object).where(series.notna(), None)
        elif pd.api.types.is_integer_dtype(series.dtype) and _beyond_exact_whole(series):
            # B36-F02 (Codex): a whole number beyond 2^53 is not exact in a double, so converting the column
            # to float would merge distinct identifiers; it is left as integers for _exact_whole_numbers.
            series = series.astype(object).where(series.notna(), None)
        elif pd.api.types.is_extension_array_dtype(series.dtype) and pd.api.types.is_numeric_dtype(series.dtype) and not pd.api.types.is_bool_dtype(series.dtype):
            # A nullable integer (R integer with NA, pandas Int64) as the plain float column every
            # numeric variable is read as, with NA as NaN, so it stays numeric (exact: every value is
            # within 2^53, checked above).
            series = series.astype("float64")
        elif pd.api.types.is_extension_array_dtype(series.dtype):
            series = series.astype(object).where(series.notna(), None)
        elif series.dtype == object:
            present = [v for v in series if v is not None and not (isinstance(v, float) and v != v)]
            beyond = any(isinstance(v, int) and not isinstance(v, bool) and abs(v) > _MAX_EXACT_WHOLE for v in present)
            if present and not beyond and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
                # pyreadr returns an R integer column with NA as objects; it is a number column.
                series = pd.to_numeric(series, errors="coerce").astype("float64")
        out[str(col)] = _exact_whole_numbers(series)
    frame = pd.DataFrame(out)
    if usecols:
        frame = frame[[c for c in usecols if c in frame.columns]]
    return frame, _PlainMeta(value_labels=value_labels, data_sheet=data_sheet)


def read_r_file(path, usecols=None, **_ignored):
    """An R data file: .rds (one object) or .RData/.rda (named objects), read by pyreadr, which reads R's
    serialisation format without running R code. The data frame with the most rows is used (as the
    worksheet with the most data rows is, for a workbook) and named as the read's sheet; a file holding
    no data frame is refused."""
    import pyreadr
    import pandas as pd

    objects = pyreadr.read_r(path)
    frames = {(name or "data"): obj for name, obj in objects.items() if isinstance(obj, pd.DataFrame)}
    if not frames:
        raise ValueError("This R file holds no data frame. Save the data with saveRDS(data_frame, \"file.rds\") and upload it again.")
    name = max(frames, key=lambda n: len(frames[n]))
    return _r_and_parquet_frame(frames[name], data_sheet=name if len(frames) > 1 or name != "data" else None, usecols=usecols, factor_codes=True)


def read_parquet_file(path, usecols=None, **_ignored):
    """A Parquet file (pandas, Polars, Spark, R arrow), read with fastparquet, which is far smaller than
    pyarrow and fits the deployed reader."""
    import pandas as pd

    df = pd.read_parquet(path, engine="fastparquet")
    return _r_and_parquet_frame(df, usecols=usecols)


READERS = {
    ".sav": pyreadstat.read_sav,
    ".dta": pyreadstat.read_dta,
    ".sas7bdat": pyreadstat.read_sas7bdat,
    # SAS transport (XPORT), the format SAS datasets are usually exchanged and archived in.
    ".xpt": pyreadstat.read_xport,
    # R and Python (Grant, 26 October 2026).
    ".rds": read_r_file,
    ".rdata": read_r_file,
    ".rda": read_r_file,
    ".parquet": read_parquet_file,
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


def _sas_blanks_missing(ext, data):
    """SAS has no separate missing value for a character variable: a blank is missing (SAS's own
    definition of a missing character value). pyreadstat returns it as "", which would otherwise be
    counted as an answer of its own. Applied in place, by both readers of a statistics file (convert,
    for the stored preview, and _read_raw_uncached, for every calculation), so they agree."""
    if ext not in (".sas7bdat", ".xpt"):
        return
    import pandas as pd

    for col in data.columns:
        # Object or pandas' string dtype (the default for text from pandas 3); kept as object so a
        # missing cell is None, as in every other column the readers hand on.
        if pd.api.types.is_object_dtype(data[col]) or pd.api.types.is_string_dtype(data[col]):
            data[col] = data[col].astype(object).map(lambda v: None if isinstance(v, str) and v.strip() == "" else v)


def convert(file_bytes: bytes, source_filename: str) -> dict:
    _check_import_limits(file_bytes)
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
    _sas_blanks_missing(ext, df)

    variable_labels = meta.column_names_to_labels or {}
    _check_import_limits(file_bytes, len(df))
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

    result = {"headers": headers, "rows": rows, "reader": STATS_READER}
    if len(raw_names) < len(all_names):
        result["totalVariables"] = len(all_names)
        result["keptVariables"] = len(raw_names)
    return result




# The reader that produced a stored preview table (documents' document_tables.read_provenance). A stored
# table from any other reader (the retired TypeScript preview reader, or an older engine read) is checked
# against a fresh read before it is shown (importPreviewIdentity.ts).
# c: Excel cells read without merging TRUE with 1 or FALSE with 0 (CAL-R1-F03).
TABLE_READER = "engine-plain-2026.10.26c"
# The same for SPSS, Stata, SAS, R and Parquet tables (convert). 2026.10.27: R and Parquet whole numbers
# beyond 2^53 kept exact as text (B38-F01); an R or Parquet table stored without this name was read
# before that, may hold rounded identifiers, and is checked against a fresh read (B40-F01).
STATS_READER = "engine-stats-2026.10.27"


def _json_cell(v):
    if v is None or _is_nat(v):
        return None
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        v = v.item()
    if isinstance(v, float) and v != v:
        return None
    return v


def read_table(file_bytes: bytes, source_filename: str, args=None) -> dict:
    """The stored preview of a CSV, TSV or Excel file: exactly the table every calculation reads
    (_read_raw, the same cached read the dictionary and cross tabs use), one object per case keyed by
    canonical variable name. args: layout ("rows_are_cases" or "columns_are_cases") and selectedSheet
    (the persisted sheet choice, if any). A persisted sheet that is gone is answered as
    sheetSelectionLost rather than raised, so the app can show its own recovery message."""
    args = args or {}
    ext = os.path.splitext(source_filename.lower())[1]
    if ext not in TABLE_EXTS:
        raise ValueError(f"Only CSV, TSV, delimited text (.txt) and Excel files are read as plain tables, not {ext or '(none)'} files.")
    layout = args.get("layout")
    if layout not in (None, "rows_are_cases", "columns_are_cases"):
        raise ValueError(f"Unknown data layout {layout!r}.")
    try:
        df, meta = _read_raw(file_bytes, source_filename, None, layout if layout == "columns_are_cases" else None, args.get("selectedSheet") or None)
    except SheetSelectionLostError as exc:
        return {"sheetSelectionLost": {"documentSheetName": exc.document_sheet_name, "availableSheets": exc.available_sheets}}
    headers = [str(c) for c in df.columns]
    rows = [{h: _json_cell(v) for h, v in zip(headers, rec)} for rec in df.itertuples(index=False, name=None)]
    return {
        "headers": headers,
        "rows": rows,
        # A CSV has no sheets; "Sheet1" is the name its persisted selection has always carried.
        "sheetName": meta.data_sheet or "Sheet1",
        "unsupportedIdentifierColumns": list(meta.unsupported_identifier_columns),
        "encoding": meta.encoding,
        "dateColumns": list(meta.date_columns),
        "reader": TABLE_READER,
    }

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
# 7: IMP-015 conflicting labels shown as conflicts, not silently chosen.
# 8: columns-as-cases files typed per variable after the flip (_flip_types): exact large integers,
#    identifiers kept literally. Only that layout's cached copies need rebuilding; crosstabs.ts asks
#    for 8 there and still accepts 7 for rows-as-cases, whose typing did not change.
# 11: CSV/TSV/Excel files read by the one reader (_read_plain, _typed_series): literal names and codes,
#     ISO dates, one duplicate-name rule in both layouts. Every cached copy of such a file is rebuilt
#     (crosstabs.ts minimumDictionaryVersion asks for 11 for them).
# 12: decimal and exponent spellings a double cannot hold exactly keep their variable as text
#     (_exact_decimal, Codex B26-F01). Every cached copy of a CSV/TSV/Excel file is rebuilt again, so a
#     version-11 dictionary that merged such values is not reused (minimumDictionaryVersion asks for 12).
# 13: a decimal or exponent spelling beyond 2^53 is text like a bare whole number (one typing policy,
#     Codex RP0-M01); cached CSV/TSV/Excel dictionaries are rebuilt again (minimumDictionaryVersion 13).
# 14: Excel cells are read without merging logical TRUE/FALSE with 1/0 in a column holding both
#     (_excel_sheet_grid, CAL-R1-F03); cached Excel dictionaries are rebuilt (minimumDictionaryVersion
#     14 for .xlsx/.xls; CSV/TSV reading did not change and their version-13 copies stay valid).
DICTIONARY_VERSION = 14
ENGINE_VERSION = "2026.10.27-1"  # shares tested with the pooled two-proportion z-test
# The version of the rules that decide a table's figures and flags, recorded in every table's notes as
# methodVersion. A table recorded with a different version (or none: built before this was recorded) was
# built under rules that can give different figures or flags, and is reported as built with an earlier
# method (src/lib/tableMethod.ts, CURRENT_TABLE_METHOD, which must equal this value; a test checks).
# "2026.10.27" (batch 47): shares tested pooled under the null hypothesis (before: unpooled, which flagged
# a 0% or 100% cell against a small gap), and non-answer labels recognised when their words run together
# ("DontKnow", "Not_applicable"), so those codes leave the bases and banners.
TABLE_METHOD = "2026.10.27"
MIN_EFFECTIVE_BASE = 30
MIN_BASE_SUPPRESS = 10   # unweighted base under this: cell values are not shown (dash)
MIN_BASE_RELIABLE = 30   # unweighted base under this: figure shown as indicative only, never tested or turned into a finding
LOW_BASE_FLAG = 100      # kept for compatibility
SIG_LEVEL = 0.05
# Value labels that mean "no usable answer"; such codes never enter a mean.
# Words may be run together or joined by "_" or "-" as well as spaced: data exports often label a code
# "DontKnow", "Not_applicable" or "NoAnswer", and before batch 47 those stayed in as answers and banner
# columns even with non-answers excluded (Grant, 27 October 2026: a "DontKnow" column in the UsedIVR banner).
_SEP = r"[\s_-]*"
_DK_RE = re.compile(
    rf"^(don['\u2019\u2018`]?t{_SEP}know|do{_SEP}not{_SEP}know|dk\b|refus|prefer{_SEP}not{_SEP}to{_SEP}(say|answer)|no{_SEP}response|no{_SEP}answer"
    rf"|not{_SEP}applicable|n/?a\b|not{_SEP}stated|unknown|missing)",
    re.IGNORECASE,
)
_WEIGHT_RE = re.compile(r"weight|wgt|\bwt\b", re.IGNORECASE)


class _PlainMeta:
    """Stand-in for pyreadstat metadata on files that carry no labels (CSV, Excel).
    An Excel workbook can carry them on other sheets; see _excel_labels and
    _excel_codebook."""

    def __init__(self, labels=None, value_labels=None, used=None, mr_sets=None, variable_measure=None, missing_ranges=None, label_conflicts=None, unsupported_identifier_columns=None, data_sheet=None, encoding=None, date_columns=None):
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
        # The worksheet read (None for CSV/TSV), the text encoding a CSV/TSV was read in
        # (_decode_plain_text) and the variables holding calendar values written as ISO text.
        self.data_sheet = data_sheet
        self.encoding = encoding
        self.date_columns = date_columns or []


# Delimited text files: CSV, TSV, and .txt exports (survey archives such as the Berkeley IGS Poll ship
# their data as tab-delimited .txt). A .txt file is read only when it is uploaded as a data or table
# file, and its delimiter is sniffed like a CSV's.
DELIMITED_EXTS = (".csv", ".tsv", ".txt")
TABLE_EXTS = DELIMITED_EXTS + (".xlsx", ".xls")

# The reader for each workbook format, named rather than left to pandas (V-B36-01, Codex): pandas 3
# picks python-calamine for .xls when no engine is given, which requirements.txt does not install, so a
# fresh install refused valid .xls files that read correctly with xlrd. Both readers named here are
# pinned in requirements.txt; any other workbook extension is not a supported format.
WORKBOOK_ENGINES = {".xlsx": "openpyxl", ".xlsm": "openpyxl", ".xls": "xlrd"}


def _open_workbook(path):
    import pandas as pd

    ext = os.path.splitext(str(path).lower())[1]
    engine = WORKBOOK_ENGINES.get(ext)
    if engine is None:
        raise ValueError(f"Unsupported workbook format: {ext or '(none)'}")
    return pd.ExcelFile(path, engine=engine)

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


def _format_code(code):
    if isinstance(code, float) and code.is_integer():
        return str(int(code))
    return str(code)


def _show_label_conflicts(var_labels, value_labels, conflicts):
    """IMP-015: when label sources disagree, no definition is silently chosen.

    Before this, a later sheet (or the codebook) simply won, and the losing definition was
    recorded in metadata nothing displayed: two sheets defining code 1 as "Yes" and as "No"
    could reverse a finding's meaning with no visible sign. Now every conflicting code is
    labelled with its raw code and ALL the competing labels, e.g. 1 [conflicting labels:
    "Yes" / "No"], and a conflicting variable label likewise. That text reaches every table,
    chart and export through the normal label path, so the conflict is visible wherever the
    category appears. The raw code stays the category's identity (labels never decide it), so
    counts and percentages are unchanged; only the meaning attached to the code is withheld.
    Codes that do not conflict keep their labels. Resolution is deterministic: correct the
    workbook's label sheets and re-read the file. Each conflict entry records
    resolution = "shown_as_conflict"."""
    var_labels = dict(var_labels)
    value_labels = {k: dict(v) for k, v in value_labels.items()}
    seen_values: dict = {}  # (variable, code) -> competing labels in the order found
    seen_vars: dict = {}
    for c in conflicts:
        kind = c.get("kind")
        name = c.get("variable")
        if kind == "value_label":
            kept, discarded = c.get("kept"), c.get("discarded")
            if isinstance(kept, dict) or isinstance(discarded, dict):
                kept_d = kept if isinstance(kept, dict) else {}
                disc_d = discarded if isinstance(discarded, dict) else {}
                for code in kept_d.keys() & disc_d.keys():
                    if str(kept_d[code]) != str(disc_d[code]):
                        bucket = seen_values.setdefault((name, code), [])
                        for lab in (str(disc_d[code]), str(kept_d[code])):
                            if lab not in bucket:
                                bucket.append(lab)
            elif "value" in c:
                bucket = seen_values.setdefault((name, c["value"]), [])
                for lab in (str(discarded), str(kept)):
                    if lab not in bucket:
                        bucket.append(lab)
            c["resolution"] = "shown_as_conflict"
        elif kind == "variable_label":
            bucket = seen_vars.setdefault(name, [])
            for lab in (str(c.get("kept")), str(c.get("discarded"))):
                if lab not in bucket:
                    bucket.append(lab)
            c["resolution"] = "shown_as_conflict"
    for (name, code), labels in seen_values.items():
        if len(labels) < 2 or name not in value_labels:
            continue
        shown = " / ".join(f'"{lab}"' for lab in labels)
        value_labels[name][code] = f"{_format_code(code)} [conflicting labels: {shown}]"
    for name, labels in seen_vars.items():
        if len(labels) < 2:
            continue
        shown = " / ".join(f'"{lab}"' for lab in labels)
        var_labels[name] = f"{name} [conflicting labels: {shown}]"
    return var_labels, value_labels


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
    value_label_sheet: dict = {}  # (variable, code) -> sheet the current label came from
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
                # IMP-015: a label row for a variable the data does not have is diagnosed, not
                # silently ignored (often a renamed or misspelt column, whose labels then never apply).
                if name and not any(c.get("kind") == "unmatched_variable" and c.get("variable") == name for c in conflicts):
                    conflicts.append({"variable": name, "kind": "unmatched_variable", "sheet": sheet})
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
                            # IMP-015: the sheet the discarded label actually came from (this
                            # used to report the last sheet read, which could be the same one).
                            "discardedSheet": value_label_sheet.get((name, key), used.get("values")),
                            "discarded": existing[key],
                        }
                    )
                existing[key] = lab
                value_label_sheet[(name, key)] = sheet
                used["values"] = sheet
    return var_labels, value_labels, used, conflicts



_CB_VAR_RE = re.compile(r"variable", re.I)
_CB_LABEL_RE = re.compile(r"label|question|wording|description", re.I)
_CB_CODES_RE = re.compile(r"response code|value code|missing value|coded value|value label", re.I)
_CB_SET_RE = re.compile(r"multiple[ _-]?response|mr ?set|multi.?response|question group", re.I)
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


def _refuse_flipped_codebook_metadata(xl, other_sheets):
    """Inspect before matching variable names: pre-flip names are case IDs, not variables."""
    import pandas as pd

    for sheet in other_sheets:
        raw = xl.parse(sheet, header=0, dtype=object)
        columns = {str(c).strip().lower(): c for c in raw.columns}
        metadata_columns = [
            c for name, c in columns.items()
            if _CB_SET_RE.search(name) or re.search(r"\bweights?\b|weighting", name)
        ]
        # A role/type column can declare a weight without a dedicated Weight column.
        role_columns = [c for name, c in columns.items() if re.search(r"role|type|purpose", name)]
        variable_columns = [c for name, c in columns.items() if _VAR_COL_RE.match(name)]
        declared = any(
            not pd.isna(value) and str(value).strip().lower() not in ("", "none", "no", "false", "n/a", "na", "-")
            for c in metadata_columns for value in raw[c]
        ) or any(
            not pd.isna(value) and re.search(r"\bweights?\b|weighting|multiple.response|mr.?set", str(value), re.I)
            for c in role_columns for value in raw[c]
        ) or any(
            not pd.isna(value) and re.fullmatch(r"weight(?:_var(?:iable)?)?|wgt|case_weight|survey_weight", str(value).strip(), re.I)
            for c in variable_columns for value in raw[c]
        )
        if declared:
            raise ValueError(
                f'Unsupported flipped workbook: separate Codebook/metadata sheet "{sheet}" declares '
                'weights or multiple-response sets. No analytical result was produced. '
                'Re-export as one row per respondent with the Codebook definitions retained, '
                'then upload again and verify the weight and multiple-response setup. '
                'Full support for this combination is pending verification.'
            )


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
        # IMP-015: a sheet with its own value/code column is the row-per-value layout that
        # _excel_labels reads. Read here as a codebook, its "Value label" column matched the label
        # pattern, so each ANSWER label was taken as the QUESTION label (last row winning): a
        # variable could be titled "No". Such sheets are skipped, and an answer-label column is
        # never taken as the variable label.
        if any(_VALUE_COL_RE.match(k) for k in cols):
            continue
        label_col = next(
            (
                c
                for k, c in cols.items()
                if _CB_LABEL_RE.search(k) and "set" not in k and "code" not in k and not _VLABEL_COL_RE.match(k)
            ),
            None,
        )
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


# The declared missing-value tokens for response values in CSV, TSV and Excel files: pandas' own
# default list (pandas.io.parsers.STR_NA_VALUES), compared after trimming so "NA " is missing too.
# Applied cell by cell by _is_missing_cell; never applied to names (_literal_text).
_NA_STRING_TOKENS = {
    "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan",
    "1.#IND", "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
}


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
    """IMP-003 / TP500-F02: unique names for repeated literal names, the one allocation rule for
    header names (rows-as-cases) and row names (columns-as-cases). Every literal name is reserved
    first; the first occurrence keeps it and each later repeat takes the next "name (n)" that no
    literal name or earlier allocation holds: "q, q, q (2)" -> "q", "q (3)", "q (2)", so a column
    literally named "q (2)" keeps its name and values. dataSetup.allocateVariableNames is the same
    rule for tables found in Word/PDF text, which this reader never sees.

    MUST run on the raw header text before pandas ever constructs a DataFrame from it:
    pd.read_csv/pd.ExcelFile.parse unconditionally rename a genuine duplicate column to
    pandas' own "name", "name.1", "name.2" convention the moment they build the column
    index (there is no way to opt out of this in current pandas), which silently replaced
    this function's own job before it ever ran - df.columns.duplicated() downstream always
    came back empty, because pandas had already resolved every duplicate under a DIFFERENT
    naming convention than this one, before this function's own loop ever got a chance.
    Calling this directly on the worksheet's own first row - read with header=None so
    pandas never gets to name the columns itself - keeps the allocation this rule's own.
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
# recovery state, never automatic substitution"); read_table answers it as sheetSelectionLost,
# which parseTable.ts raises as its SheetSelectionLostError. Raised only when `selected_sheet` is a
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


# IMP-SHIP-001 (Codex round 2): the data sheet of a workbook with no persisted choice is the
# non-dictionary sheet with the most actual DATA rows (any row, after the header row, with at
# least one cell that is not blank or a missing token). Ranking by a sheet's used range or parsed
# size let a sheet formatted out to a large empty range (formatting across A1:J101 with one real
# row) outrank a genuinely larger sheet (Codex's Sparse/Dense fixture).
def _is_blank_or_na_token(value) -> bool:
    """The "missing for ranking purposes" rule: a library missing value, or text that is blank or
    a declared missing token after trimming (_NA_STRING_TOKENS). A plain pandas `.notna()` check
    is not enough: it does not trim, so "NA " with a trailing space would count as data."""
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
    except Exception as exc:
        # Codex IR-09 (2026-10-20): this used to return an empty set, so the bare digits pandas
        # read ("7" for a cell shown as "0007") went on as if they were confirmed identifiers and
        # two different respondents could share one identity while the read reported success.
        # For .xlsx/.xlsm the format check is part of reading the file correctly, so a failure
        # here fails the read with the reason; a retry reads the formats again. A legacy .xls
        # file cannot be opened by openpyxl at all (no format codes are available to anyone in
        # this reader), so it keeps the plain values as before; that limit is not a transient
        # failure and is outside this check.
        if os.path.splitext(str(path))[1].lower() in (".xlsx", ".xlsm"):
            columns = ", ".join(headers[i] for i in id_positions)
            raise ValueError(
                f"Could not check the Excel number formats of the identifier column(s) {columns}, "
                "so leading zeros (for example 0007) cannot be confirmed and identifiers could merge. "
                "Read the file again; if it keeps failing, re-save "
                f"the workbook or store the identifiers as text. ({type(exc).__name__})"
            ) from exc
        return unsupported
    # One forward pass over the data rows, reading only the id-like columns. A read-only
    # workbook streams its XML: ws.cell(row, column) re-scans the sheet from the top on every
    # call, so the earlier per-column, per-row lookups cost rows x rows and a 1,000-case,
    # 97-column workbook hit the statistics worker's 5-minute limit (Codex real-data check,
    # 2026-10-19: csm_Wave1_Baseline.xlsx). iter_rows reads each row once, in order. Same row
    # alignment as before (row 1 is the header this file already consumed; data row i is sheet
    # row i + 2) and the same per-cell rules.
    first_col, last_col = min(id_positions) + 1, max(id_positions) + 1
    try:
        rows = ws.iter_rows(min_row=2, max_row=len(df) + 1, min_col=first_col, max_col=last_col)
        for row_i, row in enumerate(rows):
            if row_i >= len(df):
                break
            for col_idx in id_positions:
                offset = col_idx + 1 - first_col
                if offset >= len(row):
                    continue  # a short row: no cell there, so nothing to reformat
                cell = row[offset]
                fmt = getattr(cell, "number_format", None) or ""
                value = getattr(cell, "value", None)
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


# One reader for CSV, TSV and Excel (Grant, 24 October 2026; Codex TP500-F01/F02, IP1000-F01 to F04).
# This file is the only reader of a plain data file: the stored preview (read_table, below) and every
# dictionary, cross tab and driver calculation are built from the same _read_plain result, so they
# cannot disagree about a file. Library value inference is not used: pandas and SheetJS both guessed
# types cell by cell or column by column and turned literal names and codes into other values ("01" to
# 1, "NaN" to missing, a date to a serial number). Cells are read as written and typed here, by one rule.

# A cell written as a plain decimal number. A leading "+", a leading zero on a multi-digit whole part
# ("001"), thousands separators and words such as "inf" are not numbers here: in research files they
# are codes and identifiers, and reading them as numbers merges distinct codes ("001" and "1").
_STRICT_NUMBER = re.compile(r"^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
# Whole numbers beyond this are not exact in a double, which is how the stored preview (JSON read by
# the app) holds numbers; a column holding one, in any spelling (_exact_decimal), stays text so preview
# and calculation keep the same, distinct values.
_MAX_EXACT_WHOLE = 2**53


def _is_nat(v):
    return type(v).__name__ == "NaTType"


def _is_missing_cell(v) -> bool:
    """Blank, a library missing value, or one of the declared missing tokens (_NA_STRING_TOKENS, compared
    after trimming). This is the response-value missing policy; names are never put through it."""
    if v is None or _is_nat(v):
        return True
    if isinstance(v, float) and v != v:
        return True
    if isinstance(v, str):
        return v.strip() in _NA_STRING_TOKENS
    return False


def _iso_datetime(v):
    """ISO text for a calendar value, else None. A date with no time of day is written as a date
    ("2024-01-01"); otherwise the date and time ("2024-01-01T10:30:00"), or a time alone ("10:30:00").
    Excel stores no time zone, so none is added or assumed."""
    if _is_nat(v):
        return None
    if isinstance(v, datetime.datetime):
        if v.tzinfo is None and v.hour == v.minute == v.second == v.microsecond == 0:
            return v.date().isoformat()
        return v.isoformat()
    if isinstance(v, (datetime.date, datetime.time)):
        return v.isoformat()
    return None


def _literal_text(v) -> str:
    """A cell as the text it shows, for names and identifiers: a name is its literal text, so "NaN",
    "None", "01" and "TRUE" stay those names. Excel number cells are written without a trailing ".0",
    logical cells as TRUE/FALSE (as Excel shows them) and calendar cells in ISO form."""
    if v is None or _is_nat(v) or (isinstance(v, float) and v != v):
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() and abs(v) < 1e16 else repr(v)
    iso = _iso_datetime(v)
    return iso if iso is not None else str(v)


def _exact_decimal(t: str):
    """The double a decimal or exponent spelling in a text cell holds, or None when the variable must stay
    text. One typing policy for every spelling of a number written as text (Codex B26-F01, RP0-M01):
      - magnitude beyond 2^53 (_MAX_EXACT_WHOLE): text, whatever the spelling. "9007199254740994.0",
        "1e16" and "1e30" are text exactly like the bare whole number "9007199254740994" (the integer
        branch below). Beyond 2^53 neighbouring whole numbers are no longer all distinct doubles, so such
        values are treated as identifiers and kept as written rather than typed by whether one spelling
        happens to land on a representable double;
      - otherwise the round trip: the shortest text that reads back as the double (repr) must be the same
        number as the text written. "0.1", "2.50", "1e3" and "9007199254740992.0" (2^53 itself) pass; a
        spelling with more significant digits than a double holds, and an underflow, do not.
    The stored preview holds numbers as doubles (JSON read by the app), so either failure would store a
    different, rounded number and could merge distinct values. Excel number cells are doubles already,
    so the round trip does not apply to them; a whole-number Excel cell arrives as an int and is held to
    the same 2^53 magnitude rule by _as_numbers (a fractional double cannot exceed 2^53)."""
    from decimal import Decimal, InvalidOperation

    f = float(t)
    if f in (float("inf"), float("-inf")) or abs(f) > _MAX_EXACT_WHOLE:
        return None
    try:
        return f if Decimal(repr(f)) == Decimal(t) else None
    except InvalidOperation:
        return None


def _as_numbers(present):
    """The numbers these non-missing cells hold, or None when any of them is not a number by the rule
    above (a logical cell, text that is not a plain decimal number, or a whole number too large to stay
    exact). Integers stay int so a gap-free whole-number variable keeps an integer type."""
    out = []
    for v in present:
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            if abs(v) > _MAX_EXACT_WHOLE:
                return None
            out.append(v)
        elif isinstance(v, float):
            if v != v or v in (float("inf"), float("-inf")):
                return None
            out.append(v)
        elif isinstance(v, str):
            t = v.strip()
            if not _STRICT_NUMBER.match(t):
                return None
            if "." in t or "e" in t or "E" in t:
                f = _exact_decimal(t)
                if f is None:
                    return None
                out.append(f)
            else:
                n = int(t)
                if abs(n) > _MAX_EXACT_WHOLE:
                    return None
                out.append(n)
        else:
            return None
    return out


def _typed_series(name, values, date_columns):
    """Types one variable from its cells, the same way in both layouts:
      - missing cells (_is_missing_cell) are missing;
      - calendar cells become ISO text, and the variable is listed in date_columns;
      - an identifier-like name (_is_id_like_header) keeps every value as its literal text;
      - otherwise the variable is numeric when every value is a number by _as_numbers (int64 when
        whole with no gaps, else float with missing as NaN), and text exactly as written when not;
      - a variable with no values at all is numeric and empty, as before.
    Excel text and number cells in one mixed variable keep their own types, as the file has them; logical
    cells mixed with other values become their text, TRUE or FALSE, so they are never counted as 1 or 0."""
    import pandas as pd

    cells = []
    has_date = False
    for v in values:
        if _is_missing_cell(v):
            cells.append(None)
            continue
        iso = _iso_datetime(v)
        if iso is not None:
            has_date = True
            cells.append(iso)
            continue
        cells.append(v)
    if has_date:
        date_columns.add(name)
    if _is_id_like_header(name):
        return pd.Series([None if v is None else (v if isinstance(v, str) else _literal_text(v)) for v in cells], dtype=object)
    present = [v for v in cells if v is not None]
    if not present:
        return pd.Series([float("nan")] * len(cells), dtype="float64")
    # A logical cell beside other values is its Excel text, TRUE or FALSE (CAL-R1-F03): Python and pandas
    # treat True as equal to 1 and False to 0, so kept as bool it would be counted as the same answer as
    # a 1 or 0 in the same variable. A variable of logical cells only keeps them as they are.
    if any(isinstance(v, bool) for v in present) and not all(isinstance(v, bool) for v in present):
        cells = [_literal_text(v) if isinstance(v, bool) else v for v in cells]
        present = [v for v in cells if v is not None]
    numbers = None if has_date else _as_numbers(present)
    if numbers is None:
        return pd.Series(cells, dtype=object)
    it = iter(numbers)
    typed = [None if v is None else next(it) for v in cells]
    if all(isinstance(v, int) for v in typed):
        return pd.Series(typed, dtype="int64")
    return pd.Series([float("nan") if v is None else float(v) for v in typed], dtype="float64")


def _decode_plain_text(raw: bytes):
    """The text of a CSV/TSV file and the encoding it was read in. One policy, applied before anything is
    parsed: UTF-8 (with or without a byte-order mark) first; a UTF-16 file when it starts with a UTF-16
    byte-order mark; otherwise Windows-1252, the encoding of a "CSV" saved by Excel on Western-locale
    Windows. A Windows-1252 read is reported (encoding), not silent. A file that is none of these is
    refused rather than read with replacement characters."""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        try:
            return raw.decode("utf-16"), "utf-16"
        except UnicodeDecodeError as exc:
            raise ValueError(
                f"This file starts as UTF-16 text but has an unreadable byte at position {exc.start}. "
                "Save it again as \"CSV UTF-8\" and upload it again; nothing was imported."
            ) from exc
    if raw.startswith(b"\xef\xbb\xbf"):
        try:
            return raw[3:].decode("utf-8"), "utf-8"
        except UnicodeDecodeError as exc:
            raise ValueError(
                f"This file is marked as UTF-8 but byte {exc.start + 3} is not valid UTF-8. "
                "Save it again as \"CSV UTF-8\" and upload it again; nothing was imported."
            ) from exc
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("cp1252"), "windows-1252"
    except UnicodeDecodeError as exc:
        raise ValueError(
            f"This file is neither UTF-8 nor Windows-1252 text (byte {exc.start} cannot be read). "
            "Save it again as \"CSV UTF-8\" and upload it again; nothing was imported."
        ) from exc


_DELIMITER_NAMES = {",": "commas", ";": "semicolons", "\t": "tabs", "|": "pipes"}
_DELIMITER_SAMPLE_RECORDS = 5000


def _sniff_delimiter(text: str, ragged: bool = False) -> str:
    """The separator between a delimited file's values, chosen by a stated rule rather than guessed.

    IS-F01 (Codex import stress review, 2026-10-27): csv.Sniffer gave up on a semicolon file with one
    short row (a supported shape: the row is padded with missing values), and the fallback silently
    returned a comma, so the whole file was published as one text column. Each candidate (comma,
    semicolon, tab, pipe) is now read quote-aware over the first records, and a candidate fits when its
    header row splits into at least two columns and no later row has a non-empty value beyond the
    header's width (short rows and trailing empty values are allowed, as _csv_grid reads them):
      - exactly one fits: that one;
      - several fit: the one with more rows at full width; equal counts cannot be told apart, so the
        file is refused and the researcher asked to save it with one separator (never a guess);
      - none fits but a candidate splits the header: the one with the most full-width rows, so
        _csv_grid refuses its surplus row with the line, rather than importing one merged column;
      - nothing splits the header: a genuinely single-column file, read with a comma.
    ragged=True (documents such as a codebook, whose rows may be longer or shorter than the first)
    chooses the candidate that splits the most rows into two or more values; it is never refused."""
    stats = {}
    unreadable = []
    for sep in (",", ";", "\t", "|"):
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=sep, strict=True)
        rows = []
        try:
            for row in reader:
                if row:
                    rows.append(row)
                if len(rows) >= _DELIMITER_SAMPLE_RECORDS:
                    break
        except csv.Error:
            unreadable.append(sep)
            continue
        if not rows:
            continue
        width = len(rows[0])
        if ragged:
            stats[sep] = sum(1 for r in rows if len(r) >= 2)
            continue
        if width < 2:
            continue
        surplus = any(len(r) > width and any(c.strip() for c in r[width:]) for r in rows[1:])
        full = sum(1 for r in rows[1:] if len(r) >= width)
        stats[sep] = (surplus, full)
    if ragged:
        best = max(stats, key=lambda k: stats[k], default=None)
        return best if best is not None and stats[best] > 0 else ","
    fitting = sorted((k for k, (surplus, _f) in stats.items() if not surplus), key=lambda k: -stats[k][1])
    if len(fitting) == 1:
        return fitting[0]
    if len(fitting) > 1:
        if stats[fitting[0]][1] == stats[fitting[1]][1]:
            raise ValueError(
                f"This file's values could be separated by {_DELIMITER_NAMES[fitting[0]]} or by "
                f"{_DELIMITER_NAMES[fitting[1]]}, and both read as a complete table, so its columns cannot be "
                "told apart safely. Nothing was imported; save it again with one separator (for example as "
                "\"CSV UTF-8\" or tab-delimited text) and upload it again."
            )
        return fitting[0]
    if stats:
        return max(stats, key=lambda k: stats[k][1])
    # A quoting error under every splitting candidate: the first one is returned so _csv_grid reports
    # where the quoting goes wrong, rather than reading the file as one column.
    return unreadable[0] if unreadable else ","


def _csv_grid(text: str, sep: str):
    """The file's rows as lists of literal text. Quoted fields, doubled quotes and line breaks inside
    quotes are read as written. Malformed quoting (a quoted value never closed, or text after a closing
    quote) and a row with more values than the header row are refused with the line, before anything is
    published (IP1000-F04): a guessed row is never imported. A short row is padded with missing values;
    surplus trailing empty values (a trailing delimiter) are dropped. Blank lines are skipped."""
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=sep, strict=True)
    grid = []
    width = None
    try:
        for row in reader:
            if not row:
                continue
            if width is None:
                width = len(row)
                grid.append(row)
                continue
            if len(row) > width:
                if any(c.strip() for c in row[width:]):
                    raise ValueError(
                        f"Line {reader.line_num} of this CSV file has {len(row)} values but its header row has "
                        f"{width} columns, so its values cannot be matched to their columns. Nothing was imported; "
                        "fix the file and upload it again."
                    )
                row = row[:width]
            elif len(row) < width:
                row = row + [None] * (width - len(row))
            grid.append(row)
    except csv.Error as exc:
        raise ValueError(
            f"This CSV file could not be read near line {reader.line_num} ({exc}): a quoted value may be "
            "missing its closing quotation mark. Nothing was imported; fix the file and upload it again."
        ) from exc
    return grid


def _excel_cell(v):
    """A cell from pandas' object read of a worksheet, as a plain Python value (Timestamp to datetime,
    numpy scalars unwrapped); blanks stay "" or NaN and are read as missing by _is_missing_cell."""
    if hasattr(v, "to_pydatetime") and not _is_nat(v):
        return v.to_pydatetime()
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        try:
            return v.item()
        except (ValueError, TypeError):
            return v
    return v


def _excel_sheet_grid(xl, sheet_name):
    """The worksheet's cells as Excel holds them, one list per row (CAL-R1-F03).

    Not xl.parse(header=None, dtype=object): building that DataFrame merges True with 1 and False with
    0 in a column that holds both (a logical cell read as 1, or a 1 read as True), so a mixed column's
    answers changed. The cells are converted exactly as pandas' own Excel readers convert them before
    that step, so nothing else about the read changes:
      - openpyxl (.xlsx/.xlsm): OpenpyxlReader._convert_cell and get_sheet_data: an empty cell is "",
        an error cell NaN, a whole number int, other numbers float; trailing empty cells and rows are
        trimmed and rows padded with "" to the widest;
      - xlrd (.xls): XlrdReader.get_sheet_data: dates become datetime (a date on the epoch day a time),
        errors NaN, logical cells bool, whole finite numbers int.
    Blank rows inside the sheet are kept, as xl.parse keeps them. Another engine is read through
    xl.parse as before, which has no mixed logical columns to merge in the formats offered here."""
    import math
    from datetime import time as _time

    engine = getattr(xl, "engine", None)
    if engine == "openpyxl":
        from openpyxl.cell.cell import TYPE_ERROR, TYPE_NUMERIC

        sheet = xl.book[sheet_name]
        if getattr(xl.book, "read_only", False):
            sheet.reset_dimensions()

        def convert(cell):
            if cell.value is None:
                return ""
            if cell.data_type == TYPE_ERROR:
                return float("nan")
            if cell.data_type == TYPE_NUMERIC and not isinstance(cell.value, bool):
                whole = int(cell.value)
                return whole if whole == cell.value else float(cell.value)
            return cell.value

        data, last = [], -1
        for n, row in enumerate(sheet.rows):
            values = [convert(c) for c in row]
            while values and values[-1] == "":
                values.pop()
            if values:
                last = n
            data.append(values)
        data = data[: last + 1]
    elif engine == "xlrd":
        from xlrd import XL_CELL_BOOLEAN, XL_CELL_DATE, XL_CELL_ERROR, XL_CELL_NUMBER, xldate

        sheet = xl.book.sheet_by_name(sheet_name)
        epoch1904 = xl.book.datemode

        def convert(value, kind):
            if kind == XL_CELL_DATE:
                try:
                    value = xldate.xldate_as_datetime(value, epoch1904)
                except OverflowError:
                    return value
                if (not epoch1904 and value.timetuple()[0:3] == (1899, 12, 31)) or (epoch1904 and value.timetuple()[0:3] == (1904, 1, 1)):
                    return _time(value.hour, value.minute, value.second, value.microsecond)
                return value
            if kind == XL_CELL_ERROR:
                return float("nan")
            if kind == XL_CELL_BOOLEAN:
                return bool(value)
            if kind == XL_CELL_NUMBER and math.isfinite(value):
                whole = int(value)
                return whole if whole == value else value
            return value

        data = [[convert(v, t) for v, t in zip(sheet.row_values(i), sheet.row_types(i))] for i in range(sheet.nrows)]
    else:
        raw = xl.parse(sheet_name, header=None, dtype=object, na_filter=False)
        return [[_excel_cell(v) for v in row] for row in raw.values.tolist()]
    width = max((len(r) for r in data), default=0)
    return [r + [""] * (width - len(r)) for r in data]


def _typed_frame(headers, body, date_columns):
    """Rows-as-cases: one variable per column."""
    import pandas as pd

    columns = {}
    for i, h in enumerate(headers):
        columns[h] = _typed_series(h, [row[i] if i < len(row) else None for row in body], date_columns)
    df = pd.DataFrame(columns, index=pd.RangeIndex(len(body))) if columns else pd.DataFrame(index=pd.RangeIndex(len(body)))
    return df


def _flipped_frame(headers, body, date_columns):
    """Columns-as-cases: each row is a variable whose name is its first cell, each further column a case.
    The name is the first cell's literal text (_literal_text: "NaN", "None", "01" and "TRUE" are names, not
    values); a blank one becomes "Variable n". A row with no name and no values is skipped. Repeated
    names get the same allocation as repeated header names (_dedupe_header_names, TP500-F02): literal
    names are reserved first, so a row literally named "q (2)" keeps that name and its own values, and a
    second "q" becomes "q (3)". Each variable is typed by _typed_series, as a rows-as-cases column is."""
    import pandas as pd

    n_cases = max(len(headers) - 1, 0)
    kept = []
    for row in body:
        name = _literal_text(row[0] if row else None).strip()
        values = [row[j] if j < len(row) else None for j in range(1, n_cases + 1)]
        if not name and all(_is_missing_cell(v) for v in values):
            continue
        kept.append((name, values))
    names = _dedupe_header_names([name or f"Variable {i + 1}" for i, (name, _) in enumerate(kept)])
    columns = {name: _typed_series(name, values, date_columns) for name, (_, values) in zip(names, kept)}
    return pd.DataFrame(columns, index=pd.RangeIndex(n_cases)) if columns else pd.DataFrame(index=pd.RangeIndex(n_cases))


def _read_plain(path: str, ext: str, usecols=None, layout=None, selected_sheet=None):
    """CSV, TSV and Excel case-level files: one row per case and a header row of names, or (layout
    "columns_are_cases") one row per variable and a column per case. No variable labels or value labels
    exist in the data itself, so names stand in for labels and coded answers stay as they are; an Excel
    workbook may carry labels on other sheets (_excel_labels, _excel_codebook).

    This is the only reader of these files (see _typed_series): the stored preview and every calculation
    use what it returns. Cells are read as written (CSV text, or Excel's own cell values), names are their
    literal text, repeated names are allocated by _dedupe_header_names in both layouts, and each variable
    is typed by _typed_series. The meta records the sheet read, a CSV's encoding and the date columns."""
    import pandas as pd

    unsupported_id_formats: set[str] = set()  # CSV has no cell-format concept; only Excel can populate this
    xl = None
    data_sheet = None
    encoding = None
    sheets = []
    if ext in DELIMITED_EXTS:
        with open(path, "rb") as fh:
            text, encoding = _decode_plain_text(fh.read())
        sep = "\t" if ext == ".tsv" else _sniff_delimiter(text)
        grid = _csv_grid(text, sep)
        if ext == ".txt" and (not grid or max(len(r) for r in grid) < 2):
            # A CSV with one column is a table with one variable; a .txt with no delimiter is far more
            # likely prose or a fixed-width export, which would be read as one column of whole lines.
            raise ValueError(
                "This text file has no tab, comma, semicolon or pipe between its values, so it was not read as "
                "a data table. If it is a fixed-width export, save it as CSV or tab-delimited text and upload "
                "it again; if it is a transcript or document, upload it as that type instead."
            )
    else:
        try:
            xl = _open_workbook(path)
        except Exception as exc:  # noqa: BLE001 - any failure to open is the same answer to the researcher
            raise ValueError(
                f"This file doesn't parse as a spreadsheet ({exc}). If it's a Word document or PDF that was "
                'uploaded as a "Table" document, remove it and upload it again as a "Report" instead.'
            ) from exc
        # RR-05: every exit after the workbook opens must close it, the refusals and the
        # format-inspection failure included, or Windows keeps the uploaded temp file locked
        # and the caller cannot delete it. Success closes it after the label sheets are read below.
        try:
            sheets = list(xl.sheet_names)
            # IMP-SHIP-001: a sheet choice already persisted for this document (documents.selected_sheet)
            # is used directly. If it no longer names a sheet in this workbook, SheetSelectionLostError is
            # raised rather than another sheet substituted. None/"" (nothing persisted yet) is the first
            # read and resolves by the ranking rule: the non-dictionary sheet with the most data rows.
            if selected_sheet:
                if selected_sheet not in sheets:
                    raise SheetSelectionLostError(selected_sheet, sheets)
                data_sheet = selected_sheet
            else:
                candidates = [n for n in sheets if not _DICT_SHEET_RE.search(n)] or sheets
                data_sheet = max(candidates, key=lambda n: _count_data_rows(xl, n))
            if layout == "columns_are_cases":
                _refuse_flipped_codebook_metadata(xl, [n for n in sheets if n != data_sheet])
            # Every cell arrives as Excel holds it (text, number, logical or calendar value), unnamed and
            # untyped, and is typed by _typed_series (_excel_sheet_grid says why not through xl.parse).
            grid = _excel_sheet_grid(xl, data_sheet)
        except BaseException:
            xl.close()
            raise
    try:
        if grid:
            headers = _dedupe_header_names([_literal_text(v).strip() for v in grid[0]])
            body = grid[1:]
        else:
            headers, body = [], []
        date_columns: set[str] = set()
        if layout == "columns_are_cases":
            df = _flipped_frame(headers, body, date_columns)
        else:
            df = _typed_frame(headers, body, date_columns)
            if xl is not None:
                # Body row i is sheet row i + 2 here (row 1 is the header), the alignment this check reads.
                unsupported_id_formats = _apply_zero_padded_id_formats(path, data_sheet, headers, df)
            # A row with nothing but blank or missing cells is not a case.
            df = df.dropna(how="all")
        meta = _PlainMeta(
            unsupported_identifier_columns=sorted(unsupported_id_formats),
            data_sheet=data_sheet,
            encoding=encoding,
            date_columns=sorted(date_columns),
        )
        if xl is not None and len(sheets) > 1 and layout != "columns_are_cases":
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
            labs, vlabs = _show_label_conflicts(labs, vlabs, conflicts)
            meta = _PlainMeta(
                labs, vlabs, used, mr_sets, label_conflicts=conflicts,
                unsupported_identifier_columns=sorted(unsupported_id_formats),
                data_sheet=data_sheet, encoding=encoding, date_columns=sorted(date_columns),
            )
        elif xl is not None and len(sheets) > 1:
            # Columns-as-cases: label sheets name the original (pre-flip) columns, which are cases here,
            # so they are not applied; a separate Codebook declaring weights or MR sets was refused above.
            meta.sheets = {"data": data_sheet}
    finally:
        if xl is not None:
            xl.close()  # Windows will not delete a temp file that is still open
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
    _check_import_limits(file_bytes)
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
        _check_import_limits(file_bytes, len(df))
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
            (getattr(meta, "data_sheet", None), getattr(meta, "encoding", None), list(getattr(meta, "date_columns", None) or [])),
        )
        _READ_CACHE[key] = hit
    df, labels, vlabels, sheets, mr_sets, measure, missing_ranges, label_conflicts, unsupported_identifier_columns, read_facts = hit
    return _slice_read(
        df,
        _PlainMeta(
            dict(labels), dict(vlabels), dict(sheets), dict(mr_sets), dict(measure), dict(missing_ranges),
            label_conflicts=list(label_conflicts),
            unsupported_identifier_columns=list(unsupported_identifier_columns),
            data_sheet=read_facts[0],
            encoding=read_facts[1],
            date_columns=list(read_facts[2]),
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
            "for plain CSV/TSV/text/Excel files, not SPSS (.sav), Stata (.dta), SAS (.sas7bdat, .xpt), R or Parquet files, "
            "which already declare their own case/variable structure. Set the layout back to "
            "\"rows_are_cases\" for this file, or re-export it as CSV/Excel first if it genuinely "
            "needs flipping."
        )
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        kwargs = {"usecols": list(usecols)} if usecols else {}
        data, meta = reader(tmp_path, **kwargs)
        if ext in (".sav", ".zsav"):
            # The normal read masks user-missing values correctly but omits their declarations.
            # Read header metadata separately: retaining raw missing codes in the data would
            # change every denominator and statistic, whereas only the audit needs the ranges.
            _, declared = reader(tmp_path, metadataonly=True, user_missing=True)
            meta.missing_ranges = declared.missing_ranges
        _sas_blanks_missing(ext, data)
        return data, meta
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
    conflicts = getattr(meta, "label_conflicts", None)
    if conflicts is None:
        conflicts = []
        meta.label_conflicts = conflicts
    for name, mapping in (overlay.get("valueLabels") or {}).items():
        if name not in cols or vlabels.get(name):
            continue
        # B36-F01: in a numeric column "1" and "1.0" are the same answer; in a text column they are two.
        # Two codes of the linked document that land on one answer of this column with different labels
        # are not resolved by order: the answer is shown with both labels and recorded as a conflict
        # (IMP-015's form), so no label is silently attached to another answer.
        mapped, competing = {}, {}
        for code, label in (mapping or {}).items():
            key = _overlay_key(df[name], code)
            if key is None or not label:
                continue
            competing.setdefault(key, [])
            if str(label) not in competing[key]:
                competing[key].append(str(label))
            mapped.setdefault(key, str(label))
        for key, labs in competing.items():
            if len(labs) > 1:
                shown = " / ".join(f'"{lab}"' for lab in labs)
                mapped[key] = f"{_format_code(key)} [conflicting labels: {shown}]"
                conflicts.append({"variable": name, "kind": "value_label", "value": key, "kept": labs[0], "discarded": labs[1],
                                  "source": "linked codebook or questionnaire", "resolution": "shown_as_conflict"})
        if mapped:
            vlabels[name] = mapped


def _reversals_of(overlay):
    """Confirmed reverse-coded items (import step 3): {derived name: {variable, min, max}}, from the
    overlay the app sends with every calculation (src/lib/reverseCoding.ts)."""
    out = {}
    for r in (overlay or {}).get("reversals") or []:
        if isinstance(r, dict) and r.get("derived") and r.get("variable") and isinstance(r.get("min"), (int, float)) and isinstance(r.get("max"), (int, float)):
            out[str(r["derived"])] = {"variable": str(r["variable"]), "min": float(r["min"]), "max": float(r["max"])}
    return out


def _reversal_collisions(lo, hi, value_labels, missing_ranges):
    """The codes inside a scale's range lo..hi that are non-answers: declared user-missing (SPSS missing
    values or ranges) or labelled as no usable answer (_DK_RE). Reversing turns code v into lo + hi - v
    over the whole range, so a valid answer would land on such a code and then be dropped as missing
    (Codex B42-F01: with 2 declared "Refused" on 1..5, every valid 4 became 2 and left the base). A scale
    with such a code inside it cannot be reversed faithfully. Returns [(code, why)], one per code."""
    def num(v):
        try:
            x = float(v)
            return x if math.isfinite(x) else None
        except (TypeError, ValueError):
            return None

    out = {}
    for code, label in (value_labels or {}).items():
        n = num(code)
        if n is not None and lo <= n <= hi and _DK_RE.match(str(label).strip()):
            out[n] = f'labelled "{str(label).strip()}"'
    for r in missing_ranges or []:
        if not isinstance(r, dict):
            continue
        a, b = num(r.get("lo")), num(r.get("hi"))
        if a is None or b is None:
            continue
        for k in range(int(math.ceil(max(a, lo))), int(math.floor(min(b, hi))) + 1):
            out.setdefault(float(k), "declared missing")
    return sorted(out.items())


def _reversal_problem(points, value_labels_by_item, missing_by_item, items, lo=None, hi=None):
    """Why a scale cannot be reversed faithfully, or None: the one rule for confirming a reversal and for
    applying a stored one. Its usable points must be every whole number from the lowest to the highest (a
    scale with a gap, 1, 3, 4, 5, has no single mirror: 4 would become 2, a code the scale does not have),
    and no non-answer code may sit inside that range (_reversal_collisions: valid answers would land on
    it and leave the base). At confirmation the range is the battery's own (lo and hi omitted, taken from
    its points). For a stored reversal (_apply_reversals) the range is the one confirmed (lo, hi), and the
    points are the item's scale as the file has it now, so a file replaced or relabelled since is checked
    on every read (Codex B42-F01, batch 46R and its replay)."""
    pts = sorted({int(p) for p in points})
    if not pts:
        return "it has no answers on a scale"
    lo = pts[0] if lo is None else int(lo)
    hi = pts[-1] if hi is None else int(hi)
    for item in items:
        clashes = _reversal_collisions(lo, hi, value_labels_by_item.get(item), missing_by_item.get(item))
        if clashes:
            code, why = clashes[0]
            return (f"code {int(code)} ({why}) lies inside the scale {lo} to {hi}, so turning the scale around would move valid "
                    f"answers onto a non-answer code")
    if pts != list(range(lo, hi + 1)):
        return f"its answers ({', '.join(str(p) for p in pts)}) are not every whole number from {lo} to {hi}, so the scale has no single mirror"
    return None


def _battery_scale_points(grid, meta):
    """A battery's scale points for the reversal rule: the codes its items hold, plus the labelled answer
    codes (not non-answers) inside that range, so a fully labelled 1 to 5 scale on which nobody happened
    to choose 2 is still a full scale. The same definition as a stored reversal's points now
    (_apply_reversals), so confirming and applying cannot disagree about one file."""
    pts = {float(p) for p in grid["points"]}
    if not pts:
        return pts
    lo, hi = min(pts), max(pts)
    for item in grid["items"]:
        for k, v in ((getattr(meta, "variable_value_labels", None) or {}).get(item) or {}).items():
            n = _num_or_none(k)
            if n is not None and lo <= n <= hi and float(n).is_integer() and not _DK_RE.match(str(v).strip()):
                pts.add(float(n))
    return pts


def _apply_reversals(df, meta, reversals):
    """Adds each confirmed reversed item as a new derived column; the original column is never changed.
    A value on the scale's declared points (whole numbers from min to max) becomes (min + max) - value,
    so 1..5 reads 5..1; any other value (a missing or "don't know" code such as 9 or 99, or a blank) is
    kept as it is, so non-answer handling treats it exactly as on the original. The derived column takes
    the original's value labels for the same codes (the scale reads in the battery's direction, as an
    SPSS RECODE INTO with the labels applied), its missing declarations, and the original's label with
    "(reversed)". A source column that is missing or not numeric on its scale points, or whose scale has a
    non-answer code inside it (_reversal_collisions; so the missing declarations copied across never fall
    on a code valid answers are turned into), is not derived, and the reason is recorded
    (meta.reversal_problems), never silently skipped."""
    import numpy as np
    import pandas as pd

    if not reversals:
        return
    labels = getattr(meta, "column_names_to_labels", None)
    if labels is None:
        labels = {}
        meta.column_names_to_labels = labels
    vlabels = getattr(meta, "variable_value_labels", None)
    if vlabels is None:
        vlabels = {}
        meta.variable_value_labels = vlabels
    missing = getattr(meta, "missing_ranges", None)
    problems = getattr(meta, "reversal_problems", None)
    if problems is None:
        problems = []
        meta.reversal_problems = problems
    for derived, r in reversals.items():
        src = r["variable"]
        if src not in df.columns:
            problems.append({"derived": derived, "variable": src, "reason": "The variable it reverses is not in this file."})
            continue
        if derived in df.columns:
            problems.append({"derived": derived, "variable": src, "reason": f"The file already has a column named {derived}."})
            continue
        lo, hi = r["min"], r["max"]
        num = pd.to_numeric(df[src], errors="coerce")
        present = df[src].notna() & (df[src].astype(str).str.strip() != "")
        if (present & num.isna()).any():
            problems.append({"derived": derived, "variable": src, "reason": "It has text answers, so it cannot be reversed by number."})
            continue
        vals = num.to_numpy(dtype=float)
        on_scale = (~np.isnan(vals)) & (vals >= lo) & (vals <= hi) & (np.mod(vals, 1) == 0)
        # Checked on every read, not only at confirmation, with the same rule (_reversal_problem): the file
        # can be replaced or relabelled after a reversal was confirmed (a corrected codebook, a new wave).
        # The item's scale now is its labelled answer codes in the confirmed range (non-answers excluded)
        # and the whole-number codes it actually holds there. A code inside the range that is now a
        # non-answer, or a point the scale no longer has, means the reversal no longer fits: it is not
        # built, and using it fails with the reason (Codex B42-F01 and its replay). An unlabelled item on
        # which nobody chose a middle point reads as a gap too: refused, never guessed.
        item_labels = vlabels.get(src) or {}
        labelled = [float(k) for k, v in item_labels.items() if _num_or_none(k) is not None and lo <= float(k) <= hi
                    and float(k).is_integer() and not _DK_RE.match(str(v).strip())]
        points_now = set(labelled) | set(vals[on_scale].tolist())
        problem = _reversal_problem(points_now, {src: item_labels}, {src: missing.get(src) if isinstance(missing, dict) else None}, [src], lo, hi)
        if problem:
            problems.append({"derived": derived, "variable": src, "reason": (
                f"{problem[0].upper()}{problem[1:]}. Undo the reversal, or correct the item's scale, and confirm it again.")})
            continue
        out = np.where(on_scale, (lo + hi) - vals, vals)
        df[derived] = out
        base = labels.get(src) or src
        labels[derived] = f"{base} (reversed)"
        if vlabels.get(src):
            vlabels[derived] = dict(vlabels[src])
        if isinstance(missing, dict) and missing.get(src):
            missing[derived] = missing[src]


def _read(file_bytes: bytes, source_filename: str, usecols=None, overlay=None, layout=None, selected_sheet=None):
    # A derived (reversed) variable is not a column of the file: read its source instead, then derive it.
    reversals = _reversals_of(overlay)
    requested = list(usecols) if usecols is not None else None
    if usecols is not None and reversals:
        wanted = []
        for u in usecols:
            # The derived name is read too: if the file has its own column of that name, the reversal
            # reports the clash (and a request for it fails) instead of either one silently winning.
            for c in ([reversals[u]["variable"], u] if u in reversals else [u]):
                if c not in wanted:
                    wanted.append(c)
        usecols = wanted
    df, meta = _read_raw(file_bytes, source_filename, usecols, layout, selected_sheet)
    _apply_overlay(df, meta, overlay)
    _apply_reversals(df, meta, reversals)
    # A reversed variable asked for by name that could not be built fails here, with its reason, rather
    # than surfacing later as a missing column (or being read as absent).
    if requested:
        for p in getattr(meta, "reversal_problems", None) or []:
            if p["derived"] in requested:
                raise ValueError(f'The reversed variable {p["derived"]} (from {p["variable"]}) could not be built: {p["reason"]}')
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
        kind = "grid" if grid else "battery"
        # A set's key is its identity ("set:<key>" in saved mappings), so it must be unique. The same
        # stem can already name the multiple-response set made from this stem's yes/no columns
        # (EN9_1..EN9_3 a multi set, EN9_4..EN9_6 a battery): that set keeps the stem, as it always
        # did and as everything resolved by key already used, and this one is keyed apart.
        if any(x["key"] == key for x in sets):
            key = f"{key} ({kind})"
        for m in members:
            m["inSet"] = key
        sets.append(
            {
                "key": key,
                "kind": kind,
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
        real = [c for c in conflicts if c.get("kind") != "unmatched_variable"]
        if real:
            out["labelConflicts"] = real[:50]
        # IMP-015: label-sheet variables that match no data column, so their labels never apply.
        unmatched = sorted({c["variable"] for c in conflicts if c.get("kind") == "unmatched_variable"})
        if unmatched:
            out["unmatchedLabelVariables"] = unmatched[:50]
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


def _code_text(c):
    """The one text form of an answer code (CrosstabRow.rawCode). A code reaches here as the data
    value or as a value-label key, and the two can differ in type for the same code: Excel/CSV
    data reads 1 as an integer while a Labels or Codebook sheet's "1=Very easy" is keyed 1.0, so
    str() gave "1" for an unlabelled variable and "1.0" for a labelled one - two identities for one
    code, which split wave-tracking alignment (waveTrackingActions.ts keys bars by rawCode) and
    any by-code comparison. An integer-valued float is written as the integer; every other value
    (text codes such as "01", non-integer numbers such as 1.5) keeps its own str() unchanged."""
    if isinstance(c, bool):
        return str(c)
    try:
        import numpy as np
        if isinstance(c, np.floating):
            c = float(c)
        elif isinstance(c, np.integer):
            c = int(c)
    except ImportError:
        pass
    if isinstance(c, float) and c.is_integer():
        return str(int(c))
    return str(c)


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


def _non_answer_codes(labels, missing_ranges, exclude_dk):
    """The declared codes of one variable that are not answers, so they are never part of its answer
    domain: codes the file declares user-missing (SPSS missing values; pyreadstat already reads their
    cases as missing) and, when non-answers are excluded (the default), codes whose label means no usable
    answer (_DK_RE: don't know, refused, not applicable ...). _ordered_categories_raw adds every declared
    code with zero observed cases to a table (IMP-004), which is right for a substantive scale point and
    wrong for these: a "Don't know" (99) row of 0% reached the chart series and, ranked by numeric code
    above the scale, took a top-two-box slot from a real answer (Codex RP0-F01: 20% instead of 40%).
    Substantive declared codes with no cases stay in the domain. Codes compare as numbers when they are
    numbers, so a label key 99 and a declared range 99.0 are the same code."""
    def num(c):
        try:
            return float(c)
        except (TypeError, ValueError):
            return None

    ranges = [(num(r.get("lo")), num(r.get("hi"))) for r in (missing_ranges or []) if isinstance(r, dict)]
    out = set()
    for code, label in (labels or {}).items():
        n = num(code)
        if n is not None and any(lo is not None and hi is not None and lo <= n <= hi for lo, hi in ranges):
            out.add(code)
        elif exclude_dk and _DK_RE.match(str(label).strip()):
            out.add(code)
    return out


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


def _pooled_prop_se(p1: float, n1: float, p2: float, n2: float) -> float:
    """Standard error of the difference of two shares under the null hypothesis that they are equal:
    the shares pooled over both groups, on effective bases. This is the usual two-proportion z-test.
    The unpooled form (each group's own p(1-p)/n) belongs to a confidence interval, not a test: with a
    share of 0% or 100% its variance is zero, so a tiny gap looks significant (0 of 53 against 11 of
    947 gave p = 0.0008 unpooled; pooled p = 0.43; Fisher's exact p = 1.0; 27 October 2026)."""
    if n1 <= 0 or n2 <= 0:
        return 0.0
    p0 = (p1 * n1 + p2 * n2) / (n1 + n2)
    return math.sqrt(max(p0 * (1 - p0), 0.0) * (1 / n1 + 1 / n2))


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


# Codebook files (Grant, 26 October 2026): a data file's codebook as a table, read without the model.
# Organisations lay them out differently, so columns are found by what they hold, not by their header
# text alone (the Berkeley IGS Poll codebook heads its name column "VARIABLE LABEL" and its label
# column "VARIABLE NAME"). Two layouts are read:
#   - one row per variable: a name column, a label column and, optionally, a values column written
#     "1=Democrat, 2=No Party Preference" (commas inside a label are kept: a value starts only at
#     "<code>=" at the start or after a comma);
#   - one row per value: variable (repeated or left blank under its first row), code, value label, with
#     the usual header names (_classify_header).
# A row with one filled cell is a section heading. A name cell listing several names ("white, black,
# latino") gives each the row's label and values. Values written another way ("as is", "1 thru 58",
# "0-7") give no answer list; the text is kept as the variable's note.
# A cell that looks like a variable name: used to find which column of a sheet holds the names, and to
# split a cell of several comma-separated names. It does not decide which names are kept (IS-F05).
_CB_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.$#@]{0,63}$")
# The longest variable name a codebook entry may have; longer text in a name column is a sentence.
_CB_NAME_MAX = 256
# One "<code>=" in an answer list: the code is a quoted text, or a run of characters with no space,
# comma, "=" or quotation mark ("1", "01", "-9", "1.5", "1e0", "AA", "A_B", "C-D").
_CB_CODE_AT = re.compile(r"""\s*(?:"([^"]*)"|'([^']*)'|([^\s=,"']+))\s*=\s*""")
_CB_NEXT_CODE = re.compile(r""",\s*(?:"[^"]*"|'[^']*'|[^\s=,"']+)\s*=""")


def _cb_text(v):
    if v is None or (isinstance(v, float) and v != v):
        return ""
    return _literal_text(v).strip()


def _cb_name(cell):
    """A codebook variable name exactly as written (IS-F05, Codex: "Age years", "回答", "_Q1", numeric
    and long names were dropped while the read reported itself complete, though the data reader accepts
    them as column names). Any non-empty text up to _CB_NAME_MAX characters, with no line break."""
    name = _cb_text(cell)
    return name if name and len(name) <= _CB_NAME_MAX and "\n" not in name and "\r" not in name else ""


def _cb_list(text):
    """An answer list written in one cell, "1=Yes, 2=No, 9=Don't know", as ([(code, label)], unread).

    IS-F02 (Codex): a code is kept exactly as written through _cb_code, the rule the long and JSON
    layouts use (B36-F01), so "01" and "1" stay two codes and 9007199254740993 is not rounded; whether
    "1" and "1.0" are the same answer is decided against the data column when the labels are applied.
    IS-F04: text codes ("AA=Yes", "A_B=Yes, C-D=No") and spellings such as "1e0" are read, and a label
    in quotation marks may hold commas ('1="Yes, often", 2=No'). A label without quotation marks runs to
    the next ", <code>=", so it may hold a comma but not a comma followed by a code and "=".
    unread is True when the cell has an "=" yet is not such a list, so the item is reported as not fully
    read rather than silently given no answers; text with no "=" ("as is") is not an answer list."""
    text = text.strip()
    pairs, at = [], 0
    while at < len(text):
        m = _CB_CODE_AT.match(text, at)
        if not m:
            return [], "=" in text
        code = next(g for g in m.groups() if g is not None)
        at = m.end()
        if text[at:at + 1] in ('"', "'"):
            close = text.find(text[at], at + 1)
            if close < 0:
                return [], True
            label = text[at + 1:close]
            at = close + 1
            rest = text[at:].lstrip()
            if rest and not rest.startswith(","):
                return [], True
            at = len(text) - len(rest) + (1 if rest else 0)
        else:
            nxt = _CB_NEXT_CODE.search(text, at)
            end = nxt.start() if nxt else len(text)
            label = text[at:end].strip().rstrip(",").strip()
            if "=" in label:
                # "1=Yes 2=No": codes not separated by commas; never read as one label "Yes 2=No".
                return [], True
            at = end + 1 if nxt else len(text)
        pairs.append((_cb_code(code), label))
    return pairs, False


def _cb_pairs(text):
    """The answer list in a cell as [(code, label)], or [] when the cell is not one (see _cb_list)."""
    return _cb_list(text)[0]


def _cb_names(cell):
    """The variable names a name cell holds: several when it is a comma-separated list of name-like
    cells ("Q1, Q2"), otherwise the cell as one name ("Age, years" stays one name)."""
    if "," in cell:
        parts = [p.strip() for p in cell.split(",")]
        if parts and all(_CB_NAME_RE.match(p) for p in parts):
            return parts
    name = _cb_name(cell)
    return [name] if name else []


def _cb_sheet_items(grid, sheet):
    """Items from one sheet's grid, or [] when the sheet is not a codebook table."""
    rows = [[_cb_text(c) for c in r] for r in grid]
    rows = [r for r in rows if any(r)]
    if len(rows) < 2:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    # One row per value, by header names.
    for h in range(min(6, len(rows))):
        pos = _classify_header([c.lower() for c in rows[h]])
        if pos["var"] is not None and pos["value"] is not None and (pos["vlabel"] is not None or pos["label"] is not None):
            items, order, last = {}, [], None
            vl = pos["vlabel"] if pos["vlabel"] is not None else pos["label"]
            for r in rows[h + 1:]:
                name = _cb_name(r[pos["var"]]) or last
                if not name:
                    continue
                last = name
                if name not in items:
                    items[name] = {"variable": name, "label": "", "options": [], "note": None, "section": None, "sheet": sheet}
                    order.append(name)
                if pos["label"] is not None and pos["vlabel"] is not None and r[pos["label"]] and not items[name]["label"]:
                    items[name]["label"] = r[pos["label"]]
                code = r[pos["value"]]
                if code != "":
                    # The code as written (B36-F01): "1.0" and "1" are matched to the column when applied.
                    items[name]["options"].append({"code": code, "label": r[vl]})
            return [items[n] for n in order]
    # One row per variable, by content: the name column holds name-like cells, the values column
    # "<code>=" lists, the label column the longest text of the rest.
    body = [r for r in rows if sum(1 for c in r if c) >= 2]
    # Without a header, three or more such rows are needed before a sheet is taken for a codebook (a
    # prose document can have two). With a header naming a variable and a label column, one variable
    # under it is enough (B36-F05, Codex: a valid one-variable codebook was refused).
    found = next(
        ((i, pos) for i, pos in ((i, _classify_header([c.lower() for c in r])) for i, r in enumerate(rows[: min(6, len(rows))])) if pos["var"] is not None and pos["label"] is not None),
        (None, None),
    )
    header_row, header = found
    headed = header is not None
    if len(body) < (2 if headed else 3):
        return []

    def share(col, test):
        cells = [r[col] for r in body if r[col]]
        return (sum(1 for c in cells if test(c)) / len(cells)) if cells else 0.0

    # The names column is the one the header names, unless that column holds almost no one-word cells
    # while another is mostly name-like: a header written the wrong way round (Grant's Berkeley IGS
    # codebook, "VARIABLE LABEL" over the names). Without such a header, the column of name-like cells.
    # Once found, every entry in it is kept as written (IS-F05): finding it by name-like cells alone took
    # the labels column when the names were "Age years" or "回答" and the labels were single words.
    name_like = lambda x: all(_CB_NAME_RE.match(p.strip()) for p in x.split(","))
    one_word = lambda x: not any(ch.isspace() for ch in x)
    likeliest = max(range(width), key=lambda c: share(c, name_like))
    if header is not None and not (share(header["var"], one_word) < 0.2 and share(likeliest, name_like) >= 0.6):
        name_col = header["var"]
    else:
        name_col = likeliest
        if share(name_col, name_like) < 0.6:
            return []
    others = [c for c in range(width) if c != name_col]
    # The values column holds answer lists, read or not (an unreadable list still marks its column, so
    # the item is reported incomplete rather than its list taken for a label; IS-F04).
    is_list = lambda x: bool(_cb_list(x)[0]) or _cb_list(x)[1]
    values_col = max(others, key=lambda c: (share(c, is_list), share(c, lambda x: bool(_cb_pairs(x)))), default=None)
    if values_col is not None and share(values_col, is_list) < 0.2:
        values_col = None
    label_candidates = [c for c in others if c != values_col]
    if not label_candidates:
        return []
    if header is not None and name_col == header["var"] and header["label"] in label_candidates:
        label_col = header["label"]
    else:
        label_col = max(label_candidates, key=lambda c: sum(len(r[c]) for r in body))
    items, section = [], None
    for i, r in enumerate(rows):
        # The header row and anything above it are never variables (IS-F07, Codex: "VARIABLE NAME, LABEL"
        # was read as a variable "LABEL", and the next row's label taken for its name).
        if header_row is not None and i <= header_row:
            continue
        filled = [c for c in r if c]
        # One filled cell that is not name-like is a section heading, not a variable without a label.
        if len(filled) == 1 and not name_like(filled[0]):
            section = filled[0]
            continue
        names = _cb_names(r[name_col])
        if not names or (r[name_col].lower() in ("variable", "variable name", "name", "variable label")):
            continue
        values = r[values_col] if values_col is not None else ""
        pairs, unread = _cb_list(values) if values else ([], False)
        for name in names:
            items.append({
                "variable": name,
                "label": r[label_col],
                "options": [{"code": c, "label": l} for c, l in pairs],
                "note": None if pairs or not values else values,
                # An answer list that could not be read (IS-F04): the read is reported incomplete.
                "unreadValues": values if unread else None,
                "section": section,
                "sheet": sheet,
            })
    return items


_CB_NAME_KEYS = ("name", "variable", "var", "variable_name", "varname", "id", "field", "column")
_CB_LABEL_KEYS = ("label", "title", "description", "question", "text", "variable_label", "varlabel", "wording")
_CB_VALUES_KEYS = ("values", "value_labels", "valuelabels", "categories", "codes", "options", "answers", "labels")


def _cb_first(obj, keys):
    lower = {str(k).lower(): v for k, v in obj.items()}
    for k in keys:
        if k in lower and lower[k] not in (None, ""):
            return lower[k]
    return None


def _cb_json_options(values):
    """Answer codes from the usual JSON spellings: {"1": "Yes"}, [{"value": 1, "label": "Yes"}],
    [["1", "Yes"]], or a Frictionless "categories" list. A plain list of codes has no labels and gives
    none."""
    out = []
    if isinstance(values, dict):
        for code, label in values.items():
            out.append({"code": _cb_code(code), "label": _cb_text(label)})
    elif isinstance(values, list):
        for v in values:
            if isinstance(v, dict):
                code = _cb_first(v, ("value", "code", "key", "id"))
                label = _cb_first(v, ("label", "value_label", "text", "description", "name"))
                if code is not None and label is not None:
                    out.append({"code": _cb_code(code), "label": _cb_text(label)})
            elif isinstance(v, (list, tuple)) and len(v) == 2:
                out.append({"code": _cb_code(v[0]), "label": _cb_text(v[1])})
    return out


def _cb_code(code):
    """A codebook answer code as its literal identity (B36-F01, Codex): a code written as text keeps its
    exact text, so "1.0", "1" and "01" stay three codes; only a cell that is a number is written as
    that number (an Excel 1 or 1.0 cell is "1"). Whether "1" and "1.0" are the same answer depends on
    the data column, so it is decided when the labels are applied (_apply_overlay), not here."""
    return _cb_text(code)


def _codebook_from_json(file_bytes: bytes) -> dict:
    """A codebook written as JSON. Organisations use different shapes, so these are read:
      - a list of variable objects ({"name", "label", "values"} with the usual key spellings);
      - an object of such lists under "variables", "fields" (a Frictionless Table Schema), "items",
        "columns" or "codebook";
      - an object keyed by variable name whose values are objects ({"label", "values"}) or a label.
    Anything else is refused with what was expected."""
    try:
        data = json.loads(_decode_plain_text(file_bytes)[0])
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError(f"This JSON codebook could not be read ({exc}).") from exc
    entries = None
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict):
        for key in ("variables", "fields", "items", "columns", "codebook"):
            inner = data.get(key)
            if isinstance(inner, list):
                entries = inner
                break
            if isinstance(inner, dict):
                data = inner
                break
        if entries is None and isinstance(data, dict):
            entries = []
            for name, spec in data.items():
                if isinstance(spec, dict):
                    entries.append({"name": name, **spec})
                elif isinstance(spec, str):
                    entries.append({"name": name, "label": spec})
    items, seen = [], set()
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        name = _cb_first(e, _CB_NAME_KEYS)
        name = _cb_name(name) if isinstance(name, (str, int, float)) else ""
        if not name or name in seen:
            continue
        seen.add(name)
        values = _cb_first(e, _CB_VALUES_KEYS)
        label = _cb_first(e, _CB_LABEL_KEYS)
        items.append({
            "variable": name,
            "label": _cb_text(label) if isinstance(label, (str, int, float)) else "",
            "options": _cb_json_options(values) if values is not None else [],
            "note": None,
            "section": _cb_text(_cb_first(e, ("section", "group", "module"))) or None,
            "sheet": None,
        })
    if not items:
        raise ValueError(
            "No variables were found in this JSON codebook. Expected a list of variables (each with a name, a "
            "label and optionally its values), or an object keyed by variable name."
        )
    return {"items": items, "sheets": [], "skippedSheets": []}


def codebook_items(file_bytes: bytes, source_filename: str, args=None) -> dict:
    """The variables a codebook table describes: name, label, answer codes and labels, section. Every
    sheet of a workbook is read; sheets that are not codebook tables are named in skippedSheets."""
    ext = os.path.splitext(source_filename.lower())[1]
    if ext == ".json":
        return _codebook_from_json(file_bytes)
    if ext not in TABLE_EXTS:
        raise ValueError(f"A codebook is read as a table from CSV, text, Excel or JSON files, not {ext or '(none)'} files.")
    sheets = _sheet_grids(file_bytes, source_filename)
    items, used, skipped, seen = [], [], [], set()
    for name, grid in sheets:
        found = _cb_sheet_items(grid, name)
        if not found:
            if name is not None:
                skipped.append(name)
            continue
        used.append(name)
        for it in found:
            if it["variable"] in seen:
                continue  # first description of a variable wins; a repeat is not a second item
            seen.add(it["variable"])
            items.append(it)
    if not items:
        raise ValueError(
            "No codebook table was found in this file: a column of variable names with their labels (and "
            "optionally their answer codes, such as 1=Yes, 2=No), or one row per answer code. If it is a "
            "questionnaire or a document, upload it as that type, or as a Word or PDF codebook."
        )
    return {"items": items, "sheets": used, "skippedSheets": skipped}


def _sheet_grids(file_bytes: bytes, source_filename: str):
    """[(sheet name or None, grid of cell text)] for a CSV, text or Excel file, every sheet."""
    import pandas as pd

    ext = os.path.splitext(source_filename.lower())[1]
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        path = tmp.name
    try:
        if ext in DELIMITED_EXTS:
            with open(path, "rb") as fh:
                text, _enc = _decode_plain_text(fh.read())
            sep = "\t" if ext == ".tsv" else _sniff_delimiter(text, ragged=True)
            # A document row may be shorter or longer than the first (ragged rows are allowed), but its
            # quoting must be valid (B36-F03, Codex): an unclosed quote or text after a closing quote
            # used to merge the following rows into one cell, and the read was stored as complete.
            # strict=True refuses it here, before any item is stored, with where it went wrong.
            reader = csv.reader(io.StringIO(text, newline=""), delimiter=sep, strict=True)
            rows = []
            try:
                for r in reader:
                    rows.append(list(r))
            except csv.Error as exc:
                raise ValueError(
                    f"This file's quoting is not valid near line {reader.line_num} ({exc}), so it was not read: "
                    "a quotation mark is not closed, or text follows a closing one. Correct it and read the file again."
                ) from exc
            return [(None, rows)]
        xl = _open_workbook(path)
        try:
            return [(name, [[_cb_text(c) for c in r] for r in _excel_sheet_grid(xl, name)]) for name in xl.sheet_names]
        finally:
            xl.close()
    finally:
        _remove_quietly(path)


def _xlsform_items(grids):
    """Items from an XLSForm questionnaire (ODK, KoboToolbox, SurveyCTO: a "survey" sheet with type,
    name and label columns, and a "choices" sheet with list_name, name and label), or None when the file
    is not one. A question's code is its name (the data column it produces), its options are its choice
    list, "relevant" is kept as its routing text, and groups are sections. Notes, calculations and
    metadata fields (start, end, deviceid ...) produce no item."""
    by_name = {str(n).strip().lower(): g for n, g in grids if n is not None}
    survey, choices = by_name.get("survey"), by_name.get("choices")
    if not survey:
        return None

    def header(grid):
        head = [c.strip().lower() for c in grid[0]] if grid else []
        def col(*names):
            for want in names:
                for i, h in enumerate(head):
                    if h == want or h.startswith(want + "::"):
                        return i
            return None
        return col

    col = header(survey)
    t, n, l, rel = col("type"), col("name"), col("label"), col("relevant")
    if t is None or n is None or l is None:
        return None
    lists = {}
    if choices:
        ccol = header(choices)
        ln, cn, cl = ccol("list_name", "list name"), ccol("name"), ccol("label")
        if ln is not None and cn is not None and cl is not None:
            for r in choices[1:]:
                r = r + [""] * (max(ln, cn, cl) + 1 - len(r))
                if r[ln].strip() and r[cn].strip():
                    lists.setdefault(r[ln].strip(), []).append({"code": _cb_code(r[cn]), "label": r[cl].strip()})
    skip = {"note", "calculate", "start", "end", "today", "deviceid", "subscriberid", "simserial", "phonenumber", "username", "audit", "hidden", "begin_repeat", "end_repeat"}
    items, sections = [], []
    for r in survey[1:]:
        r = r + [""] * (max(x for x in (t, n, l, rel) if x is not None) + 1 - len(r))
        kind = r[t].strip()
        if not kind:
            continue
        words = kind.replace("_", " ").split()
        if words[:2] == ["begin", "group"]:
            sections.append(r[l].strip() or r[n].strip() or None)
            continue
        if words[:2] == ["end", "group"]:
            if sections:
                sections.pop()
            continue
        if kind.replace(" ", "_") in skip or words[0] in skip:
            continue
        name = _cb_name(r[n])
        if not name:
            continue
        parts = kind.split()
        options = lists.get(parts[-1], []) if parts[0] in ("select_one", "select_multiple") and len(parts) > 1 else []
        items.append({
            "variable": name,
            "label": r[l].strip() or name,
            "options": options,
            "routing": r[rel].strip() if rel is not None and r[rel].strip() else None,
            "section": next((s for s in reversed(sections) if s), None),
        })
    return items or None


def instrument_sheet(file_bytes: bytes, source_filename: str, args=None) -> dict:
    """A questionnaire in a spreadsheet: its items when it is an XLSForm ({"items": [...]}), otherwise
    the text of every sheet, row by row with cells separated by " | ", for the questionnaire reader to read
    as it reads a Word or PDF questionnaire ({"text": ...})."""
    grids = _sheet_grids(file_bytes, source_filename)
    items = _xlsform_items(grids)
    if items:
        return {"items": items, "format": "xlsform"}
    parts = []
    for name, grid in grids:
        lines = [" | ".join(c.strip() for c in r if c and c.strip()) for r in grid]
        lines = [x for x in lines if x]
        if lines:
            parts.append((f"Sheet: {name}\n" if name else "") + "\n".join(lines))
    if not parts:
        raise ValueError("This spreadsheet has no text to read as a questionnaire.")
    return {"text": "\n\n".join(parts), "format": "sheet_text"}


# Respondent-level quality (Grant, 26 October 2026, after Inspirient's survey quality assessment). Case
# diagnostics over the whole file, unweighted, that flag respondents for the researcher to look at;
# nothing here removes a case or changes any table. Each check states the rule it used and the
# variables it found, and says when it could not be measured rather than reporting zero.
RQ_GRID_MIN_ITEMS = 5          # a battery needs this many items before identical answers say much
RQ_STRAIGHTLINED_BATTERIES = 2 # a case is flagged when it gives one answer throughout at least this many
                               # batteries and at least half of those it answered: one battery alone
                               # can be answered the same way honestly
RQ_GRID_MAX_POINTS = 11        # answer scales of up to 11 points (0-10)
RQ_NEAR_STRAIGHTLINE = 0.9     # share of a battery's answers equal to the respondent's most common one
RQ_NON_ANSWER_SHARE = 0.5      # half or more of a respondent's labelled answers are non-answers
RQ_NON_ANSWER_MIN = 10         # ... out of at least this many labelled answers
RQ_SPEEDER = 0.5               # interview under half the median length (Inspirient's default)
RQ_SUPER_SPEEDER = 0.3         # under 30% of the median
RQ_LONG = 3.0                  # over three times the median: noted, not flagged
RQ_INTERVIEWER_MIN_CASES = 10
RQ_TOP_CASES = 100
_RQ_GRID_RE = re.compile(r"^(.*?[A-Za-z][A-Za-z0-9]*?)(?:[_.]?)(\d{1,2}|[a-z])$")
_RQ_DURATION_RE = re.compile(r"duration|length of interview|\bloi\b|interview ?time|time ?taken|elapsed|seconds|minutes|\bsecs?\b|\bmins?\b", re.IGNORECASE)
_RQ_INTERVIEWER_RE = re.compile(r"interviewer|\bintvw|\bint_?id\b|enumerator|field ?worker|\bagent\b", re.IGNORECASE)


def _rq_grids(df, labels_of):
    """Batteries: five or more variables sharing a stem with a numbered or lettered suffix (Q13_1 to
    Q13_14, Q11a to Q11g; the stem carries a question number or a separator), every one numeric with whole-number answers on one scale of 3 to 11 points.
    Sets of 0/1 items are left out: they are usually "tick all that apply" lists, where identical answers
    are expected. A "_summary" companion variable is not an item."""
    import numpy as np

    groups = {}
    for name in df.columns:
        n = str(name)
        if n.lower().endswith("summary") or _is_id_like_header(n) or _WEIGHT_RE.search(n):
            continue
        m = _RQ_GRID_RE.match(n)
        # The stem must carry a question number (Q13_1, Q11a) or be separated from the item number
        # (trust_1): "F12" to "F20" are numbered questions of their own, not items of a battery "F".
        if m and (re.search(r"\d", m.group(1)) or n[len(m.group(1)) : len(m.group(1)) + 1] in ("_", ".")):
            groups.setdefault(m.group(1).rstrip("_."), []).append(name)
    grids = []
    for stem, cols in groups.items():
        if len(cols) < RQ_GRID_MIN_ITEMS:
            continue
        sub = df[cols].apply(lambda c: __import__("pandas").to_numeric(c, errors="coerce"))
        if any(df[c].notna().sum() > 0 and sub[c].notna().sum() < df[c].notna().sum() for c in cols):
            continue  # a text value in an item: not a rating battery
        values = sub.to_numpy(dtype=float)
        seen = values[~np.isnan(values)]
        if seen.size == 0 or not np.all(np.mod(seen, 1) == 0):
            continue
        codes = sorted(set(seen.tolist()))
        # Non-answer codes (don't know, refused) are not scale points.
        non_answers = set()
        for c in cols:
            non_answers |= {float(k) for k in _non_answer_codes(labels_of(c), None, True) if _num_or_none(k) is not None}
        points = [v for v in codes if v not in non_answers]
        if len(points) < 3 or len(points) > RQ_GRID_MAX_POINTS:
            continue
        def item_order(c):
            tail = _RQ_GRID_RE.match(str(c)).group(2)
            return (0, int(tail), "") if tail.isdigit() else (1, 0, tail)

        cols = sorted(cols, key=item_order)
        grids.append({"stem": stem, "items": [str(c) for c in cols], "points": points, "nonAnswers": sorted(non_answers)})
    return grids


def _num_or_none(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rq_raw_answers(file_bytes, source_filename, df):
    """The answers as given, for the non-answer diagnostic only. The analysis read masks SPSS
    user-missing values as empty, which is right for every table and statistic and wrong here: a
    respondent who gave "Refused" (declared missing) ten times would look as if they skipped the
    questions, and the diagnostic would report nothing measured (B36-F04). So a .sav/.zsav file is read
    a second time with user_missing=True, and that frame is used by this check alone; it never enters
    the read cache or any other calculation. A Stata file is read the same way: its extended missing
    values (.a to .z, used for "don't know", "refused" and the like) are masked by the analysis read and
    come back here as their letters, declared in the file's missing_user_values. Returns the frame and,
    by variable, those declared codes (empty for SPSS, whose declarations are its missing_ranges). Other
    formats have no separately declared missing codes that the reader masks, so their analysis frame
    already holds the answers as given."""
    ext = os.path.splitext(source_filename.lower())[1]
    if ext not in (".sav", ".zsav", ".dta"):
        return df, {}
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        raw, raw_meta = READERS[ext](tmp_path, user_missing=True)
    finally:
        _remove_quietly(tmp_path)
    if len(raw) != len(df) or list(raw.columns) != list(df.columns):
        raise ValueError("The non-answer check could not read this file's answers consistently. Re-upload the file, or contact support if it persists.")
    if ext != ".dta":
        return raw, {}
    declared = {c: list(v) for c, v in (getattr(raw_meta, "missing_user_values", None) or {}).items()}
    # pyreadstat (1.2.8) returns a plain Stata missing value (".") as 0 in a column that also holds
    # extended missing values when read with user_missing=True. So a cell is taken from this read only
    # where the analysis read has it missing and this read gives one of the declared letters; every
    # other cell is the analysis read's (a blank stays blank, never an answer of 0).
    merged = df.copy()
    for c, letters in declared.items():
        if c not in merged.columns:
            continue
        allowed = {str(x) for x in letters}
        merged[c] = [
            a if not (a is None or (isinstance(a, float) and a != a)) else (r if isinstance(r, str) and r in allowed else None)
            for a, r in zip(df[c].tolist(), raw[c].tolist())
        ]
    return merged, declared


def _rq_code_identity(v):
    """One answer or label code as an identity: numbers compare as numbers (label key 9 and value
    9.0 are the same code), anything else as its trimmed text ("DK" is never coerced away). None for
    no answer at all (empty, blank text, NaN)."""
    if v is None:
        return None
    if isinstance(v, str):
        t = v.strip()
        if t == "":
            return None
        try:
            f = float(t)
        except ValueError:
            return ("s", t)
        return None if f != f else ("n", f)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ("s", str(v).strip())
    return None if f != f else ("n", f)


def _rq_non_answers(raw, meta, n, declared_codes=None):
    """Per respondent, the share of answers that are non-answers, over the variables where the file
    says which codes are not answers: a value label meaning no usable answer (_DK_RE), or a declared
    user-missing value or range (B36-F04), or a Stata extended missing value the file declares
    (`declared_codes`, from _rq_raw_answers). Codes are compared as identities, so a labelled text code
    such as "DK" counts. The denominator is the answers the respondent gave to those variables
    (non-answers included); a blank is no answer and is in neither count. A respondent is flagged at
    RQ_NON_ANSWER_SHARE or more of at least RQ_NON_ANSWER_MIN answers. A diagnostic prompt only: no case
    is excluded."""
    import numpy as np

    value_labels = getattr(meta, "variable_value_labels", None) or {}
    missing = getattr(meta, "missing_ranges", None) or {}
    measured_vars = 0
    na_count = np.zeros(n)
    answered = np.zeros(n)
    for c in raw.columns:
        labels = value_labels.get(c) or {}
        codes = {_rq_code_identity(k) for k in _non_answer_codes(labels, None, True)} - {None}
        codes |= {_rq_code_identity(k) for k in (declared_codes or {}).get(c, [])} - {None}
        ranges = []
        for r in missing.get(c) or []:
            if not isinstance(r, dict):
                continue
            lo, hi = _rq_code_identity(r.get("lo")), _rq_code_identity(r.get("hi"))
            if lo is None or hi is None:
                continue
            if lo[0] == "n" and hi[0] == "n":
                ranges.append((lo[1], hi[1]))
            else:
                codes |= {lo, hi}  # a declared text missing value is a code, not a range
        if not codes and not ranges:
            continue
        measured_vars += 1
        for i, v in enumerate(raw[c].tolist()):
            ident = _rq_code_identity(v)
            if ident is None:
                continue
            answered[i] += 1
            if ident in codes or (ident[0] == "n" and any(lo <= ident[1] <= hi for lo, hi in ranges)):
                na_count[i] += 1
    out = {"measured": measured_vars > 0, "variables": measured_vars, "flagged": 0, "threshold": RQ_NON_ANSWER_SHARE, "minAnswers": RQ_NON_ANSWER_MIN}
    flags = []
    if measured_vars == 0:
        return out, flags
    share = np.where(answered > 0, na_count / np.maximum(answered, 1), 0)
    eligible = answered >= RQ_NON_ANSWER_MIN
    bad = eligible & (share >= RQ_NON_ANSWER_SHARE)
    out["flagged"] = int(bad.sum())
    out["eligible"] = int(eligible.sum())
    out["medianShare"] = float(np.median(share[eligible])) if eligible.any() else None
    for i in np.flatnonzero(bad):
        flags.append((int(i), f"{round(100 * share[i])}% of {int(answered[i])} answers were non-answers"))
    return out, flags


# Wording that usually turns an item around: a negation, or a word built on a negative prefix. The prefix
# words are listed rather than matched by "dis"/"un" alone, which would catch "discount" or "understand".
_REVERSAL_WORDING_RE = re.compile(
    r"\b(not|never|no longer|don't|dont|do not|doesn't|does not|isn't|is not|can't|cannot|won't|hardly|rarely|seldom|"
    r"dislike\w*|disagree\w*|dissatisf\w*|distrust\w*|unhappy|unfair\w*|unreliable|unhelpful|unfriendly|unclear|unsafe|"
    r"unlikely|unpleasant|unsatisf\w*|untrustworthy|unwilling\w*|difficult\w*|confusing|frustrat\w*|annoy\w*|worse|worst|poor\w*)\b",
    re.IGNORECASE,
)
RQ_REVERSAL_MIN_CASES = 30  # an item-rest correlation on fewer complete cases is not reported


def _reversal_suggestions(sub, valid, g, var_labels):
    """Items of one battery that may be worded in the opposite direction, from two separate signs:
    wording (a negation or negative word in the item's label, _REVERSAL_WORDING_RE) and a negative
    item-rest correlation (Pearson, between the item and the mean of the battery's other items, over
    cases with a valid answer to the item and at least one other; non-answer codes excluded). Strength
    is "both" when the two agree, else the one that fired. A suggestion only: the researcher confirms.
    An item whose correlation cannot be computed (under RQ_REVERSAL_MIN_CASES cases, or no variation)
    carries itemRest None, never 0."""
    import numpy as np

    out = []
    items = g["items"]
    x = np.where(valid, sub, np.nan)
    for j, item in enumerate(items):
        label = str(var_labels.get(item) or "")
        m = _REVERSAL_WORDING_RE.search(label) if label else None
        others = np.delete(x, j, axis=1)
        with np.errstate(invalid="ignore"):
            rest = np.nanmean(others, axis=1) if others.shape[1] else np.full(len(x), np.nan)
        ok = ~np.isnan(x[:, j]) & ~np.isnan(rest)
        r = None
        if ok.sum() >= RQ_REVERSAL_MIN_CASES:
            a, b = x[ok, j], rest[ok]
            if np.std(a) > 0 and np.std(b) > 0:
                r = float(np.corrcoef(a, b)[0, 1])
        negative = r is not None and r < 0
        if not m and not negative:
            continue
        out.append({
            "variable": str(item), "label": label or None, "wording": m.group(0) if m else None,
            "itemRest": None if r is None else round(r, 3), "cases": int(ok.sum()),
            "strength": "both" if (m and negative) else ("wording" if m else "correlation"),
        })
    return out


def respondent_quality(file_bytes: bytes, source_filename: str, args=None) -> dict:
    """Respondent-level checks over every case: straightlining in batteries, the share of non-answers,
    speeders (when a duration variable is found) and interviewer differences (when an interviewer
    variable is found), and the cases with the most flags. Unweighted counts of cases. Also, per
    battery, the items that may be worded in the opposite direction (reversal suggestions, import step
    3) and, for items the researcher confirmed as reversed, respondents who gave the same answer across
    items worded in opposite directions. args: layout, selectedSheet, overlay (labels and confirmed
    reversals, as for every calculation)."""
    import numpy as np
    import pandas as pd

    args = args or {}
    layout = args.get("layout")
    df, meta = _read_raw(file_bytes, source_filename, None, layout if layout == "columns_are_cases" else None, args.get("selectedSheet") or None)
    # Labels from a linked codebook or questionnaire help the wording cue; the frame is a copy, so the
    # cached read is untouched. Reversed items are judged on the original columns, not derived ones.
    if args.get("overlay"):
        df = df.copy()
        _apply_overlay(df, meta, {k: v for k, v in args["overlay"].items() if k != "reversals"})
    confirmed_reversed = {r["variable"] for r in _reversals_of(args.get("overlay")).values()}
    n = len(df)
    value_labels = getattr(meta, "variable_value_labels", None) or {}
    labels_of = lambda c: value_labels.get(c) or {}
    flags = [[] for _ in range(n)]
    notes = []

    id_col = next((c for c in df.columns if _is_id_like_header(str(c))), None)

    # Straightlining.
    grids = _rq_grids(df, labels_of)
    straight_cases = np.zeros(n, dtype=int)
    eligible_cases = np.zeros(n, dtype=int)
    grid_out = []
    for g in grids:
        sub = df[g["items"]].apply(lambda c: pd.to_numeric(c, errors="coerce")).to_numpy(dtype=float)
        valid = ~np.isnan(sub)
        for na in g["nonAnswers"]:
            valid &= sub != na
        answered = valid.sum(axis=1)
        top = np.zeros(n)
        for v in g["points"]:
            top = np.maximum(top, ((sub == v) & valid).sum(axis=1))
        eligible = answered >= RQ_GRID_MIN_ITEMS
        with np.errstate(divide="ignore", invalid="ignore"):
            score = np.where(eligible, top / np.maximum(answered, 1), np.nan)
        full = eligible & (score == 1.0)
        near = eligible & (score >= RQ_NEAR_STRAIGHTLINE) & ~full
        straight_cases += full
        eligible_cases += eligible
        # Same answer to every item although some are confirmed as worded in the opposite direction: the
        # answers contradict each other, a stronger sign of inattention than ordinary straightlining.
        reversed_items = [c for c in g["items"] if c in confirmed_reversed]
        contradictory = full & (len(reversed_items) > 0) & (len(reversed_items) < len(g["items"]))
        for i in np.flatnonzero(contradictory):
            flags[i].append(f"gave the same answer to items worded in opposite directions in {g['stem']}")
        grid_out.append({
            "stem": g["stem"], "items": g["items"], "points": [int(p) for p in g["points"]],
            "eligible": int(eligible.sum()), "straightliners": int(full.sum()), "nearStraightliners": int(near.sum()),
            "reversedItems": reversed_items,
            "reversedStraightliners": int(contradictory.sum()) if reversed_items and len(reversed_items) < len(g["items"]) else None,
            "reversalSuggestions": _reversal_suggestions(sub, valid, g, getattr(meta, "column_names_to_labels", None) or {}),
            # Why this battery's items cannot be reversed (gap in the scale, a non-answer code inside it), or null.
            "reversalProblem": _reversal_problem(_battery_scale_points(g, meta), getattr(meta, "variable_value_labels", None) or {}, getattr(meta, "missing_ranges", None) or {}, g["items"]),
        })
    straight_flag = (straight_cases >= RQ_STRAIGHTLINED_BATTERIES) & (straight_cases * 2 >= eligible_cases)
    for i in np.flatnonzero(straight_flag):
        flags[i].append(f"straightlined {int(straight_cases[i])} of {int(eligible_cases[i])} batteries")

    # Non-answers: codes the file labels as no usable answer, and codes it declares user-missing.
    raw_answers, declared_codes = _rq_raw_answers(file_bytes, source_filename, df)
    non_answer, na_flags = _rq_non_answers(raw_answers, meta, n, declared_codes)
    for i, text in na_flags:
        flags[i].append(text)
    if not non_answer["measured"]:
        notes.append("Non-answers could not be measured: the file has no value labels marking codes such as \"Don't know\" or \"Refused\", and declares no missing-value codes.")

    # Speeders.
    variable_labels = getattr(meta, "column_names_to_labels", None) or {}
    duration_col = next(
        (c for c in df.columns
         if _RQ_DURATION_RE.search(f"{c} {variable_labels.get(c) or ''}") and pd.to_numeric(df[c], errors="coerce").notna().sum() > 0),
        None,
    )
    duration = {"variable": None if duration_col is None else str(duration_col)}
    dur = None
    if duration_col is not None:
        dur = pd.to_numeric(df[duration_col], errors="coerce").to_numpy(dtype=float)
        positive = dur[(~np.isnan(dur)) & (dur > 0)]
        med = float(np.median(positive)) if positive.size else None
        duration["median"] = med
        if med:
            speed = (~np.isnan(dur)) & (dur > 0) & (dur < RQ_SPEEDER * med)
            sup = speed & (dur < RQ_SUPER_SPEEDER * med)
            duration.update({"speeders": int(speed.sum()), "superSpeeders": int(sup.sum()), "long": int(((dur > RQ_LONG * med)).sum()), "speederBelow": RQ_SPEEDER * med, "superSpeederBelow": RQ_SUPER_SPEEDER * med})
            for i in np.flatnonzero(speed):
                flags[i].append(f"{'super-speeder' if sup[i] else 'speeder'}: {dur[i]:g} against a median of {med:g}")
    else:
        notes.append("Speeders could not be checked: no interview length variable was found (a name such as duration, LOI or interview time).")

    # Interviewers.
    interviewer_col = next((c for c in df.columns if _RQ_INTERVIEWER_RE.search(str(c)) and 2 <= df[c].nunique(dropna=True) <= 1000), None)
    interviewers = {"variable": None if interviewer_col is None else str(interviewer_col), "rows": []}
    if interviewer_col is not None:
        overall_straight = float(straight_flag.mean()) if n else 0.0
        overall_med = duration.get("median")
        for who, idx in df.groupby(df[interviewer_col].astype(str)).indices.items():
            if len(idx) < RQ_INTERVIEWER_MIN_CASES or who in ("nan", "None", ""):
                continue
            rate = float(straight_flag[idx].mean())
            row = {"interviewer": who, "cases": int(len(idx)), "straightlinerRate": rate}
            reasons = []
            if rate >= max(2 * overall_straight, overall_straight + 0.1) and rate > 0:
                reasons.append("more straightlining than other interviewers")
            if dur is not None and overall_med:
                their = dur[idx]
                their = their[(~np.isnan(their)) & (their > 0)]
                if their.size:
                    row["medianDuration"] = float(np.median(their))
                    if row["medianDuration"] < RQ_SPEEDER * overall_med:
                        reasons.append("interviews much shorter than other interviewers'")
            row["check"] = reasons
            interviewers["rows"].append(row)
        interviewers["rows"].sort(key=lambda r: (-len(r["check"]), -r["straightlinerRate"]))
    else:
        notes.append("Interviewer differences could not be checked: no interviewer variable was found.")

    ranked = sorted((i for i in range(n) if flags[i]), key=lambda i: -len(flags[i]))
    top = []
    for i in ranked[:RQ_TOP_CASES]:
        ident = None if id_col is None else _json_cell(df.iloc[i][id_col])
        top.append({"row": i + 1, "id": None if ident is None else _code_text(ident), "reasons": flags[i]})
    return {
        "cases": n,
        "idVariable": None if id_col is None else str(id_col),
        "straightlining": {"grids": grid_out, "flagged": int(straight_flag.sum()), "nearThreshold": RQ_NEAR_STRAIGHTLINE, "minItems": RQ_GRID_MIN_ITEMS, "minBatteries": RQ_STRAIGHTLINED_BATTERIES},
        "nonAnswer": non_answer,
        "duration": duration,
        "interviewers": interviewers,
        "flaggedCases": len(ranked),
        "topCases": top,
        "notes": notes,
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


# The qualification on a requested mean of codes that may not be a scale. The same words are
# UNORDERED_MEAN_NOTE in src/lib/crosstabAsk.ts, which the plan's Check item quotes.
UNORDERED_MEAN_NOTE = "mean of the answer codes, which may not be in order"


_ORDER_RE = re.compile(
    r"agree|disagree|satisf|likel|often|never|always|sometimes|good|poor|excellent|important|"
    r"confident|trust|easy|difficult|strongly|very |not at all|a lot|a little|extent|worse|better|"
    r"increase|decrease|frequent|rarely|high|low", re.I)


# A label that is just a number ("7", "7.0"), or a number followed by anchor wording
# ("0 - Not at all likely", "10 = Extremely likely").
_NUMBER_LABEL_RE = re.compile(r"^\s*[-+]?\d+(?:\.\d+)?\s*$")
_NUMBER_LED_LABEL_RE = re.compile(r"^\s*[-+]?\d+(?:\.\d+)?(?:\s*[-=:.)]\s*|\s+)\S")
# Owner decision, 2026-10-17: a numbered scale of this many points or more gets a mean by default.
# Researchers who want the distribution instead read the frequencies, nets or top/bottom boxes,
# which are always shown alongside.
_NUMBERED_SCALE_MIN_POINTS = 10


def _is_numbered_scale(subst):
    """True for a numbered rating scale such as 0 to 10 or 1 to 10: at least
    _NUMBERED_SCALE_MIN_POINTS substantive answers whose labels are bare numbers, with at most the
    two end points carrying anchor wording after their number. A numbered list of named categories
    ("1. Gauteng", "2. Western Cape", ...) is not a scale: there every label carries wording."""
    if len(subst) < _NUMBERED_SCALE_MIN_POINTS:
        return False
    bare = sum(1 for v in subst if _NUMBER_LABEL_RE.match(v))
    anchored = sum(1 for v in subst if not _NUMBER_LABEL_RE.match(v) and _NUMBER_LED_LABEL_RE.match(v))
    return anchored <= 2 and bare + anchored == len(subst)


def _is_ordered_scale(var, labels, measures, raw=None):
    """True when the coded answers of a single question form an ordered scale, so the mean and
    spread of the codes are meaningful. Uses the measurement level stored in the file when it says
    nominal or ordinal; otherwise a numbered scale of 10 or more points (see _is_numbered_scale),
    and otherwise the wording of the answer labels.

    A numeric column with no value labels at all (a spreadsheet's 0 to 10 rating, Grant 2026-10-22)
    is judged by its own codes when `raw` is given: whole-number codes with 10 or more distinct
    values are a numbered scale, by the same _is_numbered_scale rule a labelled "0".."10" list
    meets. Fewer distinct codes stay not ordered, as an unlabelled 1 to 5 list always was. This is
    broad: the codes are not checked to be consecutive, and nothing tells a rating from a count,
    so an unlabelled count with 10 or more distinct whole-number values is treated as a scale too
    (a mean and spread, and an unqualified requested mean). Non-integer codes are not."""
    m = str((measures or {}).get(var) or "").lower()
    if m == "nominal":
        return False
    if m == "ordinal":
        return True
    if not labels and raw is not None and getattr(raw, "dtype", None) is not None and raw.dtype.kind in "fiu":
        vals = [float(v) for v in raw.dropna().unique() if math.isfinite(float(v))]
        if vals and all(v.is_integer() for v in vals):
            return _is_numbered_scale([str(int(v)) for v in sorted(vals)])
        return False
    # "scale" is SPSS's default for any numeric column, so it proves nothing about labelled codes.
    subst = [str(v) for v in (labels or {}).values() if not _DK_RE.match(str(v).strip())]
    if len(subst) < 3:
        return False
    if _is_numbered_scale(subst):
        return True
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
    # Batch 48 (Grant, 27 October 2026): the "Mean" tick in "Show in each cell". When the request asks
    # for it, every single choice question whose codes form a rating scale (numeric codes judged an
    # ordered scale by _is_ordered_scale, the same rule that decides a question's own mean and spread)
    # gets a mean row above its answers, tested like any mean. Questions whose codes are not a scale
    # (regions, brands) get none, and are named in notes.meanNotAdded rather than left out silently.
    # Only an explicit true asks: a request saved before the tick existed builds as it always did.
    mean_rows = args.get("meanRows") is True
    mean_not_added: list = []
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
                # var + rawCode: the column's identity (its banner variable and answer code, in the
                # same one text form as CrosstabRow.rawCode), so a reader finds a subgroup by code,
                # never by its label or position. Output only; nothing is computed from it.
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": _col_label_of_code(c), "var": cv, "rawCode": _code_text(c)})
                col_masks.append(np.array([x == c for x in ident_arr], dtype=bool))
            elif gi not in emitted:
                emitted.add(gi)
                members = group_codes[gi]
                columns.append({"block": bi, "blockLabel": labels.get(cv) or cv, "name": groups[gi]["label"], "isGroup": True, "var": cv,
                                "rawCodes": sorted(_code_text(m) for m in members)})
                col_masks.append(np.array([x in members for x in ident_arr], dtype=bool))
    if len(columns) > 60:
        raise ValueError("Too many banner columns in total (limit 60). Use fewer or smaller column variables.")
    K = len(columns)
    block_of_col = [c["block"] for c in columns]
    block_any = {}
    for k in range(K):
        b = block_of_col[k]
        block_any[b] = block_any.get(b, np.zeros(n_rows, dtype=bool)) | col_masks[k]

    # Cells (or column pairs) not tested because a share was 0% or 100% under a survey design (see prop_row).
    degenerate_untested = [0]

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
                    # A share of exactly 0% or 100% has no variance under the design, so the
                    # linearised standard error of the difference collapses to the other side's
                    # alone and the smallest gap looks significant. Such a cell is not tested.
                    if pj * (1 - pj) == 0 or pc * (1 - pc) == 0:
                        se = 0.0
                        degenerate_untested[0] += 1
                    else:
                        yc = (sel_mask & cm).astype(float)
                        tc = dsg.totals(np.where(cm, wv * (yc - pc) / csw, 0.0))
                        se = math.sqrt(dsg.var_totals(tk - tc))
                else:
                    se = _pooled_prop_se(pj, n_eff, pc, c_eff)
                if se > 0:
                    z = (pj - pc) / se
                    p = _p_two_sided_design(z, dsg)
                    if p < SIG_LEVEL:
                        sg = 1 if z > 0 else -1
            ps.append(None if p is None else round(p, 4))
            sigs.append(sg)
            ok_pair = n >= MIN_BASE_RELIABLE and not math.isnan(pj) and n_eff >= MIN_EFFECTIVE_BASE
            # The fourth element marks a share (with its effective base): its letters use the pooled
            # test below. A mean's estimate has none and keeps its Welch-type comparison.
            ests.append(((pj, pj * (1 - pj) / n_eff, None if tk is None else tk.astype(np.float32), n_eff) if ok_pair else None))
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
        cell_resid: dict = {_code_text(c): {} for c in cats}
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
                    cell_resid[_code_text(cat)][k] = {
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
            ests.append((mj, var / n_eff, None if tk is None else tk.astype(np.float32), None) if (n >= MIN_BASE_RELIABLE and var is not None and n_eff >= MIN_EFFECTIVE_BASE) else None)
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
            non_answers = _non_answer_codes(r_labels, (getattr(meta, "missing_ranges", None) or {}).get(rv), exclude_dk)
            cats = [c for c in _ordered_categories_raw(ident[r_valid], r_labels, include_unobserved=True) if c not in non_answers]
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
                row["rawCode"] = _code_text(cat)
                res = cell_resid.get(_code_text(cat)) or {}
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
            item_groups = list(it.get("groups") or [])
            if mean_rows and not any((g.get("kind") or "net") == "mean" for g in item_groups):
                if raw.dtype.kind in "fiu" and _is_ordered_scale(rv, r_labels, getattr(meta, "variable_measure", None), raw):
                    # Above the first answer; anchored on every answer, so it never lands inside the list.
                    item_groups.insert(0, {"label": it["label"], "kind": "mean", "place": "above", "cats": [_label_of_code(c) for c in cats], "autoMean": True})
                else:
                    mean_not_added.append(it["label"])
            for g in item_groups:
                kind = g.get("kind") or "net"
                plus_labels = set(g.get("cats", []))
                minus_labels = set(g.get("minus", []))
                if g.get("autoMean"):
                    # B48-F01 (Codex): the Mean tick's row is the mean of the raw answer codes (below), so it
                    # never resolves labels to codes. Resolving them made unique answer labels a condition:
                    # with 2 and 3 both labelled "High" the row was refused although the codes, the scale
                    # and the arithmetic were unchanged. A group the researcher defines by its labels still
                    # refuses a label shared by several codes (_resolve_group_labels).
                    plus, minus = set(), set()
                else:
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
                    # A mean asked for in plain English (crosstabAsk.ts meanGroupFor sets
                    # qualifyCodes) can land on codes that are not a scale (regions, brands). The
                    # same ordered-scale rule that decides the default mean below
                    # (_is_ordered_scale) decides whether the row says so, in its own label, so the
                    # qualification reaches the screen and every export that prints row labels.
                    # The figure is unchanged. Groups without the flag keep their label as before.
                    if g.get("qualifyCodes") and not _is_ordered_scale(rv, r_labels, getattr(meta, "variable_measure", None), raw):
                        row["label"] += f" ({UNORDERED_MEAN_NOTE})"
                        row["codesMayBeUnordered"] = True
                    row["isNet"] = True
                    row["isScore"] = True
                    row["isMean"] = True
                    if g.get("autoMean"):
                        # Added by the Mean tick, not a group the researcher defined: the screen and
                        # exports can show or hide these rows without touching defined groups.
                        row["label"] = "Mean"
                        row["autoMean"] = True
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
            if raw.dtype.kind in "fiu" and _is_ordered_scale(rv, r_labels, getattr(meta, "variable_measure", None), raw):
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
                        share = est[ja][3] is not None and est[jb][3] is not None
                        if dsg is not None and est[ja][2] is not None and est[jb][2] is not None:
                            # As the column test: a share at 0% or 100% is not compared under a design.
                            if share and (est[ja][0] * (1 - est[ja][0]) == 0 or est[jb][0] * (1 - est[jb][0]) == 0):
                                degenerate_untested[0] += 1
                                continue
                            se = math.sqrt(dsg.var_totals(est[ja][2].astype(float) - est[jb][2].astype(float)))
                        elif share:
                            se = _pooled_prop_se(est[ja][0], est[ja][3], est[jb][0], est[jb][3])
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
            + ("t-test (design degrees of freedom) on the linearised difference of two domain estimates" if dsg is not None else "two-proportion z-test, shares pooled under the null hypothesis, on effective bases")
            + "; difference of means for averages), 95% level, "
            + {
                "none": "not corrected for multiple comparisons.",
                "bonferroni": "with a Bonferroni correction across the columns of each banner variable, for each row.",
                "fdr": "with a Benjamini-Hochberg false discovery rate correction across the columns of each banner variable, for each row.",
            }[correction],
            "correction": correction,
            # The rules this table's figures and flags came from, so a table built before a change is known.
            "methodVersion": TABLE_METHOD,
            "meanRows": mean_rows,
            "meanNotAdded": (
                "No mean row for " + "; ".join(mean_not_added) + ": their answer codes are not a rating scale, so a mean of them would not mean anything."
                if mean_not_added else None
            ),
            "degenerateUntested": (
                f"{degenerate_untested[0]} cell(s) or column pair(s) at 0% or 100% were not tested: under a survey design such a share has no variance, so a test would overstate the difference."
                if degenerate_untested[0] else None
            ),
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


# IMP-001: verification side of src/lib/parseRequestSignature.ts. Returns None when the request is
# authentic and in scope, else a short reason (kept server-side; the caller only says 401).
_SIGNED_PATH = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/\\]+$",
    re.IGNORECASE,
)
_SIGNATURE_LIFETIME_SECONDS = 300
_SIGNED_ACTIONS = {"convert", "table", "dictionary", "categories", "columns", "crosstab", "respondent_quality", "codebook", "instrument_sheet"}


def verify_parse_request(secret, header, action, bucket, storage_path, now=None):
    import hmac
    import time

    if not secret:
        return "secret not configured"
    if not isinstance(header, str) or header.count(".") != 2:
        return "missing signature"
    version, expires_text, mac = header.split(".")
    if version != "v1" or not expires_text.isdigit():
        return "malformed signature"
    expires_at = int(expires_text)
    current = int(time.time() if now is None else now)
    # The app signs with a fixed lifetime, so an expiry further ahead than that is not one it issued.
    if expires_at < current or expires_at > current + _SIGNATURE_LIFETIME_SECONDS + 60:
        return "signature expired"
    if action not in _SIGNED_ACTIONS or bucket != DEFAULT_BUCKET:
        return "action or bucket not allowed"
    if not isinstance(storage_path, str) or ".." in storage_path or not _SIGNED_PATH.match(storage_path):
        return "storage path not allowed"
    payload = f"v1\n{expires_at}\n{action}\n{bucket}\n{storage_path}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, mac):
        return "signature mismatch"
    return None


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # This function is reachable at a public Vercel URL with no session or login of its
            # own, and it downloads with the Supabase service-role key, which bypasses row-level
            # security entirely - so without this check, anyone who can reach this URL at all can
            # read any tenant's stored file by guessing or observing its storage path.
            # IMP-001 (worker scope): PARSE_STATS_SHARED_SECRET is the signing key and is never
            # sent over the wire. The app signs each request for one exact action, bucket and
            # storage path with an expiry (src/lib/parseRequestSignature.ts, called from
            # parseStatsFile.ts), and verify_parse_request recomputes that signature before
            # anything is downloaded, so a captured request cannot be replayed later or
            # retargeted at another tenant's file. The key must hold the same value in both
            # environments. An unset key is refused like a wrong one, never waved through: an
            # operator who forgot to configure it is exactly the case this check exists for.
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            storage_path = body.get("storagePath")
            source_filename = body.get("sourceFilename", "upload.sav")
            bucket = body.get("bucket", DEFAULT_BUCKET)
            action = body.get("action", "convert")
            refusal = verify_parse_request(
                os.environ.get("PARSE_STATS_SHARED_SECRET"),
                self.headers.get("x-parse-stats-signature"),
                action,
                bucket,
                storage_path,
            )
            if refusal:
                self._send_json(401, {"error": "Unauthorized"})
                return

            file_bytes = _storage_download(bucket, storage_path)
            if action == "dictionary":
                self._send_json(200, {"result": dictionary(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "categories":
                self._send_json(200, {"result": categories(file_bytes, source_filename, (body.get("args") or {})["variable"], (body.get("args") or {}).get("overlay"), (body.get("args") or {}).get("layout"), (body.get("args") or {}).get("selectedSheet"))})
                return
            if action == "columns":
                self._send_json(200, {"result": driver_columns(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "instrument_sheet":
                self._send_json(200, {"result": instrument_sheet(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "codebook":
                self._send_json(200, {"result": codebook_items(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "respondent_quality":
                self._send_json(200, {"result": respondent_quality(file_bytes, source_filename, body.get("args") or {})})
                return
            if action == "crosstab":
                self._send_json(200, {"result": crosstab(file_bytes, source_filename, body.get("args") or {})})
                return
            # Both answers are respondent-level tables, often past the 4.5 MB response limit, so both are
            # written to the converted copy the app reads back (and removes) rather than returned.
            # allow_nan=False: a number JSON cannot hold fails here, never as an unreadable preview.
            if action == "table":
                result = read_table(file_bytes, source_filename, body.get("args") or {})
            else:
                result = convert(file_bytes, source_filename)

            result_path = f"{storage_path}.converted.json"
            _storage_upload(bucket, result_path, json.dumps(result, allow_nan=False).encode("utf-8"), "application/json")

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

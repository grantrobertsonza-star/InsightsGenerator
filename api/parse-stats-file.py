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

NOT YET VERIFIED END TO END: this function has not been exercised against
a real .sav/.dta/.sas7bdat file or deployed to Vercel from this session -
see the accompanying message for why, and test it (ideally with
`vercel dev` locally, against a real file) before relying on it.
"""

import json
import math
import os
import tempfile
from http.server import BaseHTTPRequestHandler

import pyreadstat

READERS = {
    ".sav": pyreadstat.read_sav,
    ".dta": pyreadstat.read_dta,
    ".sas7bdat": pyreadstat.read_sas7bdat,
}


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
        os.unlink(tmp_path)

    variable_labels = meta.column_names_to_labels or {}
    value_labels_by_var = meta.variable_value_labels or {}

    raw_names = list(df.columns)
    headers = _build_headers(raw_names, variable_labels)

    rows = []
    for _, record in df.iterrows():
        row = {}
        for raw_name, header in zip(raw_names, headers):
            value = _clean_value(record[raw_name])
            row[header] = _resolve_value(raw_name, value, value_labels_by_var)
        rows.append(row)

    return {"headers": headers, "rows": rows}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            source_filename = self.headers.get("x-source-filename", "upload.sav")
            length = int(self.headers.get("content-length", 0))
            body = self.rfile.read(length)
            result = convert(body, source_filename)
            self._send_json(200, result)
        except Exception as exc:  # noqa: BLE001 - surfaced to the Node caller as a clear parse failure
            self._send_json(500, {"error": str(exc)})

    def _send_json(self, status: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

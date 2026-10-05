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
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            storage_path = body["storagePath"]
            source_filename = body.get("sourceFilename", "upload.sav")
            bucket = body.get("bucket", DEFAULT_BUCKET)

            file_bytes = _storage_download(bucket, storage_path)
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

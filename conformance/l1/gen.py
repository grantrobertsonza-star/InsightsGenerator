"""L1 conformance cases: data-file reading.

Every case is written FROM a declared truth: the generator holds the expected reading and writes the
file from it (or writes literal file text next to the reading the contract says it must produce).
Nothing here is copied from the reader's output.

A case is a dict:
  id, desc, clause      identity, what it checks, the contract sentence it rests on
  kind                  "table" (read_table + _read_raw), "stats" (convert + _read_raw + dictionary),
                        or "rule" (the shared limit check, _check_import_limits)
  file                  fixture file name (its extension is the format the reader sees)
  build                 callable(path) that writes the fixture
  args                  reader args (layout, selectedSheet)
  expect                expected reading (see run.py for the keys)
  question              when set, the contracts do not settle the answer: the case is run and the
                        observed reading recorded for Grant, but it is neither pass nor fail.
"""

import datetime
import os
import re
import zipfile

CASES = []

# Contract clauses, quoted short so a reader of results.json can find them.
C_ENC = "one-reader-import.md, Reading rules, Encoding (CSV/TSV)"
C_DELIM = "one-reader-import.md, Reading rules, Delimiter (_sniff_delimiter, IS-F01)"
C_QUOTE = "one-reader-import.md, Reading rules, Quoting"
C_NAMES = "one-reader-import.md, Reading rules, Names; column-names-and-preview-identity.md"
C_MISS = "one-reader-import.md, Reading rules, Missing values (_NA_STRING_TOKENS = pandas default list)"
C_TYPES = "one-reader-import.md, Reading rules, Types (_typed_series)"
C_BIG = "one-reader-import.md, Behaviour that changed, one typing policy for numbers written as text"
C_DATES = "one-reader-import.md, Reading rules, Dates (IP1000-F02)"
C_EXCEL = "one-reader-import.md, Reading rules, Excel"
C_IDFMT = "one-reader-import.md, Reading rules, Identifier formats"
C_LAYOUT = "one-reader-import.md, Reading rules, Layouts"
C_LIMITS = "import-resource-boundary.md + api/import-limits.json (maxFileBytes 100,000,000; maxCases 100,000)"
C_FLIPMETA = "import-resource-boundary.md, flipped workbook metadata guard"
C_SAVMISS = "import-resource-boundary.md, SAV/ZSAV user-missing: declarations kept, data values masked"
C_CONVERT = "parse-stats-file.py convert/_build_headers/_resolve_value/_clean_value docstrings"
C_SAS = "parse-stats-file.py _sas_blanks_missing docstring (SAS blank character value is missing)"
C_STATSFLIP = "one-reader-import.md, Layouts: SPSS, Stata and SAS files refuse columns-as-cases"
C_WEIGHT = "parse-stats-file.py dictionary(): weightLike = numeric and name or label matches weight|wgt|wt"
C_SHEET = "one-reader-import.md, Excel sheet choice (non-dictionary sheet with most real data rows; sheetSelectionLost)"
C_LABELSHEET = "parse-stats-file.py _excel_labels docstring ([variable,label] and [variable,value,value label] sheets)"

# The declared missing tokens: pandas' own default list, which the contract names as the policy.
# Taken from pandas, not from the reader, so the expectation is independent of the reader's copy.
from pandas._libs.parsers import STR_NA_VALUES as PANDAS_NA_TOKENS  # noqa: E402


def I(v):
    return ("int", v)


def F(v):
    return ("float", v)


def NUM(v):
    return ("num", v)


def S(v):
    return ("str", v)


def B(v):
    return ("bool", v)


NULL = ("null", None)


def add(**case):
    case.setdefault("kind", "table")
    case.setdefault("args", {})
    case.setdefault("question", None)
    assert case["id"] not in {c["id"] for c in CASES}, case["id"]
    CASES.append(case)


# ---------------------------------------------------------------- writers


def write_bytes(data):
    def build(path):
        with open(path, "wb") as fh:
            fh.write(data)
    build.content = data
    return build


def write_text(text, encoding="utf-8"):
    return write_bytes(text.encode(encoding))


def csv_line(values, sep, quote_all=False):
    out = []
    for v in values:
        if quote_all or any(ch in v for ch in (sep, '"', "\n", "\r")):
            out.append('"' + v.replace('"', '""') + '"')
        else:
            out.append(v)
    return sep.join(out)


def csv_text(rows, sep=",", eol="\n", quote_all=False):
    return eol.join(csv_line(r, sep, quote_all) for r in rows) + eol


def transpose(rows):
    width = max(len(r) for r in rows)
    return [[r[i] if i < len(r) else "" for r in rows] for i in range(width)]


def flip(rows):
    """Columns-as-cases form of a rows-as-cases truth (header + case rows): a first row naming the
    cases ("var", "c1", "c2", ...), then one row per variable whose first cell is its name."""
    n_cases = len(rows) - 1
    return [["var"] + [f"c{i + 1}" for i in range(n_cases)]] + transpose(rows)


# ---------------------------------------------------------------- 1. separators and quoting

# Declared truth: four variables, three cases.
BASE_HEADERS = ["id", "age", "name", "score"]
BASE_ROWS = [["001", "34", "Ann", "3.5"], ["002", "45", "Bob", "4.25"], ["010", "29", "Cee", "2.0"]]
BASE_EXPECT = {
    "headers": BASE_HEADERS,
    "nrows": 3,
    "cells": [(0, "id", *S("001")), (2, "id", *S("010")), (0, "age", *I(34)), (2, "age", *I(29)),
              (1, "name", *S("Bob")), (0, "score", *F(3.5)), (2, "score", *F(2.0))],
    "types": {"id": "str", "age": "int", "name": "str", "score": "float"},
}
SEPS = {",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe"}

for sep, sname in SEPS.items():
    for ext in (".csv", ".txt"):
        add(id=f"D-SEP-{sname}{ext}", desc=f"{sname}-separated {ext} with id/int/text/float columns",
            clause=C_DELIM, file=f"sep_{sname}{ext}",
            build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS, sep)), expect=BASE_EXPECT)
    # quoted value holding the separator
    rows = [r[:] for r in BASE_ROWS]
    rows[1][2] = f"Smith{sep} Bob"
    exp = {**BASE_EXPECT, "cells": BASE_EXPECT["cells"][:4] + [(1, "name", *S(f"Smith{sep} Bob"))]}
    add(id=f"D-QSEP-{sname}", desc=f"{sname} file, a quoted value containing the separator",
        clause=C_QUOTE, file=f"qsep_{sname}.csv", build=write_text(csv_text([BASE_HEADERS] + rows, sep)), expect=exp)
    # doubled quotes
    rows = [r[:] for r in BASE_ROWS]
    rows[0][2] = 'He said "hi"'
    exp = {**BASE_EXPECT, "cells": [(0, "name", *S('He said "hi"')), (0, "age", *I(34))]}
    add(id=f"D-DQ-{sname}", desc=f"{sname} file, doubled quotes inside a quoted value",
        clause=C_QUOTE, file=f"dq_{sname}.csv", build=write_text(csv_text([BASE_HEADERS] + rows, sep)), expect=exp)
    # line break inside quotes
    rows = [r[:] for r in BASE_ROWS]
    rows[2][2] = "line one\nline two"
    exp = {**BASE_EXPECT, "cells": [(2, "name", *S("line one\nline two")), (2, "score", *F(2.0))]}
    add(id=f"D-NLQ-{sname}", desc=f"{sname} file, a line break inside a quoted value",
        clause=C_QUOTE, file=f"nlq_{sname}.csv", build=write_text(csv_text([BASE_HEADERS] + rows, sep)), expect=exp)

add(id="D-SEP-tsv", desc=".tsv is tab-separated; commas and semicolons in values are not separators",
    clause=C_DELIM + " (.tsv is tab)", file="tsv_commas.tsv",
    build=write_text("q1\tq2\n1,5\ta;b\n2\tc|d\n"),
    expect={"headers": ["q1", "q2"], "nrows": 2, "cells": [(0, "q1", *S("1,5")), (1, "q1", *S("2")), (0, "q2", *S("a;b"))]})
add(id="D-SEP-allquoted", desc="every field quoted; quoted numbers are numbers, quoted 001 stays text",
    clause=C_QUOTE + "; " + C_TYPES, file="allquoted.csv",
    build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS, ",", quote_all=True)), expect=BASE_EXPECT)
add(id="D-SEP-crlf", desc="Windows CRLF line endings", clause=C_QUOTE, file="crlf.csv",
    build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS, ",", eol="\r\n")), expect=BASE_EXPECT)
add(id="D-SEP-cr", desc="old Mac CR-only line endings", clause=C_QUOTE, file="cr.csv",
    build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS, ",", eol="\r")), expect=BASE_EXPECT)
add(id="D-SEP-nofinaleol", desc="no line break after the last row", clause=C_QUOTE, file="noeol.csv",
    build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS, ",").rstrip("\n")), expect=BASE_EXPECT)
add(id="D-QUOTE-crlf-inside", desc="CRLF inside a quoted value is kept exactly", clause=C_QUOTE, file="crlfq.csv",
    build=write_text('a,b\r\n1,"x\r\ny"\r\n'), expect={"headers": ["a", "b"], "nrows": 1, "cells": [(0, "b", *S("x\r\ny"))]})
add(id="D-QUOTE-midfield", desc="a quote in the middle of an unquoted field is a literal character",
    clause=C_QUOTE, file="midquote.csv", build=write_text('a,b\nx"y,2\nz,3\n'),
    expect={"headers": ["a", "b"], "nrows": 2, "cells": [(0, "a", *S('x"y')), (1, "b", *I(3))]})
add(id="D-QUOTE-unclosed", desc="a quoted value never closed is refused", clause=C_QUOTE, file="unclosed.csv",
    build=write_text('a,b\n1,"abc\n2,3\n'), expect={"refuse": ["could not be read", "nothing was imported"]})
add(id="D-QUOTE-after-close", desc="text after a closing quote is refused", clause=C_QUOTE, file="afterclose.csv",
    build=write_text('a,b\n"x"y,2\n3,4\n'), expect={"refuse": ["could not be read", "nothing was imported"]})
add(id="D-QUOTE-semi-unclosed", desc="semicolon file with an unclosed quote is refused, not read as one column",
    clause=C_QUOTE, file="semiunclosed.csv", build=write_text('a;b\n1;"abc\n2;3\n'),
    expect={"refuse": ["could not be read"]})

# ---------------------------------------------------------------- 2. delimiter choice, short and surplus rows

add(id="D-DELIM-ambig-comma-semi", desc="comma and semicolon both read as complete tables with equal full rows: refused",
    clause=C_DELIM, file="ambig1.csv", build=write_text("a,b;c\n1,2;3\n"),
    expect={"refuse": ["commas", "semicolons", "nothing was imported"]})
add(id="D-DELIM-ambig-comma-pipe", desc="comma vs pipe tie: refused naming both", clause=C_DELIM, file="ambig2.csv",
    build=write_text("a|b,c\n1|2,3\n4|5,6\n"), expect={"refuse": ["commas", "pipes"]})
add(id="D-DELIM-ambig-tab-semi", desc="tab vs semicolon tie: refused", clause=C_DELIM, file="ambig3.txt",
    build=write_text("a\tb;c\n1\t2;3\n"), expect={"refuse": ["semicolons", "tabs"]})
add(id="D-DELIM-more-full-rows", desc="semicolon gives more full-width rows than comma: semicolon chosen",
    clause=C_DELIM, file="morefull.csv", build=write_text("x;y,z\n1;2,3\n4;5\n"),
    expect={"headers": ["x", "y,z"], "nrows": 2, "cells": [(0, "x", *I(1)), (0, "y,z", *S("2,3")), (1, "y,z", *S("5"))]})
add(id="D-DELIM-semi-shortrow", desc="IS-F01: semicolon file with one short row is semicolon, short row padded",
    clause=C_DELIM, file="semishort.csv", build=write_text("a;b;c\n1;2;3\n4;5\n6;7;8\n"),
    expect={"headers": ["a", "b", "c"], "nrows": 3, "cells": [(1, "c", *NULL), (2, "c", *F(8.0)), (0, "a", *I(1))],
            "types": {"a": "int", "c": "float"}})
add(id="D-DELIM-semicolon-in-values", desc="comma file whose values contain unquoted semicolons stays comma",
    clause=C_DELIM, file="semivals.csv", build=write_text("a,b\nx;y,1\nz,2\n"),
    expect={"headers": ["a", "b"], "nrows": 2, "cells": [(0, "a", *S("x;y")), (1, "b", *I(2))]})
add(id="D-DELIM-semicolon-in-header", desc="comma file with a semicolon inside a header name", clause=C_DELIM,
    file="semihead.csv", build=write_text("Q1;wave,Q2\n1,2\n3,4\n"),
    expect={"headers": ["Q1;wave", "Q2"], "nrows": 2, "cells": [(1, "Q2", *I(4))]})
add(id="D-DELIM-decimal-comma-header-comma", desc="semicolon file with decimal commas and a comma in one header name ties: refused",
    clause=C_DELIM, file="dcamb.csv", build=write_text("Age, years;Score\n30;3,5\n"),
    expect={"refuse": ["commas", "semicolons"]})
add(id="D-SURPLUS-nonempty", desc="a row with more non-empty values than the header is refused naming the line",
    clause=C_QUOTE + " (surplus refused)", file="surplus.csv", build=write_text("a,b\n1,2\n3,4,5\n"),
    expect={"refuse": ["line 3", "3 values", "2 columns"]})
add(id="D-SURPLUS-trailing-empty", desc="a trailing separator on data rows is not a surplus value",
    clause=C_QUOTE, file="trailing.csv", build=write_text("a,b\n1,2,\n3,4,\n"),
    expect={"headers": ["a", "b"], "nrows": 2, "cells": [(1, "b", *I(4))], "types": {"a": "int", "b": "int"}})
add(id="D-SURPLUS-semi-nonempty", desc="semicolon file with one surplus value is refused (not read as one merged column)",
    clause=C_DELIM, file="semisurplus.csv", build=write_text("a;b\n1;2\n3;4;5\n"),
    expect={"refuse": ["line 3"]})
add(id="D-SHORT-padded", desc="short rows padded with missing values", clause=C_QUOTE, file="short.csv",
    build=write_text("a,b,c\n1,x,3\n2\n3,y\n"),
    expect={"headers": ["a", "b", "c"], "nrows": 3, "cells": [(1, "b", *NULL), (1, "c", *NULL), (2, "b", *S("y")), (0, "c", *F(3.0))],
            "types": {"a": "int", "c": "float"}})
add(id="D-SINGLE-csv", desc="a single-column CSV is a table with one variable", clause=C_DELIM, file="single.csv",
    build=write_text("score\n1\n2\n3\n"), expect={"headers": ["score"], "nrows": 3, "cells": [(2, "score", *I(3))]})
add(id="D-SINGLE-txt", desc="a .txt with no delimiter is refused as not a data table", clause=C_DELIM + "; _read_plain .txt rule",
    file="single.txt", build=write_text("score\n1\n2\n"), expect={"refuse": ["no tab, comma, semicolon or pipe"]})
add(id="D-SINGLE-csv-text-commas-quoted", desc="single column whose quoted values contain commas", clause=C_DELIM,
    file="singleq.csv", build=write_text('comment\n"good, fast"\n"slow, rude"\n'),
    expect={"headers": ["comment"], "nrows": 2, "cells": [(0, "comment", *S("good, fast"))]})

# ---------------------------------------------------------------- 3. encodings

ENC_TRUTH = [["naam", "stad"], ["Zoë", "Café"], ["Jürgen", "€5"]]
ENC_CELLS = [(0, "naam", *S("Zoë")), (0, "stad", *S("Café")), (1, "naam", *S("Jürgen")), (1, "stad", *S("€5"))]
for label, enc, bom, expected_enc in [
    ("utf8", "utf-8", b"", "utf-8"),
    ("utf8bom", "utf-8", b"\xef\xbb\xbf", "utf-8"),
    ("utf16le-bom", "utf-16-le", b"\xff\xfe", "utf-16"),
    ("utf16be-bom", "utf-16-be", b"\xfe\xff", "utf-16"),
    ("cp1252", "cp1252", b"", "windows-1252"),
]:
    for eol in ("\n", "\r\n"):
        tag = "lf" if eol == "\n" else "crlf"
        add(id=f"D-ENC-{label}-{tag}", desc=f"{label} text with accented letters and euro sign, {tag} line ends",
            clause=C_ENC, file=f"enc_{label}_{tag}.csv",
            build=write_bytes(bom + csv_text(ENC_TRUTH, ",", eol=eol).encode(enc)),
            expect={"headers": ["naam", "stad"], "nrows": 2, "cells": ENC_CELLS, "encoding": expected_enc})
add(id="D-ENC-cp1252-smartquotes", desc="Windows-1252 curly quotes and en dash decoded to their code points",
    clause=C_ENC, file="cp1252q.csv", build=write_bytes(b"a,b\n\x93yes\x94,1\x962\n"),
    expect={"headers": ["a", "b"], "nrows": 1, "cells": [(0, "a", *S("“yes”")), (0, "b", *S("1–2"))], "encoding": "windows-1252"})
add(id="D-ENC-utf16-txt-tabs", desc="Excel 'Unicode Text' export: UTF-16LE with BOM, tab-separated .txt", clause=C_ENC + "; " + C_DELIM,
    file="unicodetext.txt", build=write_bytes(b"\xff\xfe" + "naam\tstad\r\nZo\u00eb\tCaf\u00e9\r\nJ\u00fcrgen\t\u20ac5\r\n".encode("utf-16-le")),
    expect={"headers": ["naam", "stad"], "nrows": 2, "cells": ENC_CELLS, "encoding": "utf-16"})
add(id="D-ENC-macroman", desc="Mac Roman 'caf\u00e9' (byte 0x8E) from Excel 'CSV (Macintosh)'", clause=C_ENC + "; Limits (other legacy encodings refused, not guessed)",
    file="macroman.csv", build=write_bytes("city\ncaf\u00e9\n".encode("mac_roman")), expect={},
    question="Mac Roman bytes are valid Windows-1252, so this file is read as 'caf\u017d' with only the encoding note, although the contract says other legacy encodings are refused, not guessed. Is the Windows-1252 note enough, or should accented-letter patterns typical of Mac Roman be refused?")
add(id="D-ENC-invalid-byte", desc="a byte that is neither UTF-8 nor Windows-1252 (0x81) is refused naming the byte",
    clause=C_ENC, file="badbyte.csv", build=write_bytes(b"a,b\nx\x81,1\n"),
    expect={"refuse": ["neither utf-8 nor windows-1252", "byte 5"]})
add(id="D-ENC-invalid-0x9d", desc="undefined Windows-1252 byte 0x9D refused", clause=C_ENC, file="bad9d.csv",
    build=write_bytes(b"a,b\n1,\x9d\n"), expect={"refuse": ["neither utf-8 nor windows-1252"]})
add(id="D-ENC-bom-invalid", desc="UTF-8 BOM followed by invalid UTF-8 is refused (not re-read as Windows-1252)",
    clause=C_ENC, file="bombad.csv", build=write_bytes(b"\xef\xbb\xbfa,b\n\xe9,1\n"),
    expect={"refuse": ["marked as utf-8"]})
add(id="D-ENC-bom-header", desc="a UTF-8 BOM is not part of the first header name", clause=C_ENC, file="bomname.csv",
    build=write_bytes(b"\xef\xbb\xbfid,q1\n1,2\n"), expect={"headers": ["id", "q1"], "nrows": 1, "encoding": "utf-8"})
add(id="D-ENC-nfc-nfd", desc="NFC and NFD spellings of e-acute stay two distinct values (nothing normalised)",
    clause=C_ENC + " (code points kept exactly)", file="nfd.csv",
    build=write_text("city\nCafé\nCafé\n"),
    expect={"headers": ["city"], "nrows": 2, "cells": [(0, "city", *S("Café")), (1, "city", *S("Café"))]})
add(id="D-ENC-emoji-zulu", desc="emoji and isiZulu/Afrikaans text kept exactly", clause=C_ENC, file="emoji.csv",
    build=write_text("q,naam\n\U0001F600,Ngiyabonga\nê,sê\n"),
    expect={"headers": ["q", "naam"], "nrows": 2, "cells": [(0, "q", *S("\U0001F600")), (1, "naam", *S("sê"))]})
add(id="D-ENC-utf16-nobom", desc="UTF-16LE text with no byte-order mark", clause=C_ENC, file="u16nobom.csv",
    build=write_bytes("a,b\n1,2\n".encode("utf-16-le")), expect={},
    question="UTF-16 without a byte-order mark is valid UTF-8 bytewise (every other byte NUL). The contract reads UTF-16 only with a BOM and otherwise refuses a file that is 'none of these'. Should a NUL-laden file be refused, or read?")
add(id="D-ENC-mixed-utf8-cp1252", desc="mostly UTF-8 (a UTF-8 euro sign) with one stray Windows-1252 byte",
    clause=C_ENC, file="mixedenc.csv", build=write_bytes("a,b\n€5,x\n".encode("utf-8") + b"caf\xe9,y\n"),
    expect={},
    question="By the literal rule this falls back to Windows-1252 for the whole file, so the UTF-8 euro sign becomes three characters ('â‚¬5'), with only the encoding note to show it. Should a file that is mostly valid UTF-8 with stray bytes be refused instead?")

# ---------------------------------------------------------------- 4. blank lines, header-only, empty

add(id="D-BLANK-between", desc="blank lines between data rows are skipped", clause=C_QUOTE + " (blank lines skipped)",
    file="blank.csv", build=write_text("a,b\n1,2\n\n\n3,4\n"), expect={"headers": ["a", "b"], "nrows": 2, "cells": [(1, "a", *I(3))]})
add(id="D-BLANK-leading", desc="blank lines before the header are skipped; the first non-blank line is the header",
    clause=C_QUOTE + " (blank lines skipped)", file="blanklead.csv", build=write_text("\n\na,b\n1,2\n"),
    expect={"headers": ["a", "b"], "nrows": 1})
add(id="D-BLANK-separators-only", desc="a line of only separators is a row of missing cells, not a case",
    clause=C_MISS + " (a row with nothing but missing cells is skipped)", file="seponly.csv",
    build=write_text("a,b\n1,2\n,\n3,4\n"), expect={"headers": ["a", "b"], "nrows": 2, "types": {"a": "int"}})
add(id="D-BLANK-whitespace-line", desc="a whitespace-only line is a row of missing cells", clause=C_MISS,
    file="wsline.csv", build=write_text("a,b\n1,2\n   \n3,4\n"), expect={"headers": ["a", "b"], "nrows": 2})
add(id="D-BLANK-na-row", desc="a row of NA tokens only is not a case", clause=C_MISS, file="narow.csv",
    build=write_text("a,b\n1,2\nNA,N/A\n3,4\n"), expect={"headers": ["a", "b"], "nrows": 2, "types": {"a": "int", "b": "int"}})
add(id="D-HEADER-only", desc="header row and no data: variables listed, zero cases", clause=C_NAMES, file="headeronly.csv",
    build=write_text("a,b,c\n"), expect={"headers": ["a", "b", "c"], "nrows": 0})
add(id="D-EMPTY-file", desc="a zero-byte .csv", clause=C_NAMES, file="empty.csv", build=write_bytes(b""), expect={},
    question="An empty file: refused with a message, or an empty table with no variables? The contract is silent; an empty table would let a researcher accept a file with nothing in it.")

# ---------------------------------------------------------------- 5. header names

add(id="D-NAME-literal-tokens", desc="names NaN, None, 01, TRUE stay literal names", clause=C_NAMES,
    file="namelit.csv", build=write_text("NaN,None,01,TRUE\n1,2,3,4\n"),
    expect={"headers": ["NaN", "None", "01", "TRUE"], "nrows": 1, "cells": [(0, "01", *I(3))]})
add(id="D-NAME-trimmed", desc="names are trimmed", clause=C_NAMES, file="nametrim.csv",
    build=write_text(" q1 ,\tq2\n1,2\n"), expect={"headers": ["q1", "q2"], "nrows": 1})
add(id="D-NAME-dup-two", desc="q,q -> q, q (2)", clause=C_NAMES, file="dup2.csv",
    build=write_text("q,q\n1,2\n"), expect={"headers": ["q", "q (2)"], "cells": [(0, "q", *I(1)), (0, "q (2)", *I(2))]})
add(id="D-NAME-dup-literal-q2", desc="q,q,q (2) -> q, q (3), q (2): a literal 'q (2)' keeps its name and values",
    clause=C_NAMES, file="dup3.csv", build=write_text("q,q,q (2)\n1,2,3\n"),
    expect={"headers": ["q", "q (3)", "q (2)"], "cells": [(0, "q (3)", *I(2)), (0, "q (2)", *I(3))]})
add(id="D-NAME-dup-after-trim", desc="' q' and 'q' are the same name after trimming", clause=C_NAMES, file="duptrim.csv",
    build=write_text(" q,q\n1,2\n"), expect={"headers": ["q", "q (2)"]})
add(id="D-NAME-case-distinct", desc="Q and q are different names", clause=C_NAMES, file="casediff.csv",
    build=write_text("Q,q\n1,2\n"), expect={"headers": ["Q", "q"]})
add(id="D-NAME-unicode-long", desc="non-ASCII and 300-character names kept", clause=C_NAMES, file="longname.csv",
    build=write_text("Région," + "x" * 300 + "\n1,2\n"), expect={"headers": ["Région", "x" * 300]})
add(id="D-NAME-empty-middle", desc="an empty header name between two named columns", clause=C_NAMES, file="emptyname.csv",
    build=write_text("a,,c\n1,2,3\n"), expect={},
    question="An empty header name in rows-as-cases: the contract names a blank flipped name 'Variable n' but says nothing for a blank column header. Should it become 'Variable 2' (as flipped), stay '', or be refused?")
add(id="D-NAME-two-empty", desc="two empty header names", clause=C_NAMES, file="twoempty.csv",
    build=write_text("a,,,d\n1,2,3,4\n"), expect={},
    question="Two empty names are allocated '' and ' (2)' by the dedupe rule. Is ' (2)' an acceptable variable name?")
add(id="D-NAME-trailing-sep-header", desc="header and rows both end with a separator (common Excel export)",
    clause=C_NAMES, file="trailhdr.csv", build=write_text("a,b,\n1,2,\n3,4,\n"), expect={},
    question="A trailing separator on the header creates a third, empty-named, all-missing variable. Should a column with an empty name and no values be dropped (as an empty row is)?")
add(id="D-NAME-numeric", desc="numeric-looking names stay text names", clause=C_NAMES, file="numname.csv",
    build=write_text("2024,1.50\n1,2\n"), expect={"headers": ["2024", "1.50"]})

# ---------------------------------------------------------------- 6. number spellings (one case each)

NUMBER_SPELLINGS = [
    # (spelling, expected reading of that cell or "text")
    ("0", I(0)), ("5", I(5)), ("-5", I(-5)), ("-0", I(0)), ("123456789", I(123456789)),
    ("0.1", F(0.1)), ("2.50", F(2.5)), ("-0.5", F(-0.5)), (".5", F(0.5)), ("5.", F(5.0)),
    ("1e3", F(1000.0)), ("1E3", F(1000.0)), ("1e-2", F(0.01)), ("1.5e2", F(150.0)), ("-2.5E-3", F(-0.0025)),
    ("9007199254740992", I(9007199254740992)), ("-9007199254740992", I(-9007199254740992)),
    ("9007199254740992.0", F(9007199254740992.0)),
    ("001", "text"), ("00", "text"), ("-01", "text"), ("00.5", "text"), ("+2", "text"), ("+2.5", "text"),
    ("1,234", "text"), ("1 234", "text"), ("1 234", "text"), ("1'234", "text"),
    ("45%", "text"), ("$5", "text"), ("R100", "text"), ("5kg", "text"),
    ("inf", "text"), ("-inf", "text"), ("Infinity", "text"), ("0x1A", "text"), ("1_000", "text"),
    ("−5", "text"), ("٣", "text"), ("1.2.3", "text"), ("5-", "text"), ("1/2", "text"),
    ("9007199254740993", "text"), ("-9007199254740993", "text"), ("9007199254740994.0", "text"),
    ("9.007199254740993e15", "text"), ("1e16", "text"), ("1e30", "text"), ("-1e16", "text"),
    ("0.12345678901234567890", "text"), ("1e-400", "text"), ("1e400", "text"),
    ("3,5", "text"), ("-0,5", "text"), ("1.234,5", "text"),
]
for i, (sp, exp) in enumerate(NUMBER_SPELLINGS):
    safe = re.sub(r"[^A-Za-z0-9]+", "_", sp.encode("ascii", "backslashreplace").decode())[:24] or "x"
    text = "v\n" + csv_line([sp], ",") + "\n1\n"
    if exp == "text":
        cells = [(0, "v", *S(sp)), (1, "v", *S("1"))]
        types = {"v": "str"}
        clause = C_BIG if ("e" in sp.lower() and any(c.isdigit() for c in sp)) or len(sp.strip("-")) >= 16 else C_TYPES
    else:
        whole = exp[0] == "int"
        cells = [(0, "v", *exp), (1, "v", *(I(1) if whole else F(1.0)))]
        types = {"v": "int" if whole else "float"}
        clause = C_TYPES
    add(id=f"D-NUM-{i:02d}-{safe}", desc=f"number spelling {sp!r} beside a plain 1", clause=clause,
        file=f"num_{i:02d}.csv", build=write_text(text), expect={"headers": ["v"], "nrows": 2, "cells": cells, "types": types})

add(id="D-NUM-big-makes-column-text", desc="one value beyond 2^53 makes the whole variable text; small values keep their spelling",
    clause=C_BIG, file="bigcol.csv", build=write_text("v\n12\n9007199254740993\n007\n"),
    expect={"nrows": 3, "cells": [(0, "v", *S("12")), (1, "v", *S("9007199254740993")), (2, "v", *S("007"))]})
add(id="D-NUM-big-distinct", desc="two identifiers differing beyond 2^53 stay distinct", clause=C_BIG, file="bigdistinct.csv",
    build=write_text("acct\n9007199254740993\n9007199254740992\n"),
    expect={"nrows": 2, "cells": [(0, "acct", *S("9007199254740993")), (1, "acct", *S("9007199254740992"))]})
add(id="D-NUM-gap-float", desc="whole numbers with a gap are float with the gap missing", clause=C_TYPES, file="gap.csv",
    build=write_text("v,w\n1,a\n,b\n3,c\n"), expect={"nrows": 3, "cells": [(0, "v", *F(1.0)), (1, "v", *NULL)], "types": {"v": "float"}})
add(id="D-NUM-mixed-text", desc="numbers mixed with a word: the variable is text exactly as written",
    clause=C_TYPES, file="mixed.csv", build=write_text("v\n1\n2.50\nabc\n"),
    expect={"nrows": 3, "cells": [(0, "v", *S("1")), (1, "v", *S("2.50")), (2, "v", *S("abc"))]})
add(id="D-NUM-codes-distinct", desc="001, 1, 0001 and +2 stay four codes (IP1000-F01)", clause=C_TYPES, file="codes.csv",
    build=write_text("code\n001\n1\n0001\n+2\n"),
    expect={"nrows": 4, "cells": [(0, "code", *S("001")), (1, "code", *S("1")), (2, "code", *S("0001")), (3, "code", *S("+2"))]})
add(id="D-NUM-padded-space", desc="numbers written with spaces around them (' 5')", clause=C_TYPES, file="spaced.csv",
    build=write_text("v\n 5\n6 \n"), expect={},
    question="' 5' and '6 ' (spaces around a number): the contract says numeric 'only when every value is a plain decimal number' and text is kept 'exactly as written'. Are padded numbers numbers (5, 6) or text (' 5', '6 ')?")
add(id="D-NUM-semicolon-decimal-comma", desc="semicolon file with decimal commas: values stay text as written",
    clause=C_TYPES + " (no thousands separators; anything else is text exactly as written)", file="dcomma.csv",
    build=write_text("id;score;weight\n1;3,5;1,25\n2;4;0,75\n"),
    expect={"headers": ["id", "score", "weight"], "nrows": 2,
            "cells": [(0, "score", *S("3,5")), (1, "score", *S("4")), (0, "weight", *S("1,25")), (0, "id", *S("1"))]})
add(id="D-NUM-european-thousands-dot", desc="1.234 (European thousands) reads as the decimal 1.234 by the stated rule",
    clause=C_TYPES, file="eurothousands.csv", build=write_text("v;w\n1.234;a\n2.500;b\n"),
    expect={"nrows": 2, "cells": [(0, "v", *F(1.234)), (1, "v", *F(2.5))]})
add(id="D-NUM-whitespace-text", desc="text with surrounding spaces is kept exactly as written", clause=C_TYPES, file="wstext.csv",
    build=write_text("v\n  abc \nx\n"), expect={"nrows": 2, "cells": [(0, "v", *S("  abc "))]})

# ---------------------------------------------------------------- 7. missing markers

for i, tok in enumerate(sorted(PANDAS_NA_TOKENS - {""}) + ["", " NA ", "N/A  "]):
    safe = re.sub(r"[^A-Za-z0-9]+", "_", tok) or "blank"
    add(id=f"D-MISS-token-{i:02d}-{safe}", desc=f"missing token {tok!r} beside 5 and 7", clause=C_MISS,
        file=f"miss_{i:02d}.csv", build=write_text("v,w\n5,a\n" + csv_line([tok], ",") + ",b\n7,c\n"),
        expect={"nrows": 3, "cells": [(1, "v", *NULL), (0, "v", *F(5.0)), (2, "v", *F(7.0))], "types": {"v": "float"}})
for i, tok in enumerate([".", "-", "na", "Na", "none", "NONE", "N.A.", "missing", "?", "#VALUE!", "99", "98", "-99"]):
    safe = re.sub(r"[^A-Za-z0-9]+", "_", tok) or "x"
    numeric = tok.lstrip("-").isdigit()
    if numeric:
        cells = [(1, "v", *I(int(tok))), (0, "v", *I(5))]
        types = {"v": "int"}
    else:
        cells = [(1, "v", *S(tok)), (0, "v", *S("5"))]
        types = {"v": "str"}
    add(id=f"D-MISS-notoken-{i:02d}-{safe}", desc=f"{tok!r} is not a declared missing token: kept as a value",
        clause=C_MISS + " (only blank, library missing or a listed token is missing)", file=f"notok_{i:02d}.csv",
        build=write_text("v,w\n5,a\n" + tok + ",b\n7,c\n"), expect={"nrows": 3, "cells": cells, "types": types})
add(id="D-MISS-namibia", desc="country code column with NA (Namibia) beside ZA and BW", clause=C_MISS, file="namibia.csv",
    build=write_text("country\nZA\nNA\nBW\n"), expect={},
    question="'NA' is Namibia's ISO code. By the declared token list it is read as missing, silently dropping Namibian cases from every base. Keep the policy, make it per-variable, or warn when NA appears beside other two-letter codes?")
add(id="D-MISS-name-not-token", desc="a header literally 'NA' is a name, not missing", clause=C_NAMES + "; names never put through missing",
    file="naname.csv", build=write_text("NA,b\n1,2\n"), expect={"headers": ["NA", "b"], "cells": [(0, "NA", *I(1))]})

# ---------------------------------------------------------------- 8. dates, booleans, identifiers in CSV

add(id="D-DATE-text", desc="CSV date and time text stays as written; no date columns", clause=C_DATES + " (CSV date text stays as written)",
    file="dates.csv", build=write_text("d,t,dt\n2024-01-15,10:30,15/01/2024 10:30\n2024-02-29,23:59:59,01/02/2024\n"),
    expect={"nrows": 2, "cells": [(0, "d", *S("2024-01-15")), (0, "t", *S("10:30")), (0, "dt", *S("15/01/2024 10:30"))], "dateColumns": []})
add(id="D-BOOL-text", desc="CSV TRUE/FALSE are text", clause=C_TYPES + " (CSV TRUE/FALSE are text)", file="bools.csv",
    build=write_text("b,c\nTRUE,true\nFALSE,false\n"),
    expect={"nrows": 2, "cells": [(0, "b", *S("TRUE")), (1, "b", *S("FALSE")), (0, "c", *S("true"))], "types": {"b": "str", "c": "str"}})
add(id="D-BOOL-mixed-01", desc="CSV TRUE beside 1 and 0: text, so TRUE is not counted as 1", clause=C_TYPES, file="bool01.csv",
    build=write_text("b\nTRUE\n1\n0\n"), expect={"nrows": 3, "cells": [(0, "b", *S("TRUE")), (1, "b", *S("1"))]})
for i, name in enumerate(["ID", "Respondent ID", "Case_ID", "RespID", "UUID", "respondent_id", "CaseId"]):
    add(id=f"D-ID-{i}-{re.sub('[^A-Za-z]', '', name)}", desc=f"identifier-like name {name!r} keeps values as literal text",
        clause=C_TYPES + " (an identifier-like name keeps every value as literal text)", file=f"id_{i}.csv",
        build=write_text(f"{name},q\n001,1\n2,2\n0003,3\n"),
        expect={"nrows": 3, "cells": [(0, name, *S("001")), (1, name, *S("2")), (2, name, *S("0003"))], "types": {name: "str", "q": "int"}})
for i, name in enumerate(["Valid", "Avoid", "Solid", "Idea", "Bid price"]):
    add(id=f"D-NOTID-{i}-{re.sub('[^A-Za-z]', '', name)}", desc=f"{name!r} is not an identifier name: numbers typed",
        clause=C_TYPES + " (_is_id_like_header, whole-token match)", file=f"notid_{i}.csv",
        build=write_text(f"{name}\n1\n2\n"), expect={"nrows": 2, "cells": [(0, name, *I(1))], "types": {name: "int"}})

# ---------------------------------------------------------------- 9. columns-as-cases (flipped) for CSV

def flipped_case(cid, desc, rows_truth, expect, clause=C_LAYOUT, question=None, ext=".csv"):
    """rows_truth is the rows-as-cases truth (header + case rows); the file is its transpose."""
    add(id=cid, desc=desc, clause=clause, file=cid.lower() + ext,
        build=write_text(csv_text(flip(rows_truth), ",")), args={"layout": "columns_are_cases"},
        expect=expect, question=question)


flipped_case("L-FLIP-base", "base truth written as columns-as-cases reads the same as rows-as-cases",
             [BASE_HEADERS] + BASE_ROWS, BASE_EXPECT)
flipped_case("L-FLIP-names-literal", "flipped names NaN, 01, TRUE stay names",
             [["NaN", "01", "TRUE"], ["1", "2", "3"], ["4", "5", "6"]],
             {"headers": ["NaN", "01", "TRUE"], "nrows": 2, "cells": [(1, "01", *I(5))]})
flipped_case("L-FLIP-dup", "flipped repeated names q, q, q (2) -> q, q (3), q (2)",
             [["q", "q", "q (2)"], ["1", "2", "3"]],
             {"headers": ["q", "q (3)", "q (2)"], "cells": [(0, "q (3)", *I(2)), (0, "q (2)", *I(3))]}, clause=C_NAMES + "; " + C_LAYOUT)
add(id="L-FLIP-blank-name", desc="flipped variable row with a blank name becomes 'Variable n'", clause=C_LAYOUT + " (blank name -> Variable n)",
    file="l-flip-blank-name.csv", build=write_text("var,c1,c2\nage,30,40\n,1,2\ngender,1,2\n"), args={"layout": "columns_are_cases"},
    expect={"headers": ["age", "Variable 2", "gender"], "nrows": 2, "cells": [(1, "Variable 2", *I(2))]})
add(id="L-FLIP-empty-row-skipped", desc="flipped variable row with no name and no values is skipped", clause=C_MISS,
    file="l-flip-empty.csv", build=write_text("var,c1,c2\nage,30,40\n,,\ngender,1,2\n"), args={"layout": "columns_are_cases"},
    expect={"headers": ["age", "gender"], "nrows": 2})
add(id="L-FLIP-short-row", desc="flipped short variable row padded with missing", clause=C_LAYOUT + "; " + C_QUOTE,
    file="l-flip-short.csv", build=write_text("var,c1,c2,c3\nage,30,40,50\ngender,1\n"), args={"layout": "columns_are_cases"},
    expect={"headers": ["age", "gender"], "nrows": 3, "cells": [(0, "gender", *F(1.0)), (2, "gender", *NULL)]})
add(id="L-FLIP-id-row", desc="flipped identifier row keeps leading zeros", clause=C_TYPES + "; " + C_LAYOUT,
    file="l-flip-id.csv", build=write_text("field,c1,c2\nRespondent ID,001,002\nq1,5,6\n"), args={"layout": "columns_are_cases"},
    expect={"headers": ["Respondent ID", "q1"], "nrows": 2, "cells": [(0, "Respondent ID", *S("001")), (1, "q1", *I(6))]})
add(id="L-FLIP-empty-case", desc="flipped file where one case column is entirely empty", clause=C_LAYOUT,
    file="l-flip-emptycase.csv", build=write_text("var,c1,c2,c3\nage,30,,50\ngender,1,,2\n"), args={"layout": "columns_are_cases"},
    expect={},
    question="Rows-as-cases drops a case with nothing but missing cells; the flipped reader keeps an all-empty case column (contract only says empty VARIABLE rows are skipped). Should an all-empty case be dropped in the flipped layout too, so the case count matches the same data in rows-as-cases?")
add(id="L-FLIP-trailing-sep", desc="flipped file where every line ends with a separator", clause=C_LAYOUT,
    file="l-flip-trail.csv", build=write_text("var,c1,c2,\nage,30,40,\ngender,1,2,\n"), args={"layout": "columns_are_cases"},
    expect={},
    question="A trailing separator on every line of a flipped file adds a phantom fourth case with no values. Same question as L-FLIP-empty-case.")
add(id="L-FLIP-tsv", desc="flipped .tsv", clause=C_LAYOUT, file="l-flip.tsv",
    build=write_text(csv_text(flip([BASE_HEADERS] + BASE_ROWS), "\t")), args={"layout": "columns_are_cases"}, expect=BASE_EXPECT)
add(id="L-BADLAYOUT", desc="an unknown layout value is refused", clause="read_table docstring (layout rows_are_cases or columns_are_cases)",
    file="badlayout.csv", build=write_text("a\n1\n"), args={"layout": "sideways"}, expect={"refuse": ["unknown data layout"]})
add(id="L-ROWS-explicit", desc="layout rows_are_cases explicitly given equals the default", clause=C_LAYOUT,
    file="rowsexplicit.csv", build=write_text(csv_text([BASE_HEADERS] + BASE_ROWS)), args={"layout": "rows_are_cases"}, expect=BASE_EXPECT)


# ---------------------------------------------------------------- 10. Excel (.xlsx via openpyxl, .xls via xlwt)

def xlsx(sheets, after=None, patch=None):
    """sheets: list of (name, rows, options). rows are lists of cell values (None = empty).
    options: formats {(r,c): fmt}, hidden_rows, hidden_cols, merges."""
    def build(path):
        import openpyxl
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for name, rows, opts in sheets:
            ws = wb.create_sheet(name)
            for r, row in enumerate(rows, start=1):
                for c, v in enumerate(row, start=1):
                    if v is not None:
                        ws.cell(row=r, column=c, value=v)
            for (r, c), fmt in (opts.get("formats") or {}).items():
                ws.cell(row=r, column=c).number_format = fmt
            for r in opts.get("hidden_rows", []):
                ws.row_dimensions[r].hidden = True
            for col in opts.get("hidden_cols", []):
                ws.column_dimensions[col].hidden = True
            for m in opts.get("merges", []):
                ws.merge_cells(m)
        wb.save(path)
        if patch:
            patch_xlsx(path, patch)
    return build


def patch_xlsx(path, replacements):
    """Write cached formula results into sheet1.xml (openpyxl writes formulas with no cached value)."""
    with zipfile.ZipFile(path) as zin:
        items = {n: zin.read(n) for n in zin.namelist()}
    xml = items["xl/worksheets/sheet1.xml"].decode()
    for old, new in replacements:
        assert old in xml, old
        xml = xml.replace(old, new)
    items["xl/worksheets/sheet1.xml"] = xml.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for n, b in items.items():
            zout.writestr(n, b)


def xls(sheets):
    def build(path):
        import xlwt
        wb = xlwt.Workbook()
        for name, rows, opts in sheets:
            ws = wb.add_sheet(name)
            for r, row in enumerate(rows):
                for c, v in enumerate(row):
                    if v is None:
                        continue
                    fmt = (opts.get("formats") or {}).get((r + 1, c + 1))
                    if fmt:
                        ws.write(r, c, v, xlwt.easyxf(num_format_str=fmt))
                    else:
                        ws.write(r, c, v)
        wb.save(path)
    return build


D = datetime.datetime
X_BASE = [["id", "age", "name", "score"], ["001", 34, "Ann", 3.5], ["002", 45, "Bob", 4.25], ["010", 29, "Cee", 2.0]]
X_BASE_EXPECT = {**BASE_EXPECT, "cells": [c for c in BASE_EXPECT["cells"] if c[1] != "score"] + [(0, "score", *F(3.5)), (2, "score", *NUM(2.0))],
                 "types": {"id": "str", "age": "int", "name": "str"}, "sheetName": "Data"}

for ext, builder in ((".xlsx", xlsx), (".xls", xls)):
    e = ext[1:]
    add(id=f"X-{e}-base", desc=f"{ext} plain data sheet: text ids, whole numbers, text, decimals", clause=C_EXCEL,
        file=f"base.{e}", build=builder([("Data", X_BASE, {})]), expect=X_BASE_EXPECT)
    add(id=f"X-{e}-date", desc=f"{ext} date cells become ISO dates and the variable is a date column", clause=C_DATES,
        file=f"date.{e}", build=builder([("Data", [["d", "q"], [D(2024, 1, 15), 1], [D(2023, 12, 31), 2]],
                                           {"formats": {(2, 1): "yyyy-mm-dd", (3, 1): "yyyy-mm-dd"}})]),
        expect={"headers": ["d", "q"], "nrows": 2, "cells": [(0, "d", *S("2024-01-15")), (1, "d", *S("2023-12-31"))], "dateColumns": ["d"]})
    add(id=f"X-{e}-datetime", desc=f"{ext} date-time cells become ISO date-times", clause=C_DATES,
        file=f"datetime.{e}", build=builder([("Data", [["dt"], [D(2024, 1, 15, 10, 30)], [D(2024, 1, 16, 0, 0, 5)]],
                                              {"formats": {(2, 1): "yyyy-mm-dd hh:mm", (3, 1): "yyyy-mm-dd hh:mm:ss"}})]),
        expect={"nrows": 2, "cells": [(0, "dt", *S("2024-01-15T10:30:00")), (1, "dt", *S("2024-01-16T00:00:05"))], "dateColumns": ["dt"]})
    add(id=f"X-{e}-bool", desc=f"{ext} logical cells only: stay logical", clause=C_TYPES + " (Excel logical cells stay logical)",
        file=f"bool.{e}", build=builder([("Data", [["b"], [True], [False], [True]], {})]),
        expect={"nrows": 3, "cells": [(0, "b", *B(True)), (1, "b", *B(False))], "types": {"b": "bool"}})
    add(id=f"X-{e}-bool-mixed-01", desc=f"{ext} logical cells beside 1 and 0: logical as TRUE/FALSE text, numbers stay numbers (CAL-R1-F03)",
        clause=C_TYPES + " (logical in a mixed variable is stored as its text)", file=f"boolmix.{e}",
        build=builder([("Data", [["b"], [True], [1], [False], [0]], {})]),
        expect={"nrows": 4, "cells": [(0, "b", *S("TRUE")), (1, "b", *I(1)), (2, "b", *S("FALSE")), (3, "b", *I(0))]})
    add(id=f"X-{e}-mixed-text-number", desc=f"{ext} text and number cells in one variable keep their own types",
        clause=C_TYPES + " (Excel text and number cells keep their own types)", file=f"mixtn.{e}",
        build=builder([("Data", [["v"], [5], ["abc"], [2.5]], {})]),
        expect={"nrows": 3, "cells": [(0, "v", *I(5)), (1, "v", *S("abc")), (2, "v", *F(2.5))]})
    add(id=f"X-{e}-text-001", desc=f"{ext} text cell '001' in a non-id column stays '001'", clause=C_TYPES,
        file=f"text001.{e}", build=builder([("Data", [["code"], ["001"], ["1"]], {})]),
        expect={"nrows": 2, "cells": [(0, "code", *S("001")), (1, "code", *S("1"))]})
    add(id=f"X-{e}-na-tokens", desc=f"{ext} NA text cells and blanks are missing", clause=C_MISS,
        file=f"natok.{e}", build=builder([("Data", [["v", "w"], [1, "a"], ["NA", "b"], [None, "c"], [4, "d"]], {})]),
        expect={"nrows": 4, "cells": [(1, "v", *NULL), (2, "v", *NULL), (3, "v", *F(4.0))], "types": {"v": "float"}})
    add(id=f"X-{e}-blank-row-middle", desc=f"{ext} an empty row in the middle is not a case", clause=C_MISS,
        file=f"blankmid.{e}", build=builder([("Data", [["v"], [1], [None], [3]], {})]),
        expect={"nrows": 2, "cells": [(1, "v", *I(3))]})
    add(id=f"X-{e}-ragged", desc=f"{ext} a row shorter than the header is padded", clause=C_EXCEL + " (rows padded to the widest)",
        file=f"ragged.{e}", build=builder([("Data", [["a", "b", "c"], [1, 2, 3], [4]], {})]),
        expect={"nrows": 2, "cells": [(1, "b", *NULL), (1, "a", *I(4))]})
    add(id=f"X-{e}-header-types", desc=f"{ext} header cells that are numbers, logical and dates become text names", clause=C_NAMES,
        file=f"hdrtypes.{e}", build=builder([("Data", [[2024, 1.5, True, " q "], [1, 2, 3, 4]], {})]),
        expect={"headers": ["2024", "1.5", "TRUE", "q"], "nrows": 1})
    add(id=f"X-{e}-header-date", desc=f"{ext} a date cell as a header becomes its ISO date", clause=C_NAMES,
        file=f"hdrdate.{e}", build=builder([("Data", [["q", D(2024, 3, 1)], [1, 2]], {"formats": {(1, 2): "yyyy-mm-dd"}})]),
        expect={"headers": ["q", "2024-03-01"], "nrows": 1})
    add(id=f"X-{e}-dup-names", desc=f"{ext} repeated header names allocated q, q (3), q (2)", clause=C_NAMES,
        file=f"dup.{e}", build=builder([("Data", [["q", "q", "q (2)"], [1, 2, 3]], {})]),
        expect={"headers": ["q", "q (3)", "q (2)"], "cells": [(0, "q (3)", *I(2))]})
    add(id=f"X-{e}-multi-sheet-most-rows", desc=f"{ext} two data sheets: the one with more real data rows is read", clause=C_SHEET,
        file=f"multi.{e}", build=builder([("Small", [["a"], [1]], {}), ("Large", [["b"], [1], [2], [3]], {})]),
        expect={"headers": ["b"], "nrows": 3, "sheetName": "Large"})
    add(id=f"X-{e}-dict-sheet-larger", desc=f"{ext} a Variables dictionary sheet with more rows than the data is not chosen", clause=C_SHEET,
        file=f"dictsheet.{e}",
        build=builder([("Variables", [["Variable", "Label"], ["q1", "Satisfaction"], ["q2", "Recommend"], ["q3", "Other"], ["q4", "More"]], {}),
                       ("Data", [["q1", "q2"], [1, 2], [3, 4]], {})]),
        expect={"headers": ["q1", "q2"], "nrows": 2, "sheetName": "Data", "var_labels": {"q1": "Satisfaction", "q2": "Recommend"}})
    add(id=f"X-{e}-value-label-sheet", desc=f"{ext} a [Variable, Value, Value label] sheet labels coded answers", clause=C_LABELSHEET,
        file=f"vlsheet.{e}",
        build=builder([("Data", [["gender", "q1"], [1, 5], [2, 4]], {}),
                       ("Values", [["Variable", "Value", "Value label"], ["gender", 1, "Male"], ["gender", 2, "Female"]], {})]),
        expect={"headers": ["gender", "q1"], "nrows": 2, "sheetName": "Data", "value_labels": {"gender": {1: "Male", 2: "Female"}}})
    add(id=f"X-{e}-selected-sheet", desc=f"{ext} a persisted sheet choice is used even if smaller", clause=C_SHEET,
        file=f"selsheet.{e}", build=builder([("Small", [["a"], [1]], {}), ("Large", [["b"], [1], [2], [3]], {})]),
        args={"selectedSheet": "Small"}, expect={"headers": ["a"], "nrows": 1, "sheetName": "Small"})
    add(id=f"X-{e}-selected-sheet-gone", desc=f"{ext} a persisted sheet that no longer exists: sheetSelectionLost, never substituted", clause=C_SHEET,
        file=f"selgone.{e}", build=builder([("Small", [["a"], [1]], {}), ("Large", [["b"], [1], [2], [3]], {})]),
        args={"selectedSheet": "Wave 1"}, expect={"sheetSelectionLost": {"documentSheetName": "Wave 1", "availableSheets": ["Small", "Large"]}})
    add(id=f"X-{e}-flip", desc=f"{ext} columns-as-cases sheet reads as the rows truth", clause=C_LAYOUT,
        file=f"flip.{e}", build=builder([("Data", flip(X_BASE), {})]),
        args={"layout": "columns_are_cases"}, expect={k: v for k, v in X_BASE_EXPECT.items()})
    add(id=f"X-{e}-flip-date", desc=f"{ext} columns-as-cases with a date variable row", clause=C_LAYOUT + "; " + C_DATES,
        file=f"flipdate.{e}", build=builder([("Data", [["var", "c1", "c2"], ["visit", D(2024, 5, 1), D(2024, 5, 2)], ["q", 1, 2]],
                                                    {"formats": {(2, 2): "yyyy-mm-dd", (2, 3): "yyyy-mm-dd"}})]),
        args={"layout": "columns_are_cases"},
        expect={"headers": ["visit", "q"], "nrows": 2, "cells": [(1, "visit", *S("2024-05-02"))], "dateColumns": ["visit"]})

# xlsx-only cases (formats, formulas, hidden, merged, title rows, identifier formats)
add(id="X-xlsx-number-formats", desc="formatted numbers read as the stored values (percent, thousands, currency)", clause=C_EXCEL + " (cells as the workbook holds them)",
    file="numfmt.xlsx", build=xlsx([("Data", [["pct", "thou", "cur"], [0.45, 1234, 1234.5], [0.5, 99, 10]],
                                    {"formats": {(2, 1): "0%", (3, 1): "0%", (2, 2): "#,##0", (3, 2): "#,##0", (2, 3): '"R"#,##0.00', (3, 3): '"R"#,##0.00'}})]),
    expect={"nrows": 2, "cells": [(0, "pct", *F(0.45)), (0, "thou", *I(1234)), (0, "cur", *F(1234.5)), (1, "cur", *NUM(10))]})
add(id="X-xlsx-date-formatted-number", desc="a number with a date format is a calendar value", clause=C_DATES,
    file="datenum.xlsx", build=xlsx([("Data", [["d"], [45306]], {"formats": {(2, 1): "dd/mm/yyyy"}})]),
    expect={"nrows": 1, "cells": [(0, "d", *S("2024-01-15"))], "dateColumns": ["d"]})
add(id="X-xlsx-number-no-date-format", desc="the serial number 45306 with no date format stays a number", clause=C_DATES + " (a number with no date format stays a number)",
    file="serial.xlsx", build=xlsx([("Data", [["d"], [45306]], {})]), expect={"nrows": 1, "cells": [(0, "d", *I(45306))], "dateColumns": []})
add(id="X-xlsx-time-only", desc="a time-of-day cell becomes HH:MM:SS", clause=C_DATES,
    file="time.xlsx", build=xlsx([("Data", [["t"], [datetime.time(10, 30)]], {"formats": {(2, 1): "hh:mm:ss"}})]),
    expect={"nrows": 1, "cells": [(0, "t", *S("10:30:00"))], "dateColumns": ["t"]})
add(id="X-xlsx-date-with-text", desc="a date column with one text cell 'unknown'", clause=C_DATES,
    file="datetext.xlsx", build=xlsx([("Data", [["d"], [D(2024, 1, 15)], ["unknown"], [None]], {"formats": {(2, 1): "yyyy-mm-dd"}})]),
    expect={"nrows": 2, "cells": [(0, "d", *S("2024-01-15")), (1, "d", *S("unknown"))], "dateColumns": ["d"]})
add(id="X-xlsx-text-date", desc="a date written as text in Excel stays text, not a date column", clause=C_DATES,
    file="textdate.xlsx", build=xlsx([("Data", [["d"], ["2024-01-15"]], {})]),
    expect={"nrows": 1, "cells": [(0, "d", *S("2024-01-15"))], "dateColumns": []})
add(id="X-xlsx-formula-cached", desc="formulas with cached values read as their cached values", clause=C_EXCEL + " (cells as the workbook holds them)",
    file="formula.xlsx", build=xlsx([("Data", [["a", "b", "c"], [2, "=A2*2", '=IF(A2>1,"hi","lo")'], [3, "=A3*2", '=IF(A3>5,"hi","lo")']], {})],
                                    patch=[("<f>A2*2</f><v></v>", "<f>A2*2</f><v>4</v>"), ("<f>A3*2</f><v></v>", "<f>A3*2</f><v>6</v>"),
                                           ('<c r="C2"><f>IF(A2&gt;1,"hi","lo")</f><v></v>', '<c r="C2" t="str"><f>IF(A2&gt;1,"hi","lo")</f><v>hi</v>'),
                                           ('<c r="C3"><f>IF(A3&gt;5,"hi","lo")</f><v></v>', '<c r="C3" t="str"><f>IF(A3&gt;5,"hi","lo")</f><v>lo</v>')]),
    expect={"nrows": 2, "cells": [(0, "b", *I(4)), (1, "b", *I(6)), (0, "c", *S("hi")), (1, "c", *S("lo"))]})
add(id="X-xlsx-formula-nocache", desc="formulas saved without cached values (written by a library, never opened in Excel)",
    clause=C_EXCEL, file="formulanocache.xlsx", build=xlsx([("Data", [["a", "b"], [2, "=A2*2"], [3, "=A3*2"]], {})]), expect={},
    question="A formula with no cached value reads as blank, so the variable silently becomes all-missing. Should the reader refuse (ask to open and save in Excel) rather than read blanks?")
add(id="X-xlsx-error-cells", desc="#DIV/0! and #N/A error cells are missing", clause="_excel_sheet_grid docstring (an error cell NaN); " + C_MISS,
    file="errcells.xlsx", build=xlsx([("Data", [["v", "w"], [1, "a"], ["#DIV/0!", "b"], ["#N/A", "c"], [4, "d"]], {})]),
    expect={"nrows": 4, "cells": [(1, "v", *NULL), (2, "v", *NULL), (0, "v", *F(1.0))]})
add(id="X-xlsx-hidden", desc="hidden rows and columns are read as data", clause=C_EXCEL + " (cells as the workbook holds them)",
    file="hidden.xlsx", build=xlsx([("Data", [["a", "b", "c"], [1, 2, 3], [4, 5, 6], [7, 8, 9]], {"hidden_rows": [3], "hidden_cols": ["B"]})]),
    expect={"headers": ["a", "b", "c"], "nrows": 3, "cells": [(1, "b", *I(5))]},
    question=None)
add(id="X-xlsx-merged-header", desc="merged two-row header (Q1 spanning B1:C1, sub-headers in row 2)", clause=C_EXCEL,
    file="merged.xlsx", build=xlsx([("Data", [["id", "Q1", None], [None, "Brand A", "Brand B"], ["001", 1, 0], ["002", 0, 1]], {"merges": ["B1:C1"]})]),
    expect={},
    question="Merged and multi-row headers are not in the contract (the first row is the header). Observed reading is recorded; should these be refused, or headers combined ('Q1 Brand A')?")
add(id="X-xlsx-title-rows", desc="two title rows ('Customer survey 2024', blank) above the real header", clause=C_EXCEL,
    file="title.xlsx", build=xlsx([("Data", [["Customer survey 2024"], [None], ["id", "q1"], ["001", 5], ["002", 4]], {})]),
    expect={},
    question="Title rows above the header are not in the contract. The first row becomes the header and the real header a case. Refuse, detect the header row, or let the researcher pick it?")
add(id="X-xlsx-leading-blank-row", desc="data starts on row 2 with row 1 empty", clause=C_EXCEL,
    file="leadblank.xlsx", build=xlsx([("Data", [[None], ["a", "b"], [1, 2]], {})]), expect={},
    question="CSV skips blank lines before the header; Excel keeps blank rows. With row 1 empty, is the header row 1 (all names empty) or row 2?")
add(id="X-xlsx-leading-blank-col", desc="data starts in column B with column A empty", clause=C_EXCEL,
    file="leadcol.xlsx", build=xlsx([("Data", [[None, "a", "b"], [None, 1, 2]], {})]), expect={},
    question="Column A empty: an empty-named, all-missing first variable, or the table starts at column B?")
add(id="X-xlsx-id-zero-pad", desc="identifier column number 7 formatted 0000 reads as 0007", clause=C_IDFMT,
    file="idpad.xlsx", build=xlsx([("Data", [["Respondent ID", "q"], [7, 1], [123, 2], [12345, 3]],
                                   {"formats": {(2, 1): "0000", (3, 1): "0000", (4, 1): "0000"}})]),
    expect={"nrows": 3, "cells": [(0, "Respondent ID", *S("0007")), (1, "Respondent ID", *S("0123")), (2, "Respondent ID", *S("12345"))],
            "unsupportedIdentifierColumns": []})
add(id="X-xlsx-id-other-format", desc="identifier column with a thousands format is blanked and reported", clause=C_IDFMT,
    file="idthou.xlsx", build=xlsx([("Data", [["ID", "q"], [1234, 1], [5678, 2]], {"formats": {(2, 1): "#,##0", (3, 1): "#,##0"}})]),
    expect={"nrows": 2, "cells": [(0, "ID", *NULL), (1, "ID", *NULL)], "unsupportedIdentifierColumns": ["ID"]})
add(id="X-xlsx-id-text-format", desc="identifier column of numbers carrying Excel's Text format '@' (number entered before the column was formatted as text)", clause=C_IDFMT + " (any other custom number format blanks the cell and is reported)",
    file="idtextfmt.xlsx", build=xlsx([("Data", [["ID", "q"], [1001, 1], [1002, 2]], {"formats": {(2, 1): "@", (3, 1): "@"}})]),
    expect={"nrows": 2, "cells": [(0, "ID", *NULL), (1, "ID", *NULL)], "unsupportedIdentifierColumns": ["ID"]},
    question="By the written rule the '@' (Text) format is 'any other custom number format', so every identifier is blanked (and reported). Excel shows 1001 and 1002 plainly. Should '@' be treated like General for identifiers?")
add(id="X-xlsx-nonid-zero-pad", desc="a 0000 format on a non-identifier column is not applied: number 7", clause=C_IDFMT,
    file="nonidpad.xlsx", build=xlsx([("Data", [["code"], [7], [8]], {"formats": {(2, 1): "0000", (3, 1): "0000"}})]),
    expect={"nrows": 2, "cells": [(0, "code", *I(7))], "unsupportedIdentifierColumns": []})
add(id="X-xlsx-id-general", desc="identifier column of plain numbers keeps them as text digits", clause=C_TYPES + "; " + C_IDFMT,
    file="idgeneral.xlsx", build=xlsx([("Data", [["CaseID", "q"], [7, 1], [8, 2]], {})]),
    expect={"nrows": 2, "cells": [(0, "CaseID", *S("7")), (1, "CaseID", *S("8"))]})
add(id="X-xlsx-id-zero-pad-offset", desc="zero-pad identifier format when the table starts at row 3 below title rows", clause=C_IDFMT,
    file="idpadoffset.xlsx",
    build=xlsx([("Data", [["ID", "q"], [7, 1], [8, 2], [None, None], [9, 3]], {"formats": {(2, 1): "0000", (3, 1): "0000", (5, 1): "0000"}})]),
    expect={"nrows": 3, "cells": [(0, "ID", *S("0007")), (1, "ID", *S("0008")), (2, "ID", *S("0009"))]})
add(id="X-xlsx-dict-only-name", desc="workbook whose only sheet is named 'Codes' is still read", clause=C_SHEET,
    file="codesonly.xlsx", build=xlsx([("Codes", [["a"], [1], [2]], {})]), expect={"headers": ["a"], "nrows": 2, "sheetName": "Codes"})
add(id="X-xlsx-data-sheet-named-value", desc="data sheet named 'Brand Value Tracker' (5 cases) beside a 'Sheet2' scratch sheet (1 row)",
    clause=C_SHEET, file="valuetracker.xlsx",
    build=xlsx([("Brand Value Tracker", [["q1"], [1], [2], [3], [4], [5]], {}), ("Sheet2", [["note"], ["x"]], {})]), expect={},
    question="The dictionary-sheet name rule matches 'value', 'code', 'notes', 'label' anywhere in a sheet name, so a data sheet called 'Brand Value Tracker' or 'Postcode data' is passed over for a smaller scratch sheet. Should the rule match whole words / known dictionary names only, or should data shape decide?")
add(id="X-xlsx-whitespace-cell", desc="a cell of spaces is missing", clause=C_MISS, file="wscell.xlsx",
    build=xlsx([("Data", [["v", "w"], [1, "a"], ["   ", "b"], [3, "c"]], {})]),
    expect={"nrows": 3, "cells": [(1, "v", *NULL)], "types": {"v": "float"}})
add(id="X-xlsx-big-int", desc="xlsx whole-number cell 9007199254740993 (beyond 2^53) is kept as exact text", clause=C_BIG + " (a whole-number Excel cell arrives as an int and is held to the same 2^53 rule; distinct written values never merge)",
    file="bigint.xlsx", build=xlsx([("Data", [["acct", "q"], [9007199254740993, 1], [9007199254740992, 2], [12, 3]], {})],
                                   patch=[('<c r="A2" t="n"><v>9007199254740992</v>', '<c r="A2" t="n"><v>9007199254740993</v>')]),
    expect={"nrows": 3, "cells": [(0, "acct", *S("9007199254740993")), (1, "acct", *S("9007199254740992"))], "json_distinct": "acct"})
add(id="X-xlsx-big-int-double", desc="xlsx whole-number double 1e20 (written 1e+20) held to the 2^53 rule: text", clause=C_BIG + " (a whole-number Excel cell arrives as an int and is held to the same 2^53 magnitude rule)",
    file="bigfloat.xlsx", build=xlsx([("Data", [["v"], [1e20], [2.5]], {})]), expect={"nrows": 2, "cells": [(0, "v", *S("100000000000000000000"))]})
add(id="X-xls-big-int", desc=".xls number cell beyond 2^53 (stored as a double)", clause=C_BIG, file="bigint.xls",
    build=xls([("Data", [["acct"], [9007199254740993], [12]], {})]), expect={},
    question="A .xls number cell is a double, so 9007199254740993 is already 9007199254740992 in the file; the reader cannot recover it. Should a whole number beyond 2^53 in a .xls identifier column be flagged as possibly rounded?")
add(id="X-xlsx-text-number-cells", desc="numbers stored as text cells ('5', '6') are numbers by the one rule", clause=C_TYPES,
    file="textnums.xlsx", build=xlsx([("Data", [["v"], ["5"], ["6"]], {})]), expect={"nrows": 2, "cells": [(0, "v", *I(5))], "types": {"v": "int"}})
add(id="X-xlsx-empty-sheet", desc="a workbook with one empty sheet", clause=C_EXCEL, file="emptysheet.xlsx",
    build=xlsx([("Data", [], {})]), expect={},
    question="An empty workbook reads as a table with no variables and no cases. Refuse with a message instead?")
add(id="X-xls-id-zero-pad", desc=".xls identifier column formatted 0000", clause=C_IDFMT, file="idpad.xls",
    build=xls([("Data", [["Respondent ID", "q"], [7, 1], [8, 2]], {"formats": {(2, 1): "0000", (3, 1): "0000"}})]), expect={},
    question="The contract says a zero-padding format on an identifier column is applied (0007), but the code comment says .xls format codes are not read, so 7 stays '7'. Is the .xls limit accepted (and should it be reported as unsupportedIdentifierColumns)?")

add(id="X-xlsx-1904-dates", desc="workbook on the 1904 date system: dates read as the workbook declares", clause=C_DATES + "; Limits (1904 read as declared)",
    file="d1904.xlsx", build=None, expect={"nrows": 2, "cells": [(0, "d", *S("2024-01-15")), (1, "d", *S("1904-01-02"))], "dateColumns": ["d"]})
add(id="X-xlsx-flip-big-int", desc="columns-as-cases xlsx with a whole-number cell beyond 2^53 in a variable row", clause=C_BIG + "; " + C_LAYOUT,
    file="flipbigint.xlsx", build=xlsx([("Data", [["var", "c1", "c2"], ["acct", 9007199254740993, 9007199254740992], ["q", 1, 2]], {})],
                                       patch=[('<c r="B2" t="n"><v>9007199254740992</v>', '<c r="B2" t="n"><v>9007199254740993</v>')]),
    args={"layout": "columns_are_cases"},
    expect={"headers": ["acct", "q"], "nrows": 2, "cells": [(0, "acct", *S("9007199254740993"))], "json_distinct": "acct"})
add(id="X-xlsx-flip-id-zero-pad", desc="columns-as-cases xlsx with an identifier row formatted 0000", clause=C_IDFMT + "; " + C_LAYOUT,
    file="flipidpad.xlsx", build=xlsx([("Data", [["var", "c1", "c2"], ["Respondent ID", 7, 8], ["q", 1, 2]],
                                        {"formats": {(2, 2): "0000", (2, 3): "0000"}})]),
    args={"layout": "columns_are_cases"},
    expect={"headers": ["Respondent ID", "q"], "nrows": 2, "cells": [(0, "Respondent ID", *S("0007")), (1, "Respondent ID", *S("0008"))]})
add(id="X-xlsx-number-and-text-1", desc="a variable holding number 1, text '1' and text 'abc'", clause=C_TYPES + " (Excel text and number cells keep their own types)",
    file="num1text1.xlsx", build=xlsx([("Data", [["v"], [1], ["1"], ["abc"]], {})]), expect={},
    question="Number 1 and text '1' in one Excel variable stay two types, so they are two categories that both display as '1'. Is that intended, or should a variable that is text anyway hold every cell as its text?")

# flipped workbook metadata guard
add(id="X-xlsx-flip-codebook-weight", desc="flipped workbook with a Codebook sheet declaring a weight is refused", clause=C_FLIPMETA,
    file="flipweight.xlsx",
    build=xlsx([("Data", [["var", "c1", "c2"], ["q1", 1, 2], ["wt", 1.2, 0.8]], {}),
                ("Codebook", [["Variable", "Label", "Weight"], ["wt", "Weight factor", "yes"]], {})]),
    args={"layout": "columns_are_cases"}, expect={"refuse": ["unsupported flipped workbook", "re-export"]})
add(id="X-xlsx-flip-codebook-mr", desc="flipped workbook with a codebook multiple-response set column filled is refused", clause=C_FLIPMETA,
    file="flipmr.xlsx",
    build=xlsx([("Data", [["var", "c1", "c2"], ["q1_1", 1, 0], ["q1_2", 0, 1]], {}),
                ("Codebook", [["Variable", "Label", "Multiple response set"], ["q1_1", "Brand A", "Q1"], ["q1_2", "Brand B", "Q1"]], {})]),
    args={"layout": "columns_are_cases"}, expect={"refuse": ["unsupported flipped workbook"]})
add(id="X-xlsx-flip-labels-only", desc="flipped workbook with a label-only codebook is read (labels not applied)", clause=C_FLIPMETA + " (label-only sheets allowed)",
    file="fliplabels.xlsx",
    build=xlsx([("Data", [["var", "c1", "c2"], ["q1", 1, 2], ["q2", 3, 4]], {}),
                ("Codebook", [["Variable", "Label"], ["q1", "Satisfaction"]], {})]),
    args={"layout": "columns_are_cases"}, expect={"headers": ["q1", "q2"], "nrows": 2, "sheetName": "Data"})
add(id="X-xlsx-flip-codebook-weight-role", desc="flipped workbook whose codebook Role column says 'weight' is refused", clause=C_FLIPMETA,
    file="fliprole.xlsx",
    build=xlsx([("Data", [["var", "c1", "c2"], ["q1", 1, 2], ["w", 1.2, 0.8]], {}),
                ("Codebook", [["Variable", "Label", "Role"], ["w", "Factor", "Weight"]], {})]),
    args={"layout": "columns_are_cases"}, expect={"refuse": ["unsupported flipped workbook"]})
add(id="X-not-a-workbook", desc="a text file named .xlsx is refused as not a spreadsheet", clause=C_EXCEL,
    file="fake.xlsx", build=write_text("a,b\n1,2\n"), expect={"refuse": ["doesn't parse as a spreadsheet"]})
add(id="X-unsupported-ext", desc="a .xlsm extension is not a plain table format", clause="read_table: only CSV, TSV, .txt and Excel (.xlsx, .xls)",
    file="macro.ods", build=write_text("a\n1\n"), expect={"refuse": ["only csv, tsv"]})


# ---------------------------------------------------------------- 11. stats files (pyreadstat writers)

def stats_writer(fmt, frame_fn, **kw):
    def build(path):
        import pyreadstat
        df = frame_fn()
        if fmt in ("sav", "zsav"):
            pyreadstat.write_sav(df, path, compress=(fmt == "zsav"), **kw)
        elif fmt == "dta":
            pyreadstat.write_dta(df, path, **kw)
        elif fmt == "xpt":
            pyreadstat.write_xport(df, path, **kw)
    return build


def frame(cols):
    import pandas as pd
    return lambda: pd.DataFrame(cols)


STAT_FORMATS = ["sav", "zsav", "dta", "xpt"]
ZSAV_SUBSET = {"base", "sysmiss"}  # .zsav repeats only these of the per-format cases

for fmt in STAT_FORMATS:
    up = fmt.upper()
    lab_ok = fmt in ("sav", "zsav", "dta")  # value labels are writable for these
    # base: numeric and string variables, variable labels
    kw = {"column_labels": {"Q1": "Overall satisfaction", "REGION": "Region of residence", "AGE": "Age in years"}}
    if lab_ok:
        kw["variable_value_labels"] = {"Q1": {1: "Very poor", 2: "Poor", 3: "Fair", 4: "Good", 5: "Very good"}}
    exp = {"names": ["Q1", "REGION", "AGE"], "nrows": 3,
           "var_labels": {"Q1": "Overall satisfaction", "REGION": "Region of residence", "AGE": "Age in years"},
           "calc_cells": [(0, "Q1", *NUM(5)), (1, "REGION", *S("Gauteng")), (2, "AGE", *NUM(61))],
           "preview_headers": ["Overall satisfaction", "Region of residence", "Age in years"],
           "preview_cells": [(1, "Region of residence", *S("Gauteng")), (2, "Age in years", *NUM(61))]}
    if lab_ok:
        exp["value_labels"] = {"Q1": {1: "Very poor", 2: "Poor", 3: "Fair", 4: "Good", 5: "Very good"}}
        exp["preview_cells"] = exp["preview_cells"] + [(0, "Overall satisfaction", *S("Very good")), (2, "Overall satisfaction", *S("Fair"))]
    add(id=f"S-{fmt}-base", kind="stats", desc=f".{fmt} numeric and string variables with variable labels" + (" and value labels" if lab_ok else ""),
        clause=C_CONVERT, file=f"base.{fmt}",
        build=stats_writer(fmt, frame({"Q1": [5.0, 2.0, 3.0], "REGION": ["Western Cape", "Gauteng", "Limpopo"], "AGE": [23.0, 45.0, 61.0]}), **kw),
        expect=exp)
    # missing system values
    add(id=f"S-{fmt}-sysmiss", kind="stats", desc=f".{fmt} system-missing numeric is missing in preview and calculation",
        clause=C_CONVERT + " (NaN -> None)", file=f"sysmiss.{fmt}",
        build=stats_writer(fmt, frame({"Q1": [1.0, float("nan"), 3.0]})),
        expect={"names": ["Q1"], "nrows": 3, "calc_cells": [(1, "Q1", *NULL)], "preview_cells": [(1, "Q1", *NULL)]})
    # dates
    add(id=f"S-{fmt}-dates", kind="stats", desc=f".{fmt} date and date-time variables become ISO text in the preview",
        clause=C_CONVERT + " (date/datetime rendered as ISO)", file=f"dates.{fmt}",
        build=stats_writer(fmt, frame({"VDATE": [datetime.date(2024, 1, 15), datetime.date(2023, 12, 31)],
                                       "VDT": [D(2024, 1, 15, 10, 30), D(2024, 1, 16, 0, 0, 5)]})),
        expect={"names": ["VDATE", "VDT"], "nrows": 2,
                "preview_cells": [(0, "VDATE", *S("2024-01-15")), (1, "VDATE", *S("2023-12-31")), (0, "VDT", *S("2024-01-15T10:30:00"))]})
    # weight variable
    add(id=f"S-{fmt}-weight", kind="stats", desc=f".{fmt} a variable named WEIGHT, and one labelled 'Weighting factor', are weight-like",
        clause=C_WEIGHT, file=f"weight.{fmt}",
        build=stats_writer(fmt, frame({"Q1": [1.0, 2.0, 1.0], "WEIGHT": [0.8, 1.2, 1.0], "W1": [1.1, 0.9, 1.0]}),
                           column_labels={"Q1": "Q1", "WEIGHT": "Weight", "W1": "Weighting factor"}),
        expect={"names": ["Q1", "WEIGHT", "W1"], "nrows": 3, "weightLike": {"WEIGHT": True, "W1": True, "Q1": False},
                "calc_cells": [(1, "WEIGHT", *NUM(1.2))]})
    # columns-as-cases refused
    add(id=f"S-{fmt}-flip-refused", kind="stats", desc=f".{fmt} with columns_are_cases is refused", clause=C_STATSFLIP,
        file=f"flip.{fmt}", build=stats_writer(fmt, frame({"Q1": [1.0, 2.0]})), args={"layout": "columns_are_cases"},
        expect={"refuse_calc": ["only supported for plain csv"]})
    # non-ASCII labels and values
    add(id=f"S-{fmt}-unicode", kind="stats", desc=f".{fmt} non-ASCII string values and labels kept",
        clause=C_CONVERT, file=f"unicode.{fmt}",
        build=stats_writer(fmt, frame({"CITY": ["São Paulo", "Zürich"], "Q2": [1.0, 2.0]}),
                           column_labels={"CITY": "Ville / Région", "Q2": "Q2"}),
        expect={"names": ["CITY", "Q2"], "nrows": 2, "var_labels": {"CITY": "Ville / Région"},
                "calc_cells": [(0, "CITY", *S("São Paulo")), (1, "CITY", *S("Zürich"))]})
    # blank strings
    if fmt == "xpt":
        add(id="S-xpt-blank-string", kind="stats", desc=".xpt blank character value is missing in preview and calculation",
            clause=C_SAS, file="blank.xpt", build=stats_writer(fmt, frame({"S": ["a", "", "c"], "N": [1.0, 2.0, 3.0]})),
            expect={"names": ["S", "N"], "nrows": 3, "calc_cells": [(1, "S", *NULL), (0, "S", *S("a"))], "preview_cells": [(1, "S", *NULL)]})
    else:
        add(id=f"S-{fmt}-blank-string", kind="stats", desc=f".{fmt} blank string value", clause=C_CONVERT,
            file=f"blank.{fmt}", build=stats_writer(fmt, frame({"S": ["a", "", "c"], "N": [1.0, 2.0, 3.0]})), expect={},
            question=f"A blank string in .{fmt}: SAS blanks are missing (stated); CSV/Excel blanks are missing (stated); for SPSS/Stata the reader keeps '' as an answer, so it counts in bases. Should a blank string be missing in every format?")
    # long string values
    add(id=f"S-{fmt}-long-string", kind="stats", desc=f".{fmt} long string value kept whole", clause=C_CONVERT,
        file=f"longstr.{fmt}", build=stats_writer(fmt, frame({"OPEN": ["x" * (200 if fmt == "xpt" else 1500), "short"]})),
        expect={"names": ["OPEN"], "nrows": 2, "calc_cells": [(0, "OPEN", *S("x" * (200 if fmt == "xpt" else 1500)))]})

for fmt in ("sav", "zsav"):
    full = fmt == "sav"  # .zsav: only the user-missing and measure cases (one root cause if refused)
    add(id=f"S-{fmt}-user-missing", kind="stats", desc=f".{fmt} user-missing discrete 99 and range 97-98: masked in data, declared in metadata",
        clause=C_SAVMISS, file=f"umiss.{fmt}",
        build=stats_writer(fmt, frame({"Q1": [1.0, 99.0, 2.0, 97.0, 98.0, 3.0]}),
                           missing_ranges={"Q1": [99.0, {"lo": 97.0, "hi": 98.0}]},
                           variable_value_labels={"Q1": {1: "Yes", 2: "No", 3: "Maybe", 97: "Refused", 98: "Don't know", 99: "Not asked"}}),
        expect={"names": ["Q1"], "nrows": 6, "calc_cells": [(1, "Q1", *NULL), (3, "Q1", *NULL), (4, "Q1", *NULL), (0, "Q1", *NUM(1))],
                "preview_cells": [(1, "Q1", *NULL), (3, "Q1", *NULL), (0, "Q1", *S("Yes"))],
                "missing_ranges": {"Q1": [(99.0, 99.0), (97.0, 98.0)]}})
    add(id=f"S-{fmt}-string-user-missing", kind="stats", desc=f".{fmt} string user-missing value 'X' masked in data",
        clause=C_SAVMISS, file=f"sumiss.{fmt}",
        build=stats_writer(fmt, frame({"S": ["a", "X", "b"]}), missing_ranges={"S": ["X"]}),
        expect={"names": ["S"], "nrows": 3, "calc_cells": [(1, "S", *NULL), (0, "S", *S("a"))], "missing_ranges": {"S": [("X", "X")]}})
    add(id=f"S-{fmt}-measure", kind="stats", desc=f".{fmt} measure levels nominal, ordinal, scale kept", clause="pyreadstat meta through _read_raw cache (variable_measure)",
        file=f"measure.{fmt}",
        build=stats_writer(fmt, frame({"G": [1.0, 2.0], "SAT": [3.0, 4.0], "INC": [1000.0, 2000.0]}),
                           variable_measure={"G": "nominal", "SAT": "ordinal", "INC": "scale"}),
        expect={"names": ["G", "SAT", "INC"], "nrows": 2, "measure": {"G": "nominal", "SAT": "ordinal", "INC": "scale"}})
    full and add(id=f"S-{fmt}-long-labels", kind="stats", desc=f".{fmt} 250-char variable label and 120-char value label kept",
        clause=C_CONVERT, file=f"longlab.{fmt}",
        build=stats_writer(fmt, frame({"Q9": [1.0, 2.0]}), column_labels={"Q9": "L" * 250},
                           variable_value_labels={"Q9": {1: "V" * 120, 2: "No"}}),
        expect={"names": ["Q9"], "nrows": 2, "var_labels": {"Q9": "L" * 250}, "value_labels": {"Q9": {1: "V" * 120, 2: "No"}},
                "preview_headers": ["L" * 250], "preview_cells": [(0, "L" * 250, *S("V" * 120))]})
    full and add(id=f"S-{fmt}-unlabelled-code", kind="stats", desc=f".{fmt} a code with no value label stays its code in the preview",
        clause=C_CONVERT + " (_resolve_value: unlabelled code left in place)", file=f"unlab.{fmt}",
        build=stats_writer(fmt, frame({"Q1": [1.0, 7.0]}), variable_value_labels={"Q1": {1: "Yes"}}),
        expect={"names": ["Q1"], "nrows": 2, "preview_cells": [(0, "Q1", *S("Yes")), (1, "Q1", *NUM(7))], "calc_cells": [(1, "Q1", *NUM(7))]})
    full and add(id=f"S-{fmt}-dup-labels", kind="stats", desc=f".{fmt} three variables sharing a label get unique preview headers",
        clause="_build_headers docstring (two columns never collide)", file=f"duplab.{fmt}",
        build=stats_writer(fmt, frame({"a": [1.0], "c": [2.0], "b": [3.0]}),
                           column_labels={"a": "Shared (b)", "c": "Shared", "b": "Shared"}),
        expect={"names": ["a", "c", "b"], "nrows": 1, "preview_unique": True,
                "preview_cells": [(0, "Shared (b)", *NUM(1)), (0, "Shared", *NUM(2))]})
    full and add(id=f"S-{fmt}-string-value-labels", kind="stats", desc=f".{fmt} value labels on a string variable",
        clause=C_CONVERT, file=f"strvl.{fmt}",
        build=stats_writer(fmt, frame({"R": ["N", "S", "N"]}), variable_value_labels={"R": {"N": "North", "S": "South"}}),
        expect={"names": ["R"], "nrows": 3, "value_labels": {"R": {"N": "North", "S": "South"}},
                "calc_cells": [(0, "R", *S("N"))], "preview_cells": [(1, "R", *S("South"))]})

CASES[:] = [c for c in CASES if not (c["id"].startswith("S-zsav-") and c["id"][len("S-zsav-"):] not in
                                     ZSAV_SUBSET | {"user-missing", "string-user-missing", "measure"})]

add(id="S-dta-value-labels-ints", kind="stats", desc=".dta value labels on integer codes, one code unlabelled",
    clause=C_CONVERT, file="vl.dta",
    build=stats_writer("dta", frame({"gender": [1, 2, 3]}), variable_value_labels={"gender": {1: "Male", 2: "Female"}}),
    expect={"names": ["gender"], "nrows": 3, "value_labels": {"gender": {1: "Male", 2: "Female"}},
            "preview_cells": [(0, "gender", *S("Male")), (2, "gender", *NUM(3))], "calc_cells": [(1, "gender", *NUM(2))]})
add(id="S-dta-extended-missing", kind="stats", desc=".dta extended missing .a is missing in preview and calculation", clause=C_CONVERT + " (NaN -> None)",
    file="extmiss.dta", build=None, expect={"names": ["q"], "nrows": 3, "calc_cells": [(1, "q", *NULL), (2, "q", *NUM(3))], "preview_cells": [(1, "q", *NULL)]})
add(id="S-sav-time", kind="stats", desc=".sav TIME variable becomes HH:MM:SS text in the preview", clause=C_CONVERT + " (date/time rendered as ISO)",
    file="time.sav", build=stats_writer("sav", frame({"T": [datetime.time(10, 30), datetime.time(23, 59, 59)]})),
    expect={"names": ["T"], "nrows": 2, "preview_cells": [(0, "T", *S("10:30:00")), (1, "T", *S("23:59:59"))]})
add(id="S-sav-nonascii-name", kind="stats", desc=".sav variable name with a non-ASCII letter (r\u00e9gion)", clause=C_CONVERT,
    file="nonascii.sav", build=stats_writer("sav", frame({"r\u00e9gion": [1.0, 2.0]})),
    expect={"names": ["r\u00e9gion"], "nrows": 2, "preview_headers": ["r\u00e9gion"]})
add(id="S-dta-long-labels", kind="stats", desc=".dta 80-char variable label and 200-char value label kept", clause=C_CONVERT,
    file="longlab.dta", build=stats_writer("dta", frame({"q9": [1, 2]}), column_labels={"q9": "L" * 80}, variable_value_labels={"q9": {1: "V" * 200}}),
    expect={"names": ["q9"], "nrows": 2, "var_labels": {"q9": "L" * 80}, "value_labels": {"q9": {1: "V" * 200}}})
add(id="S-xpt-v5-names", kind="stats", desc=".xpt version 5 (8-character names) reads", clause=C_CONVERT,
    file="v5.xpt", build=stats_writer("xpt", frame({"Q1": [1.0, 2.0], "NAME": ["a", "b"]}), file_format_version=5),
    expect={"names": ["Q1", "NAME"], "nrows": 2, "calc_cells": [(1, "NAME", *S("b"))]})
add(id="S-xpt-v8-longname", kind="stats", desc=".xpt version 8 long variable name reads", clause=C_CONVERT,
    file="v8.xpt", build=stats_writer("xpt", frame({"satisfaction_overall": [1.0, 2.0]}), file_format_version=8),
    expect={"names": ["satisfaction_overall"], "nrows": 2})
add(id="S-zsav-as-sav-name", kind="stats", desc="a compressed (zsav) file uploaded with a .sav name reads", clause=C_CONVERT,
    file="zsavnamed.sav", build=stats_writer("zsav", frame({"Q1": [1.0, 2.0]})), expect={"names": ["Q1"], "nrows": 2})
add(id="S-truncated-sav", kind="stats", desc="a truncated .sav is refused (never read as fewer cases)", clause="import-resource-boundary.md (truncated SAV/DTA native checks)",
    file="trunc.sav", build=None, expect={"refuse_calc": [""], "refuse_preview": [""]})
add(id="S-truncated-dta", kind="stats", desc="a truncated .dta is refused", clause="import-resource-boundary.md (truncated SAV/DTA native checks)",
    file="trunc.dta", build=None, expect={"refuse_calc": [""], "refuse_preview": [""]})


def _truncated(fmt, n=200):
    def build(path):
        import pandas as pd
        import pyreadstat
        tmp = path + ".full"
        df = pd.DataFrame({"Q1": [float(i % 5) for i in range(n)], "S": [f"resp{i}" for i in range(n)]})
        (pyreadstat.write_sav if fmt == "sav" else pyreadstat.write_dta)(df, tmp)
        with open(tmp, "rb") as fh:
            data = fh.read()
        os.unlink(tmp)
        with open(path, "wb") as fh:
            fh.write(data[: len(data) * 2 // 3])
    return build


def _workbook_1904(path):
    import openpyxl
    from openpyxl.utils.datetime import CALENDAR_MAC_1904
    wb = openpyxl.Workbook()
    wb.epoch = CALENDAR_MAC_1904
    ws = wb.active
    ws.title = "Data"
    ws.append(["d"])
    ws.append([D(2024, 1, 15)])
    ws.append([D(1904, 1, 2)])
    ws["A2"].number_format = "yyyy-mm-dd"
    ws["A3"].number_format = "yyyy-mm-dd"
    wb.save(path)


def _dta_extended_missing(path):
    import pandas as pd
    import pyreadstat
    pyreadstat.write_dta(pd.DataFrame({"q": [1, "a", 3]}, dtype=object), path, missing_user_values={"q": ["a"]})


for c in CASES:
    if c["id"] == "S-dta-extended-missing":
        c["build"] = _dta_extended_missing
    if c["id"] == "X-xlsx-1904-dates":
        c["build"] = _workbook_1904
    if c["id"] == "S-truncated-sav":
        c["build"] = _truncated("sav")
    if c["id"] == "S-truncated-dta":
        c["build"] = _truncated("dta")


# ---------------------------------------------------------------- 12. limits

MAXB = 100_000_000
MAXC = 100_000


def cases_csv(n, flipped=False):
    def build(path):
        with open(path, "w", encoding="utf-8", newline="") as fh:
            if flipped:
                fh.write("var," + ",".join(f"c{i}" for i in range(n)) + "\n")
                fh.write("q," + ",".join("1" for _ in range(n)) + "\n")
            else:
                fh.write("q\n")
                fh.write("1\n" * n)
    return build


add(id="LIM-csv-cases-at", desc="CSV with exactly 100,000 cases reads", clause=C_LIMITS, file="cases_at.csv",
    build=cases_csv(MAXC), expect={"headers": ["q"], "nrows": MAXC}, heavy=True)
add(id="LIM-csv-cases-over", desc="CSV with 100,001 cases is refused with the case-limit message", clause=C_LIMITS, file="cases_over.csv",
    build=cases_csv(MAXC + 1), expect={"refuse": ["100,000 case limit", "no partial result"]}, heavy=True)
add(id="LIM-csv-flip-cases-over", desc="flipped CSV with 100,001 case columns is refused", clause=C_LIMITS, file="flip_cases_over.csv",
    build=cases_csv(MAXC + 1, flipped=True), args={"layout": "columns_are_cases"}, expect={"refuse": ["case limit"]}, heavy=True)
add(id="LIM-csv-cases-blank-rows", desc="100,000 cases plus blank lines is not over the limit (blank lines are not cases)", clause=C_LIMITS + "; " + C_QUOTE,
    file="cases_blank.csv", build=write_text("q\n" + "1\n" * MAXC + "\n\n,\n"), expect={"headers": ["q"], "nrows": MAXC}, heavy=True)


def sav_cases(n):
    def build(path):
        import pandas as pd
        import pyreadstat
        pyreadstat.write_sav(pd.DataFrame({"Q1": [1.0] * n}), path)
    return build


add(id="LIM-sav-cases-at", kind="stats", desc=".sav with exactly 100,000 cases reads", clause=C_LIMITS, file="cases_at.sav",
    build=sav_cases(MAXC), expect={"names": ["Q1"], "nrows": MAXC, "skip_preview": True}, heavy=True)
add(id="LIM-sav-cases-over", kind="stats", desc=".sav with 100,001 cases is refused in preview and calculation", clause=C_LIMITS,
    file="cases_over.sav", build=sav_cases(MAXC + 1), expect={"refuse_calc": ["case limit"], "refuse_preview": ["case limit"]}, heavy=True)
add(id="LIM-bytes-at", kind="rule", desc="exactly 100,000,000 bytes passes the size rule", clause=C_LIMITS,
    file=None, build=None, expect={"size": MAXB, "allowed": True})
add(id="LIM-bytes-under", kind="rule", desc="99,999,999 bytes passes the size rule", clause=C_LIMITS,
    file=None, build=None, expect={"size": MAXB - 1, "allowed": True})
add(id="LIM-bytes-over-table", kind="rule", desc="100,000,001 bytes is refused by read_table before reading", clause=C_LIMITS,
    file="over.csv", build=None, expect={"size": MAXB + 1, "allowed": False, "via": "read_table", "phrase": "100 mb limit"})
add(id="LIM-bytes-over-convert", kind="rule", desc="100,000,001 bytes is refused by convert (.sav preview) before reading", clause=C_LIMITS,
    file="over.sav", build=None, expect={"size": MAXB + 1, "allowed": False, "via": "convert", "phrase": "100 mb limit"})
add(id="LIM-bytes-over-calc", kind="rule", desc="100,000,001 bytes is refused by the calculation read (_read_raw) before reading", clause=C_LIMITS,
    file="over.dta", build=None, expect={"size": MAXB + 1, "allowed": False, "via": "_read_raw", "phrase": "100 mb limit"})
add(id="LIM-doc-drift", kind="rule", desc="the written boundary contract states the same byte limit as import-limits.json", clause="import-resource-boundary.md first paragraph vs api/import-limits.json",
    file=None, build=None, expect={"doc_limit": True})

#!/usr/bin/env bash
# L4 runner. From anywhere: bash conformance/l4/run.sh
# Needs python3 with openpyxl, python-docx, python-pptx, reportlab, Pillow, pandas (the engine's own
# requirements), LibreOffice at /usr/bin/soffice (or LIBREOFFICE_PATH), and for the database parts
# TEST_DATABASE_URL pointing at a local PostgreSQL (disposable databases are created and dropped).
# Never calls a model API and never writes to cloud storage. Each vitest file runs on its own, one fork.
set -u
cd "$(dirname "$0")/../.."
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres@localhost:55432/postgres}"
python3 -I conformance/l4/generate.py
python3 -I conformance/l4/real_prep.py
for f in aggregated documents real; do
  node node_modules/vitest/vitest.mjs run --config conformance/l4/vitest.config.mjs --no-cache "conformance/l4/runner/$f.test.ts" \
    > "conformance/l4/out/$f.vitest.log" 2>&1
  echo "$f: $(grep -E '^ +Tests ' "conformance/l4/out/$f.vitest.log" | tail -1)"
done
python3 -I conformance/l4/summarize.py

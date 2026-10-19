"""Writes a synthetic SPSS file with the shape of a large national survey (default 5,600 cases by
4,500 variables, about 25 MB with SPSS row compression), for the large-file regression check.
Synthetic and seeded: no real survey data. Usage: make-large-sav.py OUT [CASES] [VARIABLES]
Gender (1 Male, 2 Female) and Purchase (1 Yes, 2 No) carry value labels so a cross tab can be built."""
import sys

import numpy as np
import pandas as pd
import pyreadstat

out = sys.argv[1]
cases = int(sys.argv[2]) if len(sys.argv) > 2 else 5600
variables = int(sys.argv[3]) if len(sys.argv) > 3 else 4500
rng = np.random.default_rng(20261019)
data = {"Gender": rng.integers(1, 3, cases), "Purchase": rng.integers(1, 3, cases)}
for i in range(variables - 2):
    data[f"Q{i + 1:04d}"] = rng.integers(1, 6, cases)
df = pd.DataFrame(data).astype("float64")
pyreadstat.write_sav(
    df,
    out,
    column_labels={"Gender": "Gender", "Purchase": "Purchased in the last month"},
    variable_value_labels={"Gender": {1.0: "Male", 2.0: "Female"}, "Purchase": {1.0: "Yes", 2.0: "No"}},
    row_compress=True,
)

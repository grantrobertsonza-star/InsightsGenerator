"""Compatibility entry point: validate the full separate pack, including XLSX."""
from pathlib import Path
import runpy,sys
p=Path(__file__).resolve().parents[2]/"validate_separate_pack.py"
sys.argv=[str(p),"--xlsx"]+sys.argv[1:]
runpy.run_path(str(p),run_name="__main__")

"""Prints the advance-width table used by src/lib/crosstabSlides.ts to estimate wrapped text.

Source: Carlito, the metric-compatible substitute for Calibri (same advance widths), which
LibreOffice uses for the PDF export when Calibri is absent. Each of the three styles the slides
use (regular, bold, italic) has its own table. Widths are thousandths of an em. Characters outside
the table are estimated at a full em by the TypeScript side. Run: python3 scripts/crosstab-slides/font-metrics.py
"""
from fontTools.ttLib import TTFont

STYLES = ["Regular", "Bold", "Italic"]
RANGES = [(32, 127), (160, 384)]
fonts = [TTFont(f"/usr/share/fonts/truetype/crosextra/Carlito-{s}.ttf") for s in STYLES]
upem = fonts[0]["head"].unitsPerEm
hhea = fonts[0]["hhea"]
os2 = fonts[0]["OS/2"]
print("// line height (hhea ascender - descender + lineGap) / em:", (hhea.ascent - hhea.descent + hhea.lineGap) / upem)
for name, f in zip(STYLES, fonts):
    cmap = f.getBestCmap()
    for lo, hi in RANGES:
        row = [str(round(f["hmtx"][cmap[cp]][0] * 1000 / upem)) if cp in cmap else "1000" for cp in range(lo, hi)]
        print(f"// {name} {lo}..{hi - 1}")
        print(",".join(row))

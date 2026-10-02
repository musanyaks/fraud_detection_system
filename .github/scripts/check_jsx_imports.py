"""Fail CI if a JSX file uses a recharts component it never imports."""
import pathlib, re, sys

KNOWN = {"Area", "AreaChart", "Bar", "BarChart", "CartesianGrid", "Cell", "ComposedChart",
         "Legend", "Line", "LineChart", "Pie", "PieChart", "RadialBar", "RadialBarChart",
         "ResponsiveContainer", "Tooltip", "XAxis", "YAxis", "LabelList", "Scatter",
         "ScatterChart", "ZoomableGroup", "Geographies", "Geography", "Marker"}

bad = []
for f in pathlib.Path("frontend/src").rglob("*.jsx"):
    src = f.read_text(encoding="utf-8")
    imported = set()
    for m in re.finditer(r'import \{([^}]*)\} from "recharts"', src):
        imported |= {s.strip() for s in m.group(1).split(",") if s.strip()}
    for m in re.finditer(r'import \{([^}]*)\} from "react-simple-maps"', src):
        imported |= {s.strip() for s in m.group(1).split(",") if s.strip()}
    for name in KNOWN:
        if re.search(rf"<{name}[\s/>]", src) and name not in imported:
            bad.append(f"{f}: uses <{name}> but never imports it")

print("\n".join(bad) if bad else "imports OK")
sys.exit(1 if bad else 0)

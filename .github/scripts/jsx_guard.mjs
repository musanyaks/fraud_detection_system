import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const KNOWN = ["Area","AreaChart","Bar","BarChart","CartesianGrid","Cell","ComposedChart",
  "Legend","Line","LineChart","Pie","PieChart","RadialBar","RadialBarChart",
  "ResponsiveContainer","Tooltip","XAxis","YAxis","LabelList","ZoomableGroup",
  "Geographies","Geography","Marker"];

const bad = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const f = join(d, e.name);
  if (e.isDirectory()) return walk(f);
  if (!f.endsWith(".jsx")) return;
  const s = readFileSync(f, "utf8");
  const imported = new Set();
  for (const m of s.matchAll(/import \{([^}]*)\} from "(recharts|react-simple-maps)"/g))
    m[1].split(",").forEach((x) => imported.add(x.trim()));
  for (const name of KNOWN)
    if (new RegExp(`<${name}[\\s/>]`).test(s) && !imported.has(name))
      bad.push(`${f}: <${name}> used but not imported`);
});
walk("src");
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
console.log("jsx import guard: OK");

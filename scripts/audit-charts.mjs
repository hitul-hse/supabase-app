// Inventory every chart the app renders, and record whether it already tells
// the reader what it means. The goal is to add descriptions only where they are
// missing, and to say something TRUE about each one - which means reading what
// the chart is actually computed from, not guessing from its title.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(n)) walk(p, out); }
    else out.push(p);
  }
  return out;
};

// Chart primitives, as opposed to icons and logos which also use <svg>.
const PRIMITIVES = /\b(BarChart|LineChart|AreaChart|PieChart|RadialBar|Donut|Sparkline|TrendChart|Gauge|HeatMap|Scatter)\b/;

const files = walk("C:/Supabase/src").filter((f) => /\.tsx$/.test(f) && !/demo|video|BrandMark|nav-icons|LoadingSkeleton|OAuthButtons|ThemeToggle|LogoutButton|Biometric/.test(f));

const found = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  if (!PRIMITIVES.test(s)) continue;
  const rel = f.replace("C:/Supabase/", "").replace(/\\/g, "/");

  const lines = s.split("\n");
  const charts = [];
  lines.forEach((l, i) => {
    const m = l.match(PRIMITIVES);
    if (!m) return;
    // Skip imports and type-only mentions.
    if (/^\s*(import|export type|type |\/\/|\*)/.test(l)) return;
    charts.push({ line: i + 1, kind: m[1], text: l.trim().slice(0, 80) });
  });
  if (!charts.length) continue;

  // Does the file explain its charts? Look for a title + a subtitle/hint prop,
  // and for aria/figcaption, which is what a screen reader would get.
  found.push({
    file: rel,
    charts: charts.length,
    kinds: [...new Set(charts.map((c) => c.kind))].join(", "),
    hasHint: /hint=|subtitle=|caption=|description=/.test(s),
    hasAria: /aria-label=|role="img"|<figcaption/.test(s),
    hasFootnote: /footnote|<p className="[^"]*text-\[1[01]px\]/.test(s),
  });
}

console.log(`files rendering charts: ${found.length}\n`);
console.log("file".padEnd(54), "n".padStart(3), "hint".padStart(5), "aria".padStart(5), "foot".padStart(5), " kinds");
for (const f of found.sort((a, b) => b.charts - a.charts)) {
  const y = (b) => (b ? "  Y  " : "  .  ");
  console.log(f.file.padEnd(54), String(f.charts).padStart(3), y(f.hasHint), y(f.hasAria), y(f.hasFootnote), ` ${f.kinds}`);
}

console.log(`\nno explanatory hint at all: ${found.filter((f) => !f.hasHint && !f.hasFootnote).map((f) => f.file).join(", ") || "(none)"}`);
console.log(`\nno aria/figcaption (invisible to a screen reader): ${found.filter((f) => !f.hasAria).length} of ${found.length}`);

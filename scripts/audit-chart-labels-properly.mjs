// Correcting my own audit. The first pass reported "7 of 9 charts invisible to a
// screen reader" because it only looked for aria-label/role=img/figcaption in
// the FILE that renders the chart. In fact every call site passes a `label` prop
// to the shared primitives, and Charts.tsx turns that into the text alternative.
//
// So the accessibility story is already good. Re-check it properly, then find
// the real gap: what a SIGHTED reader is told about how each figure is computed.
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

console.log("=== does the shared primitive really expose `label` as a text alternative? ===");
const charts = readFileSync("C:/Supabase/src/components/ui/Charts.tsx", "utf8");
charts.split("\n").forEach((l, i) => {
  if (/role="img"|aria-label|<title>|aria-hidden/.test(l)) console.log(`  Charts.tsx:${i + 1}  ${l.trim().slice(0, 100)}`);
});

console.log("\n=== every chart call site, and whether it passes a label ===");
const files = walk("C:/Supabase/src").filter((f) => /\.tsx$/.test(f) && !/demo|video/.test(f));
let total = 0, labelled = 0;
for (const f of files) {
  const s = readFileSync(f, "utf8");
  // Split on chart openings so we can look inside each element's props.
  const parts = s.split(/<(AreaTrend|Donut|Gauge)\b/);
  if (parts.length < 2) continue;
  const rel = f.replace("C:/Supabase/", "").replace(/\\/g, "/");
  for (let i = 1; i < parts.length; i += 2) {
    const kind = parts[i];
    const body = parts[i + 1].slice(0, 900);
    const close = body.indexOf("/>");
    const props = close >= 0 ? body.slice(0, close) : body;
    const has = /\blabel=/.test(props);
    total++; if (has) labelled++;
    console.log(`  ${has ? "labelled" : "NO LABEL"}  ${kind.padEnd(10)} ${rel}`);
  }
}
console.log(`\n${labelled} of ${total} chart instances pass a text alternative`);

console.log("\n=== the real gap: is the COMPUTATION explained on screen? ===");
console.log("Looking for a visible caption/footnote near each figure that says what it counts.\n");
for (const f of files) {
  const s = readFileSync(f, "utf8");
  if (!/<(AreaTrend|Donut|Gauge)\b/.test(s)) continue;
  const rel = f.replace("C:/Supabase/", "").replace(/\\/g, "/");
  // A visible explanatory line: small muted text, or an explicit hint/caption prop.
  const visible = [...s.matchAll(/(hint|caption|note|footnote)=\{?["`]([^"`]{15,120})/g)].map((m) => m[2]);
  console.log(`${rel}`);
  console.log(visible.length ? visible.map((v) => `    "${v}"`).join("\n") : "    (no visible explanation of what the figure counts)");
}

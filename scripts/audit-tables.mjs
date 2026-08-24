// Measure the real scroll problem before changing anything: for every table in
// the app, how many rows can it render, and is it paged, virtualised, or just
// dumped in full? A page that emits 200 <tr> is the thing the user is scrolling
// past, and that is what we need to find rather than guess at.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Supabase/src";

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") out.push(...walk(p)); }
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
};

const files = walk(ROOT);
const tableFiles = files.filter((f) => {
  const s = readFileSync(f, "utf8");
  return /<table|<thead|role="table"/.test(s);
});

console.log(`files containing a table: ${tableFiles.length}\n`);

const rows = [];
for (const f of tableFiles) {
  const s = readFileSync(f, "utf8");
  const rel = f.replace(/^C:\/Supabase\//, "").replace(/\\/g, "/");

  const has = (re) => re.test(s);
  rows.push({
    file: rel.replace("src/", ""),
    lines: s.split("\n").length,
    tables: (s.match(/<table/g) ?? []).length,
    // Does anything bound the row count?
    paged: has(/\bpage\b|PER PAGE|pageSize|\.slice\(/i),
    sticky: has(/sticky/),
    scrollBox: has(/overflow-(auto|x-auto|y-auto|scroll)|max-h-/),
    sortable: has(/sort|orderBy/i),
    filter: has(/filter|search/i),
    // A <details>/collapse or tabs means the user is not forced past it.
    collapsible: has(/<details|aria-expanded|role="tab"/),
  });
}

rows.sort((a, b) => b.lines - a.lines);
console.log("file".padEnd(52), "ln".padStart(5), "tbl", "pag", "stk", "scr", "srt", "flt", "col");
for (const r of rows) {
  const y = (b) => (b ? " Y " : " . ");
  console.log(
    r.file.padEnd(52),
    String(r.lines).padStart(5),
    String(r.tables).padStart(3),
    y(r.paged), y(r.sticky), y(r.scrollBox), y(r.sortable), y(r.filter), y(r.collapsible),
  );
}

console.log(`\nunpaged tables (the scroll problem): ${rows.filter((r) => !r.paged).length}`);
for (const r of rows.filter((r) => !r.paged)) console.log(`   ${r.file}`);
console.log(`\nno sticky header (lose the header while scrolling): ${rows.filter((r) => !r.sticky).length}`);
for (const r of rows.filter((r) => !r.sticky)) console.log(`   ${r.file}`);

// 65 projects name the same person as both 'responsible' and 'replacement'.
// Is that in the workbook, or did the import create it?
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";
import xlsx from "xlsx";
import { REPO_ROOT } from "./lib/repo-root.mjs";

const env = Object.fromEntries(
  readFileSync(`${REPO_ROOT}/.env.local`, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select a.project_id, pe.name as person, pr.name as project_name
  from public.project_responsibility a
  join public.project_responsibility b
    on b.project_id = a.project_id and b.person_id = a.person_id
  left join public.people pe on pe.id = a.person_id
  left join public.projects pr on pr.id = a.project_id
  where a.role = 'responsible' and b.role = 'replacement'
  order by a.project_id`);

console.log(`${rows.length} projects name the same person as responsible AND replacement\n`);
console.log("by person:");
const byPerson = new Map();
for (const r of rows) byPerson.set(r.person, (byPerson.get(r.person) ?? 0) + 1);
for (const [p, n] of [...byPerson].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${p}`);

console.log("\nfirst 10:");
for (const r of rows.slice(0, 10)) console.log(`  ${r.project_id}  ${r.person}  ${String(r.project_name ?? "").slice(0, 44)}`);

// Now the source of truth: does the workbook actually say the same name twice?
// External input, not a repo file, so it cannot be resolved from this script's
// own location. Name it in MASTERDATA_WORKBOOK; it was hardcoded to one
// machine's Downloads folder and worked nowhere else. An empty value falls into
// the existing catch, which already treats an unreadable workbook as "the DB
// finding above stands on its own".
const WB = process.env.MASTERDATA_WORKBOOK ?? "";
let wb;
try { wb = xlsx.readFile(WB); }
catch (e) {
  console.log(`\nCould not open the workbook (${e.message}).`);
  console.log("Skipping the source comparison; the DB finding above stands on its own.");
  await c.end();
  process.exit(0);
}

const norm = (s) => String(s ?? "").trim().toLowerCase();
let sameInSource = 0, differInSource = 0, blankRepl = 0;
const examples = [];

for (const sheetName of wb.SheetNames) {
  const rowsOf = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rowsOf.length) continue;
  const keys = Object.keys(rowsOf[0]);
  const respKey = keys.find((k) => /verantwort|responsible|sifa/i.test(k));
  const replKey = keys.find((k) => /vertretung|replacement/i.test(k));
  if (!respKey || !replKey) continue;

  for (const r of rowsOf) {
    const a = norm(r[respKey]), b = norm(r[replKey]);
    if (!a) continue;
    if (!b || /n\/a|keine/.test(b)) { blankRepl += 1; continue; }
    if (a === b) { sameInSource += 1; if (examples.length < 6) examples.push(`${sheetName}: "${r[respKey]}" / "${r[replKey]}"`); }
    else differInSource += 1;
  }
}

console.log(`\nWorkbook (${WB.split("/").pop()}):`);
console.log(`  responsible == replacement : ${sameInSource}`);
console.log(`  responsible != replacement : ${differInSource}`);
console.log(`  replacement blank / n/a     : ${blankRepl}`);
if (examples.length) { console.log("  examples where they match:"); for (const e of examples) console.log(`    ${e}`); }

console.log("\nVERDICT:");
if (sameInSource > 0) console.log(`  The source workbook itself repeats the name on ${sameInSource} rows.`);
else console.log("  The workbook never repeats the name; the duplication was introduced downstream.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();

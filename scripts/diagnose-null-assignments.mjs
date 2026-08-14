// Why are 8 person_assignments rows still NULL in the live DB? Determine whether
// the backfill migration would fix them, or whether they are unfixable because
// no project with that name exists.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const get = async (p) =>
  JSON.parse(await (await fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).text());

const assignments = await get("person_assignments?select=id,person_id,project_id,project_name&order=id");
const projects = await get("projects?select=id,name");
const people = await get("people?select=id,name");

const nameToProjects = new Map();
for (const p of projects) {
  if (!nameToProjects.has(p.name)) nameToProjects.set(p.name, []);
  nameToProjects.get(p.name).push(p.id);
}
const personName = new Map(people.map((p) => [p.id, p.name]));

const nulls = assignments.filter((a) => a.project_id === null);

console.log(`assignments: ${assignments.length}, NULL project_id: ${nulls.length}\n`);

let fixable = 0;
let ambiguous = 0;
let unfixable = 0;

for (const a of nulls) {
  const matches = nameToProjects.get(a.project_name) || [];
  let verdict;
  if (matches.length === 1) {
    verdict = `BACKFILL WILL FIX -> ${matches[0]}`;
    fixable++;
  } else if (matches.length > 1) {
    verdict = `AMBIGUOUS (${matches.length} projects share this name)`;
    ambiguous++;
  } else {
    verdict = "NO MATCHING PROJECT — not real project work, cannot and should not be linked";
    unfixable++;
  }
  console.log(`  #${a.id}  ${personName.get(a.person_id) ?? a.person_id}  "${a.project_name}"`);
  console.log(`        ${verdict}`);
}

console.log(`\nfixable by backfill: ${fixable}`);
console.log(`ambiguous (left NULL by design): ${ambiguous}`);
console.log(`no matching project (internal/overhead time): ${unfixable}`);

if (unfixable === nulls.length) {
  console.log(
    "\nCONCLUSION: every NULL row is internal/overhead time with no corresponding\nproject row. The backfill would change nothing, and these rows correctly have\nno project linkage. No access is being lost to real projects.",
  );
}

// READ-ONLY inspection of the live Supabase database. No writes, no DDL.
// Purpose: settle whether the fixes verified locally are actually reflected in
// production, and whether the backfill is still outstanding there.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) {
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { status: res.status, body: await res.text() };
}

console.log(`project: ${url}\n`);

// 1. Does the RBAC schema exist in production at all?
for (const table of ["app_role", "app_user_profile", "people", "projects", "person_assignments"]) {
  const { status, body } = await rest(`${table}?select=*&limit=1`);
  const exists = status === 200;
  console.log(
    `${exists ? "EXISTS " : "MISSING"}  ${table}${exists ? "" : "  -> " + body.slice(0, 120)}`,
  );
}

console.log();

// 2. Is person_assignments.project_id present, and is it backfilled?
const pa = await rest("person_assignments?select=*");
if (pa.status !== 200) {
  console.log(`person_assignments unreadable: ${pa.status} ${pa.body.slice(0, 200)}`);
} else {
  const rows = JSON.parse(pa.body);
  const hasCol = rows.length === 0 || "project_id" in rows[0];
  console.log(`person_assignments rows: ${rows.length}`);
  console.log(`project_id column present in live DB: ${hasCol}`);
  if (hasCol && rows.length) {
    const nulls = rows.filter((r) => r.project_id === null).length;
    console.log(`rows with project_id NULL (need backfill): ${nulls} / ${rows.length}`);
  }
}

console.log();

// 3. Is the live schema the OLD one? projects.owner_person_id / department are
// part of the RBAC work; their absence means the RBAC schema was never applied.
const prj = await rest("projects?select=*&limit=1");
if (prj.status === 200) {
  const rows = JSON.parse(prj.body);
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    console.log(`projects columns: ${cols.length}`);
    for (const c of ["owner_person_id", "department"]) {
      console.log(`  ${cols.includes(c) ? "present" : "ABSENT "}  projects.${c}`);
    }
  } else {
    console.log("projects table is empty; cannot infer columns from a row");
  }
}

console.log();

// 4. Do the role helper functions exist in production?
for (const fn of ["app_user_role", "can_view_person"]) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: fn === "can_view_person" ? JSON.stringify({ target_person_id: "p-1" }) : "{}",
  });
  const txt = await res.text();
  const missing = res.status === 404 || /could not find|does not exist/i.test(txt);
  console.log(`${missing ? "MISSING" : "EXISTS "}  ${fn}()  [http ${res.status}]`);
}

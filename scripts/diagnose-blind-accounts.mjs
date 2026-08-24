// Six accounts are now correctly linked to a person yet still see zero projects.
// Linking was necessary but not sufficient. Find out why for each one, because
// the honest answer may be "they genuinely have no work assigned", which is not
// a bug and must not be papered over.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const blind = ["azubuike", "hannes", "kurt", "munesh", "seif", "yasemin"];

const { rows } = await c.query(`
  select u.email, aup.person_id, aup.role_key, aup.department,
         pe.name, pe.department people_dept, pe.source, pe.is_active
  from public.app_user_profile aup
  join auth.users u on u.id = aup.user_id
  left join public.people pe on pe.id = aup.person_id
  where aup.is_active
  order by u.email`);

console.log("=== why does each blind account see nothing? ===\n");
for (const r of rows) {
  const local = r.email.split("@")[0];
  if (!blind.includes(local)) continue;

  const owned = (await c.query(
    `select count(*)::int n from public.projects where owner_person_id=$1`, [r.person_id])).rows[0].n;
  const assigned = (await c.query(
    `select count(*)::int n from public.person_assignments where person_id=$1`, [r.person_id])).rows[0].n;
  const resp = (await c.query(
    `select count(*)::int n from public.project_responsibility where person_id=$1`, [r.person_id])).rows[0].n;
  const deptProjects = r.department
    ? (await c.query(`select count(*)::int n from public.projects where department=$1`, [r.department])).rows[0].n
    : 0;

  console.log(`${r.email}  role=${r.role_key} profile_dept=${r.department ?? "-"}`);
  console.log(`   person=${r.person_id} (${r.name ?? "?"}, source=${r.source}, active=${r.is_active}, dept=${r.people_dept ?? "-"})`);
  console.log(`   owns=${owned}  assigned=${assigned}  responsibility_rows=${resp}  projects_in_their_dept=${deptProjects}`);

  const why = owned + assigned + resp === 0
    ? (r.role_key === "dept_head" && deptProjects === 0
        ? "dept_head, but ZERO projects carry their department -> projects.department is unpopulated"
        : "genuinely has no owned/assigned/responsible work in the data")
    : "HAS work but still sees 0 -> RLS bug, investigate";
  console.log(`   => ${why}\n`);
}

// Is projects.department populated at all? A dept_head sees nothing if it is not.
const dept = await c.query(`
  select coalesce(department,'(null)') department, count(*)::int n
  from public.projects group by 1 order by 2 desc`);
console.log("=== projects.department distribution ===");
console.table(dept.rows);

await c.end();

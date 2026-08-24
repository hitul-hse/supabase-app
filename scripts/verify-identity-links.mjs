// Verification + inspection for identity links.
//
//   node scripts/verify-identity-links.mjs --inspect   schema + current data dump
//   node scripts/verify-identity-links.mjs             RLS impersonation report
//
// The RLS report impersonates every app_user_profile row exactly as PostgREST
// does (role=authenticated + request.jwt.claims) and counts what they can see.
// Everything runs inside a transaction that is always rolled back.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const INSPECT = process.argv.includes("--inspect");
const POLICY = process.argv.includes("--policy");
const SNAPSHOT = "C:/Supabase/scripts/.identity-before.json";
const SAVE = process.argv.includes("--save-before");

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = async (t) => (await c.query(
  `select column_name, data_type, is_nullable, column_default
     from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows;

if (INSPECT) {
  for (const t of ["people", "app_user_profile"]) {
    console.log(`\n=== columns: ${t} ===`);
    for (const x of await cols(t)) {
      console.log(`  ${x.column_name} :: ${x.data_type} null=${x.is_nullable} def=${x.column_default ?? ""}`);
    }
  }

  const p = await c.query("select * from public.people order by source, id");
  console.log(`\n=== people (${p.rowCount}) ===`);
  for (const x of p.rows) console.log("  " + JSON.stringify(x));

  const a = await c.query(`
    select p.user_id, u.email, p.person_id, p.role_key, p.department, p.is_active, p.display_name
      from public.app_user_profile p
      left join auth.users u on u.id = p.user_id
     order by (p.person_id is not null), u.email`);
  console.log(`\n=== app_user_profile (${a.rowCount}) ===`);
  for (const x of a.rows) console.log("  " + JSON.stringify(x));

  console.log("\n=== distinct people.source ===");
  const src = await c.query(
    "select source, is_active, count(*)::int n from public.people group by 1,2 order by 1,2");
  for (const x of src.rows) console.log(`  source=${x.source} is_active=${x.is_active} n=${x.n}`);

  console.log("\n=== identity functions ===");
  for (const fn of ["app_user_person_id", "app_user_role", "app_user_department"]) {
    const r = await c.query(
      `select pg_get_functiondef(p.oid) d from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=$1`, [fn]);
    for (const x of r.rows) console.log(x.d + "\n---");
  }

  console.log("\n=== fk constraints referencing people ===");
  const fk = await c.query(`
    select tc.table_name, kcu.column_name, ccu.table_name ref
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
     where tc.constraint_type='FOREIGN KEY' and ccu.table_name='people'`);
  for (const x of fk.rows) console.log(`  ${x.table_name}.${x.column_name} -> ${x.ref}`);

  await c.end();
  process.exit(0);
}

if (POLICY) {
  console.log("=== visibility helper functions ===");
  for (const fn of ["can_view_project", "can_view_person"]) {
    const r = await c.query(
      `select pg_get_functiondef(p.oid) d from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=$1`, [fn]);
    for (const x of r.rows) console.log(x.d + "\n---");
  }

  console.log("=== projects.department distribution ===");
  const d = await c.query(
    "select department, count(*)::int n from public.projects group by 1 order by 2 desc");
  for (const x of d.rows) console.log(`  ${x.department ?? "(null)"}: ${x.n}`);

  console.log("\n=== people.department distribution ===");
  const pd = await c.query(
    "select department, is_active, count(*)::int n from public.people group by 1,2 order by 1");
  for (const x of pd.rows) console.log(`  ${x.department ?? "(null)"} active=${x.is_active}: ${x.n}`);

  console.log("\n=== factorial_person_reference ===");
  try {
    const f = await c.query("select * from public.factorial_person_reference limit 30");
    for (const x of f.rows) console.log("  " + JSON.stringify(x));
    console.log(`  (${f.rowCount} rows)`);
  } catch (e) { console.log("  n/a: " + e.message); }

  console.log("\n=== tables with an email-ish column ===");
  const ec = await c.query(`
    select table_name, column_name from information_schema.columns
     where table_schema='public' and (column_name ilike '%email%' or column_name ilike '%name%')
     order by table_name, column_name`);
  for (const x of ec.rows) console.log(`  ${x.table_name}.${x.column_name}`);

  console.log("\n=== org_chart_nodes / user_display_names ===");
  for (const t of ["org_chart_nodes", "user_display_names"]) {
    try {
      const r = await c.query(`select * from public.${t} limit 40`);
      console.log(`  -- ${t} (${r.rowCount})`);
      for (const x of r.rows) console.log("    " + JSON.stringify(x));
    } catch (e) { console.log(`  ${t}: n/a ${e.message}`); }
  }

  console.log("\n=== check constraints on people ===");
  const cc = await c.query(`
    select con.conname, pg_get_constraintdef(con.oid) def
      from pg_constraint con join pg_class cl on cl.oid=con.conrelid
      join pg_namespace n on n.oid=cl.relnamespace
     where n.nspname='public' and cl.relname='people' and con.contype='c'`);
  for (const x of cc.rows) console.log(`  ${x.conname}: ${x.def}`);

  console.log("\n=== work-evidence for every people row ===");
  const we = await c.query(`
    select p.id, p.name, p.is_active,
           (select count(*)::int from public.person_assignments a where a.person_id=p.id) assigns,
           (select count(*)::int from public.projects pr where pr.owner_person_id=p.id) owns,
           (select count(*)::int from public.timesheet_entries t where t.person_id=p.id) ts,
           (select count(*)::int from public.weekly_bookings b where b.person_id=p.id) wb
      from public.people p order by assigns desc, p.id`);
  for (const x of we.rows) {
    console.log(`  ${String(x.id).padEnd(14)} ${String(x.name).padEnd(18)} active=${x.is_active} assigns=${x.assigns} owns=${x.owns} timesheets=${x.ts} bookings=${x.wb}`);
  }

  console.log("\n=== do any timesheets/bookings name unlinked staff? ===");
  const names = ["seif", "kurt", "hannes", "munesh", "azubuike", "yasemin", "simone", "ulf", "hitul"];
  for (const n of names) {
    const r = await c.query(
      `select count(*)::int c from public.timesheet_entries where person_id ilike $1`, [`%${n}%`]);
    const b = await c.query(
      `select count(*)::int c from public.weekly_employee_summary where employee_name ilike $1`, [`%${n}%`]);
    if (r.rows[0].c || b.rows[0].c) console.log(`  ${n}: timesheets=${r.rows[0].c} summary=${b.rows[0].c}`);
  }
  console.log("  (only non-zero shown)");

  await c.end();
  process.exit(0);
}

// ---------- RLS impersonation report ----------
const users = (await c.query(`
  select p.user_id as uid, u.email, p.role_key as role, p.person_id
    from public.app_user_profile p
    left join auth.users u on u.id = p.user_id
   order by p.role_key, u.email`)).rows;

const total = (await c.query("select count(*)::int n from public.projects")).rows[0].n;

const seen = async (u) => {
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: u.uid, role: "authenticated", email: u.email })]);
    const r = await c.query("select count(*)::int n from public.projects");
    return r.rows[0].n;
  } catch (e) {
    return `ERR ${e.message.slice(0, 40)}`;
  } finally {
    await c.query("rollback");
  }
};

const before = existsSync(SNAPSHOT) && !SAVE
  ? JSON.parse(readFileSync(SNAPSHOT, "utf8")) : null;

const now = {};
const rows = [];
for (const u of users) {
  const n = await seen(u);
  now[u.email] = n;
  rows.push({
    email: u.email,
    role: u.role,
    person_id: u.person_id ?? "(null)",
    before: before ? (before[u.email] ?? "-") : "-",
    after: n,
  });
}

if (SAVE) {
  writeFileSync(SNAPSHOT, JSON.stringify(now, null, 2));
  console.log(`Saved BEFORE snapshot to ${SNAPSHOT}`);
}

const w = (s, n) => String(s).padEnd(n);
console.log(`\nprojects total (service role): ${total}\n`);
console.log(w("email", 42) + w("role", 16) + w("person_id", 18) + w("BEFORE", 8) + "AFTER");
console.log("-".repeat(92));
for (const r of rows) {
  console.log(w(r.email, 42) + w(r.role, 16) + w(r.person_id, 18) + w(r.before, 8) + r.after);
}

const blind = rows.filter((r) => r.after === 0);
console.log(`\n${rows.length - blind.length}/${rows.length} users can see projects.`);
if (blind.length) {
  console.log("Users seeing 0 projects:");
  for (const b of blind) console.log(`  - ${b.email} (${b.role}) person_id=${b.person_id}`);
}

await c.end();

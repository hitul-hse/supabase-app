/**
 * Prove the hoisted entry read policy grants EXACTLY the same access as the one
 * it replaces, on a real Postgres, for every role.
 *
 * The rewrite is a performance change to a SECURITY boundary, which is the most
 * dangerous shape of change in this codebase: if the new predicate is even
 * slightly wider, a dept_head or an employee silently gains access to a
 * colleague's hours and nothing anywhere reports it. Faster and wrong is much
 * worse than slow.
 *
 * So this does not reason about the boolean algebra -- it runs BOTH policies
 * against the same fixture, as each of the four roles, and compares the exact set
 * of entry ids each one returns. Any divergence, in either direction, fails.
 *
 * PGlite rather than the live project, deliberately: this must be able to
 * construct a dept_head who can see some members and not others, which means
 * writing fixture rows. It never touches production.
 *
 * Run: node scripts/check-entry-policy-equivalence.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

const EXEC = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";
const PM = "33333333-3333-3333-3333-333333333333";
const EMP = "44444444-4444-4444-4444-444444444444";

/**
 * The fixture has to make the three branches of the policy DISTINGUISHABLE, or
 * the comparison is vacuous:
 *
 *   - an exec (branch 1 only),
 *   - a dept_head with a colleague in their department (branch 3) AND a member in
 *     another department they must NOT see,
 *   - an employee who can see only their own rows (branch 2),
 *   - a member with no user account at all, whose rows nobody but exec should see.
 */
await db.exec(`
  insert into auth.users (id, email) values
    ('${EXEC}','e@x.com'), ('${HEAD}','h@x.com'), ('${PM}','p@x.com'), ('${EMP}','emp@x.com');

  insert into people (id, name, department, role) values
    ('p-exec','Exec','ENG','Chief'),
    ('p-head','Head','ENG','Lead'),
    ('p-eng','Engineer','ENG','Consultant'),
    ('p-sales','Sales','SALES','Consultant'),
    ('p-emp','Employee','SALES','Consultant');

  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}','p-exec','exec','ENG',true),
    ('${HEAD}','p-head','dept_head','ENG',true),
    ('${PM}','p-eng','project_manager','ENG',true),
    ('${EMP}','p-emp','employee','SALES',true);

  insert into time.member (id, display_name, user_id, hub_person_id, weekly_hours) overriding system value values
    (1,'Exec Member','${EXEC}','p-exec',40),
    (2,'Head Member','${HEAD}','p-head',40),
    (3,'Eng Member','${PM}','p-eng',40),
    (4,'Sales Member',null,'p-sales',40),
    (5,'Employee Member','${EMP}','p-emp',40),
    (6,'Unlinked Member',null,null,40);
  select setval(pg_get_serial_sequence('time.member','id'), 6);

  insert into time.customer (id, name) overriding system value values (1,'Kunde');
  select setval(pg_get_serial_sequence('time.customer','id'), 1);
  insert into time.project (id, name, customer_id, estimated_hours) overriding system value values (1,'Projekt',1,10);
  select setval(pg_get_serial_sequence('time.project','id'), 1);

  -- One entry per member, so the returned id set maps 1:1 onto "which members can
  -- this caller see".
  insert into time.entry (id, member_id, project_id, customer_id, started_at, ended_at, duration_seconds, is_billable, is_calendar)
    overriding system value values
    (101,1,1,1,'2026-07-01T09:00:00Z','2026-07-01T10:00:00Z',3600,true,false),
    (102,2,1,1,'2026-07-02T09:00:00Z','2026-07-02T10:00:00Z',3600,true,false),
    (103,3,1,1,'2026-07-03T09:00:00Z','2026-07-03T10:00:00Z',3600,true,false),
    (104,4,1,1,'2026-07-04T09:00:00Z','2026-07-04T10:00:00Z',3600,true,false),
    (105,5,1,1,'2026-07-05T09:00:00Z','2026-07-05T10:00:00Z',3600,true,false),
    (106,6,1,1,'2026-07-06T09:00:00Z','2026-07-06T10:00:00Z',3600,false,true);
  select setval(pg_get_serial_sequence('time.entry','id'), 106);
`);

/** Which entry ids can this user read, under whatever policy is installed? */
async function visibleAs(uid) {
  await db.exec("begin");
  await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}';`);
  try {
    const r = await db.query("select id from time.entry order by id");
    await db.exec("rollback");
    return r.rows.map((x) => Number(x.id));
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

const ROLES = [
  ["exec", EXEC],
  ["dept_head", HEAD],
  ["project_manager", PM],
  ["employee", EMP],
];

const ORIGINAL = `using (time.can_view_member(member_id))`;
const HOISTED = `using (
  (select app_user_role()) = 'exec'
  or member_id = (select time.current_member_id())
  or time.can_view_member(member_id)
)`;

/**
 * The predicate THAT ACTUALLY SHIPS, extracted from schema.sql.
 *
 * WHY THIS IS READ FROM THE FILE rather than trusted to equal HOISTED above: this
 * gate originally compared two hardcoded strings, which proves the rewrite I made
 * is access-equivalent -- but says nothing about what schema.sql contains today.
 * scripts/verify-policy-gate-fails.mjs demonstrated the hole by replacing the
 * policy in schema.sql with `using (true)`, a change that lets every authenticated
 * user read every entry, and this gate still exited 0.
 *
 * That is the difference between "my refactor was sound" and "the shipped policy is
 * sound", and only the second is worth a gate. So the shipped text is extracted and
 * asserted against the same fixture as the other two.
 *
 * Extracted by regex over whitespace, because schema.sql is stored CRLF here and a
 * literal match silently finds nothing.
 */
const schemaSrc = readFileSync("supabase/schema.sql", "utf8");
const shippedMatch =
  /create policy "scoped read of entry" on time\.entry\s*\r?\n?\s*for select to authenticated (using \([\s\S]*?\));/.exec(
    schemaSrc,
  );
const SHIPPED = shippedMatch ? shippedMatch[1] : null;

async function installPolicy(usingClause) {
  await db.exec(`
    drop policy if exists "scoped read of entry" on time.entry;
    create policy "scoped read of entry" on time.entry
      for select to authenticated ${usingClause};
  `);
}

// Baseline: the ORIGINAL predicate, whatever schema.sql now says, so the
// comparison is against the behaviour that shipped rather than against my
// description of it.
await installPolicy(ORIGINAL);
const before = {};
for (const [name, uid] of ROLES) before[name] = await visibleAs(uid);

await installPolicy(HOISTED);
const after = {};
for (const [name, uid] of ROLES) after[name] = await visibleAs(uid);

console.log("--- access is identical under both policies ------------------------");
for (const [name] of ROLES) {
  const b = before[name];
  const a = after[name];
  check(
    `${name}: sees exactly the same entries`,
    Array.isArray(b) && Array.isArray(a) && b.length === a.length && b.every((x, i) => x === a[i]),
    `original ${JSON.stringify(b)} vs hoisted ${JSON.stringify(a)}`,
  );
}

console.log("\n--- and the access model is still the intended one -----------------");
check("exec reads every entry", after.exec.length === 6, JSON.stringify(after.exec));
check(
  "employee reads ONLY their own entry",
  after.employee.length === 1 && after.employee[0] === 105,
  JSON.stringify(after.employee),
);
check(
  "dept_head reads their own department but not another's",
  after.dept_head.includes(102) && after.dept_head.includes(103) && !after.dept_head.includes(105),
  `dept_head saw ${JSON.stringify(after.dept_head)} — 105 is the SALES employee and must be absent`,
);
check(
  "nobody but exec reads the unlinked member's entry",
  !after.dept_head.includes(106) && !after.employee.includes(106) && !after.project_manager.includes(106),
  "an entry whose member has no account must not leak to non-execs",
);

console.log("\n--- negative control ----------------------------------------------");
// If the fixture cannot distinguish the roles, every assertion above is vacuous:
// a policy of `using (true)` would pass them all.
check(
  "the fixture actually discriminates between roles",
  after.exec.length > after.dept_head.length && after.dept_head.length > after.employee.length,
  `exec ${after.exec.length}, dept_head ${after.dept_head.length}, employee ${after.employee.length} — these must differ or the comparison proves nothing`,
);

// And prove a genuinely WIDER predicate would be caught, so the equality check
// above is not passing for a trivial reason.
await installPolicy("using (true)");
const wide = {};
for (const [name, uid] of ROLES) wide[name] = await visibleAs(uid);
check(
  "control: a deliberately permissive policy IS detected as different",
  wide.employee.length !== after.employee.length,
  `using(true) gave the employee ${wide.employee.length} rows and the hoisted policy ${after.employee.length}; if these matched, this gate could not detect a privilege leak`,
);

console.log("\n--- THE POLICY THAT ACTUALLY SHIPS grants the same access -----------");
// This is the assertion that makes this a gate on the product rather than on my
// refactor. Without it, editing schema.sql's policy to `using (true)` left this
// script passing -- demonstrated by scripts/verify-policy-gate-fails.mjs.
check(
  "the entry read policy could be extracted from schema.sql",
  SHIPPED !== null,
  "could not find `create policy \"scoped read of entry\"` in supabase/schema.sql -- if the policy moved, this gate is blind and must be updated",
);

if (SHIPPED !== null) {
  await installPolicy(SHIPPED);
  const shipped = {};
  for (const [name, uid] of ROLES) shipped[name] = await visibleAs(uid);

  for (const [name] of ROLES) {
    const b = before[name];
    const s = shipped[name];
    check(
      `${name}: the SHIPPED schema.sql policy grants exactly the original access`,
      Array.isArray(b) && Array.isArray(s) && b.length === s.length && b.every((x, i) => x === s[i]),
      `original ${JSON.stringify(b)} vs shipped ${JSON.stringify(s)}`,
    );
  }

  // And the specific catastrophe, called out by name: a permissive policy would
  // show up as the employee seeing more than their own row.
  check(
    "the shipped policy does not let an employee read other people's hours",
    shipped.employee.length === 1 && shipped.employee[0] === 105,
    `employee saw ${JSON.stringify(shipped.employee)} -- more than one row here means the policy has been widened`,
  );
}

console.log("\n--- the hoisted predicate is what lands in the catalogue -----------");
await installPolicy(HOISTED);
const qual = await db.query(
  `select qual from pg_policies where schemaname='time' and tablename='entry' and policyname='scoped read of entry'`,
);
const text = String(qual.rows[0]?.qual ?? "");
check(
  "the stored policy contains hoisted scalar subqueries",
  // Postgres reprints the qual with its own spacing and an added output alias, so
  // the stored text is `( SELECT app_user_role() AS app_user_role)` and the
  // schema-qualified name comes back quoted as `"time".current_member_id()`.
  // Matching my source formatting instead of the CATALOGUE's failed here while the
  // policy was correct, which is a test bug and worth naming rather than loosening
  // into meaninglessness: both subqueries must still be present.
  /\(\s*SELECT\s+app_user_role\(\)/i.test(text) &&
    /\(\s*SELECT\s+"?time"?\.current_member_id\(\)/i.test(text),
  `qual is: ${text}`,
);
// The per-row call must STILL be there: dropping it would make the policy faster
// and wrong, since the department branch lives inside can_view_member.
check(
  "the per-row department check is still delegated to can_view_member",
  /can_view_member\(member_id\)/i.test(text),
  `qual is: ${text} — without this branch a dept_head loses access to their department`,
);

console.log(
  failed
    ? "\nENTRY POLICY EQUIVALENCE: the rewrite CHANGES access — do not ship it\n"
    : "\nENTRY POLICY EQUIVALENCE: identical access for every role, and faster\n",
);
process.exit(failed ? 1 : 0);

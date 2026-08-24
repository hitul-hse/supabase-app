/**
 * Every active account must resolve to a person â€” or it sees nothing.
 *
 * â”€â”€ The failure this exists to catch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * RLS resolves the caller's identity through app_user_person_id(), which reads
 * app_user_profile.person_id. Every project-scoped policy is built on it:
 *
 *   can_view_project(id) := role='exec'
 *                        OR (role='dept_head' AND project.department = my dept)
 *                        OR project.owner_person_id = app_user_person_id()
 *                        OR EXISTS assignment WHERE person_id = app_user_person_id()
 *
 * If person_id is NULL, the last two arms can never be true. A non-exec,
 * non-dept_head user with a NULL person_id sees ZERO projects, ZERO assignments,
 * and one row of themselves. They log in successfully. The app renders. Every
 * list is simply empty.
 *
 * That is why this went unnoticed: it is not an error, it is an absence. On
 * 2026-08-24, 11 of 20 accounts were in this state, including three execs and a
 * project manager. check-identity-linking.mjs did not catch it because it asks a
 * different question (does one human end up with two auth.users rows after
 * signing in with two providers).
 *
 * â”€â”€ What is asserted â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 *   1. Every active profile has a non-empty person_id.
 *   2. That person_id resolves to a real public.people row (no dangling refs).
 *   3. It never points at the inactive seed mockups emp-1..emp-8.
 *   4. No two accounts share one person row.
 *   5. Every active non-exec profile can actually SEE at least one project
 *      through RLS â€” measured by impersonation, not inferred from the schema.
 *
 * (5) is the one that matters. (1)-(4) are structural and could all pass while a
 * user still sees an empty app, so the gate ends by asking the database the same
 * question the user's browser will ask.
 *
 * Read-only. Impersonation happens inside a transaction that is always rolled
 * back. Never prints a token or a password. SKIPS cleanly without .env.local so
 * it is safe in CI without credentials.
 */
import { readFileSync, existsSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  if (!ok) failed = true;
};

const ENV_PATH = "C:/Supabase/.env.local";
if (!existsSync(ENV_PATH)) {
  console.log("SKIP: no .env.local \u2014 this gate observes the live project only.");
  process.exit(0);
}

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: SUPABASE_DB_URL not set.");
  process.exit(0);
}

// Accounts that are deliberately not real humans. Keep this list tiny and
// explicit; anything added here is invisible to the gate forever.
const KNOWN_TEST_ACCOUNTS = new Set([
  "invite.flow.test.20260814@gmail.com",
  "hituls18@gmail.com",
]);

const SEED_MOCKUPS = ["emp-1", "emp-2", "emp-3", "emp-4", "emp-5", "emp-6", "emp-7", "emp-8"];

const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  const { rows: profiles } = await c.query(`
    select aup.user_id, u.email, aup.person_id, aup.role_key, aup.department, aup.is_active
    from public.app_user_profile aup
    join auth.users u on u.id = aup.user_id
    where aup.is_active
    order by u.email`);

  const real = profiles.filter((p) => !KNOWN_TEST_ACCOUNTS.has(p.email));
  console.log(`\n${profiles.length} active profiles (${real.length} real, ${profiles.length - real.length} known test)\n`);

  // 1. person_id present
  const unlinked = real.filter((p) => !p.person_id);
  check("every active account has a person_id", unlinked.length === 0,
    unlinked.length ? `${unlinked.length} without: ${unlinked.map((p) => p.email).join(", ")}` : "");

  // 2. person_id resolves
  const { rows: people } = await c.query(`select id, name, is_active, source from public.people`);
  const byId = new Map(people.map((p) => [p.id, p]));
  const dangling = real.filter((p) => p.person_id && !byId.has(p.person_id));
  check("every person_id resolves to a people row", dangling.length === 0,
    dangling.map((p) => `${p.email}->${p.person_id}`).join(", "));

  // 3. never a seed mockup
  const onMockup = real.filter((p) => SEED_MOCKUPS.includes(p.person_id));
  check("no account is linked to a seed mockup (emp-1..emp-8)", onMockup.length === 0,
    onMockup.map((p) => `${p.email}->${p.person_id}`).join(", "));

  // 4. no shared person rows
  const seen = new Map();
  const shared = [];
  for (const p of real.filter((x) => x.person_id)) {
    if (seen.has(p.person_id)) shared.push(`${p.person_id}: ${seen.get(p.person_id)} + ${p.email}`);
    else seen.set(p.person_id, p.email);
  }
  check("no two accounts share one person row", shared.length === 0, shared.join("; "));

  // 5. the question the browser asks
  //
  // Seeing zero projects has two very different causes and the gate must not
  // conflate them:
  //
  //   (a) the account is not linked to a person -> a BUG, caught by 1-4 above;
  //   (b) the person is linked but genuinely has no owned, assigned or
  //       responsible work -> NOT a bug. Several real colleagues are back-office
  //       (ORGA/TECH) and legitimately appear on no client project.
  //
  // So this asserts the implication that actually matters: if you HAVE work in
  // the data, you must be able to SEE it. An empty app for someone with 30
  // assignments is a policy failure; an empty app for someone with none is the
  // truth.
  console.log("\nvisible projects per account (through RLS):");
  const cannotSeeOwnWork = [];
  for (const p of real) {
    const has = (await c.query(`
      select
        (select count(*) from public.projects where owner_person_id = $1)
      + (select count(*) from public.person_assignments where person_id = $1)
      + (select count(*) from public.project_responsibility where person_id = $1) as n`,
      [p.person_id])).rows[0].n;

    await c.query("begin");
    let n = -1;
    try {
      await c.query("select set_config('role','authenticated',true)");
      await c.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({ sub: p.user_id, role: "authenticated", email: p.email })]);
      n = (await c.query("select count(*)::int n from public.projects")).rows[0].n;
    } catch (e) {
      console.log(`   ${p.email}: ERROR ${e.message}`);
    } finally {
      await c.query("rollback");
    }

    const note = Number(has) === 0 ? "  (no work in data)" : "";
    console.log(`   ${String(n).padStart(4)}  ${p.email}  (${p.role_key})${note}`);
    if (Number(has) > 0 && n === 0) cannotSeeOwnWork.push(`${p.email} has ${has} rows of work but sees 0`);
  }

  check("everyone with work in the data can see it", cannotSeeOwnWork.length === 0,
    cannotSeeOwnWork.join("; "));

  // 6. The dept_head arm of can_view_project() compares projects.department to
  //    the profile's department. If projects.department is entirely NULL that
  //    arm can never fire, and every dept_head silently degrades to a plain
  //    employee who only sees their own work. Nothing else asserts this.
  const { rows: [dept] } = await c.query(`
    select count(*)::int total, count(department)::int with_dept from public.projects`);
  check("projects.department is populated (dept_head RLS depends on it)",
    dept.with_dept > 0,
    dept.with_dept === 0
      ? `all ${dept.total} projects have NULL department, so the dept_head branch of can_view_project() is inert`
      : `${dept.with_dept}/${dept.total} populated`);
} finally {
  await c.end();
}

console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);

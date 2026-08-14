// Proves supabase/verify-policies.sql is correct before a human pastes it into
// the production SQL Editor. Runs it against PGlite twice:
//   1. on the FIXED schema  -> every row must read OK
//   2. on a REGRESSED schema -> the corresponding rows must NOT read OK
// Without the second run, the query could be returning OK unconditionally.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const schema = readFileSync("supabase/schema.sql", "utf8");
const query = readFileSync("supabase/verify-policies.sql", "utf8");

async function run(regression) {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  if (regression) await db.exec(regression);
  const res = await db.query(query);
  await db.close();
  return res.rows;
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

// --- Arm 1: the fixed schema. Everything must be OK. ---
console.log("=== against the FIXED schema ===");
const good = await run(null);
for (const r of good) {
  console.log(`  ${r.verdict.padEnd(12)} ${r.fix}`);
}
check("query returns 5 rows", good.length === 5, `got ${good.length}`);
check("every verdict is OK on the fixed schema", good.every((r) => r.verdict === "OK"));

// --- Arm 2: regress each fix; the query must notice. ---
console.log("\n=== against a REGRESSED schema (query must catch each) ===");
const regressed = await run(`
  drop policy "exec and dept_head can update approval_decisions" on approval_decisions;
  create policy "exec and dept_head can update approval_decisions"
    on approval_decisions for update to authenticated
    using (app_user_role() in ('exec','dept_head'));

  drop policy "exec can insert profiles" on app_user_profile;
  drop policy "exec can update profiles" on app_user_profile;
  drop policy "exec can delete profiles" on app_user_profile;

  create or replace function app_user_role() returns text
  language sql stable security definer set search_path = public as $$
    select role_key from app_user_profile where user_id = auth.uid();
  $$;
`);

for (const r of regressed) {
  console.log(`  ${r.verdict.padEnd(12)} ${r.fix}`);
}

const byFix = Object.fromEntries(regressed.map((r) => [r.fix, r.verdict]));
check(
  "catches a WITH CHECK that was removed",
  byFix["approval_decisions UPDATE has WITH CHECK"] !== "OK",
  byFix["approval_decisions UPDATE has WITH CHECK"],
);
for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
  check(`catches a dropped ${cmd} policy`, byFix[`app_user_profile has ${cmd} policy`] === "MISSING");
}
check(
  "catches a helper that stopped filtering on is_active",
  byFix["role helpers filter on is_active"] !== "OK",
  byFix["role helpers filter on is_active"],
);

console.log(
  failed
    ? `\n${failed} problem(s): the verification query is not trustworthy.`
    : `\nverify-policies.sql is correct: all OK on the fixed schema, and it catches every regression.`,
);
process.exit(failed ? 1 : 0);

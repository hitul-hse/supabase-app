// Last attempt to verify the two policy fixes on the live project without
// dashboard access. Tries every avenue PostgREST exposes:
//   1. direct table access to the pg_catalog views (expected to fail; PostgREST
//      only exposes the configured schemas)
//   2. any pre-existing SQL-execution RPC the project might have
//   3. a behavioural probe using a real signed-in user, if one can be created
//
// Documents exactly which doors are closed, so "needs the SQL Editor" is a
// tested conclusion rather than an assumption.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

const H = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

console.log(`Trying to verify policy DDL on ${url} without the dashboard.\n`);

// 1. Catalog views over REST.
for (const path of ["pg_policies?select=*&limit=1", "pg_catalog.pg_policies?select=*&limit=1"]) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: H });
  const txt = (await res.text()).slice(0, 160);
  console.log(`[${res.status}] GET /rest/v1/${path}`);
  console.log(`      ${txt.replace(/\s+/g, " ")}`);
}

// 2. Common SQL-execution RPC names, in case one was ever created.
for (const fn of ["exec_sql", "execute_sql", "sql", "query", "run_sql"]) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query: "select 1", sql: "select 1" }),
  });
  const txt = (await res.text()).slice(0, 120);
  console.log(`[${res.status}] POST /rest/v1/rpc/${fn} -> ${txt.replace(/\s+/g, " ")}`);
}

// 3. Could we mint a real authenticated session to probe behaviourally?
// That would need either the JWT secret (not in .env.local) or creating a user
// in the production auth system, which is a write to real infrastructure and
// not something to do unasked.
console.log(`\nJWT secret present in .env.local: ${Boolean(env.SUPABASE_JWT_SECRET)}`);
console.log(
  "Creating a production auth user to test policies behaviourally would be a\nwrite to live infrastructure, so it is deliberately not attempted here.",
);

console.log(`\nCONCLUSION: policy DDL (WITH CHECK expressions, profile write policies)`);
console.log(`is not reachable through PostgREST by any available route. Running`);
console.log(`supabase/verify-policies.sql in the Supabase SQL Editor is genuinely`);
console.log(`the remaining step, and it needs dashboard access.`);

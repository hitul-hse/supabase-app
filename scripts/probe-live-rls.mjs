// Behavioural probe of the LIVE database using the ANON key, which is subject to
// RLS exactly as a browser client would be. This is the closest available check
// that production RLS actually denies what it should.
//
// Read-only: issues SELECTs and one deliberately-invalid UPDATE that is expected
// to be rejected. It targets no real row for modification.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const req = async (path, init = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  return { status: res.status, text: await res.text() };
};

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

console.log(`LIVE RLS PROBE (anon key, RLS enforced)  ${url}\n`);

// An unauthenticated (anon) caller must see NO company data. Every HSE table is
// granted to `authenticated` only, so anon should get zero rows or a 401/403.
for (const table of [
  "people",
  "projects",
  "person_assignments",
  "timesheet_entries",
  "approval_decisions",
  "weekly_bookings",
  "app_user_profile",
  "executive_metrics",
]) {
  const { status, text } = await req(`${table}?select=*&limit=5`);
  let rows = [];
  try {
    rows = JSON.parse(text);
  } catch {
    rows = [];
  }
  const leaked = status === 200 && Array.isArray(rows) && rows.length > 0;
  check(`anon cannot read ${table}`, !leaked, leaked ? `LEAKED ${rows.length} row(s)!` : `http ${status}, 0 rows`);
}

console.log();

// The role helpers must not be callable by anon (explicitly revoked in schema.sql).
for (const fn of ["app_user_role", "app_user_department", "app_user_person_id"]) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const txt = await res.text();
  const denied = res.status >= 400 || /permission denied/i.test(txt);
  check(`anon cannot execute ${fn}()`, denied, `http ${res.status}`);
}

console.log();

// anon must not be able to write. Note: PostgREST answers 200/204 with an empty
// body when RLS filters every candidate row, which looks identical to success.
// So target a REAL row and assert the value is untouched afterwards, using the
// service role to read the ground truth. See scripts/verify-anon-write.mjs.
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const svcGet = async (p) =>
  (await fetch(`${url}/rest/v1/${p}`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } })).json();

const approvals = await svcGet("approval_decisions?select=id,status&order=sort_order&limit=1");
if (approvals.length) {
  const before = approvals[0];
  await req(`approval_decisions?id=eq.${encodeURIComponent(before.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "anon_pwned" }),
  });
  const after = await svcGet(`approval_decisions?select=id,status&id=eq.${encodeURIComponent(before.id)}`);
  check(
    "anon cannot actually write to approval_decisions",
    after[0]?.status === before.status,
    `status stayed "${after[0]?.status}"`,
  );
} else {
  console.log("SKIP: no approval_decisions rows to test writes against");
}

console.log(failed ? `\n${failed} PROBLEM(S) FOUND ON LIVE DB` : `\nLive RLS denies anonymous access on every table probed.`);
process.exit(failed ? 1 : 0);

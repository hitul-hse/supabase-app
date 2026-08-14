// Is the anon UPDATE 204 a real write capability, or just an empty no-op match?
// PostgREST returns 204 for an UPDATE that matched zero rows, which is
// indistinguishable from a successful write unless we verify against real data.
// This targets a REAL row id and then confirms, with the service role, that
// nothing changed.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

const asSvc = async (p, init = {}) =>
  fetch(`${url}/rest/v1/${p}`, { ...init, headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json", ...(init.headers || {}) } });

// Read real approval rows with the service role (bypasses RLS).
const rows = await (await asSvc("approval_decisions?select=id,status,title&order=sort_order")).json();
console.log(`live approval_decisions rows: ${rows.length}`);
if (!rows.length) {
  console.log("no rows to test against; inconclusive");
  process.exit(0);
}

const target = rows[0];
console.log(`target: id=${target.id} status="${target.status}"\n`);

// Attempt, as anon, to set an obviously invalid status on a REAL row.
const attempt = await fetch(`${url}/rest/v1/approval_decisions?id=eq.${encodeURIComponent(target.id)}`, {
  method: "PATCH",
  headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({ status: "anon_pwned" }),
});
const attemptBody = await attempt.text();
console.log(`anon PATCH on a real row -> http ${attempt.status}`);
console.log(`response body: ${attemptBody || "(empty)"}`);

// Verify with the service role whether the value actually changed.
const after = await (await asSvc(`approval_decisions?select=id,status&id=eq.${encodeURIComponent(target.id)}`)).json();
const changed = after[0]?.status !== target.status;

console.log(`\nstatus before: "${target.status}"`);
console.log(`status after:  "${after[0]?.status}"`);

if (changed) {
  console.log("\nFAIL: anon actually WROTE to the live database. This is a real vulnerability.");
  process.exit(1);
}
console.log(
  "\nPASS: the row is unchanged. The 204 was PostgREST reporting zero matched rows\n(RLS filtered them out), not a successful write. anon cannot write.",
);

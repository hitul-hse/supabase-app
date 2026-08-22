/**
 * Verify the migrations landed on the LIVE project, over the REST API.
 *
 * WHY REST. Applying needs DDL and a direct Postgres connection, which is not
 * available here. But VERIFYING only needs reads, and the service key can do
 * those -- so the half I can do, I do. This is the difference between "I pasted
 * something and it said success" and knowing the four permissions the user was
 * refused now exist and are granted to their role.
 *
 * Run after pasting supabase/APPLY-IN-SQL-EDITOR.sql:
 *   node scripts/verify-migrations-applied.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const timeDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "time" }, auth: { persistSession: false } },
);

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("verifying against the LIVE project\n");

/* ------------------------------------------------ the four missing keys */

const NEEDED = [
  "projects:contracts:read",
  "projects:contracts:write",
  "projects:alerts:read",
  "projects:alerts:acknowledge",
];
const { data: perms, error: permErr } = await db
  .from("app_permission")
  .select("permission_key, resource, action, display_name")
  .in("permission_key", NEEDED)
  .order("permission_key");

if (permErr) {
  check("the permission table is readable", false, permErr.message);
} else {
  const have = new Set((perms ?? []).map((p) => p.permission_key));
  for (const k of NEEDED) check(`permission ${k} exists`, have.has(k));
  check(
    "resource and action are populated on each",
    (perms ?? []).every((p) => p.resource && p.action),
    (perms ?? []).map((p) => `${p.permission_key}->${p.resource}/${p.action}`).join(" "),
  );
}

/*
 * THE USER'S ACTUAL COMPLAINT. An executive was told their role was not
 * eligible. Assert exec now holds the read capability.
 */
const { data: execGrants } = await db
  .from("app_role_permission")
  .select("permission_key")
  .eq("role_key", "exec")
  .in("permission_key", NEEDED)
  .order("permission_key");
check(
  "exec holds all four new capabilities (the refusal the user hit)",
  (execGrants ?? []).length === 4,
  (execGrants ?? []).map((g) => g.permission_key).join(", ") || "NONE",
);

const { data: allGrants } = await db
  .from("app_role_permission")
  .select("role_key, permission_key")
  .in("permission_key", NEEDED);
const byKey = {};
for (const g of allGrants ?? []) (byKey[g.permission_key] ??= []).push(g.role_key);
console.log("\n  grants per capability:");
for (const k of NEEDED) {
  console.log(`    ${k.padEnd(30)} ${(byKey[k] ?? []).sort().join(", ") || "(none)"}`);
}

/* -------------------------------------------------- tables, views, data */

console.log("");
const { error: cpErr } = await timeDb.from("project_contract_period").select("id").limit(1);
check("time.project_contract_period is reachable", !cpErr, cpErr?.message?.slice(0, 70) ?? "");

const { data: statusRows, error: stErr } = await timeDb
  .from("contract_period_status")
  .select("project_id, period_no, budget_hours, logged_hours, burn_percent")
  .order("project_id")
  .limit(5);
check("time.contract_period_status is reachable", !stErr, stErr?.message?.slice(0, 70) ?? "");

const { error: feedErr } = await db.from("budget_alert_feed").select("id").limit(1);
check("public.budget_alert_feed is reachable", !feedErr, feedErr?.message?.slice(0, 70) ?? "");

// The renewal function must be callable (a bad-permission error proves it
// EXISTS, which is what is being checked here).
const { error: rpcErr } = await timeDb.rpc("renew_contract_period", {
  p_project_id: -1,
  p_budget_hours: 1,
  p_starts_on: "2099-01-01",
  p_ends_on: "2099-12-31",
});
check(
  "time.renew_contract_period exists",
  !rpcErr || !/could not find|does not exist/i.test(rpcErr.message),
  rpcErr ? rpcErr.message.slice(0, 90) : "callable",
);

// Existing alerts must have survived and been classified.
const { data: alerts } = await db
  .from("budget_alert_feed")
  .select("kind, email_state, project_name, blocked_the_booking")
  .order("created_at", { ascending: false })
  .limit(5);
if (alerts) {
  check("existing alert rows survived and carry a kind", alerts.every((a) => a.kind));
  console.log("\n  most recent alerts now visible in /admin/alerts:");
  for (const a of alerts) {
    console.log(
      `    ${a.kind.padEnd(17)} ${a.blocked_the_booking ? "BLOCKED" : "warned "} ` +
        `${String(a.email_state).padEnd(14)} ${String(a.project_name).slice(0, 46)}`,
    );
  }
}

// The vendor-owned column must be untouched.
const { data: est } = await timeDb
  .from("project")
  .select("id")
  .not("estimated_hours", "is", null)
  .gt("estimated_hours", 0)
  .order("id");
check(
  "time.project.estimated_hours is intact (the sync still owns it)",
  (est ?? []).length > 0,
  `${(est ?? []).length} projects still carry a vendor estimate`,
);

if (statusRows?.length) {
  console.log("\n  contract periods recorded so far:");
  for (const r of statusRows) {
    console.log(
      `    project ${r.project_id} period ${r.period_no}: ` +
        `${r.logged_hours}h of ${r.budget_hours}h (${r.burn_percent}%)`,
    );
  }
} else {
  console.log("\n  no contract periods recorded yet — that is step 2.");
}

console.log(
  failed === 0
    ? "\nLIVE VERIFICATION PASSED. Budget Alerts and the contract panel are now usable.\n" +
        "Next: open a project and record its contract terms."
    : `\n${failed} check(s) failed — the paste may not have run, or only partly.`,
);
process.exit(failed === 0 ? 0 : 1);

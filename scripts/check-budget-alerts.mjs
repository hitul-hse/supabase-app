/**
 * Execute the budget-alert visibility migration against a REAL Postgres
 * (PGlite), and prove the properties the feature depends on.
 *
 * The user applies migrations by hand, so "it probably works" is not good
 * enough: a migration that dies halfway leaves them mid-apply. Two earlier
 * migrations in this repo failed exactly that way (a NOT NULL column, then a
 * non-idempotent `create policy`), which is why every claim below is executed.
 *
 * The property that actually matters here is the anti-spam index. Without it a
 * project sitting at 85% raises an identical alert on every entry somebody
 * logs, sales stop reading the list, and the feature fails the same way the
 * missing email did -- just more slowly.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const schema = readFileSync("supabase/schema.sql", "utf8");
// Ordered as the user will apply them: contract periods, then this.
const contracts = readFileSync("supabase/migrations/add_contract_periods.sql", "utf8");
const overbooking = readFileSync("supabase/migrations/add_overbooking_alerts.sql", "utf8");
const migration = readFileSync("supabase/migrations/add_budget_alert_visibility.sql", "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  await db.exec(overbooking);
  await db.exec(contracts);
  return db;
};

const db = await fresh();
console.log("base schema + prerequisite migrations applied\n");

try {
  await db.exec(migration);
  check("the migration executes without error", true);
} catch (e) {
  check("the migration executes without error", false, String(e.message).split("\n")[0]);
  console.log("\nBUDGET ALERTS: FAILED");
  process.exit(1);
}

{
  const d2 = await fresh();
  await d2.exec(migration);
  let ok = true;
  let detail = "";
  try {
    await d2.exec(migration);
  } catch (e) {
    ok = false;
    detail = String(e.message).split("\n")[0];
  }
  await d2.close();
  check("re-running it is safe (idempotent)", ok, detail);
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const attempt = async (sql) => {
  try { await db.exec(sql); return null; } catch (e) { return String(e.message).split("\n")[0]; }
};

/* ------------------------------------------------------------- the columns */

const cols = (await all(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'overbooking_alert'
`)).map((r) => r.column_name);
for (const c of ["kind", "contract_period_id", "threshold_percent", "acknowledged_at", "acknowledged_by"]) {
  check(`column ${c} exists`, cols.includes(c));
}

// Existing rows must stay valid and be classified correctly, not silently
// become an invalid 'kind'.
const kindDefault = await one(`
  select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'overbooking_alert' and column_name = 'kind'
`);
check(
  "kind defaults to 'over' so pre-existing refusal rows stay correct",
  /over/.test(String(kindDefault.column_default)),
  String(kindDefault.column_default),
);

check(
  "an invalid kind is rejected by the CHECK constraint",
  (await attempt(`
    insert into public.overbooking_alert
      (actor_name, project_id, project_name, budget_hours, logged_hours, requested_hours,
       projected_hours, over_by_hours, reason, source, kind)
    values ('T', 1, 'P', 5, 1, 1, 2, 0, 'r', 'create_entry', 'nonsense')
  `)) !== null,
);

/* --------------------------------------------------- THE ANTI-SPAM PROPERTY */

const seedAlert = (kind, threshold, project = 1) => `
  insert into public.overbooking_alert
    (actor_name, project_id, project_name, budget_hours, logged_hours, requested_hours,
     projected_hours, over_by_hours, reason, source, kind, threshold_percent)
  values ('Test Person', ${project}, 'WorkMotion GU', 5, 4.2, 0.5, 4.7, 0, 'approaching', 'create_entry',
          '${kind}', ${threshold === null ? "null" : threshold})
`;

check(
  "the first approaching alert is recorded",
  (await attempt(seedAlert("approaching", 80))) === null,
);

const dupe = await attempt(seedAlert("approaching", 80));
check(
  "a SECOND identical open alert is rejected — the state changing is the event",
  dupe !== null,
  dupe ?? "the duplicate was accepted, so every booking would raise another row",
);

// A DIFFERENT kind on the same project is a different situation and must alert.
check(
  "a different kind on the same project IS allowed",
  (await attempt(seedAlert("over", 100))) === null,
);

// Null threshold must still dedupe. Without coalesce() in the index, null != null
// would let unlimited duplicates through -- the exact case this prevents.
check(
  "an alert with no threshold is recorded",
  (await attempt(seedAlert("outside_contract", null))) === null,
);
const dupeNull = await attempt(seedAlert("outside_contract", null));
check(
  "and a duplicate with NULL threshold is still rejected (null != null would have let it through)",
  dupeNull !== null,
  dupeNull ?? "nulls bypassed the unique index",
);

/*
 * Acknowledging must free the situation to alert again: if sales handled it and
 * it recurs, that is new information rather than noise.
 */
await db.exec(`
  update public.overbooking_alert
  set acknowledged_at = now()
  where kind = 'approaching' and project_id = 1
`);
check(
  "once acknowledged, the same situation CAN alert again",
  (await attempt(seedAlert("approaching", 80))) === null,
  "otherwise a handled-then-recurring overrun would stay silent forever",
);

/* ------------------------------------------------------- delivery honesty */

await db.exec(`
  update public.overbooking_alert set notified = null where kind = 'over';
  insert into public.overbooking_alert
    (actor_name, project_id, project_name, budget_hours, logged_hours, requested_hours,
     projected_hours, over_by_hours, reason, source, kind, notified, delivery_error)
  values ('T2', 2, 'P2', 10, 12, 1, 13, 3, 'r', 'create_entry', 'over', false, 'no transport');
  insert into public.overbooking_alert
    (actor_name, project_id, project_name, budget_hours, logged_hours, requested_hours,
     projected_hours, over_by_hours, reason, source, kind, notified)
  values ('T3', 3, 'P3', 10, 12, 1, 13, 3, 'r', 'create_entry', 'over', true);
`);

const states = await all(`select project_id, email_state from public.budget_alert_feed order by project_id`);
const byProject = new Map(states.map((r) => [Number(r.project_id), r.email_state]));
check(
  "notified=null reports as 'not_attempted', NOT as sent",
  byProject.get(1) === "not_attempted",
  `project 1 -> ${byProject.get(1)} (this is the user's actual case: no RESEND_API_KEY)`,
);
check(
  "notified=false reports as 'failed'",
  byProject.get(2) === "failed",
  `project 2 -> ${byProject.get(2)}`,
);
check(
  "notified=true reports as 'sent'",
  byProject.get(3) === "sent",
  `project 3 -> ${byProject.get(3)}`,
);

const blocked = await all(`
  select kind, blocked_the_booking from public.budget_alert_feed group by kind, blocked_the_booking order by kind
`);
const blockMap = new Map(blocked.map((r) => [r.kind, r.blocked_the_booking]));
check(
  "the feed distinguishes alerts that BLOCKED a booking from those that did not",
  blockMap.get("over") === true && blockMap.get("approaching") === false &&
    blockMap.get("outside_contract") === false,
  [...blockMap].map(([k, v]) => `${k}=${v}`).join(" "),
);

/* --------------------------------------------------------------- security */

const perms = await all(`
  select permission_key, resource, action from public.app_permission
  where permission_key like 'projects:alerts:%' order by permission_key
`);
check("both alert permission keys exist", perms.length === 2, JSON.stringify(perms));
check(
  "resource and action are populated (the bug that broke the HR migration)",
  perms.every((p) => p.resource && p.action),
  perms.map((p) => `${p.permission_key} -> ${p.resource}/${p.action}`).join(", "),
);

const ackRoles = (await all(`
  select role_key from public.app_role_permission
  where permission_key = 'projects:alerts:acknowledge' order by role_key
`)).map((r) => r.role_key);
check(
  "only exec and dept_head may acknowledge",
  ackRoles.join(",") === "dept_head,exec",
  ackRoles.join(", "),
);
const readRoles = (await all(`
  select role_key from public.app_role_permission
  where permission_key = 'projects:alerts:read' order by role_key
`)).map((r) => r.role_key);
check(
  "project managers can READ alerts without being able to acknowledge",
  readRoles.includes("project_manager") && !ackRoles.includes("project_manager"),
  readRoles.join(", "),
);

const policies = await all(`
  select policyname, cmd, qual from pg_policies
  where schemaname = 'public' and tablename = 'overbooking_alert' order by policyname
`);
check(
  "there is a read policy and an update policy",
  policies.some((p) => p.cmd === "SELECT") && policies.some((p) => p.cmd === "UPDATE"),
  policies.map((p) => `${p.policyname} (${p.cmd})`).join(" | "),
);
check(
  "a person can always see an alert they triggered themselves",
  policies.some((p) => p.cmd === "SELECT" && /actor_user_id = auth\.uid\(\)/.test(String(p.qual))),
  "being told why your own booking was refused is not privileged information",
);
check(
  "acknowledging is gated on the acknowledge capability",
  policies.some((p) => p.cmd === "UPDATE" && /alerts:acknowledge/.test(String(p.qual))),
);

// The contract link must not cascade an alert away.
const fk = await one(`
  select confdeltype from pg_constraint
  where conrelid = 'public.overbooking_alert'::regclass
    and confrelid = 'time.project_contract_period'::regclass
`);
check(
  "deleting a contract period does NOT delete the alert history",
  fk && fk.confdeltype === "n",
  `on delete = ${fk ? fk.confdeltype : "no fk"} (n = set null)`,
);

await db.close();

/* ===========================================================================
 * The application layer. Static, because the property that matters is
 * structural: no surface may imply an email that was not sent, and that is a
 * claim about every code path rather than one runtime case.
 * =========================================================================== */

const read = (p) => readFileSync(p, "utf8");
const queries = read("src/lib/queries/budget-alerts.ts");
const actions = read("src/app/(app)/admin/alerts/actions.ts");
const list = read("src/app/(app)/admin/alerts/AlertList.tsx");
const watch = read("src/app/(app)/admin/alerts/ContractWatchlist.tsx");
const pageSrc = read("src/app/(app)/admin/alerts/page.tsx");
const nav = read("src/components/SidebarNav.tsx");
const permsSrc = read("src/lib/permissions.ts");

check(
  "the read layer models email state as three values, not a boolean",
  /"not_attempted" | "failed" | "sent"/.test(queries),
  "collapsing them is how an interface claims it sent something it did not",
);
check(
  "the 'not attempted' label names the missing configuration",
  queries.replace(/\s+/g, " ").includes("No email sent (no mail transport configured)"),
);
check(
  "no code path asserts an email was sent without checking the state",
  !/Email sent to/.test(queries.replace(/case "sent":[sS]{0,80}/g, "")),
);

{
  // Comments stripped: an earlier gate in this repo failed on its own prose.
  const code = queries.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const chains = [...code.matchAll(/await[\s\S]{0,600}?\.range\([^)]*\)/g)].map((m) => m[0]);
  const unordered = chains.filter((c) => !c.includes(".order("));
  check(
    "every paged alert read is ordered",
    chains.length === 0 || unordered.length === 0,
    `${chains.length} paged read(s), ${unordered.length} unordered`,
  );
}
check(
  "a missing view degrades to an empty list rather than throwing",
  /if \(error\) return \[\]/.test(queries),
  "the page must work between deploy and migration",
);

check(
  "acknowledging re-checks the capability server-side",
  actions.includes('rpc("app_user_has_permission"') &&
    actions.includes('"projects:alerts:acknowledge"'),
  "a Server Action is a public endpoint; a hidden button proves nothing",
);
check(
  "acknowledging only affects an OPEN alert",
  /\.is\("acknowledged_at", null\)/.test(actions),
  "otherwise a second click overwrites who handled it first",
);
check(
  "the alert id is validated rather than trusted",
  /\[0-9a-f-\]\{36\}/i.test(actions),
);
check(
  "acknowledging is an UPDATE, never a DELETE",
  !/\.delete\(\)/.test(actions),
  "the list is a log; deleting handled alerts destroys the record of an accepted overrun",
);

check(
  "the list states its delivery state on every row",
  list.includes("emailStateLabel"),
);
check(
  "and tells the reader how to enable mail when none is configured",
  /RESEND_API_KEY/.test(list),
  "the alert is recorded either way, and saying so prevents a second silent failure",
);
check(
  "refusals and warnings are visibly separated",
  /Refused bookings/.test(list) && /Warnings/.test(list),
  "flattening them trains people to ignore both",
);
check(
  "a warning says the hours WERE recorded",
  /hours were recorded/i.test(list),
  "the opposite of the refusal case, and the distinction people act on",
);
check(
  "the user's verbatim message is shown",
  /row\.reason/.test(list),
  "if somebody reports 'it would not let me book', this is what they saw",
);
check(
  "timestamps render in Europe/Berlin, not UTC",
  /Europe\/Berlin/.test(list),
);

check(
  "the watchlist is separate from the alert log",
  /ContractWatchlist/.test(pageSrc) && /needs acknowledging/i.test(watch),
  "a deadline is not an event: it needs no acknowledgement and changes on its own",
);
check(
  "an empty watchlist explains itself rather than implying all is well",
  /before sales have entered any agreements/i.test(watch.replace(/\s+/g, " ")),
);

check(
  "the page gates reading on the alerts:read capability",
  pageSrc.includes("PROJECTS_ALERTS_READ"),
);
check(
  "a viewer without the capability is told why",
  /does not include reading budget alerts/i.test(pageSrc),
);

/*
 * THE REGRESSION THIS SECTION EXISTS FOR.
 *
 * An executive holding 32 permissions was told "your role is not eligible" for
 * budget alerts. Their role was fine: the permission key did not exist in the
 * database yet, because the migration was unapplied, so
 * app_user_has_permission returned false for EVERY user. The page reported that
 * as a role problem and sent them looking in exactly the wrong place.
 *
 * "Not installed" and "not permitted" need opposite actions, so any surface
 * that denies access has to tell them apart.
 */
const panel = read("src/app/(app)/projects/ContractPanel.tsx");
const projectPage = read("src/app/(app)/projects/[id]/page.tsx");
const alertQueries = read("src/lib/queries/budget-alerts.ts");

check(
  "there is a way to ask whether a permission key exists at all",
  /export async function permissionKeyExists/.test(alertQueries),
);
check(
  "a read failure assumes the key EXISTS rather than blaming a migration",
  alertQueries.includes("if (error) return true"),
  "a transient fault must not be reported as a missing migration",
);

check(
  "the alerts page distinguishes 'not installed' from 'not permitted'",
  pageSrc.includes("permissionKeyExists") && /registered ?/.test(pageSrc),
);
check(
  "and when not installed it says explicitly that the role is NOT the problem",
  /not a problem with your role/i.test(pageSrc.replace(/\s+/g, " ")),
  "this is the sentence whose absence cost a user their time",
);
check(
  "it names the migrations to apply",
  /add_contract_periods\.sql/.test(pageSrc) &&
    /add_budget_alert_visibility\.sql/.test(pageSrc),
  "an error that does not say what to do next is only half an error",
);
check(
  "it states that the guard still works meanwhile",
  /still records alerts/i.test(pageSrc.replace(/\s+/g, " ")),
);

check(
  "the contract panel takes a featureInstalled flag",
  /featureInstalled: boolean/.test(panel) && /!featureInstalled \\?/.test(panel),
  "canWrite alone is false for everyone when the migration is unapplied",
);
check(
  "the contract panel also says the role is not the problem",
  /not a permission problem/i.test(panel.replace(/\s+/g, " ")),
);
check(
  "the project page computes whether contracts are installed",
  projectPage.includes("permissionKeyExists") && projectPage.includes("contractsInstalled"),
);
check(
  "acknowledge controls are gated on the acknowledge capability",
  pageSrc.includes("PROJECTS_ALERTS_ACKNOWLEDGE"),
);
check(
  "the page is reachable from the sidebar",
  nav.includes('"/admin/alerts"'),
  "an unreachable page is the same as no page",
);
check(
  "both permission keys are in the typed registry",
  permsSrc.includes("PROJECTS_ALERTS_READ") &&
    permsSrc.includes("PROJECTS_ALERTS_ACKNOWLEDGE"),
);

console.log(
  failed === 0
    ? "\nBUDGET ALERTS: recorded once per situation, visible in-app, and honest about email"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);

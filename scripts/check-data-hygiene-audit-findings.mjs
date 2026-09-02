/**
 * Do the four audit-ported hygiene panels say what Postgres says?
 *
 * WHY THIS IS ITS OWN GATE
 * ------------------------
 * /data-hygiene gained four panels ported from the rig's nightly data audit
 * (~/.data-audit/checks A, B, D3, E4). The audit is the thing the exec already
 * trusts -- it runs the SQL below against Postgres and writes a markdown report
 * -- and the panels claim to be the same finding, live. "The same finding" is
 * only true while the page's pairing rule and the audit's agree, and the two
 * are written in different languages against different clients: the audit joins
 * in SQL, the page joins in JavaScript over PostgREST pages. A drift between
 * them is invisible on the page, because a panel that says "31 orders" looks
 * exactly like one that says "33".
 *
 * So this gate runs the audit's SQL verbatim (copied from the check scripts,
 * not paraphrased) over a read-only Postgres connection, runs the page's reader
 * as the exec actually sees it, and requires the count AND the headline hours
 * to agree to the decimal. Check B's headline on 1 Sep 2026 was 33 hub projects
 * and 2,404.3 h; the panel must reproduce it, and this is what proves it does.
 *
 * THE THIRD OUTCOME
 * -----------------
 * ADR-002 §2 keeps `crm` and `projects` out of PostgREST until they carry RLS,
 * so two of the four probes read Postgres directly through withDb() and depend
 * on SUPABASE_DB_URL. This gate has that URL by construction (it needs it for
 * the truth side), so those two MUST run here; a not-run state for them is a
 * failure, not a skip. The two client-side probes may legitimately be not-run
 * only if PostgREST really refuses their schema (a 406 PGRST106, re-probed
 * here); a probe whose table PostgREST serves must not hide behind the state.
 *
 * READ-ONLY. `set default_transaction_read_only = on` is the first statement on
 * the Postgres connection, as in the audit's own db.mjs. The page side reads as
 * the review account (an exec, the role the route is gated to) when
 * REVIEW_EMAIL/REVIEW_PW are set, else with the service role. Neither writes.
 *
 * Credentials come from the environment first, then a .env.local found by
 * walking up from scripts/ (lib/gate-env.mjs). In a worktree without one:
 *   set -a; . ~/code/ui-rework/.env.local; set +a; . ~/.night-shift/env.sh
 *
 * Run: npm run check:data-hygiene-audit-findings
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const canReview = Boolean(env.REVIEW_EMAIL && env.REVIEW_PW && ANON);
const canService = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
if (!env.SUPABASE_DB_URL || !env.NEXT_PUBLIC_SUPABASE_URL || !(canReview || canService)) {
  console.log("SKIP: need SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and either REVIEW_EMAIL+REVIEW_PW (with the anon key) or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}

let failures = 0;
const ok = (pass, label, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  if (!pass) { if (detail) console.log(`        ${detail}`); failures += 1; }
};
const r1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------ Postgres, the audit's SQL -- */

// A-project-service.mjs: bucket `unlinked` is tt_project_count = 0.
const SQL_A = `
select p.id, p.name, p.code, p.customer, p.status, p.contract_hours,
       count(t.id) as tt_project_count
from public.projects p
left join time.project t on t.hub_project_id = p.id
group by p.id, p.name, p.code, p.customer, p.status, p.contract_hours
order by p.contract_hours desc nulls last, p.id`;

// B-budgets.mjs SQL_PAIRS, verbatim.
const SQL_B = `
select p.id as project_id, p.name as project_name, p.status, p.contract_hours,
       ps.project_id as time_project_id, ps.project_name as tt_name, ps.estimated_hours, ps.total_seconds,
       ps.is_archived as tt_archived,
       count(*) over (partition by p.id) as tt_rows_for_hub,
       sum(ps.estimated_hours) over (partition by p.id) as tt_estimate_sum_for_hub
from public.projects p
join time.project t on t.hub_project_id = p.id
join time.project_summary ps on ps.project_id = t.id
order by abs(coalesce(p.contract_hours,0) - coalesce(ps.estimated_hours,0)) desc, p.id`;

// D-customers.mjs SQL_LE_DRIFT, verbatim.
const SQL_D = `
select p.id, p.name, p.customer, p.contract_hours, p.customer_legal_entity_id, le.legal_name as project_le, po.legal_entity_id as order_le_id, le2.legal_name as order_le
from public.projects p
join projects.project_order po on po.order_number = p.code
left join crm.legal_entity le on le.id = p.customer_legal_entity_id
left join crm.legal_entity le2 on le2.id = po.legal_entity_id
where p.customer_legal_entity_id is distinct from po.legal_entity_id
order by p.contract_hours desc`;

// E-people.mjs SQL_REFS, verbatim.
const SQL_E = `
select f.id, f.person_id, f.external_id, f.match_method, f.matched_email, f.is_active, f.last_seen_at,
       p.name as person_name, p.factorial_employee_id as people_factorial_id, p.is_active as person_active, p.source as person_source
from crm.factorial_person_reference f left join public.people p on p.id = f.person_id order by f.match_method, p.name`;

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await db.connect();
await db.query("set default_transaction_read_only = on");
await db.query("set statement_timeout = '120s'");

const truth = {};
try {
  const a = (await db.query(SQL_A)).rows.filter((r) => Number(r.tt_project_count) === 0);
  truth.unlinked_hub_project = {
    count: a.length,
    hours: r1(a.reduce((s, r) => s + Math.max(0, Number(r.contract_hours ?? 0)), 0)),
    severe: a.filter((r) => Number(r.contract_hours ?? 0) > 0).length,
  };

  // The audit's classification, line for line (B-budgets.mjs).
  const EPS = 0.05;
  const mismatch = [];
  for (const r of (await db.query(SQL_B)).rows) {
    const contract = Number(r.contract_hours ?? 0);
    const est = r.estimated_hours === null ? null : Number(r.estimated_hours);
    const n = Number(r.tt_rows_for_hub);
    const ttBudget = n > 1 ? Number(r.tt_estimate_sum_for_hub ?? 0) : (est ?? 0);
    const delta = Math.round((ttBudget - contract) * 100) / 100;
    const ttNone = !(ttBudget > 0), hubNone = !(contract > 0);
    if (ttNone || hubNone) continue;
    if (Math.abs(delta) < EPS) continue;
    mismatch.push({ id: r.project_id, delta });
  }
  const seen = new Set();
  const byHub = mismatch.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  truth.budget_disagreement = {
    count: byHub.length,
    hours: r1(byHub.reduce((s, r) => s + Math.abs(r.delta), 0)),
    first: byHub[0]?.id ?? null,
  };

  const d = (await db.query(SQL_D)).rows;
  truth.customer_master_drift = {
    count: d.length,
    hours: r1(d.reduce((s, r) => s + Math.max(0, Number(r.contract_hours ?? 0)), 0)),
    severe: d.filter((r) => r.customer_legal_entity_id && r.order_le_id).length,
  };

  const e = (await db.query(SQL_E)).rows;
  truth.factorial_reference_mismatch = {
    count: e.filter((r) => !r.person_id || r.people_factorial_id !== r.external_id).length,
    total: e.length,
  };
} finally {
  await db.end();
}
console.log(`        postgres: ${JSON.stringify(truth)}`);

/* ------------------------------------------------- the page's reader -------- */

let supabase;
let as;
if (canReview) {
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.auth.signInWithPassword({ email: env.REVIEW_EMAIL, password: env.REVIEW_PW });
  if (error) { console.log(`FAIL: review sign-in refused (${error.message})`); process.exit(1); }
  as = "the review account (exec)";
} else {
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  as = "service role";
}
console.log(`        page side read as: ${as}`);

// withDb() reads process.env directly; loadEnv() does not export what it read.
process.env.SUPABASE_DB_URL ??= env.SUPABASE_DB_URL;
const { getDataHygiene, AUDIT_PROBES } = await import("../src/lib/queries/data-hygiene.ts");
const h = await getDataHygiene(supabase);
ok(!h.unavailable, "the reader produced a report", `unavailable=${h.unavailableReason}`);
if (h.unavailable) process.exit(1);

const findings = new Map(h.findings.map((f) => [f.key, f]));
const skipped = new Map((h.skipped ?? []).map((s) => [s.key, s]));

/**
 * Re-probe PostgREST for the table a skipped probe blames, with the same
 * credentials the page side used. A "could not run" is only earned if
 * PostgREST really refuses; a table it serves must be probed, not skipped.
 */
async function postgrestRefuses(source) {
  const [schemaName, table] = source.split(".");
  const { data: { session } = {} } = canReview ? await supabase.auth.getSession() : { data: {} };
  const bearer = canReview ? session?.access_token : env.SUPABASE_SERVICE_ROLE_KEY;
  const apikey = canReview ? ANON : env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey, Authorization: `Bearer ${bearer}`, "Accept-Profile": schemaName },
  });
  const body = await res.text();
  return { status: res.status, unexposed: res.status === 406 && /PGRST106/.test(body) };
}

/** Where the reader filed a probe: finding, clean, skipped, or nowhere. */
function outcome(key) {
  if (findings.has(key)) return "finding";
  if (skipped.has(key)) return "skipped";
  if (h.clean.includes(AUDIT_PROBES[key])) return "clean";
  return "missing";
}

for (const key of Object.keys(AUDIT_PROBES)) {
  const t = truth[key];
  const where = outcome(key);
  ok(where !== "missing", `${key}: the probe ran, or says why it did not`,
    "neither a finding, nor in clean, nor in skipped -- a probe that vanished without trace");
  if (where === "missing") continue;

  if (where === "skipped") {
    const s = skipped.get(key);
    if (key === "customer_master_drift" || key === "factorial_reference_mismatch") {
      ok(false, `${key}: reads Postgres directly and SUPABASE_DB_URL is set, so it must run`,
        `reported as could-not-run (${s.reason}) via ${s.source}`);
      continue;
    }
    const probe = await postgrestRefuses(s.source);
    ok(s.reason === "unexposed" && probe.unexposed,
      `${key}: not run because ${s.source} is unexposed, and PostgREST confirms (HTTP ${probe.status})`,
      `reason=${s.reason}, PostgREST answered ${probe.status} -- a not-run state must name a fault `
      + "PostgREST actually returns; anything else is a probe hiding behind the skip");
    console.log(`        postgres would show: ${JSON.stringify(t)}`);
    continue;
  }

  if (where === "clean") {
    ok(t.count === 0, `${key}: clean on the page and 0 rows in Postgres`,
      `Postgres finds ${t.count} row(s); the page lists the check as clean`);
    continue;
  }

  const f = findings.get(key);
  ok(f.count === t.count, `${key}: count ${f.count} matches Postgres ${t.count}`);
  const impact = f.impact;
  if (key === "unlinked_hub_project") {
    const hours = Number(/([\d.]+) contracted hours/.exec(impact)?.[1]);
    ok(hours === t.hours, `${key}: headline ${hours} h matches Postgres ${t.hours} h`, `impact: "${impact}"`);
    ok(f.severeTotal === t.severe, `${key}: ${f.severeTotal} severe rows match Postgres ${t.severe} with contracted hours`);
  }
  if (key === "budget_disagreement") {
    const m = /^(\d+) of (\d+) paired orders disagree · ([\d.]+) h in dispute/.exec(impact);
    ok(Number(m?.[1]) === t.count && Number(m?.[3]) === t.hours,
      `${key}: headline "${m?.[1]} / ${m?.[3]} h" matches Postgres ${t.count} / ${t.hours} h`, `impact: "${impact}"`);
    ok(f.rows[0]?.id === t.first,
      `${key}: the worst row on page 1 is the audit's worst (${t.first})`, `page 1 leads with ${f.rows[0]?.id}`);
  }
  if (key === "customer_master_drift") {
    const m = /([\d.]+) contracted hours · (\d+) with both sides set/.exec(impact);
    ok(Number(m?.[1]) === t.hours && Number(m?.[2]) === t.severe,
      `${key}: headline ${m?.[1]} h / ${m?.[2]} both-set matches Postgres ${t.hours} h / ${t.severe}`, `impact: "${impact}"`);
  }
  if (key === "factorial_reference_mismatch") {
    ok(t.count > 0, `${key}: Postgres agrees there is something to list (${t.count})`);
  }
}

/* A not-run probe must never leak into the clean list, whatever else happened. */
{
  const both = [...skipped.keys()].filter((k) => h.clean.includes(AUDIT_PROBES[k]));
  ok(both.length === 0, "no probe is both clean and not-run", both.join(", "));
  ok(h.scope.probes === h.findings.length + h.clean.length,
    "CHECKS RUN counts only probes that ran",
    `probes=${h.scope.probes}, findings=${h.findings.length}, clean=${h.clean.length}, skipped=${skipped.size}`);
}

console.log(failures === 0
  ? "\nAUDIT FINDINGS RECONCILE: every ported panel states the figure the audit's SQL states, or says why it could not"
  : `\n${failures} reconciliation check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;

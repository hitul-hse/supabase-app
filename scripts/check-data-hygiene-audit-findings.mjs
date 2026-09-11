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
import { record, recordNotRun, notRunInChain } from "./lib/gate-result.mjs";

const env = loadEnv();
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const canReview = Boolean(env.REVIEW_EMAIL && env.REVIEW_PW && ANON);
const canService = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
if (!env.SUPABASE_DB_URL || !env.NEXT_PUBLIC_SUPABASE_URL || !(canReview || canService)) {
  notRunInChain("need SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and either REVIEW_EMAIL+REVIEW_PW"
    + " (with the anon key) or SUPABASE_SERVICE_ROLE_KEY");
}

let failures = 0;
const ok = (pass, label, detail = "") => {
  record(pass);
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

/*
 * B-budgets.mjs SQL_PAIRS, with ONE deliberate departure from the verbatim copy:
 * the estimate is read from time.project, not from time.project_summary.
 *
 * WHY, AND WHY "VERBATIM" HAD STOPPED MEANING "THE AUDIT'S ANSWER" (2026-09-10)
 * ----------------------------------------------------------------------------
 * project_summary.estimated_hours is masked in the view itself:
 *
 *     (case when (select public.app_user_has_permission('projects:contracts:read'))
 *           then p.estimated_hours end)::numeric(10,2)   -- supabase/schema.sql
 *
 * A direct SUPABASE_DB_URL connection carries no app_user, so it reads NULL for
 * all 384 rows -- measured. The classification below then treats every null as
 * "no budget set" and skips the pair, so this side reported 0 disagreements over
 * 187 paired orders. The page, read as the exec, reported 33 worth 2,404.3 h.
 *
 * The consequence was worse than a wrong number. In the canonical run -- no
 * REVIEW_* credentials, so the page side is read with the service role, which
 * also holds no permission -- BOTH sides read null, the panel showed "clean",
 * this side computed 0, and the gate asserted that 0 agreed with 0 and passed.
 * A green assertion in which neither side could see the column it reconciles is
 * this project's own recurring bug wearing a lab coat.
 *
 * time.project.estimated_hours is the column the view masks, so reading it here
 * gives the figure a permitted caller sees: 33 orders and 2,404.3 h, matching
 * both the page's exec read and check B's own 1 Sep 2026 headline. The
 * project_summary join stays, because the audit's inner join -- "only TT
 * projects that have a summary row" -- is part of the pairing rule.
 */
const SQL_B = `
select p.id as project_id, p.name as project_name, p.status, p.contract_hours,
       ps.project_id as time_project_id, ps.project_name as tt_name,
       t.estimated_hours, ps.total_seconds,
       ps.is_archived as tt_archived,
       count(*) over (partition by p.id) as tt_rows_for_hub,
       sum(t.estimated_hours) over (partition by p.id) as tt_estimate_sum_for_hub
from public.projects p
join time.project t on t.hub_project_id = p.id
join time.project_summary ps on ps.project_id = t.id
order by abs(coalesce(p.contract_hours,0) - coalesce(t.estimated_hours,0)) desc, p.id`;

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
/*
 * AN UNREACHABLE DATABASE IS "DID NOT RUN", NOT A VERDICT.
 *
 * This connect used to be unguarded, so a paused project, a rotated password or
 * a dropped connection killed the gate at module scope: zero assertions, exit 1,
 * and `RESULT pass=0 fail=0 notrun=0` -- the line a gate prints when it checked
 * NOTHING, and indistinguishable from one that had nothing to check. Whether
 * the panels agree with the audit is unknowable without the audit's own side, so
 * the honest answer is to say the gate did not run and why.
 */
try {
  await db.connect();
  await db.query("set default_transaction_read_only = on");
  await db.query("set statement_timeout = '120s'");
} catch (e) {
  notRunInChain(`cannot reach Postgres over SUPABASE_DB_URL, so the audit's own SQL cannot be run`
    + ` to compare the panels against — ${String(e?.message ?? e).split("\n")[0]}`);
}

const truth = {};
let sqlFailed = false;
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
} catch (e) {
  /*
   * A QUERY THAT FAILS IS A VERDICT, unlike the connection above.
   *
   * The four statements are the audit's own SQL, copied verbatim. Reaching the
   * database and then failing to run them means a table, column or view the
   * audit depends on has moved -- which is a real finding about this repo, not
   * an absent dependency. It used to be an uncaught throw with zero assertions;
   * now it is one recorded failure that names the statement.
   */
  ok(false, "the audit's own SQL still runs against Postgres", String(e?.message ?? e).split("\n")[0]);
  sqlFailed = true;
} finally {
  await db.end();
}
// Outside the finally, so the connection is closed first: every comparison below
// reads `truth`, which a failed statement leaves half-built.
if (sqlFailed) process.exit(1);
console.log(`        postgres: ${JSON.stringify(truth)}`);

/* ------------------------------------------------- the page's reader -------- */

let supabase;
let as;
if (canReview) {
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.auth.signInWithPassword({ email: env.REVIEW_EMAIL, password: env.REVIEW_PW });
  /*
   * A SESSION IS A DEPENDENCY, and a refused one is NOT RUN.
   *
   * This printed a bare "FAIL:" line and exited 1 without recording anything, so
   * its RESULT line read `pass=0 fail=0 notrun=0` -- a gate that says FAIL in
   * prose and nothing at all in the one place a runner reads. A rotated password
   * or a locked review account says nothing about whether the panels reconcile,
   * so the gate reports that it could not run, with the reason, and is never
   * counted as green.
   */
  if (error) notRunInChain(`the review account (${env.REVIEW_EMAIL}) could not sign in, so the page`
    + ` side cannot be read as the exec — ${error.message}`);
  as = "the review account (exec)";
} else {
  supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  as = "service role";
}
console.log(`        page side read as: ${as}`);

// withDb() reads process.env directly; loadEnv() does not export what it read.
process.env.SUPABASE_DB_URL ??= env.SUPABASE_DB_URL;
const { getDataHygiene, AUDIT_PROBES } = await import("../src/lib/queries/data-hygiene.ts");
/*
 * A READER THAT THROWS IS THE SUBJECT FAILING, so it is asserted, not excused.
 *
 * `getDataHygiene` is the exec's page. If it throws, the page is broken for the
 * reader it was built for, and that is precisely what this gate is here to
 * notice -- but as an uncaught rejection it was a crash with zero assertions,
 * which reads from outside as "the gate is broken" rather than "the page is".
 */
let h;
try {
  h = await getDataHygiene(supabase);
} catch (e) {
  ok(false, "the reader produced a report", `it threw: ${String(e?.message ?? e).split("\n")[0]}`);
  process.exit(1);
}
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

  /*
   * THE PAGE SIDE HAS TO BE ABLE TO SEE THE COLUMN BEFORE ITS ANSWER MEANS
   * ANYTHING.
   *
   * budget_disagreement compares contracted hours against the TrackingTime
   * estimate, and time.project_summary.estimated_hours is withheld by the view
   * from any caller without projects:contracts:read (supabase/schema.sql; see
   * SQL_B's note). The service role holds no app_user permissions at all, so
   * when this gate falls back to it the panel reads every estimate as null,
   * reports "clean", and agrees with a truth side that used to be blind in
   * exactly the same way. That agreement was a vacuous pass and it is the reason
   * this branch exists.
   *
   * With the truth side now reading the unmasked column, comparing it against a
   * page deliberately withholding budgets would just invert the lie into a false
   * failure. Neither is a verdict, so this states the third answer and says what
   * would make it run: REVIEW_EMAIL + REVIEW_PW, an exec who can see budgets.
   */
  if (key === "budget_disagreement" && !canReview) {
    recordNotRun(
      "budget_disagreement: the page side is being read with the SERVICE ROLE, which holds no"
      + " app_user permission, so time.project_summary withholds estimated_hours from it and the"
      + " panel can only report 'clean'. Postgres sees "
      + `${t.count} disagreement(s) worth ${t.hours} h. Set REVIEW_EMAIL and REVIEW_PW to read the`
      + " page as the exec it is written for, and this reconciles for real.",
    );
    continue;
  }

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

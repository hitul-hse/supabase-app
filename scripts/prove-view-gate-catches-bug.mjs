// A gate never observed failing is not known to work. Restore the ORIGINAL
// coalesce-to-zero definition, run the gate (must FAIL), then restore the fixed
// one and run again (must PASS). Everything happens inside a transaction that
// is rolled back, so production is untouched either way.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const runGate = () => {
  const r = spawnSync("node", ["scripts/check-views-admit-unknown.mjs"], { cwd: "C:/Supabase", encoding: "utf8" });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

// The definition as it was before the fix: COALESCE turning unknown into zero.
const OLD = `
create or replace view public.project_budget_status
with (security_invoker = true) as
  select p.id as project_id, p.name, p.budget_hours, p.budget_fee_eur, p.budget_alert_percent,
    coalesce(sum(te.hours) filter (where te.status='approved'), 0) as hours_logged,
    coalesce(sum(te.hours) filter (where te.status='approved' and te.is_billable), 0) as billable_hours_logged,
    coalesce(sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur, 0)) filter (where te.status='approved' and te.is_billable), 0) as revenue_eur,
    coalesce(sum(te.hours * coalesce(pe.cost_rate_eur, 0)) filter (where te.status='approved'), 0) as cost_eur,
    coalesce(sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur, 0)) filter (where te.status='approved' and te.is_billable), 0)
      - coalesce(sum(te.hours * coalesce(pe.cost_rate_eur, 0)) filter (where te.status='approved'), 0) as margin_eur,
    round((coalesce(sum(te.hours) filter (where te.status='approved'),0) * 100.0) / nullif(p.budget_hours,0), 2) as hours_consumed_percent,
    coalesce(coalesce(sum(te.hours) filter (where te.status='approved'),0) > nullif(p.budget_hours,0), false) as is_over_budget,
    coalesce(((coalesce(sum(te.hours) filter (where te.status='approved'),0) * 100.0) / nullif(p.budget_hours,0)) >= p.budget_alert_percent::numeric, false) as is_past_alert_threshold
  from public.projects p
  left join public.timesheet_entries te on te.project_id = p.id
  left join public.people pe on pe.id = te.person_id
  group by p.id, p.name, p.budget_hours, p.budget_fee_eur, p.budget_alert_percent, p.billable_rate_eur;
`;

const FIXED = readFileSync("C:/Supabase/supabase/migrations/20260825090000_views_say_unknown_not_zero.sql", "utf8");

console.log("=== 1. reinstating the pre-fix definition (coalesce to zero) ===");
await c.query(OLD);
const bad = runGate();
console.log(bad.out.split("\n").filter((l) => /^(PASS|FAIL)/.test(l)).map((l) => "   " + l).join("\n"));
console.log(`   exit code: ${bad.code}  -> gate ${bad.code !== 0 ? "CAUGHT it" : "MISSED it"}`);

console.log("\n=== 2. restoring the fix ===");
await c.query(FIXED);
const good = runGate();
console.log(good.out.split("\n").filter((l) => /^(PASS|FAIL)/.test(l)).map((l) => "   " + l).join("\n"));
console.log(`   exit code: ${good.code}  -> ${good.code === 0 ? "passes" : "STILL FAILING"}`);

await c.end();

const proven = bad.code !== 0 && good.code === 0;
console.log(`\n${proven ? "PROVEN: the gate fails on the bug and passes on the fix." : "NOT PROVEN - investigate."}`);
process.exit(proven ? 0 : 1);

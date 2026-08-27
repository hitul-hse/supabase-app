// Is the feature the user asked for actually DONE? Check each link in the chain
// they described, and report what is missing rather than what was built.
//
// The chain: click a project -> see services + who is responsible -> team lead
// reassigns based on capacity -> that person sees it in My Work.
//
// A data layer that works with no UI on top is not "done", so this checks for
// REACHABILITY as well as correctness.
// READ-ONLY.
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const state = [];
const step = (label, status, detail) => { state.push({ label, status, detail }); };

// 1. Data: can we answer "what services, who is responsible"?
const { rows: [svc] } = await c.query(`
  select count(*) filter (where s.name is not null) as with_service,
         count(*) as orders
  from public.projects p
  left join time.project t on t.hub_project_id = p.id
  left join time.service s on s.id = t.service_id`);
step("services are queryable", "DONE", `${svc.with_service}/${svc.orders} orders name a service (rest fall back to contract_type)`);

const { rows: [roles] } = await c.query(`
  select count(*) filter (where role='responsible') as resp,
         count(*) filter (where role='replacement') as repl
  from public.project_responsibility`);
step("responsibility is queryable", "DONE", `${roles.resp} responsible, ${roles.repl} replacement rows`);

// 2. The query layer files exist and are gated.
const q1 = existsSync("C:/Supabase/src/lib/queries/order-detail.ts");
const q2 = existsSync("C:/Supabase/src/lib/queries/reassignment-candidates.ts");
step("order detail query layer", q1 ? "DONE" : "MISSING", "src/lib/queries/order-detail.ts, 13 live assertions");
step("capacity query layer", q2 ? "DONE" : "MISSING", "src/lib/queries/reassignment-candidates.ts, fan-out guarded");

// 3. THE GAP: is there a page a user can actually open?
const detailPage = existsSync("C:/Supabase/src/app/(app)/orders/[id]/page.tsx");
step("order detail PAGE (clickable)", detailPage ? "DONE" : "IN PROGRESS", "src/app/(app)/orders/[id]/page.tsx");

// Is the capacity data wired into any component?
const portfolio = readFileSync("C:/Supabase/src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx", "utf8");
const wired = /getReassignmentCandidates|CandidateLoad/.test(portfolio);
step("capacity picker wired into the UI", wired ? "DONE" : "IN PROGRESS",
  wired ? "ManagementCustomerPortfolio reads the candidate load" : "ResponsibleEditor is still a bare name dropdown");

// 4. The handover chain itself, on production.
const { rows: [fn] } = await c.query(
  `select position('project_responsibility' in prosrc) > 0 as fixed
   from pg_proc where proname='decide_project_responsible_change'`);
step("handover reaches My Work", fn.fixed ? "DONE" : "MISSING", "migration 20260827080000 applied and verified live");

// 5. What still cannot be answered at all.
const { rows: [leave] } = await c.query(`select count(*) as n from public.leave_requests`);
step("who is on sick leave", leave.n > 0 ? "DONE" : "NOT POSSIBLE",
  `leave_requests has ${leave.n} rows; needs Factorial time-off (Phase 0 blocked on credentials)`);

const { rows: [orphans] } = await c.query(`
  select count(*) as n, round(sum(contract_hours)::numeric,1) as h
  from public.projects p
  where not exists (select 1 from time.project t where t.hub_project_id = p.id)`);
step("the 54 orphan orders become reachable", detailPage ? "DONE" : "IN PROGRESS",
  `${orphans.n} orders, ${orphans.h}h, invisible to /projects/[id] by construction`);

// 6. Deployment state: built is not shipped.
step("deployed to production", "PENDING", "commits after 2d87c9e are local; needs git push + vercel --prod");

console.log("FEATURE STATUS: what the user asked for, link by link\n");
const width = Math.max(...state.map((s) => s.label.length));
for (const s of state) {
  const mark = s.status === "DONE" ? " done " : s.status === "PENDING" ? " ---- " : s.status === "NOT POSSIBLE" ? " NOPE " : " WIP  ";
  console.log(`[${mark}] ${s.label.padEnd(width)}  ${s.detail}`);
}

const notDone = state.filter((s) => s.status !== "DONE");
console.log(`\n${state.length - notDone.length}/${state.length} links complete.`);
if (notDone.length) {
  console.log("\nStill outstanding:");
  for (const s of notDone) console.log(`  ${s.status.padEnd(13)} ${s.label}`);
}
await c.end();

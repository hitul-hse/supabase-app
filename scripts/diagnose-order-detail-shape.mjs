// Everything a masterdata project detail page could show, assembled once so the
// query is designed against real shapes rather than assumptions.
//
// The page must key on public.projects.id (text, e.g. 10110_00358_104_01) rather
// than time.project.id (bigint), because 54 orders carrying 1,724h have no
// time.project at all and would otherwise stay unreachable.
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql, params = []) => {
  try { const r = await c.query(sql, params); console.log(`\n### ${label}`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
};

// A project WITH a time link and one WITHOUT, so the page is designed for both.
const { rows: [linked] } = await c.query(`
  select p.id from public.projects p
  where exists (select 1 from time.project t where t.hub_project_id = p.id)
    and p.owner_person_id is not null limit 1`);
const { rows: [orphan] } = await c.query(`
  select p.id from public.projects p
  where not exists (select 1 from time.project t where t.hub_project_id = p.id)
    and p.owner_person_id is not null limit 1`);

console.log(`linked example: ${linked.id}\norphan example: ${orphan.id}`);

for (const [label, id] of [["LINKED", linked.id], ["ORPHAN (no time.project)", orphan.id]]) {
  console.log(`\n${"=".repeat(70)}\n${label}: ${id}\n${"=".repeat(70)}`);

  await q("the order itself", `
    select p.id, p.code, p.name, p.customer, p.status, p.contract_hours,
           p.logged_hours, p.remaining_hours, p.consumed_percent,
           p.contract_type, p.due, p.department
    from public.projects p where p.id = $1`, [id]);

  // "what kinda services that customer is asking" -- per PROJECT via the TT
  // bridge, and per CUSTOMER across all their orders.
  await q("this project's service", `
    select s.name as service, t.id as time_project_id
    from public.projects p
    left join time.project t on t.hub_project_id = p.id
    left join time.service s on s.id = t.service_id
    where p.id = $1`, [id]);

  await q("every service this CUSTOMER buys (all their orders)", `
    select s.name as service,
           count(distinct p2.id) as orders,
           round(sum(p2.contract_hours)::numeric,1) as contract_hours
    from public.projects p
    join public.projects p2 on p2.customer = p.customer
    left join time.project t on t.hub_project_id = p2.id
    left join time.service s on s.id = t.service_id
    where p.id = $1
    group by s.name order by contract_hours desc nulls last`, [id]);

  await q("who is responsible for what on this project", `
    select r.role, pe.name, r.source, r.order_no
    from public.project_responsibility r
    join public.people pe on pe.id = r.person_id
    where r.project_id = $1
    order by (r.role = 'responsible') desc, pe.name`, [id]);

  await q("assignments (share_percent encodes the role)", `
    select pe.name, pa.share_percent, pa.sort_order, pa.logged_hours
    from public.person_assignments pa
    join public.people pe on pe.id = pa.person_id
    where pa.project_id = $1 order by pa.sort_order`, [id]);

  await q("the canonical customer entity", `
    select cle.legal_name, cle.id
    from public.projects p
    left join crm.customer_legal_entity cle on cle.id = p.customer_legal_entity_id
    where p.id = $1`, [id]);

  await q("real logged time, bounded at today", `
    select count(e.id) as entries,
           round(coalesce(sum(e.duration_seconds),0)/3600.0, 1) as hours_to_date,
           min(e.started_at)::date as first_entry,
           max(e.started_at)::date as last_entry
    from public.projects p
    join time.project t on t.hub_project_id = p.id
    join time.entry e on e.project_id = t.id and e.started_at <= now()
    where p.id = $1`, [id]);
}

console.log("\nREAD-ONLY: nothing was written.");
await c.end();

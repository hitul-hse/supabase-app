/**
 * The figures the hub's pages are built from, in one read-only snapshot --
 * so a promote can be judged by what it changed downstream, not by its own
 * report.
 *
 * WHY THIS EXISTS. hitul, 2026-09-10: "make sure the whole data chain is
 * working correctly like with charts, dashboards, tables etc and with
 * customers as well". The promote step (scripts/promote-masterdata-sheet.mjs)
 * writes public.projects, person_assignments, project_responsibility,
 * project_link, project_masterdata, project_contact and projects.project_order.
 * Every management chart, the My Work tables, the data-hygiene probes and the
 * customer portfolio derive from those rows through a handful of joins and
 * aggregates. This script computes those aggregates directly in SQL, in a
 * read-only transaction, and prints them as JSON. Run it before a promote,
 * again after, and pass the first file with --compare to see exactly which
 * figures moved and by how much.
 *
 * It also carries the invariants that would silently corrupt a chart if
 * broken: a project must never carry more than 100% share across its
 * assignments (management-employee-ownership multiplies contract hours by
 * share), the two responsibility encodings must agree, and every
 * public.projects.code must still find its projects.project_order row (the
 * management customer mapping and the customer-master drift gate join on it).
 * Those print under "invariants" with a count of offenders; 0 is the only
 * healthy value.
 *
 * Usage:
 *   node --env-file=.env.local scripts/masterdata-chain-check.mjs [--out snapshot.json] [--compare before.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "./lib/gate-env.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const OUT = arg("--out");
const COMPARE = arg("--compare");

const env = loadEnv();
const conn = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!conn) { console.error("FAIL: SUPABASE_DB_URL is required"); process.exit(3); }
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("begin read only");
const one = async (sql) => (await client.query(sql)).rows[0];
const all = async (sql) => (await client.query(sql)).rows;
const exists = async (rel) => (await one(`select to_regclass('${rel}') is not null as ok`)).ok;

const snapshot = { taken_at: new Date().toISOString(), figures: {}, invariants: {} };
const F = snapshot.figures;

// --- the order book (public.projects) as the management header and the ledgers read it
F.projects = await one(`
  select count(*)::int as rows,
         count(*) filter (where status is null)::int as status_null,
         count(*) filter (where owner_person_id is null)::int as owner_null,
         count(*) filter (where customer_legal_entity_id is null)::int as entity_null,
         count(*) filter (where contract_hours = 0)::int as contract_hours_zero,
         round(sum(contract_hours))::int as contract_hours_sum,
         round(coalesce(sum(logged_hours), 0))::int as logged_hours_sum,
         count(*) filter (where due = 'n/a')::int as due_na,
         count(*) filter (where id !~ '^[0-9]{5}_')::int as ids_without_customer_prefix,
         count(distinct customer)::int as customer_texts
  from public.projects`);
// --- the management customer mapping: projects.code -> project_order.order_number -> legal entity
F.customer_mapping = await one(`
  select count(*)::int as projects,
         count(po.id)::int as with_order_row,
         count(le.id)::int as with_legal_entity,
         count(distinct le.id)::int as legal_entities_with_projects
  from public.projects p
  left join projects.project_order po on po.order_number = p.code
  left join crm.legal_entity le on le.id = po.legal_entity_id`);
// --- responsibility, both encodings, as management and My Work read them
F.assignments = await one(`
  select count(*)::int as rows,
         count(*) filter (where share_percent = 100 and sort_order = 0)::int as responsible_rows,
         count(*) filter (where share_percent = 0 and sort_order = 1)::int as replacement_rows,
         count(*) filter (where share_percent not in (0, 100))::int as partial_shares,
         count(distinct person_id)::int as people,
         count(distinct project_id)::int as projects
  from public.person_assignments`);
F.responsibility = Object.fromEntries((await all(`
  select role || '/' || source as k, count(*)::int as n from public.project_responsibility group by 1 order by 1`)).map((r) => [r.k, r.n]));
F.links = Object.fromEntries((await all(`
  select kind || '/' || source as k, count(*)::int as n from public.project_link group by 1 order by 1`)).map((r) => [r.k, r.n]));
// --- the customer master as the customer pages read it
F.customers = await one(`
  select (select count(*)::int from crm.legal_entity) as legal_entities,
         (select count(*)::int from crm.legal_entity where lifecycle_status = 'active') as legal_entities_active,
         (select count(*)::int from crm.lexware_customer) as lexware_customers,
         (select count(*)::int from crm.location) as locations,
         (select count(*)::int from projects.project_order) as project_orders,
         (select count(*)::int from projects.project_order where legal_entity_id is not null) as project_orders_linked`);
// --- the time side these rows are bridged to
F.time_bridge = await one(`
  select count(*)::int as time_projects,
         count(*) filter (where hub_project_id is not null)::int as bridged,
         count(*) filter (where hub_project_id is not null and hub_project_id not in (select id from public.projects))::int as bridged_to_missing
  from time.project`);
// --- the sheet's own tables, when the migration is applied
if (await exists("public.project_masterdata")) {
  F.masterdata = await one(`
    select count(*)::int as rows,
           count(*) filter (where lifecycle_status = 'active')::int as active,
           count(*) filter (where lifecycle_status = 'historical')::int as historical,
           count(*) filter (where contract_end is not null and contract_end < current_date and lifecycle_status = 'active')::int as active_but_contract_ended,
           count(*) filter (where responsible_kind = 'person')::int as responsible_person,
           count(*) filter (where responsible_kind = 'doctor')::int as responsible_doctor,
           count(*) filter (where responsible_kind is null)::int as responsible_empty,
           (select count(*)::int from public.project_contact) as contacts,
           (select count(*)::int from projects.project_order where masterdata_key is not null) as order_rows_with_new_key,
           max(last_seen_at)::text as newest_last_seen_at
    from public.project_masterdata`);
} else {
  F.masterdata = { note: "public.project_masterdata does not exist yet (migration 20260910120000 not applied)" };
}

// --- invariants: 0 is the only healthy value
const I = snapshot.invariants;
// Rows with a NULL project_id are the seed fiction's emp-% assignments (no
// project at all); they are not a project that could be over-shared.
I.projects_over_100_percent_share = (await one(`
  select count(*)::int as n from (select project_id from public.person_assignments where project_id is not null group by project_id having sum(share_percent) > 100) x`)).n;
F.assignments.rows_without_project = (await one(`select count(*)::int as n from public.person_assignments where project_id is null`)).n; // the seed fiction's emp-% rows; a figure, not a fault of the chain
I.replacement_role_without_cover_assignment = (await one(`
  select count(*)::int as n from public.project_responsibility r
  where r.role = 'replacement' and not exists (
    select 1 from public.person_assignments a where a.project_id = r.project_id and a.person_id = r.person_id and a.share_percent = 0 and a.sort_order = 1)`)).n;
I.cover_assignment_without_replacement_role = (await one(`
  select count(*)::int as n from public.person_assignments a
  where a.share_percent = 0 and a.sort_order = 1 and exists (select 1 from public.project_responsibility r where r.project_id = a.project_id)
    and not exists (select 1 from public.project_responsibility r where r.project_id = a.project_id and r.person_id = a.person_id and r.role = 'replacement')`)).n;
I.responsible_role_disagrees_with_owner = (await one(`
  select count(*)::int as n from public.project_responsibility r join public.projects p on p.id = r.project_id
  where r.role = 'responsible' and p.owner_person_id is not null and p.owner_person_id <> r.person_id`)).n;
I.projects_without_order_row = (await one(`
  select count(*)::int as n from public.projects p where not exists (select 1 from projects.project_order po where po.order_number = p.code)`)).n;
I.assignments_to_missing_people = (await one(`
  select count(*)::int as n from public.person_assignments a where not exists (select 1 from public.people x where x.id = a.person_id)`)).n;
I.duplicate_order_numbers_in_project_order = (await one(`
  select count(*)::int as n from (select order_number from projects.project_order group by 1 having count(*) > 1) d`)).n;
if (await exists("public.project_masterdata")) {
  I.masterdata_rows_without_project = (await one(`
    select count(*)::int as n from public.project_masterdata m where not exists (select 1 from public.projects p where p.id = m.project_id)`)).n;
  I.masterdata_key_mismatch_between_tables = (await one(`
    select count(*)::int as n from public.project_masterdata m join projects.project_order po on po.order_number = m.project_id
    where po.masterdata_key is distinct from m.masterdata_key`)).n;
}
await client.query("rollback");
await client.end();

const bad = Object.entries(I).filter(([, n]) => n > 0);
console.log(JSON.stringify(snapshot, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify(snapshot, null, 2)); console.error(`snapshot written to ${OUT}`); }
if (COMPARE) {
  const before = JSON.parse(readFileSync(COMPARE, "utf8"));
  const diffs = [];
  const walk = (a, b, path) => {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const x = a?.[k], y = b?.[k];
      if (x && typeof x === "object" && !Array.isArray(x)) walk(x, y, `${path}.${k}`);
      else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${path}.${k}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
    }
  };
  walk(before.figures, snapshot.figures, "figures");
  walk(before.invariants, snapshot.invariants, "invariants");
  console.error(`\nCHANGES since ${before.taken_at} (${diffs.length}):`);
  for (const d of diffs) console.error(`  ${d}`);
}
if (bad.length) {
  console.error(`\nINVARIANTS BROKEN: ${bad.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  process.exit(1);
}
console.error("\ninvariants: all 0");

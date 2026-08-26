/*
 * Runs 20260826130000 in PGlite twice (house rule) against a minimal crm schema.
 * The assertions that matter: both candidates get flagged, the FK is NOT filled in
 * (the whole point is that guessing it would be wrong), and a second run does not
 * append the note twice.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync("C:/Supabase/supabase/migrations/20260826130000_ypog_berlin_alias.sql", "utf8");
const db = await new PGlite();
let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures += 1; };

await db.exec(`
  create schema crm;
  create function crm.normalise_legal_name(p_name text) returns text language sql immutable as $$
    select regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', ' ', 'g')
  $$;
  create table crm.legal_entity (
    id uuid primary key default gen_random_uuid(),
    legal_name text not null,
    lifecycle_status text not null default 'active',
    review_status text not null default 'unreviewed',
    review_reason text,
    superseded_by_id uuid,
    updated_at timestamptz not null default now()
  );
  create table public.projects (
    id text primary key, customer text not null, customer_legal_entity_id uuid
  );
  insert into crm.legal_entity (legal_name) values
    ('YPOG GmbH & Co. KG'), ('YPOG Partnerschaft von Rechtsanwälten mbB');
  insert into public.projects values ('10305_00404_501_01', 'YPOG Berlin', null);
`);

for (const pass of [1, 2]) {
  await db.exec(sql);
  const { rows } = await db.query(`
    select legal_name, review_status, review_reason from crm.legal_entity order by legal_name`);
  const { rows: [proj] } = await db.query("select customer_legal_entity_id from public.projects");

  console.log(`\nrun ${pass}:`);
  check(`run ${pass}: both YPOG entities are flagged for review`,
    rows.length === 2 && rows.every((r) => r.review_status === "review_required"),
    rows.map((r) => `${r.legal_name}=${r.review_status}`).join(", "));

  check(`run ${pass}: the order is left UNLINKED`,
    proj.customer_legal_entity_id === null,
    "linking it would be a name-similarity guess on an invoicing relationship");

  check(`run ${pass}: the reason names the order`,
    rows.every((r) => (r.review_reason ?? "").includes("10305_00404_501_01")));

  // Idempotence is the reason for the second run: the note must not accumulate.
  const dupes = rows.filter((r) => (r.review_reason.match(/10305_00404_501_01/g) ?? []).length > 1);
  check(`run ${pass}: the note appears exactly once per entity`,
    dupes.length === 0,
    dupes.length ? "re-running appended a duplicate note" : "");
}

console.log(failures === 0 ? "\nSAFE TO PASTE" : `\n${failures} failed — DO NOT PASTE`);
process.exit(failures === 0 ? 0 : 1);

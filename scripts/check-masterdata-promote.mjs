/*
 * Does promoting a staged masterdata-sheet batch write exactly what the
 * 2026-09-10 decisions allow -- and nothing else?
 *
 * WHY THIS GATE EXISTS. scripts/promote-masterdata-sheet.mjs is the first
 * process that writes the business side's Google Sheet into the tables the
 * operations pages read: public.projects, project_masterdata, project_contact,
 * project_link, projects.project_order and BOTH responsibility encodings. It
 * runs unattended against the live warehouse, so every rule it must keep is
 * pinned here against the real schema, in PGlite, with no credentials:
 *
 *   - a record is promoted only when valid and either approved or unreviewed
 *     without a blocking flag; an approved NEW_SERVICE is let in, an
 *     unreviewed one is not;
 *   - resolution is by EXACT key (ADR-001): the legacy key against
 *     public.projects.id, the new key against project_masterdata;
 *   - existing project ids never move; order_number stays the old key and the
 *     new key rides beside it as masterdata_key;
 *   - honest nulls: a service whose contract hours read "-" is SKIPPED, never
 *     inserted with 0 -- the column is NOT NULL and a fabricated 0 would read
 *     as a real contract;
 *   - the two responsibility encodings (project_responsibility roles,
 *     person_assignments share 100/0 + sort 0/1) agree after every promote, the
 *     rule check-responsibility-encodings-agree.mjs enforces on the live data;
 *   - DOC / OTHER are not people: that role's existing rows are left alone;
 *   - links are replaced, never duplicated; a hand-added link survives;
 *     contacts are upserted and deleted when the sheet empties them;
 *   - a row that vanishes from the sheet becomes historical on
 *     project_masterdata AND project_order, keeps its public.projects row and
 *     its assignments, and comes back active when it reappears;
 *   - promoting the same batch twice changes nothing; a dry run (rollback)
 *     leaves nothing.
 *
 * THE FIXTURE IS BUILT THE WAY THE IMPORTER BUILDS IT: sheet cells go through
 * normaliseServiceRow() from scripts/lib/masterdata-sheet.mjs and then through
 * a replica of the importer's resolution step (order_resolution, person kinds
 * and ids, the flags, classify()). If the staged payload's shape drifts, this
 * gate is meant to break.
 *
 * The world: supabase/schema.sql plus the migrations the promote step writes
 * through, in order -- customer-master foundation, legal-entity fields,
 * project_responsibility, projects.customer_legal_entity_id, the 2026-08-26
 * relaxation of status/billable_hours/consumed_percent (production has it;
 * schema.sql predates it), project_link, and the masterdata warehouse
 * migration this promote step is the consumer of.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import {
  SERVICE_COLUMNS, SERVICE_SHEET_NAME, normaliseServiceRow, flagDuplicateKeys, classify, personSentinel, setClock,
} from "./lib/masterdata-sheet.mjs";
import { promoteBatch, promotability, sheetModifiedOf, SOURCE_SYSTEM } from "./lib/masterdata-promote.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const j = (x) => JSON.stringify(x);
setClock(() => new Date("2026-09-10T09:00:00Z")); // ENDED_BUT_OPEN is decided against a fixed today

/* ---------------------------------------------------------------- world */
const sql = (rel) => readFileSync(`${REPO_ROOT}/${rel}`, "utf8");
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
const WORLD = [
  "supabase/schema.sql",
  "supabase/migrations/20260822130000_create_customer_master_foundation.sql",
  "supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql",
  "supabase/migrations/20260824160000_create_project_responsibility.sql",
  "supabase/migrations/20260824170000_link_project_customer_entity.sql",
  "supabase/migrations/20260826120000_projects_admit_unmeasured_hours.sql",
  "supabase/migrations/20260903230000_project_link.sql",
  "supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql",
];

const ENTITY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ENTITY_B = "bbbbbbbb-0000-4000-8000-000000000002";
const LEGACY_A = "10110_00358_104_01";
const LEGACY_B = "10234_00103_104_01";
const NEW_KEY_A = "10110_00358_1001.1_01";
const NEW_KEY_C = "10345_00500_1002.2_01";
const NEW_KEY_C_UNREVIEWED = "10345_00501_1003.1_01";
const NEW_KEY_C_NO_HOURS = "10345_00502_1004.1_01";

async function fresh() {
  const db = await new PGlite();
  await db.exec(preamble);
  for (const f of WORLD) await db.exec(sql(f));
  await db.exec(`
    insert into public.people (id, name) values ('md-mathias', 'Mathias'), ('md-hendryk', 'Hendryk'), ('md-thorsten', 'Thorsten');
    insert into crm.legal_entity (id, legal_name, review_status) values ('${ENTITY_A}', 'Kunde A GmbH', 'approved'), ('${ENTITY_B}', 'Kunde B AG', 'approved');
    insert into public.projects (id, code, name, customer, lead, status, contract_hours, billable_hours, consumed_percent, logged_hours, due, owner_person_id)
      values ('${LEGACY_A}', '${LEGACY_A}', 'Arbeitsschutz Kunde A', 'Kunde A', 'Mathias', 'NORMAL', 100, 0, 0, 33.5, 'n/a', 'md-mathias'),
             ('${LEGACY_B}', '${LEGACY_B}', 'Betriebsmedizin Kunde B', 'Kunde B', 'n/a', 'NORMAL', 50, 0, 0, 12.5, 'n/a', null);
    insert into projects.project_order (order_number, name) values ('${LEGACY_A}', 'Arbeitsschutz Kunde A'), ('${LEGACY_B}', 'Betriebsmedizin Kunde B');
    -- what the August workbook import left behind, in both encodings
    insert into public.person_assignments (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
      values ('md-mathias', '${LEGACY_A}', 'Arbeitsschutz Kunde A', 33.5, 4, 100, 0),
             ('md-thorsten', '${LEGACY_A}', 'Arbeitsschutz Kunde A', 0, 0, 0, 1),
             ('md-mathias', '${LEGACY_B}', 'Betriebsmedizin Kunde B', 12.5, 2, 100, 0);
    insert into public.project_responsibility (project_id, person_id, role, source, order_no)
      values ('${LEGACY_A}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_A}'),
             ('${LEGACY_A}', 'md-thorsten', 'replacement', 'masterdata', '${LEGACY_A}'),
             ('${LEGACY_B}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_B}');
    insert into public.project_link (project_id, kind, url, label, source)
      values ('${LEGACY_A}', 'asana', 'https://app.asana.com/old-a', 'Asana', 'masterdata'),
             ('${LEGACY_A}', 'google_chat', 'https://chat.google.com/room/hand-added', 'Chat', 'manual');
  `);
  return db;
}

/* ------------------------------------------------- the sheet, as the importer sees it */
const LETTER = Object.fromEntries(SERVICE_COLUMNS.map(([l, , k]) => [k, l]));
const sheetRow = (r, byKey) => {
  const cells = {};
  for (const [k, val] of Object.entries(byKey)) {
    if (!(k in LETTER)) throw new Error(`fixture names a column the contract does not have: ${k}`);
    if (val !== null && val !== undefined) cells[LETTER[k]] = val;
  }
  return { r, cells };
};

const ROW_A = () => sheetRow(5, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_A, order_number_sheet: NEW_KEY_A, customer_number: 10110,
  service_name: "Arbeitsschutz", order_confirmation_number: "AB00358", service_number: 1001, language: 1, subproject_number: 1,
  corporate_group: "-", customer_name: "Kunde A GmbH", postal_code: "10115", city: "Berlin", street: "Musterstraße 1",
  order_name: "Arbeitsschutz Kunde A", contract_status: "offen", contract_start: "2026-01-01", contract_end: "2027-12-31",
  contract_hours: 120, planned_hours: 100, responsible_name: "Mathias Muster", role: "SiFa", replacement_name: "Hendryk Arndt",
  min_onsite_time: "4h", travel_flat_rate: "Ja", travel_as_project_time: "Nein",
  contact1_name: "Kontakt Eins", contact1_phone: "+49 30 1", contact1_email: "k1@example.com", contact2_name: "Kontakt Zwei",
  link_google_chat: "https://chat.google.com/room/a", file_storage: "Ordner A", link_trackingtime: "https://app.trackingtime.co/p/a",
  link_asana: "https://app.asana.com/new-a",
});
const ROW_C_APPROVED = () => sheetRow(6, {
  customer_display_name: "Kunde C", customer_number: "10345", service_name: "Brandschutz", order_confirmation_number: "AB00500",
  service_number: 1002, language: 2, subproject_number: 1, order_number_sheet: NEW_KEY_C, customer_name: "Kunde C KG",
  order_name: "Brandschutz Kunde C", contract_status: "offen", contract_start: "2026-07-01", contract_end: "2028-06-30",
  contract_hours: "26,5", responsible_name: "Hendryk Arndt", role: "Brandschutzbeauftragter", replacement_name: "OTHER",
});
const ROW_C_UNREVIEWED = () => sheetRow(7, {
  customer_display_name: "Kunde C", customer_number: "10345", service_name: "Evakuierung", order_confirmation_number: "AB00501",
  service_number: 1003, language: 1, subproject_number: 1, order_number_sheet: NEW_KEY_C_UNREVIEWED,
  order_name: "Evakuierung Kunde C", contract_status: "offen", contract_end: "2028-06-30", contract_hours: 10, responsible_name: "Mathias Muster",
});
const ROW_C_NO_HOURS = () => sheetRow(8, {
  customer_display_name: "Kunde C", customer_number: "10345", service_name: "Reteach", order_confirmation_number: "AB00502",
  service_number: 1004, language: 1, subproject_number: 1, order_number_sheet: NEW_KEY_C_NO_HOURS,
  order_name: "Reteach Kunde C", contract_status: "offen", contract_end: "2028-06-30", contract_hours: "-", responsible_name: "Mathias Muster",
});
const ROW_B_DOC = () => sheetRow(9, {
  customer_display_name: "Kunde B", order_number_old: LEGACY_B, order_number_sheet: "10234_00103_1040.1_01", customer_number: 10234,
  service_name: "Betriebsmedizin", order_confirmation_number: "AB00103", service_number: 1040, language: 1, subproject_number: 1,
  customer_name: "Kunde B AG", order_name: "Betriebsmedizin Kunde B", contract_status: "offen", contract_end: "2026-03-31",
  contract_hours: 60, responsible_name: "DOC", role: "Betriebsarzt", replacement_name: "Hendryk Arndt",
});

/**
 * The importer's resolution step (import-masterdata-sheet-staging.mjs, the
 * "for (const entry of services)" loop), replicated: exact-key customer and
 * order resolution, first-name person resolution with DOC/OTHER sentinels,
 * then classify(). Kept in step with the importer by hand; the payload shape
 * it produces is what promoteBatch reads.
 */
const firstName = (s) => String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim().split(" ")[0];
async function stageLikeTheImporter(db, rows, { fileName, hash, reviewOverrides = {} }) {
  const lexware = new Map([["10110", ENTITY_A], ["10234", ENTITY_B]]);
  const orderNumbers = new Set((await db.query(`select order_number from projects.project_order`)).rows.map((r) => r.order_number));
  const people = new Map();
  for (const r of (await db.query(`select id, name from public.people where is_active`)).rows) {
    const f = firstName(r.name);
    people.set(f, people.has(f) ? "AMBIGUOUS" : r.id);
  }
  const entries = flagDuplicateKeys(rows.map(normaliseServiceRow));
  const records = entries.map((entry, i) => {
    const v = entry.values;
    const legalEntityId = v.customer_number ? lexware.get(v.customer_number) ?? null : null;
    if (v.customer_number && !legalEntityId) entry.flags.push("CUSTOMER_NOT_IN_WAREHOUSE");
    if (v.order_number && orderNumbers.has(v.order_number)) v.order_resolution = "new_key";
    else if (v.order_number_old && orderNumbers.has(v.order_number_old)) v.order_resolution = "legacy_key";
    else if (v.order_number_old) { v.order_resolution = "unknown"; entry.flags.push("UNKNOWN_OLD_KEY"); }
    else v.order_resolution = "new";
    for (const [nameKey, idKey, kindKey, flag, who] of [
      ["responsible_name", "responsible_person_id", "responsible_kind", "UNMATCHED_RESPONSIBLE", "RESPONSIBLE"],
      ["replacement_name", "replacement_person_id", "replacement_kind", "UNMATCHED_REPLACEMENT", "REPLACEMENT"],
    ]) {
      const sentinel = personSentinel(v[nameKey]);
      if (sentinel) { v[idKey] = null; v[kindKey] = sentinel; entry.flags.push(`${who}_${sentinel.toUpperCase()}`); continue; }
      const f = v[nameKey] ? firstName(v[nameKey]) : null;
      const hit = f ? people.get(f) ?? null : null;
      v[idKey] = hit && hit !== "AMBIGUOUS" ? hit : null;
      v[kindKey] = v[nameKey] ? "person" : null;
      if (f && !v[idKey]) entry.flags.push(hit === "AMBIGUOUS" ? `${flag}_AMBIGUOUS` : flag);
    }
    const status = classify({ errors: entry.errors, flags: entry.flags, candidateLegalEntityId: legalEntityId });
    if (reviewOverrides[v.sheet_row]) status.review_status = reviewOverrides[v.sheet_row];
    return {
      row_number: i + 1,
      source_external_id: v.order_number ?? v.order_number_old ?? `${SERVICE_SHEET_NAME}:${v.sheet_row}`,
      source_customer_number: v.customer_number,
      raw_payload: { sheet_name: SERVICE_SHEET_NAME, sheet_row: v.sheet_row, values: v, source_values: entry.source_values, flags: entry.flags },
      normalized_payload: v,
      candidate_legal_entity_id: legalEntityId,
      ...status,
    };
  });
  const batch = (await db.query(
    `insert into stg.import_batch (source_system, entity_type, file_name, file_hash, status, started_at, finished_at, row_count, error_count)
     values ($1, 'masterdata_v1', $2, $3, 'completed', now(), now(), $4, 0) returning id`,
    [SOURCE_SYSTEM, fileName, hash, records.length],
  )).rows[0].id;
  for (const r of records) {
    await db.query(
      `insert into stg.import_record (batch_id, row_number, source_external_id, source_customer_number, raw_payload, normalized_payload,
         validation_status, validation_error, resolution_status, candidate_legal_entity_id, review_status, review_reason)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::uuid, $11, $12)`,
      [batch, r.row_number, r.source_external_id, r.source_customer_number, j(r.raw_payload), j(r.normalized_payload),
        r.validation_status, r.validation_error, r.resolution_status, r.candidate_legal_entity_id, r.review_status, r.review_reason],
    );
  }
  return { batchId: batch, records };
}

const promote = async (db, batchId, now) => {
  await db.query("begin");
  try {
    const report = await promoteBatch(db, { batchId, apply: true, now });
    await db.query("commit");
    return report;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
};
const one = (db) => async (q, p) => (await db.query(q, p)).rows[0];
const all = (db) => async (q, p) => (await db.query(q, p)).rows;
const tableCounts = async (db) => {
  const q = one(db);
  const out = {};
  for (const t of ["public.projects", "public.project_masterdata", "public.project_contact", "public.project_link", "public.project_responsibility", "public.person_assignments", "projects.project_order"]) {
    out[t] = (await q(`select count(*)::int n from ${t}`)).n;
  }
  return out;
};
// The rule check-responsibility-encodings-agree.mjs enforces, both roles, both
// directions: a 'replacement' role row implies a share 0 / sort 1 assignment
// for the same person and vice versa; a 'responsible' row implies 100 / 0.
const encodingsDisagree = async (db) => one(db)(`
  with pr as (select project_id, person_id,
                     case role when 'responsible' then 100 else 0 end as share,
                     case role when 'responsible' then 0 else 1 end as sort
                from public.project_responsibility),
       pa as (select project_id, person_id, share_percent as share, sort_order as sort
                from public.person_assignments
               where project_id is not null
                 and ((share_percent = 100 and sort_order = 0) or (share_percent = 0 and sort_order = 1)))
  select (select count(*) from (select * from pr except select * from pa) x)::int as only_in_roles,
         (select count(*) from (select * from pa except select * from pr) y)::int as only_in_assignments`);

/* ================================================================ pure rules */
console.log("check-masterdata-promote: the promote step against the real schema in PGlite\n");
{
  const mk = (validation_status, review_status, flags) => ({ validation_status, review_status, raw_payload: { flags } });
  check("an approved record is promotable even with NEW_SERVICE (the reviewer's override)", promotability(mk("valid", "approved", ["NEW_SERVICE", "CUSTOMER_NOT_IN_WAREHOUSE"])).promotable);
  const blocked = promotability(mk("valid", "unreviewed", ["NEW_SERVICE", "ENDED_BUT_OPEN"]));
  check("an unreviewed record with a blocking flag is skipped for exactly that flag", !blocked.promotable && j(blocked.reasons) === j(["NEW_SERVICE"]), j(blocked.reasons));
  check("an unreviewed record with only informational flags is promotable", promotability(mk("valid", "unreviewed", ["ENDED_BUT_OPEN", "PHONE_STORED_AS_NUMBER"])).promotable);
  const inv = promotability(mk("invalid", "approved", []));
  check("an invalid record is never promotable, approved or not", !inv.promotable && inv.reasons.includes("INVALID"));
  check("rejected / review_required / in_review are honoured as decisions not yet taken", ["rejected", "review_required", "in_review"].every((s) => !promotability(mk("valid", s, [])).promotable));
  check("sheet_modified comes from the file_name's ' @ <ISO>' suffix when present, else received_at",
    sheetModifiedOf({ file_name: "masterdata-sheet.xlsx @ 2026-09-09T12:57:12Z", received_at: "2026-09-10T00:00:00Z" }) === "2026-09-09T12:57:12.000Z"
    && sheetModifiedOf({ file_name: "masterdata-sheet.xlsx", received_at: "2026-09-10T00:00:00Z" }) === "2026-09-10T00:00:00.000Z");
}

/* ================================================================ the world */
const db = await fresh();
const q = one(db);
const qa = all(db);
const startCounts = await tableCounts(db);

const staged1 = await stageLikeTheImporter(db, [ROW_A(), ROW_C_APPROVED(), ROW_C_UNREVIEWED(), ROW_C_NO_HOURS(), ROW_B_DOC()], {
  fileName: "masterdata-sheet.xlsx @ 2026-09-10T06:00:00Z", hash: "hash-1",
  reviewOverrides: { 6: "approved", 7: "unreviewed", 8: "approved" },
});
const flagsOf = (row) => staged1.records.find((r) => r.raw_payload.sheet_row === row).raw_payload.flags;
check("fixture: the staging replica shaped the records as the importer does (order_resolution, kinds, ids, flags)",
  staged1.records[0].raw_payload.values.order_resolution === "legacy_key"
  && staged1.records[0].raw_payload.values.responsible_person_id === "md-mathias"
  && staged1.records[0].raw_payload.values.replacement_person_id === "md-hendryk"
  && staged1.records[1].raw_payload.values.order_resolution === "new"
  && flagsOf(6).includes("NEW_SERVICE") && flagsOf(7).includes("NEW_SERVICE")
  && staged1.records[4].raw_payload.values.responsible_kind === "doctor"
  && staged1.records[1].raw_payload.values.contract_hours === 26.5
  && staged1.records[3].raw_payload.values.contract_hours === null,
  j(staged1.records.map((r) => [r.raw_payload.sheet_row, r.raw_payload.values.order_resolution, r.review_status, r.raw_payload.flags])));

/* -------------------------------------------------------------- dry run */
{
  await db.query("begin");
  const report = await promoteBatch(db, { batchId: staged1.batchId, apply: false, now: "2026-09-10T07:00:00Z" });
  await db.query("rollback");
  check("dry run: the report counts the real work (3 promotable, 1 inserted, 2 skipped)",
    report.counts.promotable === 3 && report.counts.inserted_new === 1 && report.skipped.length === 2, j(report.counts));
  const after = await tableCounts(db);
  check("dry run: after ROLLBACK not one row remains from it", j(after) === j(startCounts), `${j(startCounts)} -> ${j(after)}`);
}

/* -------------------------------------------------------------- batch 1 */
const r1 = await promote(db, staged1.batchId, "2026-09-10T07:00:00Z");
check("batch 1: 3 promotable = 2 legacy matches + 1 inserted new service; nothing matched by new key yet",
  r1.counts.promotable === 3 && r1.counts.matched_legacy === 2 && r1.counts.inserted_new === 1 && r1.counts.matched_new_key === 0, j(r1.counts));
check("batch 1: the unreviewed NEW_SERVICE is skipped for its flag; the approved service without contract hours for CONTRACT_HOURS_MISSING",
  r1.counts.skipped.NEW_SERVICE === 1 && r1.counts.skipped.CONTRACT_HOURS_MISSING === 1
  && r1.skipped.some((s) => s.sheet_row === 7 && s.reasons.includes("NEW_SERVICE"))
  && r1.skipped.some((s) => s.sheet_row === 8 && s.reasons.includes("CONTRACT_HOURS_MISSING")), j(r1.skipped));

const newProject = await q(`select id, code, name, customer, lead, status, contract_hours::float contract_hours, billable_hours, consumed_percent, logged_hours, due, contract_type, owner_person_id, customer_legal_entity_id from public.projects where id = $1`, [NEW_KEY_C]);
check("a NEW approved service becomes a public.projects row whose id = code = the new key (the invariant holds for it too)",
  newProject && newProject.code === NEW_KEY_C && newProject.name === "Brandschutz Kunde C" && newProject.customer === "Kunde C", j(newProject));
check("its contract_hours is the sheet's 26,5; status, billable_hours, consumed_percent and logged_hours are NULL (unmeasured, not 0)",
  newProject && newProject.contract_hours === 26.5 && newProject.status === null && newProject.billable_hours === null && newProject.consumed_percent === null && newProject.logged_hours === null, j(newProject));
check("its lead/owner is the resolved responsible, due is the contract end, contract_type the service name, no legal entity because the customer is not in the warehouse",
  newProject && newProject.lead === "Hendryk Arndt" && newProject.owner_person_id === "md-hendryk" && newProject.due === "2028-06-30" && newProject.contract_type === "Brandschutz" && newProject.customer_legal_entity_id === null, j(newProject));
check("the service whose hours read '-' was NOT inserted: no projects row, no masterdata row, and no project anywhere carries contract_hours = 0",
  (await q(`select count(*)::int n from public.projects where id = $1`, [NEW_KEY_C_NO_HOURS])).n === 0
  && (await q(`select count(*)::int n from public.project_masterdata where masterdata_key = $1`, [NEW_KEY_C_NO_HOURS])).n === 0
  && (await q(`select count(*)::int n from public.projects where contract_hours = 0`)).n === 0);

const projA = await q(`select id, code, name, contract_hours::float contract_hours, due, contract_type, owner_person_id, lead, customer_legal_entity_id, status, billable_hours::float billable_hours, logged_hours::float logged_hours from public.projects where id = $1`, [LEGACY_A]);
check("legacy match: the existing project keeps its id and code, and gains contract_hours 120, due, contract_type, the legal entity, owner and lead from the sheet",
  projA && projA.code === LEGACY_A && projA.contract_hours === 120 && projA.due === "2027-12-31" && projA.contract_type === "Arbeitsschutz"
  && projA.owner_person_id === "md-mathias" && projA.lead === "Mathias Muster" && projA.customer_legal_entity_id === ENTITY_A, j(projA));
check("legacy match: status, billable_hours and logged_hours are untouched (they belong to refresh-order-hours)",
  projA && projA.status === "NORMAL" && projA.billable_hours === 0 && projA.logged_hours === 33.5, j(projA));

const mdA = await q(`select masterdata_key, order_number_old, customer_number, language, contract_start::text contract_start, contract_end::text contract_end, contract_status_sheet, responsible_kind, responsible_person_id, replacement_kind, replacement_person_id, service_role, travel_flat_rate, travel_as_project_time, corporate_group, file_storage, sheet_row, lifecycle_status, historical_since, last_seen_batch_id, (last_seen_at at time zone 'UTC')::text last_seen_at, source_system from public.project_masterdata where project_id = $1`, [LEGACY_A]);
check("project_masterdata carries the sheet's fields for the legacy project: new key, old key, customer number, language, dates, kinds, people, role, yes/no flags",
  mdA && mdA.masterdata_key === NEW_KEY_A && mdA.order_number_old === LEGACY_A && mdA.customer_number === "10110" && Number(mdA.language) === 1
  && mdA.contract_start === "2026-01-01" && mdA.contract_end === "2027-12-31" && mdA.contract_status_sheet === "offen"
  && mdA.responsible_kind === "person" && mdA.responsible_person_id === "md-mathias" && mdA.replacement_kind === "person" && mdA.replacement_person_id === "md-hendryk"
  && mdA.service_role === "SiFa" && mdA.travel_flat_rate === true && mdA.travel_as_project_time === false && Number(mdA.sheet_row) === 5, j(mdA));
check("honest nulls in project_masterdata: corporate_group '-' is NULL; file_storage is text, not a link",
  mdA && mdA.corporate_group === null && mdA.file_storage === "Ordner A", j(mdA));
check("project_masterdata is active, last seen by batch 1 at the SHEET's modified time (from the file_name), source MASTERDATA_SHEET_V1",
  mdA && mdA.lifecycle_status === "active" && mdA.historical_since === null && mdA.last_seen_batch_id === staged1.batchId
  && /^2026-09-10 06:00:00/.test(mdA.last_seen_at) && mdA.source_system === SOURCE_SYSTEM && r1.sheet_modified === "2026-09-10T06:00:00.000Z", j(mdA));
const mdB = await q(`select responsible_kind, responsible_person_id, replacement_kind, replacement_person_id, contract_end::text contract_end from public.project_masterdata where project_id = $1`, [LEGACY_B]);
check("DOC as responsible is stored as kind 'doctor' with no person; the replacement resolves to Hendryk",
  mdB && mdB.responsible_kind === "doctor" && mdB.responsible_person_id === null && mdB.replacement_kind === "person" && mdB.replacement_person_id === "md-hendryk", j(mdB));

const poA = await q(`select order_number, masterdata_key, lifecycle_status, historical_since, last_seen_batch_id, legal_entity_id, review_status from projects.project_order where order_number = $1`, [LEGACY_A]);
const poC = await q(`select order_number, masterdata_key, lifecycle_status, review_status, legal_entity_id, name from projects.project_order where order_number = $1`, [NEW_KEY_C]);
check("project_order: order_number is still the OLD key, masterdata_key is the new one beside it, active, last seen by batch 1",
  poA && poA.order_number === LEGACY_A && poA.masterdata_key === NEW_KEY_A && poA.lifecycle_status === "active" && poA.historical_since === null && poA.last_seen_batch_id === staged1.batchId, j(poA));
check("project_order for the new service was created: review_required because no legal entity is known (promote-customer-master's rule)",
  poC && poC.masterdata_key === NEW_KEY_C && poC.review_status === "review_required" && poC.legal_entity_id === null && poC.name === "Brandschutz Kunde C", j(poC));
check("project_order B gained its legal entity from the candidate (coalesce), never overwriting a known one",
  (await q(`select legal_entity_id from projects.project_order where order_number = $1`, [LEGACY_B]))?.legal_entity_id === ENTITY_B);
check("the fixture's two legacy project_order rows are the only ones with the old keys -- no order_number was rewritten to a new key",
  (await q(`select count(*)::int n from projects.project_order where order_number in ($1, $2)`, [LEGACY_A, LEGACY_B])).n === 2
  && (await q(`select count(*)::int n from projects.project_order where order_number = $1`, [NEW_KEY_A])).n === 0);

const contactsA = await qa(`select slot, name, phone, email, source_system from public.project_contact where project_id = $1 order by slot`, [LEGACY_A]);
check("contacts: slot 1 with name/phone/email and slot 2 with name only are upserted; the DOC project with no contacts has none",
  contactsA.length === 2 && contactsA[0].name === "Kontakt Eins" && contactsA[0].phone === "+49 30 1" && contactsA[0].email === "k1@example.com"
  && contactsA[1].name === "Kontakt Zwei" && contactsA[1].phone === null && contactsA[1].email === null && contactsA.every((c) => c.source_system === SOURCE_SYSTEM)
  && (await q(`select count(*)::int n from public.project_contact where project_id = $1`, [LEGACY_B])).n === 0, j(contactsA));

const linksA = await qa(`select kind, url, label, source from public.project_link where project_id = $1 order by kind, url`, [LEGACY_A]);
check("links: the stale masterdata Asana URL is replaced by the sheet's, not duplicated",
  linksA.filter((l) => l.kind === "asana").length === 1 && linksA.find((l) => l.kind === "asana").url === "https://app.asana.com/new-a" && linksA.find((l) => l.kind === "asana").source === "masterdata", j(linksA));
check("links: the hand-added (source manual) chat link survives beside the sheet's; labels are the sheet headers; file_storage is not a link",
  linksA.filter((l) => l.kind === "google_chat").length === 2 && linksA.some((l) => l.source === "manual" && l.url === "https://chat.google.com/room/hand-added")
  && linksA.find((l) => l.kind === "trackingtime")?.label === "Zeiterfassungslink" && linksA.find((l) => l.kind === "asana")?.label === "Asana-Link"
  && linksA.length === 4, j(linksA));
check("links: the report counts what changed (3 written, 1 removed)", r1.counts.links_written === 3 && r1.counts.links_removed === 1, j(r1.counts));

const respA = await qa(`select person_id, role, source, order_no from public.project_responsibility where project_id = $1 order by role, person_id`, [LEGACY_A]);
const asgA = await qa(`select person_id, share_percent::float share, sort_order sort, logged_hours::float logged, project_name from public.person_assignments where project_id = $1 order by sort_order`, [LEGACY_A]);
check("responsibility A: Mathias responsible + Hendryk replacement; the stale Thorsten cover is gone from the role table",
  respA.length === 2 && respA.some((r) => r.person_id === "md-hendryk" && r.role === "replacement") && respA.some((r) => r.person_id === "md-mathias" && r.role === "responsible")
  && !respA.some((r) => r.person_id === "md-thorsten"), j(respA));
check("responsibility A: order_no is the PROJECT ID, not the new key (MyWorkTables prints '· order N' when they differ)",
  respA.every((r) => r.order_no === LEGACY_A && r.source === "masterdata"), j(respA));
check("assignments A: Mathias 100/0 keeps his remembered logged_hours 33.5; Hendryk 0/1 is new; Thorsten's 0/1 row is gone; project_name is the project's name",
  asgA.length === 2 && asgA[0].person_id === "md-mathias" && asgA[0].share === 100 && asgA[0].sort === 0 && asgA[0].logged === 33.5
  && asgA[1].person_id === "md-hendryk" && asgA[1].share === 0 && asgA[1].sort === 1 && asgA[1].logged === 0 && asgA.every((a) => a.project_name === "Arbeitsschutz Kunde A"), j(asgA));
const respB = await qa(`select person_id, role from public.project_responsibility where project_id = $1 order by role`, [LEGACY_B]);
const asgB = await qa(`select person_id, share_percent::float share, sort_order sort, logged_hours::float logged from public.person_assignments where project_id = $1 order by sort_order`, [LEGACY_B]);
check("DOC project B: the existing responsible rows (Mathias, 12.5 h) are left alone in BOTH encodings; the Hendryk replacement is added to both",
  respB.length === 2 && respB[0].role === "replacement" && respB[0].person_id === "md-hendryk" && respB[1].role === "responsible" && respB[1].person_id === "md-mathias"
  && asgB.length === 2 && asgB[0].person_id === "md-mathias" && asgB[0].logged === 12.5 && asgB[1].person_id === "md-hendryk" && asgB[1].share === 0 && asgB[1].sort === 1, j({ respB, asgB }));
check("the report says so: 2 roles left alone (DOC responsible on B, OTHER replacement on C) with a note each",
  r1.counts.responsibility_left_alone === 2 && r1.responsibility_notes.length === 2 && r1.responsibility_notes.some((n) => n.project_id === LEGACY_B && n.kind === "doctor")
  && r1.responsibility_notes.some((n) => n.project_id === NEW_KEY_C && n.kind === "other" && n.role === "replacement"), j(r1.responsibility_notes));
const agree1 = await encodingsDisagree(db);
check("both encodings agree for every project after batch 1 (the check-responsibility-encodings-agree rule)", agree1 && agree1.only_in_roles === 0 && agree1.only_in_assignments === 0, j(agree1));
check("the report's responsibility/assignment counts match the rows written (4 roles written = A×2, B×1, C×1)",
  r1.counts.responsibility_rows === 4 && r1.counts.assignment_rows === 4, j(r1.counts));
check("batch 1 marked nothing historical: every masterdata row is in the sheet", r1.counts.historical_marked === 0
  && (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'historical'`)).n === 0);

/* ----------------------------------------------------------- idempotent */
const counts1 = await tableCounts(db);
const r1b = await promote(db, staged1.batchId, "2026-09-10T07:30:00Z");
const counts1b = await tableCounts(db);
check("promoting the same batch twice changes no table count", j(counts1) === j(counts1b), `${j(counts1)} -> ${j(counts1b)}`);
check("on the re-run the new service is found by its key (matched_new_key), nothing is inserted and no link is rewritten",
  r1b.counts.inserted_new === 0 && r1b.counts.matched_new_key === 1 && r1b.counts.matched_legacy === 2 && r1b.counts.links_written === 0 && r1b.counts.links_removed === 0, j(r1b.counts));
check("the re-run keeps Mathias's remembered logged_hours and both encodings still agree",
  (await q(`select logged_hours::float h from public.person_assignments where project_id = $1 and share_percent = 100 and sort_order = 0`, [LEGACY_A]))?.h === 33.5
  && j(await encodingsDisagree(db)) === j({ only_in_roles: 0, only_in_assignments: 0 }));
check("public.projects never lost a row (fixture 2 + 1 inserted = 3, the legacy ids still there)",
  counts1b["public.projects"] === 3 && (await q(`select count(*)::int n from public.projects where id in ($1, $2)`, [LEGACY_A, LEGACY_B])).n === 2);

/* ---------------------------------------------- batch 2: row A disappears */
const staged2 = await stageLikeTheImporter(db, [ROW_C_APPROVED(), ROW_C_UNREVIEWED(), ROW_C_NO_HOURS(), ROW_B_DOC()], {
  fileName: "masterdata-sheet.xlsx @ 2026-09-10T08:00:00Z", hash: "hash-2",
  reviewOverrides: { 6: "approved", 7: "unreviewed", 8: "approved" },
});
const r2 = await promote(db, staged2.batchId, "2026-09-10T09:00:00Z");
const mdA2 = await q(`select lifecycle_status, (historical_since at time zone 'UTC')::text historical_since, last_seen_batch_id from public.project_masterdata where project_id = $1`, [LEGACY_A]);
const poA2 = await q(`select lifecycle_status, (historical_since at time zone 'UTC')::text historical_since, order_number from projects.project_order where order_number = $1`, [LEGACY_A]);
check("batch 2 without row A: A becomes historical on project_masterdata with historical_since = the promote instant, and its last_seen stays batch 1",
  r2.counts.historical_marked === 1 && mdA2?.lifecycle_status === "historical" && /^2026-09-10 09:00:00/.test(mdA2?.historical_since ?? "") && mdA2?.last_seen_batch_id === staged1.batchId, j({ counts: r2.counts, mdA2 }));
check("...mirrored onto projects.project_order for the same project id, order_number untouched",
  poA2?.lifecycle_status === "historical" && /^2026-09-10 09:00:00/.test(poA2?.historical_since ?? "") && poA2?.order_number === LEGACY_A, j(poA2));
check("...while public.projects still holds A and its assignments are intact (never deleted)",
  (await q(`select count(*)::int n from public.projects where id = $1`, [LEGACY_A])).n === 1
  && (await q(`select count(*)::int n from public.person_assignments where project_id = $1`, [LEGACY_A])).n === 2
  && (await tableCounts(db))["public.projects"] === 3);
check("the rows the sheet still lists stay active (B by its old key, C by its new key); the skipped-but-listed rows are not treated as vanished",
  (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'active'`)).n === 2
  && (await q(`select lifecycle_status from projects.project_order where order_number = $1`, [LEGACY_B]))?.lifecycle_status === "active");

/* ------------------------------------------- batch 3: row A is back, changed */
const rowA3 = ROW_A();
delete rowA3.cells[LETTER.contact2_name];                   // contact 2 emptied
rowA3.cells[LETTER.contact1_phone] = "+49 30 2";             // contact 1 changed
rowA3.cells[LETTER.link_asana] = "https://app.asana.com/new-a-2"; // Asana moved
delete rowA3.cells[LETTER.link_trackingtime];               // TrackingTime link removed
const staged3 = await stageLikeTheImporter(db, [rowA3, ROW_C_APPROVED(), ROW_C_UNREVIEWED(), ROW_C_NO_HOURS(), ROW_B_DOC()], {
  fileName: "masterdata-sheet.xlsx @ 2026-09-10T10:00:00Z", hash: "hash-3",
  reviewOverrides: { 6: "approved", 7: "unreviewed", 8: "approved" },
});
const r3 = await promote(db, staged3.batchId, "2026-09-10T11:00:00Z");
const mdA3 = await q(`select lifecycle_status, historical_since, last_seen_batch_id, (last_seen_at at time zone 'UTC')::text last_seen_at from public.project_masterdata where project_id = $1`, [LEGACY_A]);
const poA3 = await q(`select lifecycle_status, historical_since, last_seen_batch_id, masterdata_key from projects.project_order where order_number = $1`, [LEGACY_A]);
check("batch 3 with row A again: reactivated = 1; A is active with historical_since NULL on project_masterdata, last seen by batch 3 at its sheet time",
  r3.counts.reactivated === 1 && mdA3?.lifecycle_status === "active" && mdA3?.historical_since === null && mdA3?.last_seen_batch_id === staged3.batchId && /^2026-09-10 10:00:00/.test(mdA3?.last_seen_at ?? ""), j({ counts: r3.counts, mdA3 }));
check("...and on project_order, still under the old order_number with the same masterdata_key",
  poA3?.lifecycle_status === "active" && poA3?.historical_since === null && poA3?.last_seen_batch_id === staged3.batchId && poA3?.masterdata_key === NEW_KEY_A, j(poA3));
const contactsA3 = await qa(`select slot, name, phone from public.project_contact where project_id = $1 order by slot`, [LEGACY_A]);
check("contacts: slot 1 is updated in place, slot 2 is deleted once the sheet empties it (report: 1 written, 1 deleted for A)",
  contactsA3.length === 1 && contactsA3[0].slot === 1 && contactsA3[0].phone === "+49 30 2" && r3.counts.contacts_deleted === 1, j({ contactsA3, counts: r3.counts }));
const linksA3 = await qa(`select kind, url, source from public.project_link where project_id = $1 order by kind, url`, [LEGACY_A]);
check("links: the moved Asana URL replaces the previous one, the removed TrackingTime link is gone, the manual chat link still survives",
  linksA3.filter((l) => l.kind === "asana").length === 1 && linksA3.find((l) => l.kind === "asana").url === "https://app.asana.com/new-a-2"
  && !linksA3.some((l) => l.kind === "trackingtime") && linksA3.some((l) => l.source === "manual") && linksA3.length === 3, j(linksA3));
check("both encodings still agree after three batches, and the assignment rows of A are exactly Mathias 100/0 and Hendryk 0/1",
  j(await encodingsDisagree(db)) === j({ only_in_roles: 0, only_in_assignments: 0 })
  && (await q(`select count(*)::int n from public.person_assignments where project_id = $1`, [LEGACY_A])).n === 2);
check("across all batches no project, masterdata row or project_order was deleted (3 / 3 / 3)",
  (await tableCounts(db))["public.projects"] === 3 && (await tableCounts(db))["public.project_masterdata"] === 3 && (await tableCounts(db))["projects.project_order"] === 3, j(await tableCounts(db)));

/* --------------------------------------------------------- refusals */
{
  const staging = (await db.query(`insert into stg.import_batch (source_system, entity_type, file_name, file_hash, status, row_count, error_count) values ($1, 'masterdata_v1', 'x', 'hash-4', 'processing', 0, 0) returning id`, [SOURCE_SYSTEM])).rows[0].id;
  let refused = null;
  await db.query("begin");
  try { await promoteBatch(db, { batchId: staging }); } catch (e) { refused = e.message; }
  await db.query("rollback");
  check("a batch that is not 'completed' is refused, not promoted", /not completed/.test(refused ?? ""), refused ?? "no error");
  let unknown = null;
  await db.query("begin");
  try { await promoteBatch(db, { batchId: "00000000-0000-4000-8000-000000000000" }); } catch (e) { unknown = e.message; }
  await db.query("rollback");
  check("an unknown batch id is refused", /does not exist/.test(unknown ?? ""), unknown ?? "no error");
}

await db.close();
console.log(failures ? `\nFAIL (${failures})` : "\nPASS");
process.exit(failures ? 1 : 0);

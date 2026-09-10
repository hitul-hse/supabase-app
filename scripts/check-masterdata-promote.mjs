/*
 * Does promoting a staged masterdata-sheet batch write exactly what the
 * 2026-09-10 decisions allow -- and nothing else?
 *
 * WHY THIS GATE EXISTS. scripts/promote-masterdata-sheet.mjs is the first
 * process that writes the business side's Google Sheet into the tables the
 * operations pages read: public.projects, project_masterdata, project_contact,
 * project_link, projects.project_order and EVERY responsibility encoding. It
 * runs unattended against the live warehouse, so every rule it must keep is
 * pinned here against the real schema, in PGlite, with no credentials:
 *
 *   - a record is promoted only when valid and either approved or unreviewed
 *     without a blocking flag; an approved NEW_SERVICE is let in, an
 *     unreviewed one is not;
 *   - resolution is by EXACT key (ADR-001): the legacy key against
 *     public.projects.id, the new key against project_masterdata. The
 *     negative control is a record whose old key is in project_order but not
 *     in public.projects and whose order name EQUALS an existing project's:
 *     it must be skipped LEGACY_PROJECT_MISSING with no write, because a
 *     lookup that fell back to name equality would find the project;
 *   - a second project claiming a key another holds is MASTERDATA_KEY_CONFLICT,
 *     skipped with no half-insert; an unknown old key is UNKNOWN_OLD_KEY;
 *   - existing project ids never move; order_number stays the old key and the
 *     new key rides beside it as masterdata_key;
 *   - honest nulls: a service whose contract hours read "-" is SKIPPED, never
 *     inserted with 0 -- the column is NOT NULL and a fabricated 0 would read
 *     as a real contract;
 *   - the THREE responsibility encodings (project_responsibility roles,
 *     person_assignments share 100/0 + sort 0/1, projects.owner_person_id)
 *     agree after every promote: the four checks of
 *     check-responsibility-encodings-agree.mjs replicated verbatim, plus
 *     "one share-100 row per project" and "owner_person_id is the
 *     responsible role's person";
 *   - a role held by change_control (the handover RPC's exact row shape:
 *     share 100 / sort_order 2 and source 'change_control', from
 *     20260827080000) is never deleted, re-sourced, duplicated or reverted,
 *     whether the sheet agrees with it or not;
 *   - a resolved person keeps their assignment row IN PLACE (id, tasks_count,
 *     logged_hours survive); a changed responsible never inherits the previous
 *     holder's hours; a brand-new responsible row carries the project's
 *     logged total (the August convention), the replacement's 0;
 *   - DOC / OTHER / an empty cell mean no colleague holds the role: its
 *     masterdata rows go from both tables and owner_person_id is cleared, so
 *     the orphan cover of a "gap project" (the 28 the live gate documents) is
 *     removed rather than left beside a new responsible row;
 *   - links: the sheet's rows carry source 'masterdata_sheet'; a stated URL
 *     replaces the workbook's ('masterdata') URL of that kind, an empty or
 *     placeholder cell leaves the workbook's link alone and withdraws only the
 *     sheet's own; a hand-added link survives everything;
 *     contacts are upserted and deleted when the sheet empties them;
 *   - a row that vanishes from the sheet becomes historical on
 *     project_masterdata AND project_order, keeps its public.projects row and
 *     its assignments, and comes back active when it reappears;
 *   - an EMPTY batch is refused; a batch that would mark more than half of the
 *     active rows historical is refused unless the caller lifts the bound;
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
 * through, in order -- customer-master foundation, legal-entity fields, the
 * change-control tables, project_responsibility, projects.customer_legal_
 * entity_id, the 2026-08-26 relaxation of status/billable_hours/consumed_
 * percent (production has it; schema.sql predates it), the handover RPC
 * migration that admits source 'change_control', project_link, and the
 * masterdata warehouse migration this promote step is the consumer of.
 *
 * Proved red by mutation before it was trusted: a legacy lookup that falls
 * back to name equality, the key-conflict guard disabled, the empty-cell
 * clearing skipped, change_control rows deleted, the share-100 sweep removed,
 * the empty-batch refusal removed and the link source reverted each turn at
 * least one assertion below red.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import {
  SERVICE_COLUMNS, SERVICE_SHEET_NAME, normaliseServiceRow, flagDuplicateKeys, classify, personSentinel, setClock,
} from "./lib/masterdata-sheet.mjs";
import { promoteBatch, promotability, sheetModifiedOf, SOURCE_SYSTEM, LINK_SOURCE } from "./lib/masterdata-promote.mjs";

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
  "supabase/migrations/20260823090000_add_project_change_control.sql",
  "supabase/migrations/20260824160000_create_project_responsibility.sql",
  "supabase/migrations/20260824170000_link_project_customer_entity.sql",
  "supabase/migrations/20260826120000_projects_admit_unmeasured_hours.sql",
  "supabase/migrations/20260827080000_reassignment_moves_responsibility.sql",
  "supabase/migrations/20260903230000_project_link.sql",
  "supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql",
];

const ENTITY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ENTITY_B = "bbbbbbbb-0000-4000-8000-000000000002";
const LEGACY_A = "10110_00358_104_01";       // the ordinary legacy match
const LEGACY_B = "10234_00103_104_01";       // DOC responsible
const LEGACY_D = "10110_00358_105_01";       // claims A's new key in batch 3
const LEGACY_E = "10110_00360_104_01";       // both cells emptied
const LEGACY_F = "10234_00104_104_01";       // the handover RPC's state
const LEGACY_G = "10234_00105_104_01";       // a gap project: 0/1 cover, no role rows
const LEGACY_H = "10110_00361_104_01";       // responsible changes person
const LEGACY_I = "10234_00106_104_01";       // the PRE-20260827 RPC state: 100/2, stale masterdata role
const LEGACY_MISSING = "10110_00999_104_01"; // in project_order, not in public.projects
const LEGACY_UNKNOWN = "10110_00777_104_01"; // in neither
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
             ('${LEGACY_B}', '${LEGACY_B}', 'Betriebsmedizin Kunde B', 'Kunde B', 'n/a', 'NORMAL', 50, 0, 0, 12.5, 'n/a', null),
             ('${LEGACY_D}', '${LEGACY_D}', 'Gefaehrdungsbeurteilung Kunde A', 'Kunde A', 'n/a', 'NORMAL', 10, 0, 0, 0, 'n/a', null),
             ('${LEGACY_E}', '${LEGACY_E}', 'Unterweisung Kunde A', 'Kunde A', 'Mathias', 'NORMAL', 40, 0, 0, 5, 'n/a', 'md-mathias'),
             ('${LEGACY_F}', '${LEGACY_F}', 'Ergonomie Kunde B', 'Kunde B', 'Hendryk', 'NORMAL', 30, 0, 0, 8, 'n/a', 'md-hendryk'),
             ('${LEGACY_G}', '${LEGACY_G}', 'Brandschutz Kunde B', 'Kunde B', 'n/a', 'NORMAL', 25, 0, 0, 12.5, 'n/a', null),
             ('${LEGACY_H}', '${LEGACY_H}', 'Evakuierung Kunde A', 'Kunde A', 'Mathias', 'NORMAL', 80, 0, 0, 20, 'n/a', 'md-mathias'),
             ('${LEGACY_I}', '${LEGACY_I}', 'Ersthelfer Kunde B', 'Kunde B', 'Thorsten', 'NORMAL', 35, 0, 0, 50, 'n/a', 'md-thorsten');
    insert into projects.project_order (order_number, name) values
      ('${LEGACY_A}', 'Arbeitsschutz Kunde A'), ('${LEGACY_B}', 'Betriebsmedizin Kunde B'), ('${LEGACY_D}', 'Gefaehrdungsbeurteilung Kunde A'),
      ('${LEGACY_E}', 'Unterweisung Kunde A'), ('${LEGACY_F}', 'Ergonomie Kunde B'), ('${LEGACY_G}', 'Brandschutz Kunde B'),
      ('${LEGACY_H}', 'Evakuierung Kunde A'), ('${LEGACY_I}', 'Ersthelfer Kunde B'), ('${LEGACY_MISSING}', 'Order without a project row');
    -- what the August workbook import left behind, in both encodings
    insert into public.person_assignments (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
      values ('md-mathias', '${LEGACY_A}', 'Arbeitsschutz Kunde A', 33.5, 4, 100, 0),
             ('md-thorsten', '${LEGACY_A}', 'Arbeitsschutz Kunde A', 0, 0, 0, 1),
             ('md-mathias', '${LEGACY_B}', 'Betriebsmedizin Kunde B', 12.5, 2, 100, 0),
             ('md-mathias', '${LEGACY_E}', 'Unterweisung Kunde A', 5, 1, 100, 0),
             ('md-thorsten', '${LEGACY_E}', 'Unterweisung Kunde A', 0, 0, 0, 1),
             ('md-thorsten', '${LEGACY_F}', 'Ergonomie Kunde B', 0, 0, 0, 1),
             ('md-thorsten', '${LEGACY_G}', 'Brandschutz Kunde B', 0, 0, 0, 1),
             ('md-mathias', '${LEGACY_H}', 'Evakuierung Kunde A', 33.5, 4, 100, 0),
             ('md-hendryk', '${LEGACY_I}', 'Ersthelfer Kunde B', 0, 0, 0, 1);
    -- F went through decide_project_responsible_change (20260827080000): the
    -- incoming person's assignment is share 100 / sort_order max+1 (here 2)
    -- and the role row is source 'change_control' -- the RPC's exact shape.
    insert into public.person_assignments (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
      values ('md-hendryk', '${LEGACY_F}', 'Ergonomie Kunde B', 0, 0, 100, 2);
    -- I went through the RPC's FIRST version (20260823090000), which moved
    -- owner and assignment (Thorsten 100/2, 7.5 h since) but never touched the
    -- role table: Mathias's masterdata 'responsible' row is stale. The sheet
    -- names Thorsten, so the promote must sweep the 100/2 row into 100/0.
    insert into public.person_assignments (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
      values ('md-thorsten', '${LEGACY_I}', 'Ersthelfer Kunde B', 7.5, 0, 100, 2);
    insert into public.project_responsibility (project_id, person_id, role, source, order_no)
      values ('${LEGACY_A}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_A}'),
             ('${LEGACY_A}', 'md-thorsten', 'replacement', 'masterdata', '${LEGACY_A}'),
             ('${LEGACY_B}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_B}'),
             ('${LEGACY_E}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_E}'),
             ('${LEGACY_E}', 'md-thorsten', 'replacement', 'masterdata', '${LEGACY_E}'),
             ('${LEGACY_F}', 'md-hendryk', 'responsible', 'change_control', '${LEGACY_F}'),
             ('${LEGACY_F}', 'md-thorsten', 'replacement', 'masterdata', '${LEGACY_F}'),
             ('${LEGACY_H}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_H}'),
             ('${LEGACY_I}', 'md-mathias', 'responsible', 'masterdata', '${LEGACY_I}'),
             ('${LEGACY_I}', 'md-hendryk', 'replacement', 'masterdata', '${LEGACY_I}');
    -- G deliberately has NO role row: the live gate's "gap project" shape.
    insert into public.project_link (project_id, kind, url, label, source)
      values ('${LEGACY_A}', 'asana', 'https://app.asana.com/old-a', 'Asana', 'masterdata'),
             ('${LEGACY_A}', 'trackingtime', 'https://app.trackingtime.co/p/a', 'TrackingTime', 'masterdata'),
             ('${LEGACY_A}', 'google_chat', 'https://chat.google.com/room/hand-added', 'Chat', 'manual'),
             ('${LEGACY_B}', 'trackingtime', 'https://app.trackingtime.co/p/b-august', 'TrackingTime', 'masterdata');
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
// The TrackingTime cell holds the sheet's placeholder: parseLink reads it as null.
const ROW_B_DOC = () => sheetRow(9, {
  customer_display_name: "Kunde B", order_number_old: LEGACY_B, order_number_sheet: "10234_00103_1040.1_01", customer_number: 10234,
  service_name: "Betriebsmedizin", order_confirmation_number: "AB00103", service_number: 1040, language: 1, subproject_number: 1,
  customer_name: "Kunde B AG", order_name: "Betriebsmedizin Kunde B", contract_status: "offen", contract_end: "2026-03-31",
  contract_hours: 60, responsible_name: "DOC", role: "Betriebsarzt", replacement_name: "Hendryk Arndt", link_trackingtime: "Link einfügen",
});
// Both people cells empty: NO_RESPONSIBLE is informational, the row is unreviewed and promotable.
const ROW_E_EMPTY = () => sheetRow(10, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_E, order_number_sheet: "10110_00360_1005.1_01", customer_number: 10110,
  service_name: "Unterweisung", order_confirmation_number: "AB00360", service_number: 1005, language: 1, subproject_number: 1,
  customer_name: "Kunde A GmbH", order_name: "Unterweisung Kunde A", contract_status: "offen", contract_end: "2027-12-31", contract_hours: 40,
});
// The sheet was not updated after the in-product handover to Hendryk: it still says Mathias.
const ROW_F_RPC = (replacement = "Thorsten X") => sheetRow(11, {
  customer_display_name: "Kunde B", order_number_old: LEGACY_F, order_number_sheet: "10234_00104_1041.1_01", customer_number: 10234,
  service_name: "Ergonomie", order_confirmation_number: "AB00104", service_number: 1041, language: 1, subproject_number: 1,
  customer_name: "Kunde B AG", order_name: "Ergonomie Kunde B", contract_status: "offen", contract_end: "2027-06-30", contract_hours: 30,
  responsible_name: "Mathias Muster", replacement_name: replacement,
});
// A gap project (0/1 cover, no role row) whose sheet row names a responsible and DOC as cover.
const ROW_G_GAP = () => sheetRow(12, {
  customer_display_name: "Kunde B", order_number_old: LEGACY_G, order_number_sheet: "10234_00105_1042.1_01", customer_number: 10234,
  service_name: "Brandschutz", order_confirmation_number: "AB00105", service_number: 1042, language: 1, subproject_number: 1,
  customer_name: "Kunde B AG", order_name: "Brandschutz Kunde B", contract_status: "offen", contract_end: "2027-06-30", contract_hours: 25,
  responsible_name: "Hendryk Arndt", replacement_name: "DOC",
});
// The responsible changes from Mathias (33.5 h on his row) to Thorsten.
const ROW_H_CHANGED = () => sheetRow(13, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_H, order_number_sheet: "10110_00361_1006.1_01", customer_number: 10110,
  service_name: "Evakuierung", order_confirmation_number: "AB00361", service_number: 1006, language: 1, subproject_number: 1,
  customer_name: "Kunde A GmbH", order_name: "Evakuierung Kunde A", contract_status: "offen", contract_end: "2027-12-31", contract_hours: 80,
  responsible_name: "Thorsten X",
});
// The sheet already names the person the first-version RPC handed over to.
const ROW_I_OLD_RPC = () => sheetRow(17, {
  customer_display_name: "Kunde B", order_number_old: LEGACY_I, order_number_sheet: "10234_00106_1043.1_01", customer_number: 10234,
  service_name: "Ersthelfer", order_confirmation_number: "AB00106", service_number: 1043, language: 1, subproject_number: 1,
  customer_name: "Kunde B AG", order_name: "Ersthelfer Kunde B", contract_status: "offen", contract_end: "2027-06-30", contract_hours: 35,
  responsible_name: "Thorsten X", replacement_name: "Hendryk Arndt",
});
// ADR-001 negative control: the old key is an order with no project row, and the
// order name is EXACTLY project A's name. Exact-key resolution must skip it.
const ROW_LEGACY_MISSING = () => sheetRow(14, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_MISSING, order_number_sheet: "10110_00999_1007.1_01", customer_number: 10110,
  service_name: "Arbeitsschutz", order_confirmation_number: "AB00999", service_number: 1007, language: 1, subproject_number: 1,
  customer_name: "Kunde A GmbH", order_name: "Arbeitsschutz Kunde A", contract_status: "offen", contract_end: "2027-12-31", contract_hours: 15,
  responsible_name: "Mathias Muster",
});
// An old key the warehouse has never seen, approved by a reviewer anyway.
const ROW_UNKNOWN_OLD = () => sheetRow(15, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_UNKNOWN, order_number_sheet: "10110_00777_1008.1_01", customer_number: 10110,
  service_name: "Arbeitsschutz", order_confirmation_number: "AB00777", service_number: 1008, language: 1, subproject_number: 1,
  customer_name: "Kunde A GmbH", order_name: "Arbeitsschutz Kunde A Nord", contract_status: "offen", contract_end: "2027-12-31", contract_hours: 15,
  responsible_name: "Mathias Muster",
});
// Project D's row derives exactly A's new key (same customer, AB, service, language, subproject).
const ROW_D_CONFLICT = () => sheetRow(16, {
  customer_display_name: "Kunde A", order_number_old: LEGACY_D, order_number_sheet: NEW_KEY_A, customer_number: 10110,
  service_name: "Arbeitsschutz", order_confirmation_number: "AB00358", service_number: 1001, language: 1, subproject_number: 1,
  customer_name: "Kunde A GmbH", order_name: "Gefaehrdungsbeurteilung Kunde A", contract_status: "offen", contract_end: "2027-12-31", contract_hours: 10,
  responsible_name: "Mathias Muster",
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

const promote = async (db, batchId, now, extra = {}) => {
  await db.query("begin");
  try {
    const report = await promoteBatch(db, { batchId, apply: true, now, ...extra });
    await db.query("commit");
    return report;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
};
const rolledBack = async (db, opts) => {
  await db.query("begin");
  try {
    return { report: await promoteBatch(db, opts), error: null };
  } catch (e) {
    return { report: null, error: e.message };
  } finally {
    await db.query("rollback");
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
/*
 * The invariants the live data must keep after a promote, all in one query so
 * every batch below can assert `all zero`:
 *   only_in_roles / only_in_assignments: the two role encodings name the same
 *     (project, person, role). The responsible's assignment is ANY share-100
 *     row of the person -- the handover RPC writes sort_order max+1, and that
 *     shape is legitimate; the replacement's is share 0 / sort 1.
 *   gap_contradicted / gap_disagrees / gap_partial_role: checks 2, 3 and 4 of
 *     check-responsibility-encodings-agree.mjs, copied verbatim. Check 4 is
 *     the one a promote can most easily break: a project with a 0/1 cover, no
 *     replacement role row, but now a responsible role row.
 *   double_share: more than one share-100 row on a project (the ownership
 *     page would count its contract hours twice).
 *   owner_mismatch: projects.owner_person_id disagrees with the responsible
 *     role row (or one exists without the other).
 */
const invariants = async (db) => one(db)(`
  with pr as (select project_id, person_id, role from public.project_responsibility),
       pa as (select project_id, person_id, case when share_percent = 100 then 'responsible' else 'replacement' end as role
                from public.person_assignments
               where project_id is not null and (share_percent = 100 or (share_percent = 0 and sort_order = 1))),
       cover_pa as (select distinct project_id from public.person_assignments where share_percent = 0 and sort_order = 1 and project_id is not null),
       cover_pr as (select distinct project_id from public.project_responsibility where role = 'replacement')
  select (select count(*) from (select * from pr except select * from pa) x)::int as only_in_roles,
         (select count(*) from (select * from pa except select * from pr) y)::int as only_in_assignments,
         (select count(*) from cover_pr left join cover_pa using (project_id) where cover_pa.project_id is null)::int as gap_contradicted,
         (select count(*) from (select project_id, person_id from public.person_assignments where share_percent = 0 and sort_order = 1) a
            join (select project_id, person_id from public.project_responsibility where role = 'replacement') r using (project_id)
           where a.person_id <> r.person_id)::int as gap_disagrees,
         (select count(*) filter (where exists (select 1 from public.project_responsibility r where r.project_id = cover_pa.project_id))
            from cover_pa left join cover_pr using (project_id) where cover_pr.project_id is null)::int as gap_partial_role,
         (select count(*) from (select project_id from public.person_assignments where share_percent = 100 group by project_id having count(*) > 1) d)::int as double_share,
         (select count(*) from public.projects p
            left join public.project_responsibility r on r.project_id = p.id and r.role = 'responsible'
           where p.owner_person_id is distinct from r.person_id)::int as owner_mismatch`);
const ALL_ZERO = j({ only_in_roles: 0, only_in_assignments: 0, gap_contradicted: 0, gap_disagrees: 0, gap_partial_role: 0, double_share: 0, owner_mismatch: 0 });

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
  check("the sheet's link rows carry source 'masterdata_sheet', distinct from the August workbook's default 'masterdata'", LINK_SOURCE === "masterdata_sheet", LINK_SOURCE);
  check("sheet_modified comes from the file_name's ' @ <ISO>' suffix when present, else received_at",
    sheetModifiedOf({ file_name: "masterdata-sheet.xlsx @ 2026-09-09T12:57:12Z", received_at: "2026-09-10T00:00:00Z" }) === "2026-09-09T12:57:12.000Z"
    && sheetModifiedOf({ file_name: "masterdata-sheet.xlsx", received_at: "2026-09-10T00:00:00Z" }) === "2026-09-10T00:00:00.000Z");
}

/* ================================================================ the world */
const db = await fresh();
const q = one(db);
const qa = all(db);
const startCounts = await tableCounts(db);
const mathiasRowA = await q(`select id, tasks_count from public.person_assignments where project_id = $1 and person_id = 'md-mathias'`, [LEGACY_A]);
const hendrykRowI = await q(`select id from public.person_assignments where project_id = $1 and person_id = 'md-hendryk'`, [LEGACY_I]);
// The seeded world carries exactly the defects the promote must repair: G's
// orphan cover (the live gate's gap shape), B's owner NULL beside a Mathias
// role row, and I's first-version handover (Thorsten 100/2 with no role row,
// Mathias's stale role row, owner Thorsten). Everything else -- the current
// RPC's 100/2 + change_control shape on F included -- is consistent, which
// proves the invariant query accepts that shape.
const inv0 = await invariants(db);
check("fixture: the invariant query sees the seeded world's deliberate defects (G's orphan cover, B's owner, I's stale handover) and nothing else",
  j(inv0) === j({ ...JSON.parse(ALL_ZERO), only_in_roles: 1, only_in_assignments: 2, owner_mismatch: 2 }), j(inv0));

const BATCH_ROWS = () => [ROW_A(), ROW_C_APPROVED(), ROW_C_UNREVIEWED(), ROW_C_NO_HOURS(), ROW_B_DOC(), ROW_E_EMPTY(), ROW_F_RPC(), ROW_G_GAP(), ROW_H_CHANGED(), ROW_I_OLD_RPC(), ROW_LEGACY_MISSING(), ROW_UNKNOWN_OLD()];
const REVIEW = { 6: "approved", 7: "unreviewed", 8: "approved", 15: "approved" };
const staged1 = await stageLikeTheImporter(db, BATCH_ROWS(), { fileName: "masterdata-sheet.xlsx @ 2026-09-10T06:00:00Z", hash: "hash-1", reviewOverrides: REVIEW });
const rec = (row) => staged1.records.find((r) => r.raw_payload.sheet_row === row);
const flagsOf = (row) => rec(row).raw_payload.flags;
check("fixture: the staging replica shaped the records as the importer does (order_resolution, kinds, ids, flags)",
  rec(5).raw_payload.values.order_resolution === "legacy_key"
  && rec(5).raw_payload.values.responsible_person_id === "md-mathias"
  && rec(5).raw_payload.values.replacement_person_id === "md-hendryk"
  && rec(6).raw_payload.values.order_resolution === "new"
  && flagsOf(6).includes("NEW_SERVICE") && flagsOf(7).includes("NEW_SERVICE")
  && rec(9).raw_payload.values.responsible_kind === "doctor"
  && rec(6).raw_payload.values.contract_hours === 26.5
  && rec(8).raw_payload.values.contract_hours === null
  && rec(10).raw_payload.values.responsible_kind === null && rec(10).raw_payload.values.replacement_kind === null && flagsOf(10).includes("NO_RESPONSIBLE") && rec(10).review_status === "unreviewed"
  && rec(12).raw_payload.values.replacement_kind === "doctor" && rec(12).review_status === "unreviewed"
  && rec(14).raw_payload.values.order_resolution === "legacy_key" && rec(14).review_status === "unreviewed"
  && rec(15).raw_payload.values.order_resolution === "unknown" && rec(15).review_status === "approved",
  j(staged1.records.map((r) => [r.raw_payload.sheet_row, r.raw_payload.values.order_resolution, r.review_status, r.raw_payload.flags])));

/* -------------------------------------------------------------- dry run */
{
  const { report } = await rolledBack(db, { batchId: staged1.batchId, apply: false, now: "2026-09-10T07:00:00Z" });
  check("dry run: the report counts the real work (8 promotable, 1 inserted, 4 skipped)",
    report && report.counts.promotable === 8 && report.counts.inserted_new === 1 && report.skipped.length === 4, j(report?.counts));
  const after = await tableCounts(db);
  check("dry run: after ROLLBACK not one row remains from it", j(after) === j(startCounts), `${j(startCounts)} -> ${j(after)}`);
}

/* -------------------------------------------------------------- batch 1 */
const r1 = await promote(db, staged1.batchId, "2026-09-10T07:00:00Z");
check("batch 1: 8 promotable = 7 legacy matches + 1 inserted new service; nothing matched by new key yet",
  r1.counts.promotable === 8 && r1.counts.matched_legacy === 7 && r1.counts.inserted_new === 1 && r1.counts.matched_new_key === 0, j(r1.counts));
check("batch 1: the unreviewed NEW_SERVICE is skipped for its flag; the approved service without contract hours for CONTRACT_HOURS_MISSING",
  r1.counts.skipped.NEW_SERVICE === 1 && r1.counts.skipped.CONTRACT_HOURS_MISSING === 1
  && r1.skipped.some((s) => s.sheet_row === 7 && s.reasons.includes("NEW_SERVICE"))
  && r1.skipped.some((s) => s.sheet_row === 8 && s.reasons.includes("CONTRACT_HOURS_MISSING")), j(r1.skipped));

/* ---- ADR-001: exact keys, never names */
const skippedMissing = r1.skipped.find((s) => s.sheet_row === 14);
check("ADR-001 negative control: the record whose old key has no project row is skipped LEGACY_PROJECT_MISSING although its order name equals project A's",
  skippedMissing && j(skippedMissing.reasons) === j(["LEGACY_PROJECT_MISSING"]) && r1.counts.skipped.LEGACY_PROJECT_MISSING === 1, j(r1.skipped));
check("...and it wrote nothing: no masterdata row carries its keys, project_order kept no masterdata_key for it, project A's masterdata row is from sheet row 5",
  (await q(`select count(*)::int n from public.project_masterdata where order_number_old = $1 or masterdata_key = $2`, [LEGACY_MISSING, "10110_00999_1007.1_01"])).n === 0
  && (await q(`select masterdata_key from projects.project_order where order_number = $1`, [LEGACY_MISSING]))?.masterdata_key === null
  && Number((await q(`select sheet_row from public.project_masterdata where project_id = $1`, [LEGACY_A]))?.sheet_row) === 5
  && (await q(`select count(*)::int n from public.projects`)).n === startCounts["public.projects"] + 1);
const skippedUnknown = r1.skipped.find((s) => s.sheet_row === 15);
check("an approved record with an old key the warehouse never held is skipped UNKNOWN_OLD_KEY by the resolution step, not inserted",
  skippedUnknown && j(skippedUnknown.reasons) === j(["UNKNOWN_OLD_KEY"]) && r1.counts.skipped.UNKNOWN_OLD_KEY === 1
  && (await q(`select count(*)::int n from public.projects where id in ($1, $2)`, [LEGACY_UNKNOWN, "10110_00777_1008.1_01"])).n === 0, j(r1.skipped));

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
check("the fixture's legacy project_order rows are the only ones with the old keys -- no order_number was rewritten to a new key",
  (await q(`select count(*)::int n from projects.project_order where order_number in ($1, $2)`, [LEGACY_A, LEGACY_B])).n === 2
  && (await q(`select count(*)::int n from projects.project_order where order_number = $1`, [NEW_KEY_A])).n === 0);

const contactsA = await qa(`select slot, name, phone, email, source_system from public.project_contact where project_id = $1 order by slot`, [LEGACY_A]);
check("contacts: slot 1 with name/phone/email and slot 2 with name only are upserted; the DOC project with no contacts has none",
  contactsA.length === 2 && contactsA[0].name === "Kontakt Eins" && contactsA[0].phone === "+49 30 1" && contactsA[0].email === "k1@example.com"
  && contactsA[1].name === "Kontakt Zwei" && contactsA[1].phone === null && contactsA[1].email === null && contactsA.every((c) => c.source_system === SOURCE_SYSTEM)
  && (await q(`select count(*)::int n from public.project_contact where project_id = $1`, [LEGACY_B])).n === 0, j(contactsA));

/* ---- links: two importer sources, one hand-added */
const linksA = await qa(`select kind, url, label, source from public.project_link where project_id = $1 order by kind, url`, [LEGACY_A]);
check("links: the stale workbook Asana URL is replaced by the sheet's, not duplicated, and the sheet's row carries source 'masterdata_sheet'",
  linksA.filter((l) => l.kind === "asana").length === 1 && linksA.find((l) => l.kind === "asana").url === "https://app.asana.com/new-a" && linksA.find((l) => l.kind === "asana").source === LINK_SOURCE, j(linksA));
check("links: the workbook's TrackingTime row with the SAME url as the sheet's is claimed (re-sourced), not duplicated",
  linksA.filter((l) => l.kind === "trackingtime").length === 1 && linksA.find((l) => l.kind === "trackingtime").source === LINK_SOURCE, j(linksA));
check("links: the hand-added (source manual) chat link survives beside the sheet's; labels are the sheet headers; file_storage is not a link",
  linksA.filter((l) => l.kind === "google_chat").length === 2 && linksA.some((l) => l.source === "manual" && l.url === "https://chat.google.com/room/hand-added")
  && linksA.find((l) => l.kind === "trackingtime")?.label === "Zeiterfassungslink" && linksA.find((l) => l.kind === "asana")?.label === "Asana-Link"
  && linksA.length === 4, j(linksA));
const linksB = await qa(`select kind, url, source from public.project_link where project_id = $1`, [LEGACY_B]);
check("links: B's TrackingTime cell reads 'Link einfügen' (null), so the workbook's link of that kind SURVIVES with its source",
  linksB.length === 1 && linksB[0].kind === "trackingtime" && linksB[0].url === "https://app.trackingtime.co/p/b-august" && linksB[0].source === "masterdata", j(linksB));
check("links: the report counts what changed (3 written = 2 inserted + 1 claimed, 1 removed)", r1.counts.links_written === 3 && r1.counts.links_removed === 1, j(r1.counts));

/* ---- responsibility: every encoding, per project */
const respOf = (id) => qa(`select person_id, role, source, order_no from public.project_responsibility where project_id = $1 order by role, person_id`, [id]);
const asgOf = (id) => qa(`select id, person_id, share_percent::float share, sort_order sort, logged_hours::float logged, tasks_count, project_name from public.person_assignments where project_id = $1 order by sort_order, person_id`, [id]);
const ownerOf = async (id) => q(`select owner_person_id, lead from public.projects where id = $1`, [id]);

const respA = await respOf(LEGACY_A);
const asgA = await asgOf(LEGACY_A);
check("responsibility A: Mathias responsible + Hendryk replacement; the stale Thorsten cover is gone from the role table",
  respA.length === 2 && respA.some((r) => r.person_id === "md-hendryk" && r.role === "replacement") && respA.some((r) => r.person_id === "md-mathias" && r.role === "responsible")
  && !respA.some((r) => r.person_id === "md-thorsten"), j(respA));
check("responsibility A: order_no is the PROJECT ID, not the new key (MyWorkTables prints '· order N' when they differ)",
  respA.every((r) => r.order_no === LEGACY_A && r.source === "masterdata"), j(respA));
check("assignments A: Mathias's 100/0 row is updated IN PLACE (same id, tasks_count 4, 33.5 h survive); Hendryk 0/1 is new; Thorsten's 0/1 row is gone",
  asgA.length === 2 && asgA[0].person_id === "md-mathias" && asgA[0].share === 100 && asgA[0].sort === 0 && asgA[0].logged === 33.5
  && asgA[0].id === mathiasRowA.id && asgA[0].tasks_count === 4
  && asgA[1].person_id === "md-hendryk" && asgA[1].share === 0 && asgA[1].sort === 1 && asgA[1].logged === 0 && asgA.every((a) => a.project_name === "Arbeitsschutz Kunde A"), j({ asgA, mathiasRowA }));

const respB = await respOf(LEGACY_B);
const asgB = await asgOf(LEGACY_B);
check("DOC project B: the sheet says no colleague is responsible, so Mathias's masterdata responsible rows go from BOTH tables; Hendryk's replacement is added to both",
  respB.length === 1 && respB[0].role === "replacement" && respB[0].person_id === "md-hendryk"
  && asgB.length === 1 && asgB[0].person_id === "md-hendryk" && asgB[0].share === 0 && asgB[0].sort === 1, j({ respB, asgB }));
check("...and B's owner stays NULL / lead 'n/a' -- the third encoding agrees with the other two",
  j(await ownerOf(LEGACY_B)) === j({ owner_person_id: null, lead: "n/a" }), j(await ownerOf(LEGACY_B)));

const respE = await respOf(LEGACY_E);
const asgE = await asgOf(LEGACY_E);
check("emptied cells on E: both roles cleared in both role tables AND owner_person_id NULL / lead 'n/a' (no page contradicts another)",
  respE.length === 0 && asgE.length === 0 && j(await ownerOf(LEGACY_E)) === j({ owner_person_id: null, lead: "n/a" }), j({ respE, asgE, owner: await ownerOf(LEGACY_E) }));

const respF = await respOf(LEGACY_F);
const asgF = await asgOf(LEGACY_F);
check("change_control project F: the handover's role row keeps its source and person although the sheet still names Mathias",
  respF.length === 2 && respF.some((r) => r.role === "responsible" && r.person_id === "md-hendryk" && r.source === "change_control")
  && respF.some((r) => r.role === "replacement" && r.person_id === "md-thorsten" && r.source === "masterdata"), j(respF));
check("change_control project F: the RPC's 100/2 row is the only share-100 row (sum 100, not 200); Thorsten's cover row is kept in place; owner stays Hendryk",
  asgF.length === 2 && asgF.filter((a) => a.share === 100).length === 1 && asgF.find((a) => a.share === 100).person_id === "md-hendryk" && asgF.find((a) => a.share === 100).sort === 2
  && asgF.some((a) => a.person_id === "md-thorsten" && a.share === 0 && a.sort === 1)
  && (await ownerOf(LEGACY_F)).owner_person_id === "md-hendryk", j({ asgF, owner: await ownerOf(LEGACY_F) }));
check("change_control project F: the report says the role is held elsewhere and that the sheet disagrees",
  r1.counts.responsibility_held_elsewhere === 1
  && r1.responsibility_notes.some((n) => n.project_id === LEGACY_F && n.role === "responsible" && /change_control/.test(n.note) && /md-mathias/.test(n.note) && /handover wins/.test(n.note)), j(r1.responsibility_notes));

const respG = await respOf(LEGACY_G);
const asgG = await asgOf(LEGACY_G);
check("gap project G: Hendryk becomes responsible in both tables and the orphan 0/1 cover goes because the sheet says DOC -- no partial role row is left behind",
  respG.length === 1 && respG[0].role === "responsible" && respG[0].person_id === "md-hendryk"
  && asgG.length === 1 && asgG[0].person_id === "md-hendryk" && asgG[0].share === 100 && asgG[0].sort === 0, j({ respG, asgG }));
check("gap project G: the brand-new responsible row carries the PROJECT's logged total 12.5 (the August convention), and owner/lead follow",
  asgG[0]?.logged === 12.5 && j(await ownerOf(LEGACY_G)) === j({ owner_person_id: "md-hendryk", lead: "Hendryk Arndt" }), j({ asgG, owner: await ownerOf(LEGACY_G) }));

const respH = await respOf(LEGACY_H);
const asgH = await asgOf(LEGACY_H);
check("changed responsible on H: Thorsten replaces Mathias in both tables; his new row carries the project's 20 h, NOT Mathias's 33.5; owner and lead move with him",
  respH.length === 1 && respH[0].person_id === "md-thorsten" && respH[0].role === "responsible"
  && asgH.length === 1 && asgH[0].person_id === "md-thorsten" && asgH[0].share === 100 && asgH[0].sort === 0 && asgH[0].logged === 20 && asgH[0].tasks_count === 0
  && j(await ownerOf(LEGACY_H)) === j({ owner_person_id: "md-thorsten", lead: "Thorsten X" }), j({ respH, asgH, owner: await ownerOf(LEGACY_H) }));
const respI = await respOf(LEGACY_I);
const asgI = await asgOf(LEGACY_I);
check("first-version handover on I: Mathias's stale role row goes, Thorsten holds the role in both tables, and his 100/2 row is swept into ONE 100/0 row that keeps HIS 7.5 h (not the project's 50)",
  respI.length === 2 && respI.some((r) => r.role === "responsible" && r.person_id === "md-thorsten") && respI.some((r) => r.role === "replacement" && r.person_id === "md-hendryk")
  && asgI.filter((a) => a.share === 100).length === 1 && asgI.find((a) => a.share === 100).person_id === "md-thorsten" && asgI.find((a) => a.share === 100).sort === 0 && asgI.find((a) => a.share === 100).logged === 7.5
  && asgI.find((a) => a.person_id === "md-hendryk")?.id === hendrykRowI.id && asgI.length === 2, j({ respI, asgI }));
check("the report names the change: responsibility_changed counts H's responsible, I's responsible and A's replacement, with a note each",
  r1.counts.responsibility_changed === 3
  && r1.responsibility_notes.some((n) => n.project_id === LEGACY_I && n.role === "responsible" && /from md-mathias to md-thorsten/.test(n.note))
  && r1.responsibility_notes.some((n) => n.project_id === LEGACY_H && n.role === "responsible" && /from md-mathias to md-thorsten/.test(n.note))
  && r1.responsibility_notes.some((n) => n.project_id === LEGACY_A && n.role === "replacement" && /from md-thorsten to md-hendryk/.test(n.note)), j(r1.responsibility_notes));
check("the report counts the clearings (B's DOC responsible, E's two roles, G's DOC replacement = 4) with a note naming who was removed; C's OTHER replacement had nothing to clear and is silent",
  r1.counts.responsibility_cleared === 4
  && r1.responsibility_notes.filter((n) => /removed from that role/.test(n.note)).length === 4
  && r1.responsibility_notes.some((n) => n.project_id === LEGACY_B && n.kind === "doctor" && /md-mathias/.test(n.note))
  && r1.responsibility_notes.filter((n) => n.project_id === LEGACY_E).length === 2
  && !r1.responsibility_notes.some((n) => n.project_id === NEW_KEY_C), j({ counts: r1.counts, notes: r1.responsibility_notes }));
check("the report's role/assignment counts match the rows enforced (9 roles: A×2, B×1, C×1, F×1, G×1, H×1, I×2; 6 assignment rows inserted, 3 kept in place)",
  r1.counts.responsibility_rows === 9 && r1.counts.assignment_rows === 9 && r1.counts.assignment_rows_inserted === 6 && r1.counts.responsibility_left_alone === 0, j(r1.counts));
const inv1 = await invariants(db);
check("every encoding agrees for every project after batch 1: the live gate's four checks, one share-100 row per project, owner = responsible", j(inv1) === ALL_ZERO, j(inv1));
check("batch 1 marked nothing historical: every masterdata row is in the sheet", r1.counts.historical_marked === 0
  && (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'historical'`)).n === 0);

/* ----------------------------------------------------------- idempotent */
const counts1 = await tableCounts(db);
const r1b = await promote(db, staged1.batchId, "2026-09-10T07:30:00Z");
const counts1b = await tableCounts(db);
check("promoting the same batch twice changes no table count", j(counts1) === j(counts1b), `${j(counts1)} -> ${j(counts1b)}`);
check("on the re-run the new service is found by its key (matched_new_key), nothing is inserted, no link or assignment row is rewritten, nothing changes or clears",
  r1b.counts.inserted_new === 0 && r1b.counts.matched_new_key === 1 && r1b.counts.matched_legacy === 7 && r1b.counts.links_written === 0 && r1b.counts.links_removed === 0
  && r1b.counts.assignment_rows_inserted === 0 && r1b.counts.responsibility_changed === 0 && r1b.counts.responsibility_cleared === 0, j(r1b.counts));
check("the re-run keeps Mathias's row (id, 33.5 h) and every invariant still holds",
  (await q(`select id, logged_hours::float h from public.person_assignments where project_id = $1 and share_percent = 100`, [LEGACY_A]))?.h === 33.5
  && (await q(`select id from public.person_assignments where project_id = $1 and share_percent = 100`, [LEGACY_A]))?.id === mathiasRowA.id
  && j(await invariants(db)) === ALL_ZERO);
check("public.projects never lost a row (fixture 8 + 1 inserted = 9, the legacy ids still there)",
  counts1b["public.projects"] === 9 && (await q(`select count(*)::int n from public.projects where id in ($1, $2, $3, $4, $5, $6, $7, $8)`, [LEGACY_A, LEGACY_B, LEGACY_D, LEGACY_E, LEGACY_F, LEGACY_G, LEGACY_H, LEGACY_I])).n === 8);

/* ---------------------------------------------- batch 2: row A disappears */
const staged2 = await stageLikeTheImporter(db, BATCH_ROWS().filter((r) => r.r !== 5), { fileName: "masterdata-sheet.xlsx @ 2026-09-10T08:00:00Z", hash: "hash-2", reviewOverrides: REVIEW });
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
  && (await tableCounts(db))["public.projects"] === 9);
check("the rows the sheet still lists stay active (B by its old key, C by its new key, E/F/G/H/I); the skipped-but-listed rows are not treated as vanished",
  (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'active'`)).n === 7
  && (await q(`select lifecycle_status from projects.project_order where order_number = $1`, [LEGACY_B]))?.lifecycle_status === "active");

/* ------------------------------------------- batch 3: row A is back, changed */
const rowA3 = ROW_A();
delete rowA3.cells[LETTER.contact2_name];                   // contact 2 emptied
rowA3.cells[LETTER.contact1_phone] = "+49 30 2";             // contact 1 changed
rowA3.cells[LETTER.link_asana] = "https://app.asana.com/new-a-2"; // Asana moved
delete rowA3.cells[LETTER.link_trackingtime];               // TrackingTime link withdrawn
const rows3 = BATCH_ROWS().filter((r) => ![5, 11].includes(r.r)).concat([rowA3, ROW_F_RPC("Hendryk Arndt"), ROW_D_CONFLICT()]);
// D's row derives A's key, so both carry DUPLICATE_ORDER_KEY and need a reviewer's approval to reach the guard.
const staged3 = await stageLikeTheImporter(db, rows3, { fileName: "masterdata-sheet.xlsx @ 2026-09-10T10:00:00Z", hash: "hash-3", reviewOverrides: { ...REVIEW, 5: "approved", 16: "approved" } });
check("fixture: A's and D's rows both derive the same new key and are flagged DUPLICATE_ORDER_KEY; both approved so the promote's own guard decides",
  staged3.records.filter((r) => r.raw_payload.values.order_number === NEW_KEY_A).length === 2
  && staged3.records.filter((r) => r.raw_payload.flags.includes("DUPLICATE_ORDER_KEY") && r.review_status === "approved").length === 2,
  j(staged3.records.map((r) => [r.raw_payload.sheet_row, r.raw_payload.values.order_number, r.review_status])));
// Caught rather than propagated: a promote that lets D's claim through dies on
// the unique index, and that must read as a FAIL line here, not as a crash.
let r3;
try {
  r3 = await promote(db, staged3.batchId, "2026-09-10T11:00:00Z");
} catch (e) {
  r3 = { counts: { skipped: {} }, skipped: [], responsibility_notes: [], error: e.message };
}
check("batch 3 promoted without an error (a key conflict must be a skip, never a unique-index failure)", !r3.error, r3.error ?? "");
const mdA3 = await q(`select lifecycle_status, historical_since, last_seen_batch_id, (last_seen_at at time zone 'UTC')::text last_seen_at from public.project_masterdata where project_id = $1`, [LEGACY_A]);
const poA3 = await q(`select lifecycle_status, historical_since, last_seen_batch_id, masterdata_key from projects.project_order where order_number = $1`, [LEGACY_A]);
check("batch 3 with row A again: reactivated = 1; A is active with historical_since NULL on project_masterdata, last seen by batch 3 at its sheet time",
  r3.counts.reactivated === 1 && mdA3?.lifecycle_status === "active" && mdA3?.historical_since === null && mdA3?.last_seen_batch_id === staged3.batchId && /^2026-09-10 10:00:00/.test(mdA3?.last_seen_at ?? ""), j({ counts: r3.counts, mdA3 }));
check("...and on project_order, still under the old order_number with the same masterdata_key",
  poA3?.lifecycle_status === "active" && poA3?.historical_since === null && poA3?.last_seen_batch_id === staged3.batchId && poA3?.masterdata_key === NEW_KEY_A, j(poA3));
const skippedD = r3.skipped.find((s) => s.sheet_row === 16);
check("MASTERDATA_KEY_CONFLICT: D's approved claim on A's key is skipped, A keeps the key, D gets no masterdata row and no masterdata_key, no project was inserted",
  skippedD && j(skippedD.reasons) === j(["MASTERDATA_KEY_CONFLICT"]) && r3.counts.skipped.MASTERDATA_KEY_CONFLICT === 1
  && (await q(`select project_id from public.project_masterdata where masterdata_key = $1`, [NEW_KEY_A]))?.project_id === LEGACY_A
  && (await q(`select count(*)::int n from public.project_masterdata where project_id = $1`, [LEGACY_D])).n === 0
  && (await q(`select masterdata_key from projects.project_order where order_number = $1`, [LEGACY_D]))?.masterdata_key === null
  && (await tableCounts(db))["public.projects"] === 9, j(r3.skipped));
const contactsA3 = await qa(`select slot, name, phone from public.project_contact where project_id = $1 order by slot`, [LEGACY_A]);
check("contacts: slot 1 is updated in place, slot 2 is deleted once the sheet empties it (report: 1 written, 1 deleted for A)",
  contactsA3.length === 1 && contactsA3[0].slot === 1 && contactsA3[0].phone === "+49 30 2" && r3.counts.contacts_deleted === 1, j({ contactsA3, counts: r3.counts }));
const linksA3 = await qa(`select kind, url, source from public.project_link where project_id = $1 order by kind, url`, [LEGACY_A]);
check("links: the moved Asana URL replaces the previous one; the withdrawn TrackingTime link (claimed by the sheet in batch 1) is gone; the manual chat link still survives",
  linksA3.filter((l) => l.kind === "asana").length === 1 && linksA3.find((l) => l.kind === "asana").url === "https://app.asana.com/new-a-2"
  && !linksA3.some((l) => l.kind === "trackingtime") && linksA3.some((l) => l.source === "manual") && linksA3.length === 3, j(linksA3));
check("links: B's workbook TrackingTime link is still there after three batches of 'Link einfügen'",
  (await q(`select count(*)::int n from public.project_link where project_id = $1 and source = 'masterdata'`, [LEGACY_B])).n === 1);
check("self-cover guard: the sheet now names F's change_control responsible (Hendryk) as his own cover; the replacement rows are left alone (Thorsten stays) and the report says why",
  j((await respOf(LEGACY_F)).map((r) => [r.person_id, r.role, r.source])) === j([["md-thorsten", "replacement", "masterdata"], ["md-hendryk", "responsible", "change_control"]])
  && (await asgOf(LEGACY_F)).length === 2
  && r3.responsibility_notes.some((n) => n.project_id === LEGACY_F && n.role === "replacement" && /own cover/.test(n.note)), j({ respF: await respOf(LEGACY_F), notes: r3.responsibility_notes }));
check("every invariant still holds after three batches, and the assignment rows of A are exactly Mathias 100/0 and Hendryk 0/1",
  j(await invariants(db)) === ALL_ZERO
  && (await q(`select count(*)::int n from public.person_assignments where project_id = $1`, [LEGACY_A])).n === 2, j(await invariants(db)));
check("across all batches no project, masterdata row or project_order was deleted (9 / 8 / 10)",
  (await tableCounts(db))["public.projects"] === 9 && (await tableCounts(db))["public.project_masterdata"] === 8 && (await tableCounts(db))["projects.project_order"] === 10, j(await tableCounts(db)));

/* --------------------------------------------------------- refusals */
{
  const staging = (await db.query(`insert into stg.import_batch (source_system, entity_type, file_name, file_hash, status, row_count, error_count) values ($1, 'masterdata_v1', 'x', 'hash-4', 'processing', 0, 0) returning id`, [SOURCE_SYSTEM])).rows[0].id;
  const notCompleted = await rolledBack(db, { batchId: staging });
  check("a batch that is not 'completed' is refused, not promoted", /not completed/.test(notCompleted.error ?? ""), notCompleted.error ?? "no error");
  const unknown = await rolledBack(db, { batchId: "00000000-0000-4000-8000-000000000000" });
  check("an unknown batch id is refused", /does not exist/.test(unknown.error ?? ""), unknown.error ?? "no error");

  const activeBefore = (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'active'`)).n;
  const empty = await stageLikeTheImporter(db, [], { fileName: "masterdata-sheet.xlsx @ 2026-09-10T12:00:00Z", hash: "hash-5" });
  const refusedEmpty = await rolledBack(db, { batchId: empty.batchId, now: "2026-09-10T13:00:00Z" });
  check("an EMPTY completed batch (the service tab came through with no rows) is refused, and nothing was marked historical",
    /carries no service_orders records/.test(refusedEmpty.error ?? "") && refusedEmpty.report === null
    && (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'active'`)).n === activeBefore, refusedEmpty.error ?? "no error");

  const thin = await stageLikeTheImporter(db, [ROW_B_DOC()], { fileName: "masterdata-sheet.xlsx @ 2026-09-10T12:30:00Z", hash: "hash-6" });
  const refusedThin = await rolledBack(db, { batchId: thin.batchId, now: "2026-09-10T13:30:00Z" });
  check(`a batch carrying 1 of ${activeBefore} active rows would mark ${activeBefore - 1} historical: refused by the 50% bound, naming the figures, with every row still active`,
    new RegExp(`would mark ${activeBefore - 1} of ${activeBefore} active`).test(refusedThin.error ?? "") && /allow-mass-historical/.test(refusedThin.error ?? "")
    && (await q(`select count(*)::int n from public.project_masterdata where lifecycle_status = 'active'`)).n === activeBefore, refusedThin.error ?? "no error");
  const lifted = await rolledBack(db, { batchId: thin.batchId, now: "2026-09-10T13:30:00Z", maxHistoricalShare: 1 });
  check("the same batch with the bound lifted (the CLI's --allow-mass-historical) marks them, so the bound is the only thing that refused it",
    lifted.error === null && lifted.report?.counts.historical_marked === activeBefore - 1, lifted.error ?? j(lifted.report?.counts));
  const bad = await rolledBack(db, { batchId: thin.batchId, maxHistoricalShare: 2 });
  check("a maxHistoricalShare outside 0..1 is rejected as a caller error", /between 0 and 1/.test(bad.error ?? ""), bad.error ?? "no error");
}

await db.close();
console.log(failures ? `\nFAIL (${failures})` : "\nPASS");
process.exit(failures ? 1 : 0);

/*
 * Promote one staged masterdata-sheet batch into the warehouse -- the pure half.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The masterdata Google Sheet is staged hourly into stg.import_batch /
 * stg.import_record (source MASTERDATA_SHEET_V1, see
 * scripts/import-masterdata-sheet-staging.mjs). Staging is deliberately inert:
 * nothing a reviewer sees on /customer-master/import-review has touched
 * public.projects yet. This module is the step that does, under the decisions
 * hitul took on 2026-09-10 (vault: "2026-09-10 masterdata sheet keys and
 * disappearing rows") and the migration that encodes them,
 * supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql:
 *
 *   1. the sheet's new key Kundennummer_AB(5)_Service.Sprache_Teilprojekt(2)
 *      is the stable project key; the old key (public.projects.id = code =
 *      projects.project_order.order_number) stays as an alias and an existing
 *      id NEVER moves -- five joins and the customer-master drift gate rely on
 *      it;
 *   2. a row that disappears from the sheet is marked historical with the
 *      batch that stopped carrying it, never deleted;
 *   3. liveness is contract_end, not the sheet's status column, so the status
 *      column is stored as information (contract_status_sheet) and decides
 *      nothing here;
 *   4. honest nulls: "-" in the sheet is null and is written as null. A
 *      NOT NULL column that the sheet leaves empty makes the record a skip,
 *      never a fabricated 0.
 *
 * WHY IT IS PURE
 * --------------
 * promoteBatch(db, ...) uses ONLY db.query(sql, params) -> { rows }, which
 * pg.Client and @electric-sql/pglite both satisfy. It never opens, commits or
 * rolls back a transaction: the caller does, so the CLI can run it under
 * BEGIN ... ROLLBACK for a dry run and the gate
 * (scripts/check-masterdata-promote.mjs) can run the identical code in PGlite
 * against the real migrations. Every write here belongs to the caller's one
 * transaction; a thrown error leaves nothing half-done once the caller rolls
 * back.
 *
 * WHAT IT NEVER DOES
 * ------------------
 *   - delete from public.projects, public.project_masterdata or
 *     projects.project_order (decision 2 above);
 *   - guess: a record that cannot be resolved by an EXACT key (ADR-001) is
 *     reported as skipped with its reasons, never matched by name;
 *   - touch the columns other processes own: projects.status, logged_hours,
 *     logged_hours_as_of, billable_hours, consumed_percent, remaining_hours
 *     belong to scripts/refresh-order-hours.mjs; budget_* to the budget editor;
 *   - promote the sheet's planned/on-site/remote hours (they are not in the
 *     warehouse contract at all);
 *   - write a person the staging step did not resolve: a name that matched
 *     nobody (possible only on an approved record) leaves the existing rows of
 *     that role alone and is reported -- the sheet names someone, we merely
 *     cannot match them, and a resolution failure is not a fact about the
 *     project;
 *   - touch a responsibility row another process owns: a project_responsibility
 *     row whose source is not 'masterdata' was written by the in-product
 *     handover RPC (decide_project_responsible_change, 20260827080000, source
 *     'change_control'), which records an approved four-eyes decision. That
 *     role is skipped entirely -- role rows, assignment rows, owner_person_id,
 *     lead -- and the report says whether the sheet agrees with it;
 *   - remove a link it did not write: a hand-added project_link (any source
 *     other than the two importers') survives every promote;
 *   - promote an EMPTY batch, or one that would mark more than half of the
 *     active warehouse historical: both are refused with an error before any
 *     write persists, because a sheet whose service tab came through empty or
 *     half-filtered must not flip 247 rows to 'historical' in one hour.
 *
 * WHAT MAKES A RECORD PROMOTABLE
 * ------------------------------
 * validation_status = 'valid' AND (review_status = 'approved', OR
 * review_status = 'unreviewed' with none of its flags in BLOCKING_FLAGS).
 * 'approved' overrides the flags on purpose: that is how a reviewer lets a
 * NEW_SERVICE in. Everything else is skipped with the reasons listed.
 *
 * RESOLUTION, BY EXACT KEY ONLY
 * -----------------------------
 *   order_resolution 'legacy_key' -> public.projects.id = values.order_number_old
 *   order_resolution 'new_key'    -> project_masterdata.masterdata_key = values.order_number,
 *                                    else public.projects.id = values.order_number
 *   order_resolution 'new'        -> the same lookup first (a re-run of the batch that
 *                                    created the project must find it), else INSERT
 *                                    public.projects with id = code = the new key --
 *                                    only for an 'approved' record
 *   order_resolution 'unknown'    -> skipped (UNKNOWN_OLD_KEY)
 *
 * THE THREE RESPONSIBILITY ENCODINGS
 * ----------------------------------
 * The same fact is stored three times and read by different pages:
 *   public.project_responsibility   role 'responsible' / 'replacement'   my-work, service overview
 *   public.person_assignments       share 100 / sort 0, share 0 / sort 1  employee ownership, my-work MINE
 *   public.projects                 owner_person_id + lead                my-work isOwner, customer portfolio
 * check-responsibility-encodings-agree.mjs fails when the first two disagree,
 * and a page contradicting another is the bug, so one decision per role is
 * applied to every encoding in the same transaction:
 *
 *   held by change_control  -> nothing touched (see above), reported;
 *   person, resolved        -> that person and nobody else holds the role in
 *                              every encoding. An assignment row the person
 *                              already holds is UPDATED in place (its id,
 *                              tasks_count and logged_hours survive); a
 *                              different holder's row goes; every other
 *                              share-100 row of the project goes with it so
 *                              "one 100-share row per project" holds (the
 *                              ownership page multiplies contract hours by
 *                              share/100 per row);
 *   person, unresolved      -> nothing touched, reported;
 *   DOC / OTHER / empty     -> the sheet says no colleague holds the role, so
 *                              the masterdata rows of that role go from both
 *                              tables and, for the responsible, owner_person_id
 *                              becomes NULL and lead 'n/a'. DOC is the company
 *                              doctor and OTHER "someone else": both are a
 *                              statement, not a gap, and the August importers
 *                              wrote no row for either (import-masterdata-
 *                              projects.mjs resolved DOC to nobody), so on
 *                              production this is a no-op that keeps the three
 *                              encodings and project_masterdata.responsible_kind
 *                              telling one story.
 *
 * logged_hours on a NEW responsible row follows the August convention
 * (import-masterdata-projects.mjs:312-317): the responsible's row carries the
 * project's logged total, the replacement's carries 0. A figure is never
 * carried over from a different person's deleted row.
 *
 * order_no on project_responsibility is the project id, not the new key:
 * MyWorkTables prints "· order N" whenever order_no differs from the code.
 *
 * LINKS HAVE TWO IMPORTER SOURCES
 * -------------------------------
 * project_link.source 'masterdata' is what the August workbook importer wrote
 * (253 TrackingTime, 95 Chat, 75 Teams, 44 Asana, 17 Drive rows) and the
 * column's default. This pipeline writes 'masterdata_sheet' so its own rows
 * are distinguishable. A kind the sheet STATES a URL for is the sheet's: the
 * URL is claimed (inserted, or an identical importer row re-sourced) and every
 * other importer-sourced URL of that kind goes. A kind the sheet leaves empty
 * -- or holds the placeholder "Link einfügen", which parseLink reads as null --
 * withdraws only what the sheet itself claimed earlier; the workbook's link
 * stays until the sheet states a different one, because an unfilled cell is
 * not a statement that the link is wrong. A hand-added link is never touched.
 */

import { BLOCKING_FLAGS, SERVICE_COLUMNS, SERVICE_SHEET_NAME } from "./masterdata-sheet.mjs";

export const SOURCE_SYSTEM = "MASTERDATA_SHEET_V1";
/** project_link.source for rows this pipeline writes. 'masterdata' is the August workbook's. */
export const LINK_SOURCE = "masterdata_sheet";
/** The link sources a promote may replace when the sheet states a URL for the kind. */
export const IMPORTER_LINK_SOURCES = ["masterdata", LINK_SOURCE];
/** The project_responsibility source this pipeline owns. Anything else is another process's decision. */
export const RESPONSIBILITY_SOURCE = "masterdata";
/** A batch that would mark more than this share of the active warehouse historical is refused. */
export const DEFAULT_MAX_HISTORICAL_SHARE = 0.5;

/** Sheet column -> public.project_link.kind. file_storage is a folder name, not a link kind. */
export const LINK_KINDS = [
  ["link_asana", "asana"],
  ["link_google_chat", "google_chat"],
  ["link_google_drive", "google_drive"],
  ["link_microsoft_teams", "microsoft_teams"],
  ["link_trackingtime", "trackingtime"],
];

const headerOf = (key) => SERVICE_COLUMNS.find((c) => c[2] === key)?.[1] ?? key;
const isFiveDigits = (s) => /^\d{5}$/.test(String(s ?? ""));
// pg and PGlite both hand jsonb back parsed; a driver that returns the text is
// not a reason to read every record as empty.
const payloadOf = (record) => {
  const p = record?.raw_payload;
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return p && typeof p === "object" ? p : {};
};

/**
 * The sheet's own modified time for a batch. The puller records it in
 * file_name as "<file> @ <ISO>"; a batch staged by hand has none, and then the
 * moment we received the file is the most honest substitute.
 */
export function sheetModifiedOf(batch) {
  const m = / @ (\S+)$/.exec(batch.file_name ?? "");
  if (m && !Number.isNaN(Date.parse(m[1]))) return new Date(m[1]).toISOString();
  return new Date(batch.received_at).toISOString();
}

/**
 * Promotable, or the reasons it is not. Pure, so the gate can pin the rule.
 * An 'approved' record overrides its flags; an 'unreviewed' one must carry no
 * blocking flag; every other review status is a decision that has not been
 * taken yet (or was taken against the row) and is honoured as such.
 */
export function promotability(record) {
  const payload = payloadOf(record);
  const flags = Array.isArray(payload.flags) ? payload.flags : [];
  const reasons = [];
  if (record.validation_status !== "valid") reasons.push("INVALID");
  if (record.review_status === "approved") {
    // reviewer's call: flags are information now
  } else if (record.review_status === "unreviewed") {
    for (const f of flags) if (BLOCKING_FLAGS.has(f)) reasons.push(f);
  } else {
    reasons.push(String(record.review_status ?? "NO_REVIEW_STATUS").toUpperCase());
  }
  return { promotable: reasons.length === 0, reasons };
}

/**
 * Promote one batch inside the caller's transaction.
 *
 * @param db     anything with query(sql, params) -> Promise<{ rows }>
 * @param opts   { batchId, apply, now, maxHistoricalShare }
 *               apply is echoed into the report; the writes happen either way,
 *               and the caller decides between COMMIT and ROLLBACK.
 *               now is the instant written to updated_at / historical_since,
 *               injectable so a gate can reason about it.
 *               maxHistoricalShare (0..1, default 0.5): the disappearance step
 *               throws when it would mark more than this share of the active
 *               MASTERDATA_SHEET_V1 rows historical. 1 disables the guard; the
 *               CLI passes that only under --allow-mass-historical.
 * @returns the report described in the header of this file
 */
export async function promoteBatch(db, { batchId, apply = false, now = new Date(), maxHistoricalShare = DEFAULT_MAX_HISTORICAL_SHARE } = {}) {
  if (!batchId) throw new Error("promoteBatch: batchId is required");
  if (!(maxHistoricalShare >= 0 && maxHistoricalShare <= 1)) throw new Error("promoteBatch: maxHistoricalShare must be between 0 and 1");
  const nowIso = new Date(now).toISOString();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await rows(sql, params))[0] ?? null;

  /* ---------------------------------------------------------- a. the batch */
  const batch = await one(
    `select id, source_system, status, file_name, received_at from stg.import_batch where id = $1`,
    [batchId],
  );
  if (!batch) throw new Error(`stg.import_batch ${batchId} does not exist`);
  if (batch.source_system !== SOURCE_SYSTEM) throw new Error(`batch ${batchId} is ${batch.source_system}, not ${SOURCE_SYSTEM}`);
  if (batch.status !== "completed") throw new Error(`batch ${batchId} is ${batch.status}, not completed; a batch is promoted only once its staging finished`);
  const sheetModified = sheetModifiedOf(batch);

  const records = await rows(
    `select id, row_number, raw_payload, validation_status, review_status, candidate_legal_entity_id
       from stg.import_record
      where batch_id = $1 and raw_payload->>'sheet_name' = $2
      order by row_number`,
    [batchId, SERVICE_SHEET_NAME],
  );
  // An empty service tab stages as a completed batch (the header is found,
  // dataRows() is [], the contacts still land). Promoting it would find no
  // key in the batch and mark EVERY masterdata row historical. Refused here,
  // before a single write, rather than reported as historical_marked = N.
  if (records.length === 0) {
    throw new Error(`batch ${batchId} carries no ${SERVICE_SHEET_NAME} records; refusing to promote it, because an empty batch would mark the whole warehouse historical`);
  }

  // The people the warehouse knows. A person id the staging step resolved but
  // that has since been removed must not abort the whole batch on a foreign
  // key; it is reported per role instead.
  const people = new Set((await rows(`select id from public.people`)).map((r) => r.id));

  const counts = {
    promotable: 0,
    matched_legacy: 0,
    matched_new_key: 0,
    inserted_new: 0,
    skipped: {},
    projects_updated: 0,
    masterdata_upserted: 0,
    contacts_written: 0,
    contacts_deleted: 0,
    links_written: 0,
    links_removed: 0,
    responsibility_rows: 0,        // roles enforced to a resolved person, in every encoding
    responsibility_changed: 0,     // ...of which the holder changed from one person to another
    responsibility_cleared: 0,     // roles the sheet gives to nobody (DOC / OTHER / empty) whose rows were removed
    responsibility_left_alone: 0,  // roles naming a person the staging step could not resolve
    responsibility_held_elsewhere: 0, // roles owned by another process (source <> 'masterdata'); untouched
    assignment_rows: 0,            // assignment rows enforced (kept in place or inserted)
    assignment_rows_inserted: 0,
    historical_marked: 0,
    reactivated: 0,
  };
  const skipped = [];
  const responsibilityNotes = [];
  const skip = (record, values, reasons) => {
    for (const r of reasons) counts.skipped[r] = (counts.skipped[r] ?? 0) + 1;
    skipped.push({ sheet_row: values?.sheet_row ?? payloadOf(record).sheet_row ?? null, order_number: values?.order_number ?? null, reasons });
  };

  // j. needs every key the batch carries, promotable or not: a row the sheet
  // still lists -- even one a reviewer has not approved -- has not disappeared.
  const knownKeys = new Set();
  for (const r of records) {
    const v = payloadOf(r).values ?? {};
    if (v.order_number) knownKeys.add(v.order_number);
    if (v.order_number_old) knownKeys.add(v.order_number_old);
  }

  for (const record of records) {
    const v = payloadOf(record).values ?? {};
    /* ------------------------------------------------------ b. promotable */
    const verdict = promotability(record);
    if (!verdict.promotable) { skip(record, v, verdict.reasons); continue; }

    /* ------------------------------------------------ c. exact-key resolution */
    let projectId = null;
    let how = null; // 'legacy' | 'new_key' | 'insert'
    const reasons = [];
    const byNewKey = async () => v.order_number
      ? await one(
        `select coalesce(
                  (select project_id from public.project_masterdata where masterdata_key = $1),
                  (select id from public.projects where id = $1)) as id`,
        [v.order_number],
      )
      : null;
    if (v.order_resolution === "legacy_key") {
      if (!v.order_number_old) reasons.push("LEGACY_KEY_MISSING");
      else {
        const p = await one(`select id from public.projects where id = $1`, [v.order_number_old]);
        if (p) { projectId = p.id; how = "legacy"; } else reasons.push("LEGACY_PROJECT_MISSING");
      }
    } else if (v.order_resolution === "new_key" || v.order_resolution === "new") {
      const hit = await byNewKey();
      if (hit?.id) { projectId = hit.id; how = "new_key"; } else if (v.order_resolution === "new") {
        if (record.review_status !== "approved") reasons.push("NEW_SERVICE_NOT_APPROVED");
        else how = "insert";
      } else reasons.push("NEW_KEY_PROJECT_MISSING");
    } else if (v.order_resolution === "unknown") {
      reasons.push("UNKNOWN_OLD_KEY");
    } else {
      reasons.push("NO_RESOLUTION");
    }

    // Preconditions of the warehouse contract, checked BEFORE any write so a
    // skipped record leaves no half-inserted project behind.
    if (!v.order_number) reasons.push("NEW_KEY_MISSING");
    if (!isFiveDigits(v.customer_number)) reasons.push("CUSTOMER_NUMBER_MISSING");
    if (how === "insert") {
      if (v.contract_hours === null || v.contract_hours === undefined) reasons.push("CONTRACT_HOURS_MISSING");
      if (!(v.order_name ?? v.service_name)) reasons.push("NAME_MISSING");
    }
    if (reasons.length) { skip(record, v, reasons); continue; }
    const targetId = how === "insert" ? v.order_number : projectId;
    // The new key is unique across the warehouse (project_masterdata_key_key,
    // project_order_masterdata_key_key). Two projects claiming one key is a
    // sheet defect for a reviewer, not something to resolve by overwriting.
    const taken = await one(
      `select project_id as id from public.project_masterdata where masterdata_key = $1 and project_id <> $2
       union all
       select order_number from projects.project_order where masterdata_key = $1 and order_number <> $2
       limit 1`,
      [v.order_number, targetId],
    );
    if (taken) { skip(record, v, ["MASTERDATA_KEY_CONFLICT"]); continue; }

    counts.promotable += 1;
    const candidate = record.candidate_legal_entity_id ?? null;
    const responsibleResolved = v.responsible_kind === "person" && v.responsible_person_id && people.has(v.responsible_person_id);
    const replacementResolved = v.replacement_kind === "person" && v.replacement_person_id && people.has(v.replacement_person_id);
    const dueText = v.contract_end ? String(v.contract_end) : null;

    if (how === "insert") {
      // status / billable_hours / consumed_percent / logged_hours stay NULL:
      // nothing has been measured for a service born in the sheet, and the
      // 2026-08-26 migration relaxed exactly these columns so a ledger row can
      // say so instead of lying with 0 (projects_admit_unmeasured_hours.sql).
      await db.query(
        `insert into public.projects
           (id, code, name, customer, lead, status, contract_hours, billable_hours, consumed_percent, logged_hours,
            due, contract_type, owner_person_id, customer_legal_entity_id)
         values ($1, $1, $2, $3, $4, null, $5::numeric, null, null, null, $6, $7, $8, $9::uuid)`,
        [
          v.order_number,
          v.order_name ?? v.service_name,
          v.customer_display_name ?? v.customer_name ?? v.customer_number,
          responsibleResolved ? v.responsible_name : "n/a",
          v.contract_hours,
          dueText ?? "n/a",
          v.service_name ?? null,
          responsibleResolved ? v.responsible_person_id : null,
          candidate,
        ],
      );
      projectId = v.order_number;
      counts.inserted_new += 1;
    } else {
      /* ------------------------------------ d. the existing project, narrowly */
      // Only the columns the sheet owns. A null from the sheet never overwrites
      // a known figure (contract_hours, due) -- "-" means "not stated", not 0.
      // owner_person_id and lead are the third responsibility encoding and
      // are decided in step i together with the other two.
      const updated = await rows(
        `update public.projects set
           contract_hours = coalesce($2::numeric, contract_hours),
           due = coalesce($3::text, due),
           contract_type = coalesce($4::text, contract_type),
           customer_legal_entity_id = coalesce(customer_legal_entity_id, $5::uuid)
         where id = $1
         returning id`,
        [projectId, v.contract_hours ?? null, dueText, v.service_name ?? null, candidate],
      );
      counts.projects_updated += updated.length;
      if (how === "legacy") counts.matched_legacy += 1; else counts.matched_new_key += 1;
    }

    /* ------------------------------------------------ e. project_masterdata */
    const before = await one(`select lifecycle_status from public.project_masterdata where project_id = $1`, [projectId]);
    await db.query(
      `insert into public.project_masterdata
         (project_id, masterdata_key, order_number_old, customer_number, customer_display_name, customer_name, corporate_group,
          service_number, service_name, language, subproject_number, order_confirmation_number, street, postal_code, city,
          contract_start, contract_end, contract_status_sheet, responsible_kind, replacement_kind,
          responsible_person_id, replacement_person_id, service_role, min_onsite_time,
          travel_flat_rate, travel_flat_rate_text, travel_as_project_time, travel_as_project_time_text, file_storage, sheet_row,
          source_system, lifecycle_status, historical_since, last_seen_batch_id, last_seen_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7,
               $8::integer, $9, $10::smallint, $11::smallint, $12, $13, $14, $15,
               $16::date, $17::date, $18, $19, $20,
               $21, $22, $23, $24,
               $25::boolean, $26, $27::boolean, $28, $29, $30::integer,
               $31, 'active', null, $32::uuid, $33::timestamptz, $34::timestamptz)
       on conflict (project_id) do update set
         masterdata_key = excluded.masterdata_key,
         order_number_old = excluded.order_number_old,
         customer_number = excluded.customer_number,
         customer_display_name = excluded.customer_display_name,
         customer_name = excluded.customer_name,
         corporate_group = excluded.corporate_group,
         service_number = excluded.service_number,
         service_name = excluded.service_name,
         language = excluded.language,
         subproject_number = excluded.subproject_number,
         order_confirmation_number = excluded.order_confirmation_number,
         street = excluded.street,
         postal_code = excluded.postal_code,
         city = excluded.city,
         contract_start = excluded.contract_start,
         contract_end = excluded.contract_end,
         contract_status_sheet = excluded.contract_status_sheet,
         responsible_kind = excluded.responsible_kind,
         replacement_kind = excluded.replacement_kind,
         responsible_person_id = excluded.responsible_person_id,
         replacement_person_id = excluded.replacement_person_id,
         service_role = excluded.service_role,
         min_onsite_time = excluded.min_onsite_time,
         travel_flat_rate = excluded.travel_flat_rate,
         travel_flat_rate_text = excluded.travel_flat_rate_text,
         travel_as_project_time = excluded.travel_as_project_time,
         travel_as_project_time_text = excluded.travel_as_project_time_text,
         file_storage = excluded.file_storage,
         sheet_row = excluded.sheet_row,
         source_system = excluded.source_system,
         lifecycle_status = 'active',
         historical_since = null,
         last_seen_batch_id = excluded.last_seen_batch_id,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
      [
        projectId, v.order_number, v.order_number_old ?? null, v.customer_number, v.customer_display_name ?? null, v.customer_name ?? null, v.corporate_group ?? null,
        v.service_number ?? null, v.service_name ?? null, v.language ?? null, v.subproject_number ?? null, v.order_confirmation_number ?? null,
        v.street ?? null, v.postal_code ?? null, v.city ?? null,
        v.contract_start ?? null, v.contract_end ?? null, v.contract_status ?? null, v.responsible_kind ?? null, v.replacement_kind ?? null,
        responsibleResolved ? v.responsible_person_id : null, replacementResolved ? v.replacement_person_id : null, v.role ?? null, v.min_onsite_time ?? null,
        v.travel_flat_rate ?? null, v.travel_flat_rate_text ?? null, v.travel_as_project_time ?? null, v.travel_as_project_time_text ?? null, v.file_storage ?? null, v.sheet_row ?? null,
        SOURCE_SYSTEM, batchId, sheetModified, nowIso,
      ],
    );
    counts.masterdata_upserted += 1;
    if (before?.lifecycle_status === "historical") counts.reactivated += 1;

    /* --------------------------------------------- f. projects.project_order */
    // Mirrors promote-customer-master.mjs:179-187: an order with a known legal
    // entity is approved, one without is a review case. order_number is the
    // OLD key and is never changed.
    await db.query(
      `insert into projects.project_order (order_number, name, legal_entity_id, review_status)
       select $1::text, $2::text, $3::uuid, case when $3::uuid is null then 'review_required' else 'approved' end
       where not exists (select 1 from projects.project_order where order_number = $1)`,
      [projectId, v.order_name ?? v.service_name ?? null, candidate],
    );
    await db.query(
      `update projects.project_order set
         masterdata_key = $2,
         legal_entity_id = coalesce(legal_entity_id, $3::uuid),
         last_seen_batch_id = $4::uuid,
         last_seen_at = $5::timestamptz,
         lifecycle_status = 'active',
         historical_since = null,
         updated_at = $6::timestamptz
       where order_number = $1`,
      [projectId, v.order_number, candidate, batchId, sheetModified, nowIso],
    );

    /* ------------------------------------------------- g. project_contact */
    for (const slot of [1, 2]) {
      const name = v[`contact${slot}_name`] ?? null;
      const phone = v[`contact${slot}_phone`] ?? null;
      const email = v[`contact${slot}_email`] ?? null;
      if (name || phone || email) {
        await db.query(
          `insert into public.project_contact (project_id, slot, name, phone, email, source_system, updated_at)
           values ($1, $2::smallint, $3, $4, $5, $6, $7::timestamptz)
           on conflict (project_id, slot) do update set
             name = excluded.name, phone = excluded.phone, email = excluded.email,
             source_system = excluded.source_system, updated_at = excluded.updated_at`,
          [projectId, slot, name, phone, email, SOURCE_SYSTEM, nowIso],
        );
        counts.contacts_written += 1;
      } else {
        const gone = await rows(`delete from public.project_contact where project_id = $1 and slot = $2::smallint returning slot`, [projectId, slot]);
        counts.contacts_deleted += gone.length;
      }
    }

    /* ---------------------------------------------------- h. project_link */
    // See "LINKS HAVE TWO IMPORTER SOURCES" in the header. A stated URL is
    // claimed under LINK_SOURCE (an identical workbook row is re-sourced, not
    // duplicated -- the unique key is (project, kind, url)) and every other
    // importer-sourced URL of the kind goes; an empty cell withdraws only the
    // sheet's own earlier claim. Anything hand-added is never touched.
    for (const [key, kind] of LINK_KINDS) {
      const url = v[key] ?? null;
      if (url) {
        const written = await rows(
          `insert into public.project_link (project_id, kind, url, label, source)
           values ($1, $2, $3, $4, $5)
           on conflict (project_id, kind, url) do update set source = excluded.source, label = excluded.label
             where project_link.source = any($6::text[])
               and (project_link.source <> excluded.source or project_link.label is distinct from excluded.label)
           returning id`,
          [projectId, kind, url, headerOf(key), LINK_SOURCE, IMPORTER_LINK_SOURCES],
        );
        counts.links_written += written.length;
      }
      const removed = await rows(
        `delete from public.project_link
          where project_id = $1 and kind = $2
            and source = any(case when $3::text is null then $5::text[] else $4::text[] end)
            and ($3::text is null or url <> $3::text)
          returning id`,
        [projectId, kind, url, IMPORTER_LINK_SOURCES, [LINK_SOURCE]],
      );
      counts.links_removed += removed.length;
    }

    /* -------------------------------------- i. responsibility, every encoding */
    // One decision per role, applied to project_responsibility,
    // person_assignments and (for the responsible) projects.owner_person_id +
    // lead. See "THE THREE RESPONSIBILITY ENCODINGS" in the header.
    const project = await one(`select name, logged_hours, owner_person_id from public.projects where id = $1`, [projectId]);
    const projectName = project?.name ?? projectId;
    const note = (role, kind, text) => responsibilityNotes.push({ sheet_row: v.sheet_row ?? null, project_id: projectId, role, kind, note: text });
    // The responsible another process holds, if any -- needed by the
    // replacement's self-cover guard below as well as by its own branch.
    const heldResponsible = await rows(
      `select person_id, source from public.project_responsibility
        where project_id = $1 and role = 'responsible' and source <> $2 order by person_id`,
      [projectId, RESPONSIBILITY_SOURCE],
    );
    for (const [role, kind, personId, resolved] of [
      ["responsible", v.responsible_kind ?? null, v.responsible_person_id ?? null, responsibleResolved],
      ["replacement", v.replacement_kind ?? null, v.replacement_person_id ?? null, replacementResolved],
    ]) {
      const isResponsible = role === "responsible";
      const share = isResponsible ? 100 : 0;
      const sort = isResponsible ? 0 : 1;
      const sheetSays = resolved ? `names ${personId}` : kind === "person" ? "names a person that did not resolve" : kind ? `says ${kind === "doctor" ? "DOC" : "OTHER"}` : "names nobody";

      /* -- provenance: a role written by the handover RPC is not ours ------ */
      const held = isResponsible ? heldResponsible : await rows(
        `select person_id, source from public.project_responsibility
          where project_id = $1 and role = $2 and source <> $3 order by person_id`,
        [projectId, role, RESPONSIBILITY_SOURCE],
      );
      if (held.length) {
        counts.responsibility_held_elsewhere += 1;
        const agrees = resolved && held.length === 1 && held[0].person_id === personId;
        note(role, kind, `${role} is held by ${held.map((h) => `${h.person_id} (source ${h.source})`).join(", ")}; the sheet ${agrees ? "agrees" : sheetSays}; left alone in every encoding${agrees ? "" : " -- the approved handover wins until the sheet is updated"}`);
        continue;
      }
      // Nobody may be their own cover (the rule decide_project_responsible_change
      // enforces): a sheet that names the change_control responsible as the
      // replacement would resurrect exactly that through this door.
      if (!isResponsible && resolved && heldResponsible.some((h) => h.person_id === personId)) {
        counts.responsibility_left_alone += 1;
        note(role, kind, `the sheet names ${personId} as replacement, but ${personId} holds the responsible role by change_control; a person cannot be their own cover, so the replacement rows are left alone`);
        continue;
      }

      /* -- a person we could not match: the sheet names someone ------------ */
      if (kind === "person" && !resolved) {
        counts.responsibility_left_alone += 1;
        note(role, kind, personId ? `person ${personId} is not in public.people; existing ${role} rows left alone` : `the ${role} name matched no person at staging time; existing ${role} rows left alone`);
        continue;
      }

      /* -- DOC / OTHER / empty: no colleague holds the role ---------------- */
      if (!resolved) {
        const goneRoles = await rows(
          `delete from public.project_responsibility where project_id = $1 and role = $2 and source = $3 returning person_id`,
          [projectId, role, RESPONSIBILITY_SOURCE],
        );
        const goneAssignments = await rows(
          isResponsible
            ? `delete from public.person_assignments where project_id = $1 and share_percent = 100 returning person_id`
            : `delete from public.person_assignments where project_id = $1 and share_percent = 0 and sort_order = 1 returning person_id`,
          [projectId],
        );
        let ownerCleared = false;
        if (isResponsible && project?.owner_person_id) {
          await db.query(`update public.projects set owner_person_id = null, lead = 'n/a' where id = $1`, [projectId]);
          ownerCleared = true;
        }
        if (goneRoles.length || goneAssignments.length || ownerCleared) {
          counts.responsibility_cleared += 1;
          const who = [...new Set([...goneRoles, ...goneAssignments].map((r) => r.person_id).concat(ownerCleared ? [project.owner_person_id] : []))].sort();
          note(role, kind, `the sheet ${sheetSays} for ${role}; ${who.join(", ")} removed from that role in every encoding`);
        }
        continue;
      }

      /* -- a resolved person: this one, and nobody else, in every encoding - */
      const replacedRoles = await rows(
        `delete from public.project_responsibility
          where project_id = $1 and role = $2 and source = $3 and person_id <> $4 returning person_id`,
        [projectId, role, RESPONSIBILITY_SOURCE, personId],
      );
      await db.query(
        `insert into public.project_responsibility (project_id, person_id, role, source, order_no)
         values ($1, $2, $3, $4, $1)
         on conflict (project_id, person_id, role) do update set order_no = excluded.order_no`,
        [projectId, personId, role, RESPONSIBILITY_SOURCE],
      );
      counts.responsibility_rows += 1;
      // Every share-100 row of the project that is not this person's 100/0 row
      // goes (a different holder; the RPC's 100/sort>=1 shape from before the
      // role table existed); for the replacement, every other 0/1 cover.
      const replacedAssignments = await rows(
        isResponsible
          ? `delete from public.person_assignments
              where project_id = $1 and share_percent = 100 and not (person_id = $2 and sort_order = 0)
              returning person_id, logged_hours`
          : `delete from public.person_assignments
              where project_id = $1 and share_percent = 0 and sort_order = 1 and person_id <> $2
              returning person_id, logged_hours`,
        [projectId, personId],
      );
      const kept = await rows(
        `update public.person_assignments set project_name = $3
          where project_id = $1 and person_id = $2 and share_percent = $4::numeric and sort_order = $5::integer
          returning id`,
        [projectId, personId, projectName, share, sort],
      );
      if (kept.length === 0) {
        // logged_hours is NOT NULL. This person's own deleted row (a 100/N
        // shape) keeps its figure; otherwise the August convention applies:
        // the responsible row carries the project's logged total when that is
        // measured, the replacement row 0. Never another person's hours.
        const own = replacedAssignments.find((r) => r.person_id === personId)?.logged_hours;
        const hours = own ?? (isResponsible ? project?.logged_hours ?? null : 0);
        await db.query(
          `insert into public.person_assignments (person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order)
           values ($1, $2, $3, coalesce($4::numeric, 0), 0, $5::numeric, $6::integer)`,
          [personId, projectId, projectName, hours, share, sort],
        );
        counts.assignment_rows_inserted += 1;
      }
      counts.assignment_rows += 1;
      if (isResponsible) {
        await db.query(`update public.projects set owner_person_id = $2, lead = $3 where id = $1`, [projectId, personId, v.responsible_name ?? personId]);
      }
      const previous = [...new Set([...replacedRoles, ...replacedAssignments].map((r) => r.person_id).filter((p) => p !== personId))].sort();
      if (previous.length || (isResponsible && project?.owner_person_id && project.owner_person_id !== personId)) {
        counts.responsibility_changed += 1;
        const from = [...new Set([...previous, ...(isResponsible && project?.owner_person_id && project.owner_person_id !== personId ? [project.owner_person_id] : [])])].sort();
        note(role, kind, `${role} changes from ${from.join(", ")} to ${personId} in every encoding`);
      }
    }
  }

  /* ------------------------------------------------------ j. disappearance */
  // Everything the sheet once gave us and no longer lists, by either key.
  // Marked, never deleted; the mirror on project_order keeps the two lifecycle
  // columns telling one story.
  //
  // Bounded: a sheet that lost half its rows (a filter left on, a tab
  // half-pasted) is a broken export, not 120 ended contracts. The would-be
  // count is measured first and the batch refused above the share the caller
  // allows -- the dry run shows the figure, and --allow-mass-historical is
  // the operator's explicit answer to it.
  const known = [...knownKeys];
  const exposure = await one(
    `select count(*) filter (where not (masterdata_key = any($2::text[])) and not (project_id = any($2::text[])))::int as would_mark,
            count(*)::int as active
       from public.project_masterdata
      where source_system = $1 and lifecycle_status <> 'historical'`,
    [SOURCE_SYSTEM, known],
  );
  if (exposure.would_mark > maxHistoricalShare * exposure.active) {
    throw new Error(`batch ${batchId} would mark ${exposure.would_mark} of ${exposure.active} active masterdata rows historical, more than the allowed ${Math.round(maxHistoricalShare * 100)}%; refusing -- check the sheet, then pass --allow-mass-historical if that is really what happened`);
  }
  const marked = await rows(
    `update public.project_masterdata
        set lifecycle_status = 'historical',
            historical_since = coalesce(historical_since, $2::timestamptz),
            updated_at = $2::timestamptz
      where source_system = $1
        and lifecycle_status <> 'historical'
        and not (masterdata_key = any($3::text[]))
        and not (project_id = any($3::text[]))
      returning project_id`,
    [SOURCE_SYSTEM, nowIso, known],
  );
  counts.historical_marked = marked.length;
  await db.query(
    `update projects.project_order po
        set lifecycle_status = 'historical',
            historical_since = coalesce(po.historical_since, md.historical_since, $2::timestamptz),
            updated_at = $2::timestamptz
       from public.project_masterdata md
      where md.project_id = po.order_number
        and md.source_system = $1
        and md.lifecycle_status = 'historical'
        and (po.lifecycle_status <> 'historical' or po.historical_since is null)`,
    [SOURCE_SYSTEM, nowIso],
  );

  /* ------------------------------------------------------------ k. report */
  return {
    batch_id: batchId,
    sheet_modified: sheetModified,
    apply: Boolean(apply),
    records: records.length,
    counts,
    skipped,
    responsibility_notes: responsibilityNotes,
  };
}

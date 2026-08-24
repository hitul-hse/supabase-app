-- The 28 mockup rows deleted from public.timesheet_entries on 2026-08-24.
--
-- Kept only so the deletion is reversible and so scripts/check-timesheet-truth.mjs
-- can be shown to actually FAIL on them rather than merely observed passing. Every
-- row belongs to 'emp-1' ('Anna Brandt', is_active=false, source='seed'), an
-- account nobody holds. See supabase/migrations/delete_mockup_timesheet_rows.sql
-- for the full evidence.
--
-- NOTE: id is GENERATED ALWAYS, so replaying this needs
-- "overriding system value" after the column list.
--
-- Do NOT restore this into production. It is fiction.

insert into public.timesheet_entries (id, entry_group, task_name, project_name, customer, is_billable, warning, day_of_week, hours, person_id, week_start, status, submitted_at, started_at, stopped_at, project_id, rejection_note) values
  ('1', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 0, '6.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('2', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 1, '7.5', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('3', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 2, '4.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('4', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 3, '8.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('5', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 4, '2.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('6', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 5, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('7', 1, 'Report & recommendations', 'SITE RISK ASSESSMENT 2026', 'Nordwerk AG', true, null, 6, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('8', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 0, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('9', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 1, '2.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('10', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 2, '4.5', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('11', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 3, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('12', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 4, '5.5', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('13', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 5, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('14', 2, 'Gap analysis workshop', 'ISO 45001 READINESS', 'Halbach Werke', true, null, 6, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('15', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 0, '1.5', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('16', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 1, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('17', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 2, '1.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('18', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 3, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('19', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 4, '2.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('20', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 5, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('21', 3, 'Internal · team meeting, admin', 'NON-BILLABLE', null, false, null, 6, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('22', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 0, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('23', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 1, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('24', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 2, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('25', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 3, '2.0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('26', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 4, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('27', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 5, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null),
  ('28', 4, 'Travel · plant 2 site visit', 'NEEDS PROJECT ASSIGNMENT', null, false, 'Needs project assignment', 6, '0', 'emp-1', '2026-08-09T22:00:00.000Z', 'approved', '2026-08-16T11:58:43.410Z', null, null, null, null);

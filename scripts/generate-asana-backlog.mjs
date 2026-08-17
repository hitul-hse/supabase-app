/**
 * Generates an Asana-importable CSV of the platform roadmap backlog.
 *
 * WHY A CSV AND NOT THE API: creating these tasks through the Asana API needs a
 * workspace token we do not have (ASANA_ACCESS_TOKEN is absent from .env.local).
 * A CSV import needs no token, no app registration and no admin approval — you
 * import it straight into the HSE Hub project.
 *
 * THE COLUMN CONTRACT IS NOT NEGOTIABLE (verified against Asana's own docs):
 *   - "Name" MUST be the first column, then Description, Section, Assignee.
 *   - Headers MUST be Title Case or the importer treats them as custom fields.
 *   - Due Date MUST be US format M/D/YYYY. A single malformed cell silently
 *     downgrades the WHOLE column to a text custom field.
 *   - A parent task MUST appear on an earlier row than any of its subtasks.
 *   - Collaborators are comma-separated with NO spaces.
 *
 * Run: npm run asana:backlog   ->   docs/asana/hse-platform-backlog.csv
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = "docs/asana/hse-platform-backlog.csv";

/** Asana's required column order. Task Name first — everything else follows. */
const COLUMNS = [
  "Name",
  "Description",
  "Section",
  "Assignee",
  "Start Date",
  "Due Date",
  "Type",
  "Parent Task",
  "Priority",
  "Phase",
  "Blocked By",
];

/**
 * Kick-off date for the schedule. Every task is offset from here in working
 * days so the plan stays coherent if you shift the start.
 */
const START = new Date(2026, 7, 24); // 24 Aug 2026 (month is 0-indexed)

/** US format M/D/YYYY — the only format Asana's importer accepts for dates. */
function usDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Adds working days (skips Sat/Sun) so due dates never land on a weekend. */
function addWorkingDays(from, days) {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

/** Cursor that walks the calendar as tasks are laid out in sequence. */
let cursor = new Date(START);
function schedule(durationDays) {
  const start = new Date(cursor);
  const due = addWorkingDays(start, durationDays);
  cursor = new Date(due);
  return { start: usDate(start), due: usDate(due) };
}

/**
 * The backlog. Mirrors docs/architecture/PLATFORM-ARCHITECTURE.md §7 exactly —
 * if the roadmap changes, change it there first and regenerate.
 *
 * `days` is a working-day estimate, deliberately coarse. `milestone: true`
 * emits Asana's Type=Milestone so phase gates render as diamonds on the timeline.
 */
const PHASES = [
  {
    section: "Phase 0 — Foundations",
    phase: "0",
    tasks: [
      {
        name: "Apply schema.sql to the live Supabase project",
        days: 1,
        priority: "High",
        desc:
          "BLOCKER for everything else. The permission objects (app_permission, app_role_permission, app_user_has_permission) are in schema.sql but have never been applied to live — verified: both tables and the RPC return 404. Until this runs, /admin/roles silently redirects every user home including exec, and /portal shows an empty state. schema.sql is idempotent; 'policy already exists' errors are safe to skip.",
      },
      {
        name: "Decide: one Supabase project with schemas, or separate projects",
        days: 1,
        priority: "High",
        milestone: true,
        desc:
          "Gates all module DDL. Recommendation is ONE project with a schema per module. Separate projects put each module in its own Postgres instance, so Hub cannot JOIN hours against budget against leave — which is its entire purpose — and auth.users is per-project, so one sign-in becomes four logins. See PLATFORM-ARCHITECTURE.md §2.",
      },
      {
        name: "Introduce the platform schema",
        days: 4,
        priority: "High",
        desc:
          "Create the platform schema and move people/roles/permissions into it. Leave compatibility views behind at the old names so nothing breaks mid-move. platform.person becomes the single definition of a human — no module may define its own.",
      },
      {
        name: "Add Google and Microsoft OAuth with a domain allow-list",
        days: 4,
        priority: "High",
        desc:
          "Microsoft covers the Asana seats, Google covers TrackingTime. Supabase auto-links identities that share a VERIFIED email into one auth.users row, which is what makes both land on one account. CAVEAT: SAML SSO accounts are excluded from linking entirely, so choosing Entra SAML over Azure OAuth breaks this. Unknown domains must land in pending-provisioning, never auto-approve.",
      },
      {
        name: "Bridge portal shell with permission-driven tiles",
        days: 3,
        priority: "Medium",
        desc:
          "Already built at /portal (commit fd8f5d1). Remaining work is polish and the empty/pending states. Tiles come from app_user_modules() — granting a permission is the only step needed to reveal a module. Never hard-code a tile list.",
      },
      {
        name: "GATE: one colleague, two providers, one account",
        days: 1,
        priority: "High",
        milestone: true,
        desc:
          "Exit test for Phase 0. Sign in with Microsoft, sign out, sign in with Google, and prove it is ONE auth.users row with two identities — not two accounts. This gate must be able to fail: verify by querying auth.identities, not by the app looking right.",
      },
    ],
  },
  {
    section: "Phase 1 — Discovery",
    phase: "1",
    tasks: [
      {
        name: "Obtain API credentials for all three vendors",
        days: 2,
        priority: "High",
        desc:
          "ASANA_ACCESS_TOKEN (personal access token), TRACKINGTIME_AUTH (base64 of email:APP_PASSWORD — the app password, NOT the login password), FACTORIAL_API_KEY (admin-created under Configuration > API). Give each integration its OWN token: Asana's rate limits are per-token.",
      },
      {
        name: "Run the discovery harness against Asana",
        days: 1,
        priority: "High",
        parent: "Obtain API credentials for all three vendors",
        desc: "npm run discover asana. Produces a field inventory in docs/asana/ (gitignored — raw JSON is unredacted).",
      },
      {
        name: "Run the discovery harness against TrackingTime",
        days: 1,
        priority: "High",
        parent: "Obtain API credentials for all three vendors",
        desc: "npm run discover trackingtime. Confirm whether project budgets and Google Calendar events are reachable — both are open questions.",
      },
      {
        name: "Run the discovery harness against Factorial",
        days: 1,
        priority: "High",
        parent: "Obtain API credentials for all three vendors",
        desc: "npm run discover factorial. Pay attention to units: this repo already stores Factorial in MINUTES and TrackingTime in SECONDS.",
      },
      {
        name: "Review field inventories and resolve unit and type conflicts",
        days: 2,
        priority: "High",
        desc:
          "The harness flags three traps: a field the docs call required that is null in practice, an ID that is numeric in one endpoint and a string in another, and any duration field whose unit is not hours. Resolve every flag BEFORE writing DDL — designing from vendor docs and meeting real data later earns a migration in week three.",
      },
      {
        name: "GATE: field inventories reviewed, no unresolved unit ambiguity",
        days: 1,
        priority: "High",
        milestone: true,
        desc: "Exit test for Phase 1. Every duration field has a stated unit and every cross-endpoint ID has one agreed type.",
      },
    ],
  },
  {
    section: "Phase 2 — Time module",
    phase: "2",
    tasks: [
      {
        name: "Design the time schema from the observed inventory",
        days: 3,
        priority: "High",
        desc:
          "Time goes FIRST deliberately: highest daily interaction, best-understood model (timesheets already exist), and it feeds utilisation — the metric everyone asks for. Lowest schema risk for proving the platform shape.",
      },
      {
        name: "Build clock-in / clock-out against customer, project, task",
        days: 5,
        priority: "High",
        desc: "Billable and non-billable split, service category. A live timer already exists in the app — reuse it rather than rebuilding.",
      },
      {
        name: "Backfill historical TrackingTime data",
        days: 3,
        priority: "Medium",
        desc: "One-time load into raw, then staged. Do NOT overwrite hand-made identity mappings: weekly_employee_summary.person_id is deliberately excluded from sync payloads for exactly this reason.",
      },
      {
        name: "RLS per role for the time module, with negative controls",
        days: 3,
        priority: "High",
        desc:
          "Employee sees own entries only; dept_head sees their department; exec sees all. Existence of a policy is not proof it does the right thing — each gate must be shown to FAIL when the policy is removed.",
      },
      {
        name: "GATE: a colleague logs a week of real hours end to end",
        days: 1,
        priority: "High",
        milestone: true,
        desc: "Exit test for Phase 2. Real hours, real project, approved by a real manager, with RLS tested per role.",
      },
    ],
  },
  {
    section: "Phase 3 — Projects module",
    phase: "3",
    tasks: [
      {
        name: "Design the projects schema from the Asana inventory",
        days: 3,
        priority: "High",
        desc: "Boards, tasks, sections, milestones, dependencies. There is a partial head start from the existing Kanban work on project_sections.",
      },
      {
        name: "Build task board, sections and assignment",
        days: 8,
        priority: "High",
        desc: "The largest single surface in the platform. Existing TaskBoardView and project_sections work is the starting point, not a rewrite.",
      },
      {
        name: "Backfill Asana projects and tasks",
        days: 3,
        priority: "Medium",
        desc: "Asana paid tier allows 1500 req/min, but the cost limiter is driven by opt_fields width — request narrow field sets. Honour Retry-After exactly: rejected requests still count against quota, so retrying early makes recovery worse.",
      },
      {
        name: "RLS per role for the projects module, with negative controls",
        days: 3,
        priority: "High",
        desc: "Project manager sees own projects; dept_head sees department; exec sees all.",
      },
      {
        name: "GATE: a project runs a full week in the new tool, not Asana",
        days: 1,
        priority: "High",
        milestone: true,
        desc: "Exit test for Phase 3. One real project, one real week, no falling back to Asana.",
      },
    ],
  },
  {
    section: "Phase 4 — HR module",
    phase: "4",
    tasks: [
      {
        name: "Design the hr schema from the Factorial inventory",
        days: 3,
        priority: "High",
        desc: "Deliberately after two other modules: this is the most sensitive data, so the permission model should have been exercised in anger first.",
      },
      {
        name: "Holiday booking, sick leave and absence approval",
        days: 6,
        priority: "High",
        desc: "Leave/PTO already exists in the app — extend it rather than starting over.",
      },
      {
        name: "Contracts, working-time models and job postings",
        days: 6,
        priority: "Medium",
        desc: "Contract data is the most sensitive in the platform. Salary-adjacent fields need their own permission key, not a role check.",
      },
      {
        name: "Decide how granular Factorial hours may be shown, and to whom",
        days: 1,
        priority: "High",
        desc: "A policy question, not a technical one, but it changes what the dept-head dashboard is allowed to display. Carried over from HSE-HUB-PORTAL.md.",
      },
      {
        name: "GATE: leave request approved end to end with RLS proven per role",
        days: 1,
        priority: "High",
        milestone: true,
        desc: "Exit test for Phase 4.",
      },
    ],
  },
  {
    section: "Phase 5 — Hub as pure analytics",
    phase: "5",
    tasks: [
      {
        name: "Rebuild Hub to read only from the analytics schema",
        days: 5,
        priority: "High",
        desc:
          "Hub's RLS surface becomes SELECT-only. It can then never corrupt operational data, and it can be rebuilt without touching what people depend on daily.",
      },
      {
        name: "Per-module dashboards for exec and team leads",
        days: 6,
        priority: "High",
        desc: "One dashboard per module: project health, utilisation, absence and headcount, pipeline.",
      },
      {
        name: "Decision surface — approve overtime, flag budget overrun, upcoming birthdays",
        days: 4,
        priority: "High",
        desc:
          "The ONE exception to read-only. Decisions write to platform.decision and the owning module reads and applies them. Hub never UPDATEs a module table. There is deliberately no UPDATE or DELETE policy on the decision table: an audit trail that can be edited is not one.",
      },
      {
        name: "GATE: an exec approves overtime in Hub and the Time module applies it",
        days: 1,
        priority: "High",
        milestone: true,
        desc: "Exit test for Phase 5. Proves the decision seam works without Hub writing to module tables.",
      },
    ],
  },
  {
    section: "Phase 6 — CRM and infrastructure",
    phase: "6",
    tasks: [
      {
        name: "Decide whether Samdock stays in scope or HubSpot replaces it",
        days: 1,
        priority: "Low",
        desc: "Open question 8. Do not build the CRM module until this is settled.",
      },
      {
        name: "Write the GCP migration checklist",
        days: 2,
        priority: "Medium",
        desc:
          "Schemas, tables, views, functions, RLS and triggers all move with pg_dump. The real lock-in is DASHBOARD-ONLY CONFIG — exposed schemas and Auth provider settings — which is invisible to git and WILL be forgotten. It needs a written checklist before any move.",
      },
      {
        name: "Stand up staging self-hosted on GCP to prove the path",
        days: 5,
        priority: "Medium",
        desc:
          "Prove the migration on STAGING while production stays safely hosted. Note: hosted Supabase gives Supavisor connection pooling for free; self-hosted must stand it up or you get connection exhaustion under load.",
      },
      {
        name: "Retire the paid Asana and TrackingTime seats",
        days: 1,
        priority: "Medium",
        milestone: true,
        desc:
          "LAST, never first. Cancel only after the replacement modules have run real work end to end. This ordering is already the recommendation on the CEO Decision frame of the Miro board.",
      },
    ],
  },
];

/** RFC4180 escaping — quote if the value contains a comma, quote or newline. */
function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = [];
for (const phase of PHASES) {
  for (const t of phase.tasks) {
    const { start, due } = schedule(t.days);
    rows.push({
      Name: t.name,
      Description: t.desc,
      Section: phase.section,
      Assignee: "",
      "Start Date": start,
      "Due Date": due,
      Type: t.milestone ? "Milestone" : "",
      "Parent Task": t.parent ?? "",
      Priority: t.priority,
      Phase: phase.phase,
      "Blocked By": "",
    });
  }
}

const csv = [
  COLUMNS.join(","),
  ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(",")),
].join("\r\n");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv, "utf8");

const milestones = rows.filter((r) => r.Type === "Milestone").length;
const subtasks = rows.filter((r) => r["Parent Task"]).length;
console.log(`Wrote ${OUT}`);
console.log(`  ${rows.length} tasks across ${PHASES.length} phases`);
console.log(`  ${milestones} milestones (phase gates), ${subtasks} subtasks`);
console.log(`  schedule ${rows[0]["Start Date"]} -> ${rows[rows.length - 1]["Due Date"]}`);

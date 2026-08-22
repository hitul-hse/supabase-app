/**
 * The contract read/write layer's guarantees, asserted against the SHIPPED
 * source.
 *
 * These are STATIC checks. That is a deliberate choice rather than a shortcut:
 * the properties worth guarding here are structural ("no action trusts the
 * client for authorisation", "no paged read is unordered"), and those are
 * exactly the ones a runtime test tends to miss because the happy path passes
 * either way. The behavioural side is covered by check-contract-periods.mjs,
 * which executes the real migration against real Postgres.
 *
 * Two of these checks exist because the codebase has already been burned:
 *
 *   - Unordered .range() paging. PostgREST has no stable row order without
 *     .order(), so paging silently REPEATS and SKIPS rows. It made a 5,299-row
 *     read return 5,000 distinct rows and cost a day to find.
 *
 *   - Authorisation inferred from what the page rendered. A Server Action is a
 *     public HTTP endpoint; hiding a button hides nothing.
 */
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const read = (p) => readFileSync(p, "utf8");

const QUERIES = "src/lib/queries/contract-periods.ts";
const ACTIONS = "src/app/(app)/projects/contract-actions.ts";
const PANEL = "src/app/(app)/projects/ContractPanel.tsx";
const PAGE = "src/app/(app)/projects/[id]/page.tsx";
const MIGRATION = "supabase/migrations/add_contract_periods.sql";
const PERMS = "src/lib/permissions.ts";

const queries = read(QUERIES);
const actions = read(ACTIONS);
const panel = read(PANEL);
const page = read(PAGE);
const migration = read(MIGRATION);
const perms = read(PERMS);

/* --------------------------------------------------------------- the reads */

check(
  "the read layer goes through the contract_period_status view, not raw joins",
  queries.includes('from("contract_period_status")'),
  "the view computes logged_hours inside the period window, so callers cannot disagree about it",
);

/*
 * Every .range() must be preceded by an .order(). Checked per statement rather
 * than per file, because a file can contain one ordered read and one that is
 * not.
 */
{
  /*
   * Comments are stripped first. The first version of this check split on
   * ";\n" and counted the PROSE explaining why ordering matters as an
   * unordered read -- a gate failing on its own documentation. Anchor on the
   * builder chain that actually reaches .range() instead.
   */
  const code = queries
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Each await ... .range(...) chain, from the await to the closing call.
  const chains = [...code.matchAll(/await[\s\S]{0,600}?\.range\([^)]*\)/g)].map((m) => m[0]);
  const unordered = chains.filter((c) => !c.includes(".order("));
  check(
    "every paged read is ordered",
    chains.length > 0 && unordered.length === 0,
    `${chains.length} paged read(s), ${unordered.length} unordered`,
  );
}

check(
  "a missing table degrades to an empty list rather than throwing",
  /if \(error\) return \[\]/.test(queries),
  "the project page must keep working between deploy and migration",
);

check(
  "the attention query classifies lapsed contracts only for the LATEST period",
  queries.includes("isLatest") && queries.includes('kind: "lapsed"'),
  "an older period ending is history, not a problem; flagging it would bury the real cases",
);

check(
  "attention rows are sorted worst-first",
  /rank\[a\.kind\] - rank\[b\.kind\]/.test(queries),
);

/* ------------------------------------------------------------- the writes */

const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
check(
  "the three write actions exist",
  ["setContractTerms", "renewContract", "correctContractPeriod"].every((f) =>
    exported.includes(f),
  ),
  exported.join(", "),
);

check(
  "the file is a server module",
  actions.trimStart().startsWith('"use server"'),
);

/*
 * THE CENTRAL SECURITY PROPERTY. Every exported action must call authorise()
 * before it does anything else, and authorise() must ask the database.
 */
{
  const bodies = actions.split(/export async function /).slice(1);
  const missing = bodies
    .filter((b) => !b.slice(0, 400).includes("await authorise()"))
    .map((b) => b.split("(")[0]);
  check(
    "EVERY action re-checks permission server-side before acting",
    missing.length === 0,
    missing.length ? `missing in: ${missing.join(", ")}` : `${bodies.length} actions checked`,
  );
}

check(
  "authorisation is asked of the database, not derived from a role string",
  actions.includes('rpc("app_user_has_permission"') && actions.includes("p_key:"),
  "roles get added (hr arrived late); a capability check keeps working",
);
check(
  "and it is the contracts:write capability, not projects:write",
  actions.includes('"projects:contracts:write"'),
  "changing a commercial budget is a different act from editing a project record",
);

check(
  "an unauthenticated caller is refused explicitly",
  /not signed in/i.test(actions),
);

check(
  "no action reads a permission or role from the submitted form",
  !/formData\.get\(["'](permission|role|is_admin|can_write)/i.test(actions),
);

/* -------------------------------------------------- error translation */

check(
  "the overlap error (23P01) is translated for a human",
  actions.includes("23P01") && /overlap/i.test(actions),
);
check(
  "the database's own HINT is preferred over invented wording",
  /error\.hint/.test(actions),
  "the trigger knows which period collided; this file does not",
);
check(
  "a permission error from the database (42501) maps to the denial message",
  actions.includes("42501"),
  "renew_contract_period enforces permission itself, so its refusal must read the same",
);
check(
  "a check-constraint violation (23514) is explained, not dumped",
  actions.includes("23514"),
);

/* --------------------------------------------------- input validation */

check(
  "dates are validated as real calendar dates, not just pattern-matched",
  /toISOString\(\)\.slice\(0, 10\) !== s/.test(actions),
  "2026-02-31 matches the pattern but is not a date; Postgres would roll it",
);
check(
  "an end date before the start is rejected before hitting the database",
  /endsOn < startsOn/.test(actions),
);
check(
  "a non-positive budget is rejected",
  /n <= 0/.test(actions),
);
check(
  "a comma decimal is accepted (the business writes German numbers)",
  /replace\(",", "\."\)/.test(actions),
);
check(
  "the warn threshold is clamped into 1..100 rather than trusted",
  /Math\.min\(100, Math\.max\(1,/.test(actions),
);

/* ------------------------------------------------ renewal goes via the DB */

check(
  "renewal calls the database function rather than inserting directly",
  actions.includes('rpc("renew_contract_period"'),
  "picking the next period number, linking the chain and rejecting overlap must be one atomic step",
);
check(
  "the renewal message states that the previous period is preserved",
  /previous period keeps its own budget/i.test(actions),
  "this is the requirement; the confirmation should say it happened",
);

check(
  "correcting a period is scoped by project as well as id",
  /\.eq\("id", periodId\)[\s\S]{0,80}\.eq\("project_id", projectId\)/.test(actions),
  "a mismatched pair is a bug or a probe, and must not write",
);

/* ------------------------------------------------------------- the UI */

check(
  "the panel shows the contract history as a table",
  /Contract history/.test(panel) && /<table/.test(panel),
  "the preserved history is the point of the feature, not a footnote",
);
check(
  "the history states that nothing is overwritten by a renewal",
  /Nothing is overwritten by a renewal|keeps its own budget/i.test(panel),
);
check(
  "each history row shows ITS OWN budget and ITS OWN booked hours",
  /p\.budgetHours/.test(panel) && /p\.loggedHours/.test(panel),
);
check(
  "a lapsed contract is called out on the project page",
  /No contract covers today/i.test(panel),
  "silence here is what let hours pile up outside a contract unnoticed",
);
check(
  "the vendor fallback is labelled as vendor-synced, not passed off as agreed",
  /synced from TrackingTime/i.test(panel) && /overwrites/i.test(panel),
);
check(
  "write controls are gated on the permission the server re-checks",
  /canWrite &&/.test(panel),
);
check(
  "a read-only viewer is told why, rather than shown nothing",
  /only executives and department heads can record them/i.test(panel) ||
    /Contract terms are commercial/i.test(panel),
  "an empty panel would read as 'no contract', which is a different statement from 'you may not edit this'",
);
check(
  "the burn bar carries an accessible label",
  /aria-label=/.test(panel) && /role="img"/.test(panel),
);
check(
  "colours come from CSS variables, not hardcoded hex",
  !/#[0-9a-fA-F]{6}(?![^(]*\))/.test(panel.replace(/var\(--warning, #d99b3d\)/g, "")),
  "one CSS-variable fallback is allowed; standalone hex is not",
);

/* ------------------------------------------------------- the wiring */

check(
  "the project page renders the contract panel",
  page.includes("<ContractPanel"),
);
check(
  "the panel sits ABOVE the burn chart",
  page.indexOf("<ContractPanel") < page.indexOf("<BurnChart"),
  "the burn only means something measured against the agreed budget",
);
check(
  "the page reads periods unconditionally but gates the forms",
  page.includes("getProjectContractPeriods") &&
    page.includes("PROJECTS_CONTRACTS_WRITE"),
  "everyone who sees the project sees the terms; only writing is restricted",
);
check(
  "both permission keys are registered in the typed registry",
  perms.includes("PROJECTS_CONTRACTS_READ") && perms.includes("PROJECTS_CONTRACTS_WRITE"),
);

/* ------------------------------------------- the migration's own promises */

check(
  "the migration grants the write capability to exec and dept_head only",
  /projects:contracts:write[\s\S]{0,200}'exec', 'dept_head'/.test(migration),
);
check(
  "DELETE on a contract period stays exec-only",
  /for delete[\s\S]{0,120}app_user_role\(\) = 'exec'/.test(migration),
  "deleting a period destroys the history the feature exists to keep",
);
check(
  "the no-overlap rule is enforced in the database, not just the UI",
  migration.includes("assert_no_contract_period_overlap"),
);
check(
  "the overlap check takes a per-project advisory lock",
  migration.includes("pg_advisory_xact_lock"),
  "two concurrent renewals could each see no overlap and both insert",
);
check(
  "hours are attributed in Europe/Berlin, not UTC",
  migration.includes("Europe/Berlin"),
  "23:30 on the last contract day must not fall into the next period",
);

console.log(
  failed === 0
    ? "\nCONTRACT UI: every write re-checks permission, paged reads are ordered, and the history is preserved and visible"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);

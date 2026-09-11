/*
 * A server action that bypasses row-level security must check a permission.
 *
 * THE INCIDENT THIS COMES FROM (2026-09-11). `getWeekDrilldown` read
 * `time.entry` and `time.member` over SUPABASE_DB_URL -- a connection that runs
 * as the owner role with RLS OFF -- behind nothing but `getUser()`. A server
 * action is a public POST endpoint, and an OAuth sign-in with no profile row
 * keeps its session and passes `enforceRoleRouteAccess`. So exactly the accounts
 * RLS shuts out of everything else could read the top eight people per team, by
 * name, with their hours, for any week. The sibling action
 * `projects/project-drilldown.ts` had required a permission all along, which is
 * what made it obvious that one of the two was wrong.
 *
 * THE RULE. Any file that declares "use server" AND opens a direct Postgres
 * connection must call `app_user_has_permission` before it reads. Session alone
 * is not a boundary here, because the connection has no boundary of its own:
 * whatever the query selects, it gets.
 *
 * WHY THIS IS ITS OWN GATE RATHER THAN A SECTION OF check-server-action-auth.
 * That gate drives a real browser against a stubbed Supabase, and it reports NOT
 * RUN when its port is busy. A static rule that can only be checked when a
 * browser is free is a rule that silently stops being checked. This one reads
 * files and always runs.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. Which permission, or whether it is the
 * right one for the data. That is a judgement a reader makes; this gate catches
 * the case where nobody made it at all.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const SRC = join(REPO_ROOT, "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments describe intent; they must never satisfy an assertion about code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const declaresServerAction = (s) => /^\s*["']use server["']/m.test(s);
/* Either the pg driver directly, or the connection string that only the
 * privileged path uses. Both spellings, because either alone is bypassable. */
const opensPrivilegedConnection = (s) =>
  /from\s+["']pg["']/.test(s) || /SUPABASE_DB_URL/.test(s);
const checksAPermission = (s) => /app_user_has_permission/.test(s);

const files = walk(SRC).map((f) => ({ path: relative(REPO_ROOT, f), src: stripComments(readFileSync(f, "utf8")) }));

const actions = files.filter((f) => declaresServerAction(f.src));
const privileged = actions.filter((f) => opensPrivilegedConnection(f.src));

check(
  "the scan found server actions at all",
  actions.length >= 10,
  `found ${actions.length}; if this is 0 the walk is broken and every check below is vacuous`,
);
check(
  "at least one server action opens a privileged connection",
  privileged.length >= 1,
  "found none, so the rule below is asserting nothing about this codebase",
);

for (const f of privileged) {
  check(
    `${f.path} checks a permission before reading over a connection that bypasses RLS`,
    checksAPermission(f.src),
    "it opens a direct Postgres connection, which runs as the owner with row-level security off, behind no permission check",
  );
}

/* ------------------------------------------------------- negative controls */

const subject = privileged.find((f) => /week-drilldown/.test(f.path)) ?? privileged[0];
check("[control] a privileged action was found to mutate", Boolean(subject));

if (subject) {
  const withoutPermission = { ...subject, src: subject.src.replace(/app_user_has_permission/g, "some_other_call") };
  check(
    "[control] the mutation removing the permission check changed the source",
    withoutPermission.src !== subject.src,
  );
  check(
    "[control] the rule WOULD catch an action reading privileged data with no permission check",
    checksAPermission(withoutPermission.src) === false,
  );

  const withoutPg = { ...subject, src: subject.src.replace(/from\s+["']pg["']/g, 'from "not-pg"').replace(/SUPABASE_DB_URL/g, "SOME_OTHER_URL") };
  check(
    "[control] an action that does NOT open a privileged connection is out of scope",
    opensPrivilegedConnection(withoutPg.src) === false,
    "the detector matches something other than the privileged connection, so it would judge ordinary actions",
  );

  const notAnAction = { ...subject, src: subject.src.replace(/^\s*["']use server["']/m, "// not an action") };
  check(
    "[control] a file that does not declare an action is out of scope",
    declaresServerAction(notAnAction.src) === false,
  );
}

console.log(
  failures === 0
    ? `\nPRIVILEGED SERVER ACTIONS: OK — ${privileged.length} of ${actions.length} action file(s) open a privileged connection, all gated.`
    : `\nPRIVILEGED SERVER ACTIONS: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);

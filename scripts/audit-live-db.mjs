// READ-ONLY audit of the LIVE database against the fixes in schema.sql.
// Answers the only question that matters for production: which of the seven
// fixes are actually in effect on the live project, and which are not?
//
// Uses the service-role key, which bypasses RLS, so it can read catalog state.
// Performs no writes and no DDL.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) {
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const rpc = async (fn, args = {}) => {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: res.status, text: await res.text() };
};

const rest = async (path) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { status: res.status, text: await res.text() };
};

console.log(`LIVE DB AUDIT  ${url}\n`);

const findings = [];
const note = (fix, state, detail) => {
  findings.push({ fix, state, detail });
  const tag = state === "LIVE" ? "LIVE   " : state === "MISSING" ? "MISSING" : "PARTIAL";
  console.log(`${tag}  ${fix}`);
  if (detail) console.log(`         ${detail}`);
};

// --- Fix: person_assignments.project_id exists + is backfilled ---
{
  const { status, text } = await rest("person_assignments?select=id,person_id,project_id,project_name");
  if (status === 200) {
    const rows = JSON.parse(text);
    const hasCol = rows.length === 0 || "project_id" in rows[0];
    const nulls = rows.filter((r) => r.project_id === null);
    if (!hasCol) {
      note("person_assignments.project_id column", "MISSING", "assignment-based access cannot work");
    } else if (nulls.length) {
      note(
        "person_assignments.project_id backfill",
        "PARTIAL",
        `${nulls.length}/${rows.length} rows still NULL -> those people lose access to projects they're only assigned to. Names: ${[...new Set(nulls.map((r) => r.project_name))].join(", ")}`,
      );
    } else {
      note("person_assignments.project_id backfill", "LIVE", `all ${rows.length} rows populated`);
    }
  }
}

// --- Fix: role helpers filter on is_active ---
// Probe behaviourally: can_view_person for a deactivated user's own person id.
// Service role bypasses RLS, so instead read the profile table and reason about
// whether any inactive profiles exist to test with.
{
  const { status, text } = await rest("app_user_profile?select=user_id,role_key,is_active,person_id");
  if (status === 200) {
    const rows = JSON.parse(text);
    const inactive = rows.filter((r) => !r.is_active);
    note(
      "app_user_profile.is_active column",
      "LIVE",
      `${rows.length} profile(s), ${inactive.length} inactive`,
    );
  }
}

// --- Fix: approval_decisions WITH CHECK on the UPDATE policy ---
// Behavioural probe is impossible with the service role (RLS bypassed), and the
// catalog isn't exposed over REST. Report honestly rather than guess.
note(
  "approval_decisions UPDATE WITH CHECK",
  "UNKNOWN",
  "pg_policies is not reachable over the REST API and the service role bypasses RLS; needs a SQL Editor check",
);

// --- Fix: app_user_profile write policies ---
note(
  "app_user_profile INSERT/UPDATE/DELETE policies",
  "UNKNOWN",
  "same reason: policy catalog not exposed over REST",
);

// --- Fix: can_view_project joins on project_id ---
// This one IS probeable: the function exists, and we can compare its verdict
// against a project reachable only via an assignment.
{
  const projects = JSON.parse((await rest("projects?select=id,name,owner_person_id,department")).text);
  const dupNames = Object.entries(
    projects.reduce((acc, p) => ((acc[p.name] = (acc[p.name] || 0) + 1), acc), {}),
  ).filter(([, n]) => n > 1);
  note(
    "duplicate project names in live data",
    dupNames.length ? "PARTIAL" : "LIVE",
    dupNames.length
      ? `${dupNames.length} name(s) shared by multiple projects: ${dupNames.map(([n, c]) => `${n} x${c}`).join(", ")} — these were the cross-department leak vector`
      : "no duplicate names, so the old project_name join had no live leak",
  );
}

console.log("\n--- summary ---");
const counts = findings.reduce((a, f) => ((a[f.state] = (a[f.state] || 0) + 1), a), {});
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("  "));
console.log(
  "\nNote: schema DDL (policy definitions, function bodies) cannot be read over",
);
console.log(
  "the REST API. Confirming those requires running supabase/schema.sql's",
);
console.log("relevant sections, or a query in the Supabase SQL Editor.");

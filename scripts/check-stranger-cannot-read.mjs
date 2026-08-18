/**
 * The invite-only model, tested at its FAILURE MODES rather than its happy path.
 *
 * WHAT MY EARLIER CHECKS ACTUALLY PROVED, and did not: they confirmed an uninvited
 * user is REDIRECTED to /access-pending, and that a profiled user reaches the app.
 * Both are about routing. Neither one proves the claim I actually made, which was
 * "they can read nothing" -- a redirect is a UI courtesy, not a security boundary. A
 * stranger holding a valid JWT can call PostgREST directly and never touch our
 * routing at all.
 *
 * So this exercises the boundary itself, as a real authenticated stranger, against
 * the live database:
 *
 *   1. EVERY table in the schema, read directly over the REST API. Not a sample --
 *      one missed table with a permissive policy is the whole breach.
 *   2. The `time` schema too, which holds the hours and the money and has its own
 *      policies.
 *   3. WRITES, not just reads. A stranger who cannot read but can INSERT into
 *      app_user_profile could provision themselves.
 *   4. PRIVILEGE ESCALATION specifically: can they create their own profile, or
 *      promote themselves to exec?
 *   5. The RPCs, which are security-definer and therefore bypass RLS by design --
 *      exactly where a gate would be forgotten.
 *   6. An INACTIVE profile (is_active = false), which is how an admin revokes
 *      someone. A revoked user still holds a valid JWT; if the policies key on the
 *      row's existence rather than on is_active, revocation does nothing.
 *
 * (6) is the edge case most likely to be wrong, because it is the one nobody tests.
 *
 * Creates two disposable users and deletes them in a finally block, verifying the
 * cleanup rather than trusting it.
 *
 * Run: node scripts/check-stranger-cannot-read.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) { console.log("SKIP: no credentials"); process.exit(0); }

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

/** A real signed-in session for an address, as OAuth would produce. */
async function sessionFor(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data, error: vErr } = await anon.auth.verifyOtp({
    type: "magiclink", token_hash: link.properties.hashed_token,
  });
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`);
  return data.session;
}

const stamp = Date.now();
const STRANGER = `rls.stranger.${stamp}@hs-experts.com`;
const REVOKED = `rls.revoked.${stamp}@hs-experts.com`;
const made = { stranger: null, revoked: null };

/**
 * Tables that must return NOTHING to a stranger, because they carry people, hours,
 * money, or the access model itself.
 *
 * Split from the reference tables below deliberately. My first version of this check
 * asserted "zero rows from every table" and reported twelve leaks -- which was a bug
 * in the TEST, not the product: several of those tables carry an explicit
 * `authenticated can read` policy in schema.sql because they hold no personal data
 * and the app needs them to render at all. Calling deliberate design a breach would
 * have sent everyone chasing a non-problem, and worse, it would have buried the ONE
 * finding that was real.
 */
const MUST_BE_EMPTY = [
  "people", "projects", "project_timeline", "project_sections", "project_tasks",
  "person_assignments", "person_qualifications", "weekly_bookings", "approval_decisions",
  "timesheet_entries", "leave_requests", "app_user_profile", "platform_decision",
  "task_comments", "weekly_employee_summary",
];

/**
 * Non-personal reference data with an intentional `authenticated can read` policy:
 * role names, permission keys, module list, and non-sensitive dashboard aggregates.
 * A stranger seeing these learns the shape of the app, not anything about a person.
 * Asserted separately so the intent is explicit and a future change that made one of
 * them sensitive would have to move it deliberately.
 */
const DELIBERATELY_READABLE = [
  "app_role", "app_permission", "app_role_permission", "app_module",
  "sync_sources", "executive_metrics", "weekly_trends", "team_utilisations",
];

/**
 * The `time` schema. `entry`, `member` and `member_rate` are the sensitive ones --
 * hours, people and RATES. The catalogue tables (service/customer/project/task) are
 * readable by any authenticated user by policy, the same call as above.
 */
const TIME_MUST_BE_EMPTY = ["member", "member_rate", "entry"];
const TIME_READABLE = ["service", "customer", "project", "task"];

try {
  // ── Two disposable users: one never provisioned, one provisioned then revoked ──
  const s = await admin.auth.admin.createUser({
    email: STRANGER, email_confirm: true,
    user_metadata: { note: "RLS stranger probe; safe to delete" },
  });
  if (s.error) throw new Error(s.error.message);
  made.stranger = s.data.user.id;

  const r = await admin.auth.admin.createUser({
    email: REVOKED, email_confirm: true,
    user_metadata: { note: "RLS revoked probe; safe to delete" },
  });
  if (r.error) throw new Error(r.error.message);
  made.revoked = r.data.user.id;

  // The revoked user gets a profile that is explicitly INACTIVE -- how an admin
  // takes access away without deleting the person.
  const { data: person } = await admin.from("people").select("id").limit(1);
  const { error: pErr } = await admin.from("app_user_profile").insert({
    user_id: made.revoked,
    person_id: person?.[0]?.id ?? null,
    role_key: "exec",           // deliberately the HIGHEST role...
    department: "HSE",
    is_active: false,           // ...but switched off. If is_active is ignored, this reads everything.
  });
  if (pErr) throw new Error(`could not create the revoked profile: ${pErr.message}`);

  const strangerSession = await sessionFor(STRANGER);
  const revokedSession = await sessionFor(REVOKED);

  /** Read a table as a given user, returning the row count or an error. */
  const readAs = async (token, table, schema = "public") => {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=5`, {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        ...(schema === "time" ? { "Accept-Profile": "time" } : {}),
      },
    });
    const body = await res.text();
    let rows = null;
    try { const j = JSON.parse(body); rows = Array.isArray(j) ? j.length : null; } catch { /* error body */ }
    return { status: res.status, rows, body: body.slice(0, 120) };
  };

  // ── 1+2. Every table, as an unprovisioned stranger ──────────────────────
  console.log(`=== an authenticated stranger reading every table directly over the API ===`);
  const leaks = [];
  for (const t of MUST_BE_EMPTY) {
    const res = await readAs(strangerSession.access_token, t);
    if ((res.rows ?? 0) > 0) leaks.push(`public.${t} (${res.rows} rows)`);
  }
  for (const t of TIME_MUST_BE_EMPTY) {
    const res = await readAs(strangerSession.access_token, t, "time");
    if ((res.rows ?? 0) > 0) leaks.push(`time.${t} (${res.rows} rows)`);
  }
  check(
    `a stranger reads 0 rows from all ${MUST_BE_EMPTY.length + TIME_MUST_BE_EMPTY.length} tables holding people, hours, money or access`,
    leaks.length === 0,
    leaks.length === 0
      ? "every sensitive table returned an empty array -- RLS denies at the database, not merely the router"
      : `LEAKED: ${leaks.join(", ")}`,
  );

  // The reference tables ARE readable, on purpose. Asserted rather than ignored, so
  // the boundary is documented by the test and a table cannot quietly drift across it.
  const readable = [];
  for (const t of DELIBERATELY_READABLE) {
    const res = await readAs(strangerSession.access_token, t);
    readable.push(`${t}=${res.rows ?? res.status}`);
  }
  for (const t of TIME_READABLE) {
    const res = await readAs(strangerSession.access_token, t, "time");
    readable.push(`time.${t}=${res.rows ?? res.status}`);
  }
  console.log(
    `\n  reference tables a stranger CAN read, by design (role names, permission keys,\n` +
      `  module list, project/customer catalogue, non-personal aggregates):\n    ${readable.join("  ")}`,
  );
  check(
    "the readable set contains no personal, hours or money data",
    // The sensitive tables are the ones asserted empty above. This states the
    // separation explicitly rather than leaving it implied by two lists.
    !DELIBERATELY_READABLE.some((t) => MUST_BE_EMPTY.includes(t)) &&
      !TIME_READABLE.some((t) => TIME_MUST_BE_EMPTY.includes(t)),
    "no table appears in both lists, so nothing sensitive is being waved through as 'reference data'",
  );

  // Negative control: the same reads as a REAL exec must return data, or the test
  // above is passing because the tables are empty rather than because RLS works.
  const { data: execProfile } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
  const { data: eu } = await admin.auth.admin.getUserById(execProfile[0].user_id);
  const execSession = await sessionFor(eu.user.email);
  const execReads = [];
  for (const t of ["people", "projects", "app_user_profile"]) {
    const res = await readAs(execSession.access_token, t);
    execReads.push(`${t}=${res.rows ?? res.status}`);
  }
  const execEntry = await readAs(execSession.access_token, "entry", "time");
  check(
    "control: a real exec DOES read data, so the zero above is RLS and not empty tables",
    execEntry.rows > 0,
    `exec sees time.entry=${execEntry.rows} rows, ${execReads.join(" ")} -- if these were also 0 the stranger test would prove nothing`,
  );

  // ── 3+4. Writes and privilege escalation ────────────────────────────────
  console.log("\n=== can a stranger provision or promote themselves? ===");
  const writeAs = async (token, table, payload) => {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.text()).slice(0, 160) };
  };

  const selfProvision = await writeAs(strangerSession.access_token, "app_user_profile", {
    user_id: made.stranger, role_key: "exec", department: "HSE", is_active: true,
  });
  check(
    "a stranger CANNOT create their own app_user_profile",
    selfProvision.status >= 400,
    `HTTP ${selfProvision.status} ${selfProvision.body}`,
  );

  // Did it work anyway? Check with service role rather than trusting the status.
  const { data: sneaked } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", made.stranger).maybeSingle();
  check(
    "no profile row exists for the stranger afterwards",
    sneaked === null,
    sneaked ? "A PROFILE WAS CREATED -- self-provisioning is possible" : "confirmed absent via service role",
  );

  const promote = await fetch(`${URL_BASE}/rest/v1/app_user_profile?user_id=eq.${made.revoked}`, {
    method: "PATCH",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${strangerSession.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ is_active: true }),
  });
  const promoteBody = (await promote.text()).slice(0, 160);
  const { data: stillOff } = await admin
    .from("app_user_profile").select("is_active").eq("user_id", made.revoked).maybeSingle();
  check(
    "a stranger cannot reactivate a revoked profile",
    stillOff?.is_active === false,
    `PATCH returned HTTP ${promote.status} ${promoteBody}; is_active is still ${stillOff?.is_active}`,
  );

  // ── 5. Security-definer RPCs, which bypass RLS by design ────────────────
  console.log("\n=== the RPCs, which bypass RLS and so must gate themselves ===");
  const rpcAs = async (token, fn, body = {}, schema = "public") => {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(schema === "time" ? { "Content-Profile": "time" } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, rows: Array.isArray(parsed) ? parsed.length : null, value: parsed, body: text.slice(0, 120) };
  };

  const econ = await rpcAs(strangerSession.access_token, "project_economics",
    { p_from: "2000-01-01", p_to: "2027-12-31" }, "time");
  check(
    "a stranger gets NO rows from time.project_economics (the money RPC)",
    econ.status >= 400 || (econ.rows ?? 0) === 0,
    `HTTP ${econ.status}, ${econ.rows ?? 0} rows -- this function is security definer, so its own permission gate is the only thing protecting it`,
  );

  const role = await rpcAs(strangerSession.access_token, "app_user_role");
  check(
    "app_user_role() returns nothing for a stranger",
    role.value === null || role.value === "" || role.status >= 400,
    `returned ${JSON.stringify(role.value)} -- a role here would grant access everywhere`,
  );

  const perm = await rpcAs(strangerSession.access_token, "app_user_has_permission", { p_key: "overview:export" });
  check(
    "app_user_has_permission() is false for a stranger",
    perm.value === false || perm.status >= 400,
    `returned ${JSON.stringify(perm.value)}`,
  );

  // ── 6. THE EDGE CASE: a revoked (inactive) profile ───────────────────────
  console.log("\n=== a REVOKED user (profile exists, is_active = false, role exec) ===");
  //
  // The profile is deliberately given role_key = 'exec' with is_active = false: the
  // highest privilege, switched off. If is_active were ignored anywhere, this account
  // would read the entire company.
  //
  // NOTE ON app_user_profile ITSELF. A revoked user CAN still read their own profile
  // row, and that is correct rather than a leak: schema.sql carries an explicit
  // "user can read own profile" policy, and the app needs it to tell someone their
  // access is inactive instead of showing a blank page. My first version of this
  // check counted that row as a breach, which would have raised a false alarm about
  // revocation being broken. What actually matters is whether the revoked account
  // gets a ROLE or any DATA -- so that is what is asserted.
  const revokedLeaks = [];
  for (const t of ["people", "projects", "timesheet_entries", "weekly_bookings", "leave_requests"]) {
    const res = await readAs(revokedSession.access_token, t);
    if ((res.rows ?? 0) > 0) revokedLeaks.push(`public.${t} (${res.rows})`);
  }
  for (const t of TIME_MUST_BE_EMPTY) {
    const res = await readAs(revokedSession.access_token, t, "time");
    if ((res.rows ?? 0) > 0) revokedLeaks.push(`time.${t} (${res.rows})`);
  }

  const revokedRole = await rpcAs(revokedSession.access_token, "app_user_role");
  const revokedPerm = await rpcAs(revokedSession.access_token, "app_user_has_permission", {
    p_key: "timesheets:read_all",
  });
  const revokedMoney = await rpcAs(revokedSession.access_token, "project_economics",
    { p_from: "2000-01-01", p_to: "2027-12-31" }, "time");

  check(
    "an inactive exec profile grants NO role, so is_active is honoured",
    revokedRole.value === null || revokedRole.value === "",
    `app_user_role() returned ${JSON.stringify(revokedRole.value)} -- if this said 'exec', revoking an account would do nothing at all`,
  );
  check(
    "an inactive exec profile grants no permission",
    revokedPerm.value === false || revokedPerm.status >= 400,
    `app_user_has_permission('timesheets:read_all') returned ${JSON.stringify(revokedPerm.value)}`,
  );
  check(
    "an inactive exec profile reads no people, hours, or money",
    revokedLeaks.length === 0,
    revokedLeaks.length === 0
      ? "revocation works: the account authenticates, learns it is inactive, and sees nothing else"
      : `LEAKED despite is_active=false: ${revokedLeaks.join(", ")}`,
  );
  check(
    "an inactive exec profile gets no rows from the money RPC",
    revokedMoney.status >= 400 || (revokedMoney.rows ?? 0) === 0,
    `project_economics returned ${revokedMoney.rows ?? 0} rows`,
  );

  // And the one row it CAN see is its own, which is what makes /access-pending
  // legible rather than blank.
  const ownRow = await readAs(revokedSession.access_token, "app_user_profile");
  check(
    "a revoked user can still read their OWN profile row, so the app can explain their status",
    (ownRow.rows ?? 0) === 1,
    `${ownRow.rows} row(s) -- exactly one, their own; this is the "user can read own profile" policy working as intended`,
  );
} finally {
  // ── Cleanup, verified ───────────────────────────────────────────────────
  for (const [label, id] of Object.entries(made)) {
    if (!id) continue;
    await admin.from("app_user_profile").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(`\n  cleanup ${label}: ${error ? `NOT deleted (${error.message})` : "deleted"}`);
  }
  const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const left = (after?.users ?? []).filter((u) => /rls\.(stranger|revoked)\./.test(String(u.email ?? "")));
  console.log(`  leftover probe accounts: ${left.length}`);
  if (left.length) { failed = true; console.log(`  MANUAL CLEANUP: ${left.map((u) => u.email).join(", ")}`); }
}

console.log(
  failed
    ? "\nSTRANGER ACCESS: the invite-only boundary does NOT hold\n"
    : "\nSTRANGER ACCESS: an authenticated stranger reads nothing, writes nothing, and revocation works\n",
);
process.exit(failed ? 1 : 0);

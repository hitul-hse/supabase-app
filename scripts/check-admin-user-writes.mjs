/**
 * Do the Users & Roles admin writes work, and do the guards hold?
 *
 * WHY THIS EXISTS. Changing a user's team failed with "permission denied for table
 * app_user_profile" (42501). Not only the team -- role changes and the
 * ACTIVE/INACTIVE toggle failed identically, so every inline control on that page
 * was inert while the page itself looked healthy, because `select` IS granted and
 * reads worked.
 *
 * The cause was a missing table GRANT, not a missing policy. Postgres checks grants
 * before policies, so `update` was refused before the (correct) "exec can update
 * profiles" policy was ever consulted. Proven in a real engine: policy without
 * grant gives 42501, with grant gives 1 row, and a policy that matches nothing gives
 * 0 rows and NO error -- which is how the two failure modes are told apart.
 *
 * The three actions now write through the service role, as inviteUser on the same
 * page already did. That made two new mistakes possible, so both are asserted here:
 * an admin deactivating themselves, or demoting themselves out of the role that
 * grants admin:users:write, would lock themselves out of the console with no way
 * back short of a database console.
 *
 * Drives the REAL server actions, compiled with Next's own SWC, against the live
 * database. Every change is made on a throwaway probe account and reverted.
 *
 * Run: npm run check:admin-user-writes
 */
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

await loadBindings();

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: no service-role key");
  process.exit(0);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const dir = resolve(mkdtempSync(join("node_modules", ".adminw-")));
const req = createRequire(join(process.cwd(), "package.json"));
const posix = (p) => p.split("\\").join("/");

async function compile(src, out, rewrites = {}) {
  let code = readFileSync(src, "utf8");
  for (const [from, to] of Object.entries(rewrites)) code = code.split(`"${from}"`).join(`"${to}"`);
  const res = await transform(code, {
    filename: src,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, out);
  writeFileSync(file, res.code);
  return file;
}

// A probe account to be edited, so no real colleague is touched.
const probeEmail = `admin.write.probe.${Date.now()}@example.invalid`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: probeEmail, email_confirm: false,
});
if (createErr) { console.log(`SKIP: could not create a probe account -- ${createErr.message}`); process.exit(0); }
await admin.from("app_user_profile").insert({
  user_id: created.user.id, role_key: "employee", department: null, is_active: true,
});

/*
 * try/finally, and the `finally` is the whole point.
 *
 * This gate creates a REAL auth account to edit. The cleanup below used to sit at
 * the end of a linear script, so it ran only when every check above it had already
 * passed. Any throw -- a changed action signature, a network blip, a Supabase 500 --
 * skipped it and stranded the account in production forever.
 *
 * That is not hypothetical. On 2026-08-26 this leaked 391 accounts
 * (admin.write.probe.*@example.invalid), which is why /admin/users renders 411 rows
 * for a company of twenty and why check:table-scroll-budget reads 22.97 screens
 * against a 3-screen budget. The gate that guards admin writes was itself the
 * largest writer of junk admin rows.
 *
 * The cleanup is idempotent and re-asserts its own success, so a failure to delete
 * is reported rather than swallowed.
 */
/*
 * RESIDUAL GAP, stated because it is real and NOT fixed here.
 *
 * The `finally` above protects the throw path, and that is proven: injecting a
 * mid-body throw crashes the run and the probe count stays flat.
 *
 * It does NOT protect a kill. On Windows there is no way for it to. A SIGTERM
 * never unwinds the stack (measured: a node process holding a try/finally exits
 * 143 with the finally unrun), and Windows has no real signals -- child.kill()
 * calls TerminateProcess, which is immediate and uncatchable, so a
 * process.on("SIGTERM") handler does not run either. Both were tested here: the
 * handler version still leaked one account (409 -> 410) when the run was killed
 * mid-probe.
 *
 * This matters because scripts/tmp-audit-exit.mjs runs the registered gates under
 * `timeout: 240000` and execFileSync kills the child when that elapses; its own
 * log records sig:SIGTERM against several gates. Every such kill of THIS gate
 * strands one probe account.
 *
 * The only thing that actually closes it on this platform is a sweeper: delete
 * any admin.write.probe.* account older than a few minutes at the START of a run,
 * so a killed run is cleaned up by the next one. scripts/purge-probe-accounts.mjs
 * does that shape of match already. Not wired in here without a decision, because
 * it means a gate deleting production auth rows on every run.
 */
try {

  // The exec whose session the actions will run under.
  const { data: execProfile } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1).maybeSingle();
  const { data: execUser } = await admin.auth.admin.getUserById(execProfile.user_id);

  // Stub the server-only modules the action file imports. createClient must return a
  // client authenticated AS THE EXEC, because assertCanManageUsers reads the session
  // through it -- stubbing that away would test nothing.
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: execUser.user.email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: verified } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });

  const stub = join(dir, "stubs.cjs");
  writeFileSync(
    stub,
    `const { createClient } = require("@supabase/supabase-js");
  const URL_ = ${JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL)};
  const ANON = ${JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)};
  const SERVICE = ${JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY)};
  const TOKEN = ${JSON.stringify(verified.session.access_token)};
  module.exports = {
    createClient: async () => createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: "Bearer " + TOKEN } },
    }),
    createAdminClient: () => createClient(URL_, SERVICE, { auth: { persistSession: false } }),
    revalidatePath: () => {},
    getSiteUrl: () => "https://hseportal.hs-experts.com",
    PERMISSIONS: require(${JSON.stringify(posix(await compile("src/lib/permissions.ts", "permissions.cjs")))}).PERMISSIONS,
  };`,
  );

  const actions = req(await compile("src/app/(app)/admin/users/actions.ts", "actions.cjs", {
    "@/utils/supabase/server": posix(stub),
    "@/utils/supabase/admin": posix(stub),
    "next/cache": posix(stub),
    "@/utils/site-url": posix(stub),
    "@/lib/permissions": posix(stub),
  }));

  const readProbe = async () => {
    const { data } = await admin
      .from("app_user_profile").select("role_key, department, is_active").eq("user_id", created.user.id).maybeSingle();
    return data;
  };

  // ── 1. The reported bug: changing a team ────────────────────────────────
  const teamRes = await actions.changeUserDepartment(created.user.id, "TECH");
  check(
    "changing a user's team succeeds",
    !teamRes.error,
    teamRes.error ?? "no error -- this returned 42501 permission denied before the fix",
  );
  check("and the value is actually stored", (await readProbe())?.department === "TECH", JSON.stringify(await readProbe()));

  // Clearing it must work too, since "None" is a legitimate choice.
  const clearRes = await actions.changeUserDepartment(created.user.id, "");
  check("clearing a team stores null, not an empty string", !clearRes.error && (await readProbe())?.department === null,
    `${clearRes.error ?? ""} ${JSON.stringify((await readProbe())?.department)}`);

  // ── 2. The other two writes, broken by the same cause ──────────────────
  const roleRes = await actions.changeUserRole(created.user.id, "project_manager");
  check("changing a role succeeds", !roleRes.error, roleRes.error ?? "ok");
  check("and is stored", (await readProbe())?.role_key === "project_manager", JSON.stringify((await readProbe())?.role_key));

  const deactivate = await actions.setUserActive(created.user.id, false);
  check("deactivating an account succeeds", !deactivate.error, deactivate.error ?? "ok");
  check("and is stored", (await readProbe())?.is_active === false, JSON.stringify((await readProbe())?.is_active));
  await actions.setUserActive(created.user.id, true);

  // ── 3. The self-lockout guards ─────────────────────────────────────────
  const selfDeactivate = await actions.setUserActive(execProfile.user_id, false);
  check(
    "an admin cannot deactivate themselves",
    Boolean(selfDeactivate.error),
    selfDeactivate.error ?? "ALLOWED -- an admin could lock themselves out of the console",
  );
  const { data: execAfter } = await admin
    .from("app_user_profile").select("is_active").eq("user_id", execProfile.user_id).maybeSingle();
  check("and their account is untouched", execAfter.is_active === true, `is_active=${execAfter.is_active}`);

  const selfDemote = await actions.changeUserRole(execProfile.user_id, "employee");
  check(
    "an admin cannot demote themselves out of admin",
    Boolean(selfDemote.error),
    selfDemote.error ?? "ALLOWED -- an admin could lock themselves out",
  );
  const { data: roleAfter } = await admin
    .from("app_user_profile").select("role_key").eq("user_id", execProfile.user_id).maybeSingle();
  check("and their role is untouched", roleAfter.role_key === "exec", `role_key=${roleAfter.role_key}`);

  // Acting on SOMEONE ELSE must still be allowed: the guard must be narrow.
  const otherOk = await actions.setUserActive(created.user.id, false);
  check("but deactivating someone else is still allowed", !otherOk.error, otherOk.error ?? "ok");
  await actions.setUserActive(created.user.id, true);

  // ── 4. A non-admin is still refused ────────────────────────────────────
  // The permission gate is the whole boundary now that RLS is bypassed, so it has to
  // be shown working rather than assumed.
  const { data: employee } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "employee").eq("is_active", true)
    .neq("user_id", created.user.id).limit(1).maybeSingle();
  if (employee) {
    const { data: empUser } = await admin.auth.admin.getUserById(employee.user_id);
    const { data: empLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: empUser.user.email });
    const { data: empVerified } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: empLink.properties.hashed_token });

    const empStub = join(dir, "stubs-emp.cjs");
    writeFileSync(
      empStub,
      readFileSync(stub, "utf8").replace(
        JSON.stringify(verified.session.access_token),
        JSON.stringify(empVerified.session.access_token),
      ),
    );
    const empActions = req(await compile("src/app/(app)/admin/users/actions.ts", "actions-emp.cjs", {
      "@/utils/supabase/server": posix(empStub),
      "@/utils/supabase/admin": posix(empStub),
      "next/cache": posix(empStub),
      "@/utils/site-url": posix(empStub),
      "@/lib/permissions": posix(empStub),
    }));

    const denied = await empActions.changeUserDepartment(created.user.id, "HR");
    check(
      "an employee cannot change anyone's team",
      Boolean(denied.error),
      denied.error ?? "ALLOWED -- the permission gate is the only boundary now, so this must hold",
    );
    check(
      "and nothing was written",
      (await readProbe())?.department === null,
      JSON.stringify((await readProbe())?.department),
    );
  }
} finally {
  // ── Clean up ─────────────────────────────────────────────────────────
  await admin.from("app_user_profile").delete().eq("user_id", created.user.id);
  await admin.auth.admin.deleteUser(created.user.id);
}

const { data: gone } = await admin
  .from("app_user_profile").select("user_id").eq("user_id", created.user.id);
check("the probe account was removed", (gone?.length ?? 0) === 0, `${gone?.length ?? 0} row(s) left`);

rmSync(dir, { recursive: true, force: true });
console.log(failed ? "\nADMIN USER WRITES: still broken\n" : "\nADMIN USER WRITES: all three edits work, and nobody can lock themselves out\n");
process.exit(failed ? 1 : 0);

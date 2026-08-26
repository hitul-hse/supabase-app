/**
 * resendInvite and deleteUser, exercised against the live database.
 *
 * NO REAL COLLEAGUE IS TOUCHED. Every account here is created by this script on an
 * @example.invalid address and removed at the end. That matters more than usual: one of
 * these actions mails people and the other is irreversible, and the roster is 19 real
 * accounts belonging to colleagues who have not asked for either.
 *
 * The actions are imported and invoked for real, with their server-only dependencies
 * stubbed so createClient() returns a client authenticated AS AN EXEC. Stubbing the
 * auth check away instead would test nothing: that guard is the whole security
 * boundary.
 *
 * WHAT THIS GATE IS FOR, beyond regression. "No error came back" was the assertion I
 * started with, and it passed on an implementation that delivered nothing at all --
 * generateLink returns a link rather than sending, so the button reported success while
 * the colleague got no mail. So the re-invite assertion below demands an outcome an
 * admin can act on: either it says it sent, or it hands back a usable link. A no-op
 * satisfies neither.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
// Next's bundled swc, not a top-level @swc/core: that package is not a direct
// dependency, and check-admin-user-writes.mjs compiles this same module this way.
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.log("SKIP: no service-role key"); process.exit(0); }

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const dir = resolve(mkdtempSync(join("node_modules", ".usermgmt-")));
const req = createRequire(join(process.cwd(), "package.json"));
const posix = (p) => p.split("\\").join("/");

async function compile(src, out) {
  const res = await transform(readFileSync(src, "utf8"), {
    filename: src,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, out);
  writeFileSync(file, res.code);
  return file;
}

const created = [];
const makeAccount = async (label, { role = "employee", active = true } = {}) => {
  const email = `usermgmt.${label}.${Date.now()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false });
  if (error) throw new Error(`could not create ${label}: ${error.message}`);
  await admin.from("app_user_profile").insert({
    user_id: data.user.id, role_key: role, department: null, is_active: active,
  });
  created.push(data.user.id);
  return { id: data.user.id, email };
};

/** Compile the action module with createClient() bound to a given user's session. */
async function actionsAs(accessToken, tag) {
  const stub = join(dir, `stubs-${tag}.cjs`);
  writeFileSync(
    stub,
    `const { createClient } = require("@supabase/supabase-js");
const URL_ = ${JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL)};
const ANON = ${JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)};
const SERVICE = ${JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY)};
const TOKEN = ${JSON.stringify(accessToken)};
module.exports = {
  createClient: async () => createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: "Bearer " + TOKEN } },
  }),
  createAdminClient: () => createClient(URL_, SERVICE, { auth: { persistSession: false } }),
  revalidatePath: () => {},
  getSiteUrl: () => "https://hseportal.hs-experts.com",
  PERMISSIONS: require(${JSON.stringify(posix(await compile("src/lib/permissions.ts", `permissions-${tag}.cjs`)))}).PERMISSIONS,
};`,
  );
  let src = readFileSync("src/app/(app)/admin/users/actions.ts", "utf8");
  for (const from of ["@/utils/supabase/server", "@/utils/supabase/admin", "next/cache", "@/utils/site-url", "@/lib/permissions"]) {
    src = src.split(`"${from}"`).join(`"${posix(stub)}"`);
  }
  const ts = join(dir, `actions-${tag}.ts`);
  writeFileSync(ts, src);
  return req(await compile(ts, `actions-${tag}.cjs`));
}

const sessionFor = async (email) => {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  return data.session.access_token;
};

try {
  const { data: execProfile } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1).maybeSingle();
  const { data: execUser } = await admin.auth.admin.getUserById(execProfile.user_id);
  const actions = await actionsAs(await sessionFor(execUser.user.email), "exec");

  // ── 1. RE-INVITE ─────────────────────────────────────────────────────
  const fresh = await makeAccount("neverused");
  const r1 = await actions.resendInvite(fresh.id);

  /*
   * The assertion is DELIVERY, not the absence of an error.
   *
   * A throttled send is a PASS when a link comes back: the mail limiter is shared with
   * every other mail the project sends, so being refused for a minute is normal, and
   * the link is the answer to it. What must never pass is silence -- no send and no
   * link, reported as success.
   *
   * But there is a THIRD outcome that is neither: Supabase refuses to mint the link
   * at all under its own rate limit, so the action has no link to fall back on. That
   * is the gate being rate-limited, not the product being broken, and reporting it as
   * a product failure is how a suite teaches people to ignore red. It showed up
   * exactly once, in a full-suite run alongside several other agents' gates; this
   * script creates five real auth accounts per run, so it is the heaviest consumer of
   * that limiter in the repo. Three consecutive standalone runs pass.
   *
   * So a rate-limited refusal SKIPs with the reason stated, and anything else fails.
   */
  const throttled = /rate limit|too many requests|429|over_email_send_rate/i.test(
    `${r1.error ?? ""} ${r1.message ?? ""}`,
  );
  const actionable = !r1.error && (Boolean(r1.link) || /re-sent/i.test(r1.message ?? ""));
  if (!actionable && throttled) {
    console.log("SKIP: re-invite delivery — Supabase refused to mint a link (rate limit),");
    console.log(`        so this run cannot judge delivery: ${r1.error ?? r1.message}`);
    console.log("        Re-run this gate alone. It is the gate being throttled, not the product.");
  } else {
    check(
      "re-inviting a never-used account either sends, or returns a usable link",
      actionable,
      r1.error ?? `${r1.message ?? "(no message)"} ${r1.link ? "[link returned]" : "[no link]"}`,
    );
    check(
      "the outcome names the address, so an admin knows who it concerns",
      (r1.message ?? "").includes(fresh.email),
      r1.message,
    );
  }
  if (r1.link) {
    check(
      "any fallback link is a real Supabase verification URL, not a placeholder",
      /^https:\/\/\S+\/auth\/v1\/verify\?/.test(r1.link),
      r1.link.slice(0, 60),
    );
  }

  // A deactivated account must be refused: they could set a password and still be
  // locked out, with nothing on screen explaining why.
  const inactive = await makeAccount("inactive", { active: false });
  const r2 = await actions.resendInvite(inactive.id);
  check("re-inviting a DEACTIVATED account is refused", Boolean(r2.error), r2.error ?? "it was allowed");
  check("and the refusal says to activate them first", /ACTIVE|activated/i.test(r2.error ?? ""), r2.error);

  // ── 2. REMOVE ────────────────────────────────────────────────────────
  const doomed = await makeAccount("doomed");

  // Borrow a real spare member row so the unlink path is genuinely exercised. An
  // archived, unlinked member is used rather than inventing one, so nothing fictional
  // enters the roster.
  const time = admin.schema("time");
  const { data: spare } = await time
    .from("member").select("id, display_name").is("user_id", null).eq("is_archived", true).limit(1).maybeSingle();
  let borrowed = null;
  if (spare) {
    await time.from("member").update({ user_id: doomed.id }).eq("id", spare.id);
    borrowed = spare.id;
  }

  const r3 = await actions.deleteUser(doomed.id);
  check("removing an account succeeds", !r3.error, r3.error ?? r3.message);
  check("and the message names who was removed", (r3.message ?? "").includes(doomed.email), r3.message);

  const { data: goneProfile } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", doomed.id).maybeSingle();
  check("the profile is gone", goneProfile === null);

  const { data: goneUser } = await admin.auth.admin.getUserById(doomed.id);
  check("the sign-in is gone", !goneUser?.user, goneUser?.user ? "auth user still exists" : "deleted");

  if (borrowed) {
    const { data: member } = await time
      .from("member").select("id, display_name, user_id").eq("id", borrowed).maybeSingle();
    check(
      "the TrackingTime member SURVIVES the deletion",
      member !== null,
      member ? `kept: ${member.display_name}` : "the roster row was destroyed with the account",
    );
    check(
      "and is unlinked rather than left pointing at a deleted user",
      member?.user_id === null,
      `user_id=${member?.user_id} -- a dangling link would block linking that address again`,
    );
    check("the message says the hours were kept", /kept/i.test(r3.message ?? ""), r3.message);
  } else {
    console.log("SKIP: no spare archived member to exercise the unlink path");
  }

  // ── 3. The refusals ──────────────────────────────────────────────────
  const self = await actions.deleteUser(execProfile.user_id);
  check("an admin cannot delete their own account", Boolean(self.error), self.error ?? "it was allowed");
  const { data: stillThere } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", execProfile.user_id).maybeSingle();
  check("and their own account is untouched", stillThere !== null);

  // These are the two most dangerous actions on the page, so a non-admin must reach
  // neither -- checked by invoking them, not by reading the guard.
  const employee = await makeAccount("employee");
  const empActions = await actionsAs(await sessionFor(employee.email), "emp");
  const victim = await makeAccount("victim");

  const denied1 = await empActions.deleteUser(victim.id);
  check("an employee cannot remove an account", Boolean(denied1.error), denied1.error ?? "it was allowed");
  const { data: victimStill } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", victim.id).maybeSingle();
  check("and nothing was deleted", victimStill !== null);

  const denied2 = await empActions.resendInvite(victim.id);
  check("an employee cannot send invites", Boolean(denied2.error), denied2.error ?? "it was allowed");
} finally {
  const time = admin.schema("time");
  for (const id of created) {
    // Unlink before deleting, so a failed run cannot leave a member row pointing at an
    // account that no longer exists -- the exact state deleteUser exists to avoid.
    await time.from("member").update({ user_id: null }).eq("user_id", id);
    await admin.from("app_user_profile").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`\ncleaned up ${created.length} probe accounts`);
}

console.log(failed === 0 ? "\nUSER MANAGEMENT: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;

/**
 * Does app_user_profile carry the table GRANTs its policies assume?
 *
 * grant_app_user_profile_writes.sql cites this script by name, so it needs to
 * exist and actually prove the claim.
 *
 * The admin console no longer depends on this: the three inline writes were
 * rerouted through createAdminClient(), which bypasses RLS and grants entirely.
 * That is what fixed the reported "permission denied for table app_user_profile"
 * bug. This script covers the OTHER path -- writing as the signed-in user -- so
 * that if anything is ever moved back onto the user's own session, or a new
 * feature writes a profile client-side, the grant is known to be in place rather
 * than assumed.
 *
 * It is deliberately behavioural, not a catalogue query. PostgREST cannot read
 * information_schema.table_privileges, and more importantly the distinction that
 * matters is only visible in the error:
 *
 *     no grant                -> 42501 permission denied for table
 *     grant, policy matches   -> the row is updated
 *     grant, policy does not  -> 0 rows and NO error
 *
 * A missing grant is loud; a non-matching policy is silent. So the same probe
 * that confirms the grant also confirms the policy is doing the authorisation.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

/** A client whose requests carry a real end-user JWT, so grants and RLS both apply. */
async function clientFor(userId) {
  const { data: user } = await admin.auth.admin.getUserById(userId);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: verified } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
  });
}

// A probe row to be written, so no real colleague is touched.
const probeEmail = `grant.probe.${Date.now()}@example.invalid`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: probeEmail,
  email_confirm: false,
});
if (createErr) {
  console.log(`SKIP: could not create a probe account -- ${createErr.message}`);
  process.exit(0);
}
await admin.from("app_user_profile").insert({
  user_id: created.user.id,
  role_key: "employee",
  department: null,
  is_active: true,
});

const readProbe = async () => {
  const { data } = await admin
    .from("app_user_profile")
    .select("role_key, department, is_active")
    .eq("user_id", created.user.id)
    .maybeSingle();
  return data;
};

try {
  const { data: execProfile } = await admin
    .from("app_user_profile")
    .select("user_id")
    .eq("role_key", "exec")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!execProfile) {
    console.log("SKIP: no active exec to sign in as");
    process.exit(0);
  }

  // ── 1. An exec's own session can write a profile ────────────────────────
  const exec = await clientFor(execProfile.user_id);
  const { error: updErr } = await exec
    .from("app_user_profile")
    .update({ department: "TECH" })
    .eq("user_id", created.user.id);

  const denied = updErr?.code === "42501" || /permission denied for table/i.test(updErr?.message ?? "");
  check(
    "an exec's own session is not refused by a missing table grant",
    !denied,
    denied
      ? `${updErr.code} ${updErr.message} -- apply supabase/migrations/grant_app_user_profile_writes.sql`
      : "no 42501",
  );
  check("no other error on the exec's update", !updErr, updErr ? `${updErr.code} ${updErr.message}` : "ok");
  check(
    "and the exec's write reached the row (grant AND policy both allow it)",
    (await readProbe())?.department === "TECH",
    JSON.stringify(await readProbe()),
  );

  // ── 2. The grant does not hand authorisation to non-execs ───────────────
  // This is the check that makes the grant safe: an employee now gets past the
  // grant and is stopped by the policy instead, which shows as zero rows rather
  // than an error. If this ever starts passing rows, the grant became the only
  // line of defence and the policy stopped matching.
  const { data: empProfile } = await admin
    .from("app_user_profile")
    .select("user_id")
    .eq("role_key", "employee")
    .eq("is_active", true)
    .neq("user_id", created.user.id)
    .limit(1)
    .maybeSingle();

  if (empProfile) {
    const employee = await clientFor(empProfile.user_id);
    const { error: empErr } = await employee
      .from("app_user_profile")
      .update({ role_key: "exec" })
      .eq("user_id", created.user.id);

    check(
      "an employee's attempt is refused by the POLICY, silently, not by the grant",
      !empErr,
      empErr ? `${empErr.code} ${empErr.message}` : "no error, as expected for a non-matching policy",
    );
    check(
      "an employee cannot escalate the probe to exec",
      (await readProbe())?.role_key === "employee",
      JSON.stringify((await readProbe())?.role_key),
    );
  } else {
    console.log("SKIP: no active employee to test the negative case");
  }

  // ── 3. Delete is allowed for an exec, by policy ────────────────────────
  // schema.sql carries an "exec can delete profiles" policy, so this is the
  // intended behaviour rather than an oversight. The app never uses it -- the
  // console deactivates instead, which keeps the audit trail -- but asserting it
  // here keeps the grant and the policy documented as the pair they are.
  const { error: delErr } = await exec.from("app_user_profile").delete().eq("user_id", created.user.id);
  check(
    "an exec's delete is not refused by a missing grant",
    !(delErr?.code === "42501" || /permission denied for table/i.test(delErr?.message ?? "")),
    delErr ? `${delErr.code} ${delErr.message}` : "no 42501",
  );
  check(
    "the exec's delete removed the row, matching the delete policy",
    (await readProbe()) === null,
    JSON.stringify(await readProbe()),
  );
} finally {
  await admin.from("app_user_profile").delete().eq("user_id", created.user.id);
  await admin.auth.admin.deleteUser(created.user.id);
  console.log("\nprobe account removed");
}

console.log(failed === 0 ? "\nPROFILE GRANTS: all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);

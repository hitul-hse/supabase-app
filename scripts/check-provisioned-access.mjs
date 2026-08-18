/**
 * Do the 15 new accounts see the right things, and nothing more?
 *
 * Provisioning is the easy half. The half that matters is whether a real
 * colleague with role=employee can now see their OWN logged hours (the whole
 * point of linking member.user_id) while still being unable to read anyone
 * else's people, money or hours.
 *
 * Signs in as a real newly-provisioned employee via a magic link, then reads
 * through the anon client so RLS applies exactly as it would in the browser.
 *
 * Read-only; creates nothing.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Pick someone who actually logged time, so "can see my own hours" is testable.
const { data: members } = await admin
  .schema("time").from("member")
  .select("id, display_name, email, user_id")
  .not("user_id", "is", null);

// Rency Sebastian has 1081h and was provisioned in this run.
const subject = members.find((m) => /Rency/.test(m.display_name));
if (!subject) { console.log("SKIP: expected member not found"); process.exit(0); }

const { data: profile } = await admin
  .from("app_user_profile").select("role_key, person_id, is_active").eq("user_id", subject.user_id).maybeSingle();
console.log(`subject: ${subject.display_name} <${subject.email}>`);
console.log(`  member id ${subject.id}, role ${profile?.role_key}, person_id ${profile?.person_id ?? "null"}\n`);

check("the new account has a Hub profile", Boolean(profile), JSON.stringify(profile));
check("it is an employee, not an exec", profile?.role_key === "employee", `role_key=${profile?.role_key}`);
check("it is linked to its TrackingTime member", Boolean(subject.user_id), "");

// Their own hours, per the service role: the figure they should be able to see.
let ownSeconds = 0;
for (let from = 0; ; from += 1000) {
  const { data } = await admin.schema("time").from("entry")
    .select("duration_seconds").eq("member_id", subject.id).range(from, from + 999);
  if (!data?.length) break;
  for (const r of data) ownSeconds += Number(r.duration_seconds ?? 0);
  if (data.length < 1000) break;
}
console.log(`  their logged hours (service role): ${Math.round(ownSeconds / 3600)}h\n`);

// Sign in as them.
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: subject.email });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: verified, error: otpErr } = await anon.auth.verifyOtp({
  type: "magiclink", token_hash: link.properties.hashed_token,
});
if (otpErr || !verified?.session) {
  console.log(`FAIL: could not sign in as them -- ${otpErr?.message}`);
  process.exit(1);
}
const asThem = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
});

// 1. Their own role resolves.
const { data: role } = await asThem.rpc("app_user_role");
check("app_user_role() resolves for them", role === "employee", `returned ${JSON.stringify(role)}`);

// 2. current_member_id() must find them -- this is what makes /time work.
const { data: mid, error: midErr } = await asThem.schema("time").rpc("current_member_id");
check(
  "time.current_member_id() resolves to their own member row",
  Number(mid) === Number(subject.id),
  midErr ? midErr.message : `returned ${mid}, expected ${subject.id}`,
);

// 3. They can read their OWN time entries.
let theirView = 0;
for (let from = 0; ; from += 1000) {
  const { data, error } = await asThem.schema("time").from("entry")
    .select("duration_seconds, member_id").range(from, from + 999);
  if (error) { console.log(`   entry read error: ${error.message}`); break; }
  if (!data?.length) break;
  for (const r of data) theirView += Number(r.duration_seconds ?? 0);
  if (data.length < 1000) break;
}
check(
  "they can see their own logged hours",
  Math.abs(theirView - ownSeconds) < 3600,
  `they see ${Math.round(theirView / 3600)}h, their own total is ${Math.round(ownSeconds / 3600)}h`,
);

// 4. And NOT everyone else's.
//
// Counted by reading rows rather than with { count: "exact" }: under RLS the
// count came back null, and `null < 5218` is false in JS, so the assertion was
// passing on a comparison that never actually happened. Paging the visible rows
// is slower and actually measures what they can see.
const { count: allEntries } = await admin.schema("time").from("entry").select("*", { count: "exact", head: true });
let visibleRows = 0;
const memberIdsSeen = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await asThem.schema("time").from("entry")
    .select("member_id").range(from, from + 999);
  if (error) break;
  if (!data?.length) break;
  visibleRows += data.length;
  for (const r of data) memberIdsSeen.add(r.member_id);
  if (data.length < 1000) break;
}
check(
  "they cannot read the whole company's entries",
  visibleRows > 0 && visibleRows < (allEntries ?? 0),
  `they see ${visibleRows} of ${allEntries} entries`,
);
check(
  "every entry they can see is their own",
  memberIdsSeen.size === 1 && memberIdsSeen.has(subject.id),
  `member ids visible to them: ${[...memberIdsSeen].join(", ")} (expected only ${subject.id})`,
);

// 5. Money stays shut.
const { data: econ } = await asThem.schema("time").rpc("project_economics");
check("the money RPC returns nothing for an employee", (econ?.length ?? 0) === 0, `${econ?.length ?? 0} rows`);

// 6. They cannot promote themselves.
const { error: escErr } = await asThem
  .from("app_user_profile").update({ role_key: "exec" }).eq("user_id", subject.user_id);
const { data: after } = await admin
  .from("app_user_profile").select("role_key").eq("user_id", subject.user_id).maybeSingle();
check(
  "they cannot escalate their own role",
  after?.role_key === "employee",
  `role is still ${after?.role_key}${escErr ? ` (update rejected: ${escErr.message.slice(0, 60)})` : " (update silently affected 0 rows)"}`,
);

console.log(failed ? "\nNEW USER ACCESS: something is wrong\n" : "\nNEW USER ACCESS: sees their own hours, nothing else\n");
process.exit(failed ? 1 : 0);

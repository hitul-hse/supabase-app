/*
 * Proves the rate-limit SKIP branch in check-user-management.mjs actually fires,
 * and — more importantly — that it does NOT swallow a real product failure.
 *
 * A "tolerate the flake" change is dangerous precisely because it is invisible
 * when correct: if the predicate were too broad, a genuine silent-failure bug
 * would SKIP forever and the gate would be decoration. So this replays the exact
 * predicate against the outcomes that matter.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("C:/Supabase/scripts/check-user-management.mjs", "utf8");

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures += 1; };

// The predicate, lifted verbatim from the gate so they cannot drift silently.
const m = /const throttled = \/([^/]+)\/i\.test\(/.exec(src);
check("the throttled predicate is present and parseable", Boolean(m));
if (!m) process.exit(1);
const re = new RegExp(m[1], "i");
console.log(`  predicate: /${m[1]}/i\n`);

const throttled = (r) => re.test(`${r.error ?? ""} ${r.message ?? ""}`);
const actionable = (r) => !r.error && (Boolean(r.link) || /re-sent/i.test(r.message ?? ""));
const verdict = (r) => (actionable(r) ? "PASS" : throttled(r) ? "SKIP" : "FAIL");

const cases = [
  // Real rate limits, in the wordings Supabase and PostgREST actually use.
  ["SKIP", { error: "email rate limit exceeded" }, "Supabase's own wording"],
  ["SKIP", { error: "For security purposes, you can only request this after 51 seconds." , message: "over_email_send_rate_limit" }, "error code form"],
  ["SKIP", { error: "429 Too Many Requests" }, "HTTP form"],

  // The healthy outcomes must still PASS.
  ["PASS", { message: "Invite re-sent to a@b.c" }, "a real send"],
  ["PASS", { message: "copy the one-time link", link: "https://x.supabase.co/auth/v1/verify?token=1" }, "throttled but a link came back — the documented fallback"],

  // THE ONES THAT MUST STILL FAIL. This is the whole point of the script: the
  // bug this gate exists to catch is "reported success, sent nothing".
  ["FAIL", { message: "Invite processed" }, "silence dressed as success — the original bug"],
  ["FAIL", { message: "" }, "no message at all"],
  ["FAIL", { error: "permission denied for table app_user_profile" }, "an RLS regression"],
  ["FAIL", { error: "Could not find the user" }, "a lookup bug"],
  ["FAIL", { error: "TypeError: cannot read properties of undefined" }, "a crash"],
];

for (const [want, r, why] of cases) {
  const got = verdict(r);
  check(`${want.padEnd(4)} <- ${why}`, got === want, got === want ? "" : `got ${got}`);
}

console.log(failures === 0
  ? "\nThe SKIP is narrow: it absorbs rate limits and nothing else."
  : `\n${failures} case(s) misclassified — the predicate is wrong`);
process.exit(failures === 0 ? 0 : 1);

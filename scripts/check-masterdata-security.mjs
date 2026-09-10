/**
 * The masterdata pipeline's security properties, pinned where a regex could not
 * pin them.
 *
 * WHY A SECOND GATE BESIDE check-masterdata-drop.mjs
 * --------------------------------------------------
 * The pipeline that shipped on 2026-09-10 (PRs #66 and #68) went live without a
 * security pass; HSEHU-74 is that pass. check-masterdata-drop.mjs already
 * asserts twenty-four properties of the same files and every one of them still
 * holds. What it cannot do is assert ORDER, EXHAUSTIVENESS or ABSENCE, because
 * each of its assertions is a regex asking "does this text appear somewhere".
 * Four regressions were demonstrated slipping past it during the review
 * (docs/security/2026-09-10-masterdata-pipeline-review.md records the probes):
 *
 *   1. `console.error("secret was " + presented)` — the "never logs the secret"
 *      assertion only looks at console.log, so console.error/warn/info are free.
 *   2. `json(401, { error: `bad secret: got ${presented}` })` — the same
 *      assertion never looks at a RESPONSE body, only at a log line.
 *   3. `await supabase.from("app_user_profile").update({ role_key: "exec" })` —
 *      "writes only under the bucket prefix, never to a table" asserts that ONE
 *      bucket upload exists and that four schema names do not appear. Any table
 *      outside that list, or the same list in single quotes, is invisible.
 *   4. moving the secret check below `await req.arrayBuffer()` — `/return
 *      json\(401/` still matches wherever the check sits, so the function could
 *      buffer an unauthenticated 15 MB body and still pass.
 *
 * This gate asserts the properties positionally and exhaustively instead: the
 * secret check is FIRST, every `.from()` in the function names the bucket, and
 * no sink of any kind carries the secret identifiers.
 *
 * It also pins four things nothing pinned before: the Apps Script's OAuth
 * scopes as an exact allowlist rather than a substring pattern (the pattern
 * admitted gmail.readonly, contacts.readonly and admin.directory.user.readonly
 * — proven, see the review), the gateway JWT flag, the edge function's npm
 * dependency as an exact version, and the presence of every masterdata gate in
 * the assertion baseline.
 *
 * Static on purpose: source reading only, no credentials, so it runs on every
 * unattended cycle and on CI, where this pipeline's live halves cannot run at
 * all.
 */
import { readFileSync, existsSync } from "node:fs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (ok, label, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};
const read = (p) => readFileSync(p, "utf8");

const FN_PATH = "supabase/functions/masterdata-sheet-drop/index.ts";
const fn = read(FN_PATH);

/* ------------------------------------------------------------------ 1. order
 * The one property that decides whether an unauthenticated request can cost
 * anything: nothing happens before the shared secret is checked.
 *
 * Index comparison rather than a pattern, because the defect this catches is a
 * line MOVING, and a line that has moved still matches the pattern that found
 * it where it used to be.
 */
const at = (re, src = fn) => {
  const m = re.exec(src);
  return m ? m.index : -1;
};
const secretGuard = at(/if \(!\(await secretMatches\(presented, expected\)\)\) return json\(401/);
check(secretGuard > 0, "drop: the 401 guard is one statement — `if (!(await secretMatches(presented, expected))) return json(401`");

for (const [label, re] of [
  ["the body is read (req.arrayBuffer)", /req\.arrayBuffer\(\)/],
  ["a Supabase client is built (createClient)", /createClient\(/],
  ["any storage call is made (.storage.)", /\.storage\./],
  ["the sheet headers are validated (x-sheet-id)", /headers\.get\("x-sheet-id"\)/],
]) {
  const idx = at(re);
  check(
    secretGuard > 0 && idx > secretGuard,
    `drop: the secret is checked BEFORE ${label}`,
    idx < 0 ? "the compared statement is gone — re-read this gate" : `401 at ${secretGuard}, subject at ${idx}`,
  );
}

/* --------------------------------------------------------------- 2. the sinks
 * No log line and no response body may carry the presented or the expected
 * secret. Every sink is enumerated and every one is asserted, rather than one
 * pattern being asked whether it matches — which is how console.error and the
 * response body escaped the first gate.
 */
const SECRET_IDENTS = /\b(presented|expected)\b/;
const consoleSinks = [...fn.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1]);
const jsonSinks = [...fn.matchAll(/\bjson\(\s*\d{3}\s*,([\s\S]*?)\)\s*[;,)]/g)].map((m) => m[1]);
check(consoleSinks.length > 0, "drop: the gate found the function's log sinks to check", `${consoleSinks.length} console.* call(s)`);
check(jsonSinks.length > 0, "drop: the gate found the function's response sinks to check", `${jsonSinks.length} json() call(s)`);
const leakyLogs = consoleSinks.filter((s) => SECRET_IDENTS.test(s));
const leakyBodies = jsonSinks.filter((s) => SECRET_IDENTS.test(s));
check(leakyLogs.length === 0, "drop: NO console sink — log, error, warn, info or debug — carries the secret", leakyLogs.join(" | "));
check(leakyBodies.length === 0, "drop: NO response body carries the secret back to the caller", leakyBodies.join(" | "));
check(
  !/Deno\.env\.get\("MASTERDATA_DROP_SECRET"\)/.test(fn.slice(fn.indexOf("Deno.serve") + 400)),
  "drop: the secret is read once into `expected` and never re-read into a later expression",
);

/* ------------------------------------------------------- 3. reach, exhaustive
 * The function holds a SERVICE-ROLE client: it can read and write every table
 * and every bucket in the project. It needs four objects in one bucket. Assert
 * every reach it makes, not merely that four schema names are absent.
 */
const fromArgs = [...fn.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1].trim());
check(fromArgs.length > 0, "drop: the gate found the function's .from() calls to check", fromArgs.join(", "));
check(
  fromArgs.every((a) => a === "BUCKET"),
  "drop: EVERY .from() names the bucket constant — no table is reachable, whatever it is called or quoted",
  fromArgs.filter((a) => a !== "BUCKET").join(", "),
);
check(!/\.rpc\(/.test(fn), "drop: the function calls no RPC");
check(!/\.schema\(/.test(fn), "drop: the function selects no non-default schema");
check(!/auth\.admin|admin\.(createUser|deleteUser|listUsers|generateLink)/.test(fn), "drop: the function touches no auth admin API");
check(/BUCKET = "masterdata-sheet"/.test(fn) && /PREFIX = "V1"/.test(fn), "drop: the bucket and prefix are constants, not derived from a header");

/* ------------------------------------- 4. the immutable copy stays immutable
 * The dated archive object is the only thing in the bucket that a second POST
 * cannot rewrite. latest.xlsx, latest.json and heartbeat.json are all upsert
 * true by design. If the archive ever became upsertable, the bucket would keep
 * no record of what was actually delivered.
 */
check(
  /const stored = await put\(path, bytes, XLSX, false\)/.test(fn),
  "drop: the dated archive object is written with upsert=false — it can never be rewritten",
);

/* ------------------------------------ 5. the scope check stays an exact set
 * The manifest's own scopes are asserted by check-masterdata-drop.mjs, which is
 * where the Apps Script assertions live; duplicating the list here would give it
 * two homes that drift. What is asserted HERE is that the check keeps its SHAPE:
 * a set comparison against a named allowlist, never a substring pattern. That is
 * the property the review proved matters, because the pattern form admitted
 * gmail.readonly, contacts.readonly, calendar.readonly and
 * admin.directory.user.readonly — and, vacuously, an empty scope list.
 */
const dropGate = read("scripts/check-masterdata-drop.mjs");
/*
 * Comment lines are stripped before the "has it come back" test, because that
 * gate's comment QUOTES the defeated pattern in order to explain it -- and a
 * check that cannot tell the explanation from the code would forbid the file
 * from documenting its own history.
 */
const dropGateCode = dropGate.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
check(/const ALLOWED_SCOPES = \[/.test(dropGateCode), "check-masterdata-drop: the manifest is compared against a named ALLOWED_SCOPES list");
check(/sameSet\(scopes, ALLOWED_SCOPES\)/.test(dropGateCode), "check-masterdata-drop: the comparison is a SET equality, so an extra scope and a missing one both fail");
check(
  !/oauthScopes\.every\(/.test(dropGateCode),
  "check-masterdata-drop: the defeatable substring pattern has not come back into the code",
);

/* ------------------------------------- 6. every CLI refuses the wrong project
 * Three scripts in this pipeline open a database connection of their own. Each
 * must refuse when SUPABASE_DB_URL is not the project NEXT_PUBLIC_SUPABASE_URL
 * names. The importer and the promoter always did; the puller did not, and the
 * decision it makes on that connection — "is this export already staged?" —
 * sits ABOVE both guarded children, so a wrong-project answer made the job
 * print "nothing new to stage" and exit 0 while the warehouse went stale.
 *
 * The two library modules are deliberately absent from this list: they take an
 * injected `db` and open nothing, which is what lets the promote gate run the
 * identical code in PGlite.
 */
for (const script of [
  "scripts/pull-masterdata-sheet.mjs",
  "scripts/import-masterdata-sheet-staging.mjs",
  "scripts/promote-masterdata-sheet.mjs",
]) {
  const src = read(script);
  // The ref is parsed out of NEXT_PUBLIC_SUPABASE_URL with a regex literal, so
  // the SOURCE text reads `\.supabase\.co` -- backslashes and all. Match the
  // two operative facts instead of the escaped host: it derives the ref from
  // that variable, and it refuses when the connection string lacks it.
  const derivesRef = /NEXT_PUBLIC_SUPABASE_URL/.test(src) && /projectRef/.test(src);
  const refuses = /includes\(projectRef\)/.test(src);
  check(derivesRef && refuses, `${script}: refuses a database that is not the project NEXT_PUBLIC_SUPABASE_URL names`);
  check(/new pg\.Client\(/.test(src), `${script}: opens its own connection — so the guard above is the one that protects it`);
}
const pull = read("scripts/pull-masterdata-sheet.mjs");
check(
  /const sibling = \(name\) => fileURLToPath\(new URL\(name, import\.meta\.url\)\)/.test(pull)
  && !/spawnSync\(process\.execPath, \["scripts\//.test(pull),
  "pull: the importer and the promoter are resolved against this file, not against the working directory",
);
check(
  /const env = loadEnv\(\);\nconst MAX_HEARTBEAT_AGE_H = Number\(env\.MASTERDATA_MAX_HEARTBEAT_AGE_H/.test(pull),
  "pull: the dead-man switch threshold is read AFTER loadEnv, so setting it in .env.local is not silently ignored",
);

/* --------------------------------- 7. the drop secret's absence is explained
 * MASTERDATA_DROP_SECRET has three homes and check-secret-parity.mjs could not
 * reach any of them: its mechanism compares a hash of the rig's copy against a
 * registry of what was last pushed to GitHub ACTIONS, and this secret is not a
 * GitHub secret and should not become one. Putting it in MAPPED or in
 * PRESENCE_ONLY would turn that gate red forever. So it is NAMED in a third,
 * printed-only list — because the gate's own rule is that "an unexplained
 * absence from this list is indistinguishable from an oversight".
 */
const parity = read("scripts/check-secret-parity.mjs");
check(/MASTERDATA_DROP_SECRET/.test(parity), "check-secret-parity: the drop secret is named, so its absence from the comparison is stated rather than assumed");
check(
  !/^\s*"MASTERDATA_DROP_SECRET",\s*$/m.test(parity),
  "check-secret-parity: it is NOT in MAPPED — it has no GitHub Actions home to compare against, and asserting one would be red forever",
);

/* ------------------------------------------------------------ 6. verify_jwt
 * index.ts documents "Authorization: Bearer <anon key> — the gateway's JWT
 * check (verify_jwt)" as a layer of the design. Nothing in the repository set
 * it: there was no supabase/config.toml, no deploy script and no workflow, so a
 * single `supabase functions deploy --no-verify-jwt` would have removed the
 * layer with nothing to notice. The flag is now pinned where a deploy reads it.
 *
 * What this CANNOT prove is the setting on the already-deployed function; that
 * is a dashboard fact and the review says so rather than implying otherwise.
 */
const CONFIG = "supabase/config.toml";
if (check(existsSync(CONFIG), `${CONFIG} exists — the gateway JWT check is pinned in the repo, not only in a comment`)) {
  const cfg = read(CONFIG);
  const block = /\[functions\.masterdata-sheet-drop\]([\s\S]*?)(?=\n\[|$)/.exec(cfg);
  check(Boolean(block), "config.toml: has a [functions.masterdata-sheet-drop] block");
  check(Boolean(block) && /verify_jwt\s*=\s*true/.test(block[1]), "config.toml: masterdata-sheet-drop pins verify_jwt = true");
}

/* ----------------------------------------------------- 7. the dependency pin
 * The function runs with the service-role key. Its one npm import decides what
 * that key is handed to. A floating `@2` range is resolved at DEPLOY time from
 * npm with no lockfile in the edge runtime, so any published 2.x — including a
 * compromised one — is what deploys next.
 */
const deno = JSON.parse(read("supabase/functions/masterdata-sheet-drop/deno.json"));
const imports = deno.imports ?? {};
const supaImport = imports["@supabase/supabase-js"] ?? "";
check(
  /^npm:@supabase\/supabase-js@\d+\.\d+\.\d+$/.test(supaImport),
  "deno.json: @supabase/supabase-js is pinned to an exact version, not a floating major",
  supaImport,
);
check(
  Object.values(imports).every((v) => !/@\d+$/.test(String(v))),
  "deno.json: no import resolves through a bare major range",
  Object.entries(imports).filter(([, v]) => /@\d+$/.test(String(v))).map(([k, v]) => `${k} -> ${v}`).join(", "),
);
/*
 * The same library is resolved twice in this repository — by npm for the Next
 * app, where package-lock.json records an exact version and an integrity hash
 * and `npm ci` refuses to drift from it, and by the edge runtime for this
 * function, where nothing records anything. Holding the two to one number makes
 * a bump a single reviewed decision instead of two that silently diverge.
 */
const lockVersion = JSON.parse(read("package-lock.json"))
  .packages?.["node_modules/@supabase/supabase-js"]?.version;
check(
  Boolean(lockVersion) && supaImport === `npm:@supabase/supabase-js@${lockVersion}`,
  "deno.json: the function's supabase-js is the same version package-lock.json pins for the app",
  `function ${supaImport || "(none)"} vs lock ${lockVersion || "(none)"}`,
);

/* -------------------------------------------------- 8. no credential committed
 * The repository is public. The pipeline's files carry a Supabase URL, a Drive
 * file id and the NAMES of two secrets; they must never carry a value.
 */
const PUBLIC_FILES = [
  FN_PATH,
  "supabase/functions/masterdata-sheet-drop/deno.json",
  "docs/masterdata/apps-script-push.gs",
  "docs/masterdata/apps-script-manifest.json",
  "scripts/pull-masterdata-sheet.mjs",
  "scripts/import-masterdata-sheet-staging.mjs",
  "scripts/promote-masterdata-sheet.mjs",
];
const CREDENTIAL_SHAPES = [
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "a JWT (anon or service-role key)"],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key"],
  [/postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]{6,}@/, "a connection string with a password"],
];
for (const file of PUBLIC_FILES) {
  const src = read(file);
  const hits = CREDENTIAL_SHAPES.filter(([re]) => re.test(src)).map(([, what]) => what);
  check(hits.length === 0, `no credential is committed in ${file}`, hits.join(", "));
}

/* ------------------------------------------- 9. the gates cannot silently thin
 * scripts/gates/assertion-baseline.json is what turns "the gate ran" into "the
 * gate still checked as much as it used to". Every masterdata gate was chained
 * into test:db on 2026-09-10 and NONE of them was recorded there, so any of
 * them could have dropped from eighty assertions to two and still read green.
 * All of them are static or PGlite-backed — they need no credentials, so their
 * counts are the same on a runner as on the rig, and a missing entry has no
 * excuse.
 */
const pkg = JSON.parse(read("package.json"));
const baseline = JSON.parse(read("scripts/gates/assertion-baseline.json"));
const chained = pkg.scripts["test:db"].split("&&").map((s) => s.trim().replace(/^npm run /, ""));
const masterdataGates = chained.filter((n) => /masterdata/.test(n));
check(masterdataGates.length >= 6, "package.json: every masterdata gate is chained into test:db", masterdataGates.join(", "));
const unbaselined = masterdataGates.filter((n) => !(n in (baseline.gates ?? {})) && !(n in (baseline.unstable ?? {})));
check(
  unbaselined.length === 0,
  "assertion-baseline: every masterdata gate has a recorded assertion count, so a thinned gate goes red",
  unbaselined.join(", "),
);

/* ---------------------------------------------------------------- 10. wired in */
check(pkg.scripts["check:masterdata-security"] === "node scripts/check-masterdata-security.mjs", "package.json: this gate is registered");
check(/check:masterdata-security/.test(pkg.scripts["test:db"]), "package.json: this gate is chained into test:db");

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);

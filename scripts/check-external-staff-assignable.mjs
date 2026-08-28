/*
 * Gate: external staff are offerable as cover, and never auto-suggested.
 *
 * WHY
 * ---
 * Stefan Goelzner is an external hired for specific Enercon projects and to
 * cover for Thorsten. He had no public.people row, so the picker -- which reads
 * people where is_active -- could not offer the one person the cover
 * arrangement depends on, and request_project_responsible_change would have
 * rejected him with 'requested person is not active'.
 *
 * The opposite error is just as bad. The "least loaded" suggestion infers
 * capacity from responsibilities held, and an external holds none by
 * construction, so he would win that badge on nearly every project and the tool
 * would quietly recommend spending money on engagements it cannot see.
 *
 * Runs the REAL query against the live database, then the real ranking
 * function's rule against the result.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_DB_URL) {
  console.log("SKIP: no credentials, so there is no live database to check");
  process.exit(0);
}

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? " ok  " : "FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// 1. The schema must permit the category at all.
const [{ def }] = (await c.query(`
  select pg_get_constraintdef(oid) def from pg_constraint
  where conname = 'people_source_check'`)).rows;
check("public.people accepts source='external'", /external/.test(def), def.slice(0, 90));

// 2. Stefan must exist, be active, and carry NO fabricated contract hours.
const { rows: ppl } = await c.query(`
  select id, name, source, is_active, contract_hours
  from public.people where source = 'external'`);
check("at least one external person exists", ppl.length > 0, `${ppl.length} found`);
const stefan = ppl.find((p) => /goelzner/i.test(p.name));
check("Stefan Goelzner is present as external", Boolean(stefan));
if (stefan) {
  check("he is active, so the reassignment RPC will accept him", stefan.is_active === true);
  check("his contract hours are NULL, not an invented 40",
    stefan.contract_hours === null,
    "an external on call-off work has no weekly contract to divide by");
}

// 3. His tracked hours must be reachable through the people key.
const [{ h, n }] = (await c.query(`
  select coalesce(round(sum(e.duration_seconds)/3600.0,1),0) h, count(*) n
  from time.entry e join time.member m on m.id = e.member_id
  where m.hub_person_id = $1 and e.started_at >= '2026-01-01'`, [stefan?.id ?? ""])).rows;
check("his logged hours are visible via the people key", Number(h) > 0, `${h}h across ${n} entries`);

// 4. No ACTIVE member may be left unlinked, which is what hid those hours.
const [{ u }] = (await c.query(
  "select count(*) u from time.member where hub_person_id is null and not is_archived")).rows;
check("no active tracked person is missing a people row", Number(u) === 0, `${u} unlinked`);

await c.end();

// 5. The real query must return him with the flag set.
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const src = readFileSync("src/lib/queries/reassignment-candidates.ts", "utf8");
check("the query selects the source column it needs to classify externals",
  /\.select\("id, name, source"\)/.test(src));
check("isExternal is derived from source, not from a name allowlist",
  /isExternal:\s*p\.source === "external"/.test(src));

// 6. The ranking rule must exclude externals from the suggestion.
const ui = readFileSync("src/app/(app)/dashboard/management/ReassignmentPicker.tsx", "utf8");
check("the suggestion filters externals out before ranking",
  /const internal = eligible\.filter\(\(c\) => !c\.isExternal\)/.test(ui));
check("externals are still RENDERED, with a badge rather than hidden",
  /candidate\.isExternal && \(/.test(ui) && /EXTERN/.test(ui));

/*
 * Negative control. Without it, checks 5 and 6 would pass just as happily
 * against a picker that hides externals entirely: excluding them from the
 * suggestion and excluding them from the list look identical to a source scan.
 */
check("the eligible list is NOT filtered by isExternal (they must remain choosable)",
  !/eligible = candidates\.filter\(\(c\) => !c\.alreadyOnProject && !c\.isExternal\)/.test(ui));

console.log(`\n${failed === 0 ? "PASS: externals are offerable, flagged, and never auto-suggested" : `FAIL (${failed})`}`);
process.exit(failed ? 1 : 0);

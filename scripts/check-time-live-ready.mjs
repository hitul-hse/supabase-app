/**
 * Is the live database actually ready for the `time` module?
 *
 * Every other DB gate in this repo runs against PGlite built from schema.sql.
 * That proves the schema is *correct* and proves nothing about whether it has
 * been *applied*. The difference is not academic: at the time this check was
 * written, /time was merged, built, gated and green on all 30 suites, while on
 * the live project the `time` schema was not exposed to PostgREST at all and the
 * portal tile still pointed at /timesheets. Every user would have seen an empty
 * state, and nothing in CI could tell.
 *
 * So this asks the real project three questions:
 *   1. do the `time` tables exist and is the schema exposed to PostgREST,
 *   2. does the Time Tracking tile point at the page that exists,
 *   3. is there any data behind it yet.
 *
 * Read-only: it issues SELECTs and nothing else.
 *
 * Deliberately SKIPS rather than fails without credentials. CI has no service
 * key, and a check that goes red for a missing secret trains people to ignore
 * it. It is a deploy-readiness probe for a developer or a deploy step, not a
 * unit test -- which is why it is not in the test:db chain.
 */
import { readFileSync, existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local — nothing to probe");
  process.exit(0);
}

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();

const url = get("NEXT_PUBLIC_SUPABASE_URL");
// Prefer the service key so "does this object exist" is not confused with "may
// anon read it", but fall back to anon: RLS denial still returns 200, so the
// schema-exposure question is answerable either way.
const key = get("SUPABASE_SERVICE_ROLE_KEY") || get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!url || !key) {
  console.log("SKIP: no Supabase URL/key in .env.local");
  process.exit(0);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
let notReady = 0;
const report = (ok, name, detail = "") => {
  console.log(`${ok ? "READY    " : "NOT READY"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) notReady++;
};

console.log(`live project: ${url}\n`);

// ── 1. Is the `time` schema reachable through the API? ─────────────────────
// PostgREST only serves a schema listed in its exposed-schemas setting. A
// missing schema answers 406/PGRST106, which is a configuration fact rather
// than a SQL error, so it cannot be fixed by re-running schema.sql alone.
let schemaExposed = true;
for (const table of ["member", "entry", "service", "week_summary"]) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, "Accept-Profile": "time" },
  });
  const ok = res.status === 200;
  let hint = "";
  if (!ok) {
    const body = await res.json().catch(() => ({}));
    hint = `${res.status} ${body.code ?? ""} ${body.message ?? ""}`.trim();
    if (body.code === "PGRST106") schemaExposed = false;
  }
  report(ok, `time.${table} is reachable`, hint);
}

// `raw` is checked here too, even though this file is named for the time module.
// The importer writes the landing zone through the same API, so an unexposed
// `raw` stops data ever arriving -- which surfaces as an empty /time page and
// would otherwise be diagnosed as a bug in this module rather than a missing
// deploy step one layer upstream.
let rawExposed = true;
{
  const res = await fetch(`${url}/rest/v1/sync_run?select=*&limit=1`, {
    headers: { ...headers, "Accept-Profile": "raw" },
  });
  const ok = res.status === 200;
  if (!ok) {
    const body = await res.json().catch(() => ({}));
    if (body.code === "PGRST106") rawExposed = false;
    report(false, "raw.sync_run is reachable (needed by the importer)",
      `${res.status} ${body.code ?? ""} ${body.message ?? ""}`.trim());
  } else {
    report(true, "raw.sync_run is reachable (needed by the importer)");
  }
}

if (!schemaExposed || !rawExposed) {
  const missing = [!rawExposed && "raw", !schemaExposed && "time"].filter(Boolean);
  console.log(
    `\n  FIX: expose ${missing.join(" and ")} to PostgREST. Either route works.\n` +
      "\n" +
      "    (a) Dashboard -> Integrations -> Data API -> Settings -> 'Exposed schemas'\n" +
      "        (this MOVED; it used to be Project Settings -> API, and Supabase's\n" +
      "         own docs still say so. Some projects show it as Project Settings\n" +
      "         -> Data API.) Set the field to:\n" +
      "          public, graphql_public, raw, time\n" +
      "\n" +
      "    (b) Or run this in the SQL Editor:\n" +
      "          alter role authenticator\n" +
      "            set pgrst.db_schemas = 'public, graphql_public, raw, time';\n" +
      "          notify pgrst, 'reload config';\n" +
      "          notify pgrst, 'reload schema';\n" +
      "        Trade-off: this takes exposed-schema management away from the\n" +
      "        dashboard UI. Undo with:\n" +
      "          alter role authenticator reset pgrst.db_schemas;\n" +
      "        It REPLACES the list, so public and graphql_public must stay in it.\n" +
      "\n" +
      "       The tables can exist and be correct while staying invisible to the\n" +
      "       client until this is set -- PGRST106 rejects the schema NAME before\n" +
      "       it looks at any table, so it is NOT evidence the DDL failed to apply.\n" +
      "       See docs/architecture/MODULE-GO-LIVE.md.",
  );
}

// The probes above all use the SERVICE key, which bypasses both grants and RLS.
// They prove the objects exist and the schema is exposed to the API. They do not
// prove a signed-in user can read them: if `authenticated` lacked USAGE on the
// schema, every logged-in user would get 42501 and see an empty page -- which is
// indistinguishable from "no time tracked", the exact silent failure this file
// exists to catch. Anon cannot answer it either, being correctly granted nothing.
//
// Rather than imply a check it cannot perform, say so and name what does cover it:
//   check-time-rls.mjs      asserts the grants against real Postgres
//   npm run check:acceptance drives a signed-in browser end to end
if (schemaExposed) {
  console.log(
    "\n  NOTE: these probes use the service key, so they cannot see whether the" +
      "\n        `authenticated` role holds USAGE on `time`. If a signed-in user" +
      "\n        sees an empty /time while this check is green, that grant is the" +
      "\n        first thing to check. check-time-rls.mjs and check:acceptance" +
      "\n        cover it directly.",
  );
}

// ── 2. Does the portal tile point at the page that exists? ─────────────────
const tileRes = await fetch(
  `${url}/rest/v1/app_module?select=module_key,display_name,href,is_live&module_key=eq.time`,
  { headers },
);
const tile = tileRes.status === 200 ? (await tileRes.json())[0] : null;

if (!tile) {
  report(false, "the TrackingTime tile exists", `app_module unreadable (${tileRes.status})`);
} else {
  // The destination is the organisation dashboard, not the personal tracker.
  // A tile still on /time is not a cosmetic wart: everyone entering through
  // the portal lands on their own week and never reaches the company report.
  report(
    tile.href === "/time/dashboard",
    "the TrackingTime tile points at /time/dashboard",
    `href=${tile.href}`,
  );
  report(
    tile.display_name === "TrackingTime API Dashboard",
    'the tile is named "TrackingTime API Dashboard"',
    `display_name=${tile.display_name}`,
  );
  if (tile.href === "/timesheets" || tile.href === "/time") {
    console.log(
      "\n  FIX: the seed uses `on conflict do nothing`, so it cannot correct an\n" +
        "       existing row. Run the repair statements from supabase/schema.sql:\n" +
        "         update app_module set href = '/time/dashboard',\n" +
        "                display_name = 'TrackingTime API Dashboard'\n" +
        "          where module_key = 'time';",
    );
  }
}

// ── 3. Is there anything behind it? ────────────────────────────────────────
// Not a failure: an exposed-but-empty module is the correct state before the
// first import. Reported so "empty page" is never a mystery.
if (schemaExposed) {
  const counts = {};
  for (const table of ["member", "entry", "service"]) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers: { ...headers, "Accept-Profile": "time", Prefer: "count=exact" },
    });
    counts[table] = res.headers.get("content-range")?.split("/")[1] ?? "?";
  }
  console.log(
    `\ndata: ${counts.member} members, ${counts.entry} entries, ${counts.service} services`,
  );
  if (counts.entry === "0") {
    console.log("      (no entries yet — run `node scripts/import-trackingtime.mjs`)");
  }
}

console.log(
  notReady === 0
    ? "\nTIME MODULE: live and reachable"
    : `\nTIME MODULE: ${notReady} prerequisite(s) unmet — /time will render an empty state for every user`,
);
process.exit(notReady === 0 ? 0 : 1);

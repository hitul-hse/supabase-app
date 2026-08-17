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
    "\n  FIX: Supabase Dashboard -> Project Settings -> API -> 'Exposed schemas'.\n" +
      `       Add ${missing.join(" and ")} alongside public, i.e.\n` +
      "         public, graphql_public, raw, time\n" +
      "       The tables can exist and be correct while staying invisible to the\n" +
      "       client until this is set. See docs/architecture/MODULE-GO-LIVE.md.",
  );
}

// ── 2. Does the portal tile point at the page that exists? ─────────────────
const tileRes = await fetch(
  `${url}/rest/v1/app_module?select=module_key,href,is_live&module_key=eq.time`,
  { headers },
);
const tile = tileRes.status === 200 ? (await tileRes.json())[0] : null;

if (!tile) {
  report(false, "the Time Tracking tile exists", `app_module unreadable (${tileRes.status})`);
} else {
  report(
    tile.href === "/time",
    "the Time Tracking tile points at /time",
    `href=${tile.href}`,
  );
  if (tile.href === "/timesheets") {
    console.log(
      "\n  FIX: the seed uses `on conflict do nothing`, so it cannot correct an\n" +
        "       existing row. Run the repair statement from supabase/schema.sql:\n" +
        "         update app_module set href = '/time' where module_key = 'time';",
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

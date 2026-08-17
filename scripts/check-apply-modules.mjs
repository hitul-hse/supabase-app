/**
 * Is supabase/apply-modules.sql actually runnable, and in step with schema.sql?
 *
 * The file exists so somebody can bring the `raw` and `time` modules up on a
 * live database without re-running schema.sql (which dies on its unguarded
 * legacy policies). Two things must hold, and neither is obvious by reading:
 *
 *   1. It executes against a database that already has `public` -- the real
 *      situation. Testing it against an empty database would prove nothing,
 *      because the interesting failure is a dependency on something in public.
 *   2. It is byte-identical to what the generator produces from schema.sql, so
 *      the extract cannot silently drift from its source.
 *   3. It is re-runnable. Somebody will run it twice.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// ── 1. No drift from schema.sql ────────────────────────────────────────────
const committed = readFileSync("supabase/apply-modules.sql", "utf8");
execFileSync(process.execPath, ["scripts/generate-apply-modules.mjs"], { stdio: "pipe" });
const regenerated = readFileSync("supabase/apply-modules.sql", "utf8");
check(
  "apply-modules.sql matches what the generator produces from schema.sql",
  committed === regenerated,
  committed === regenerated ? "" : "run `node scripts/generate-apply-modules.mjs` and commit",
);

// ── 2. It runs on a database that already has `public` ─────────────────────
const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    -- service_role exists on every hosted Supabase project but not in PGlite.
    -- Without the stub, section 9's grants abort with 'role "service_role" does
    -- not exist' and every later assertion fails -- which reads as broken DDL
    -- when the only thing actually missing is this test fixture.
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

// Build the "already live" starting point: schema.sql up to but NOT including
// section 7. That is what the live project looks like right now.
const schema = readFileSync("supabase/schema.sql", "utf8");
const cut = schema.lastIndexOf("-- ---", schema.search(/^-- 7\. raw/m));
const publicOnly = schema.slice(0, cut);

const db = await new PGlite();
await db.exec(preamble);
await db.exec(publicOnly);

// Sanity: the starting point really lacks the module schemas, or the test below
// would pass for the wrong reason.
const { rows: pre } = await db.query(
  `select count(*)::int as n from information_schema.schemata where schema_name in ('raw','time')`,
);
check("the starting point has neither raw nor time", pre[0].n === 0, `found ${pre[0].n}`);

let ranClean = true;
try {
  await db.exec(readFileSync("supabase/apply-modules.sql", "utf8"));
} catch (e) {
  ranClean = false;
  check("apply-modules.sql executes against a public-only database", false, e.message);
}
if (ranClean) check("apply-modules.sql executes against a public-only database", true);

// ── 3. It created what /time needs ─────────────────────────────────────────
const { rows: schemas } = await db.query(
  `select schema_name from information_schema.schemata
    where schema_name in ('raw','time') order by schema_name`,
);
check(
  "both raw and time schemas now exist",
  schemas.length === 2,
  schemas.map((s) => s.schema_name).join(", "),
);

for (const t of ["member", "entry", "service", "customer", "project", "task", "member_rate"]) {
  const { rows } = await db.query(
    `select count(*)::int as n from information_schema.tables
      where table_schema='time' and table_name=$1`,
    [t],
  );
  check(`time.${t} exists`, rows[0].n === 1);
}

const { rows: views } = await db.query(
  `select table_name from information_schema.views where table_schema='time' order by table_name`,
);
check(
  "time.week_summary exists (the page's summary table reads it)",
  views.some((v) => v.table_name === "week_summary"),
  views.map((v) => v.table_name).join(", "),
);

// RLS must be on for every time table. A module brought up without it would be
// wide open to any authenticated user.
const { rows: unprotected } = await db.query(
  `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'time' and c.relkind = 'r' and not c.relrowsecurity`,
);
check(
  "RLS is enabled on every time table",
  unprotected.length === 0,
  unprotected.map((r) => r.relname).join(", ") || "all protected",
);

// ── 4. Re-runnable ─────────────────────────────────────────────────────────
let second = true;
try {
  await db.exec(readFileSync("supabase/apply-modules.sql", "utf8"));
} catch (e) {
  second = false;
  check("running it a second time is safe", false, e.message);
}
if (second) check("running it a second time is safe", true);

await db.close();

console.log(
  failed
    ? "\nAPPLY-MODULES: not safe to hand to somebody"
    : "\nAPPLY-MODULES: runnable on a live public-only database, and re-runnable",
);
process.exit(failed ? 1 : 0);

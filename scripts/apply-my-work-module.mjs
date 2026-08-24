/**
 * Apply the My Work portal tile, then prove every role can actually see it.
 *
 * WHY THE VERIFY HALF MATTERS MORE THAN THE INSERT
 * -----------------------------------------------
 * app_user_modules() only returns a module when the caller's role holds a
 * permission whose module_key matches. Get that wrong and the INSERT still
 * succeeds, `select * from app_module` still shows the row, and the tile is
 * invisible to everyone -- a failure that looks exactly like success from the
 * database side. So this runs app_user_modules() as each of the five roles and
 * asserts My Work is in the result.
 *
 * Idempotent (the migration is all upserts), so re-running is safe.
 *
 * Run: node scripts/apply-my-work-module.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const CONN = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!CONN) {
  console.log("SKIP: SUPABASE_DB_URL not set.");
  process.exit(0);
}

const db = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
await db.connect();

const MIGRATION = "supabase/migrations/20260824190000_add_my_work_module.sql";
await db.query("begin");
await db.query(readFileSync(MIGRATION, "utf8"));
await db.query("commit");
console.log("applied.\n");

const tile = await db.query("select * from app_module where module_key = 'my_work'");
console.log("tile row:", JSON.stringify(tile.rows[0] ?? null));

const grants = await db.query(
  "select role_key from app_role_permission where permission_key = 'my_work:read_own' order by role_key",
);
console.log(`granted to ${grants.rows.length} roles: ${grants.rows.map((r) => r.role_key).join(", ")}`);

console.log("\n=== does the tile actually surface, per role? ===");
// Replays app_user_modules()'s own predicate per role, rather than trusting the
// grant table: the join is where this silently fails.
const roles = await db.query("select role_key from app_role order by role_key");
let allOk = true;
for (const { role_key } of roles.rows) {
  const seen = await db.query(
    `select m.module_key, m.display_name, m.href, m.sort_order
     from app_module m
     where m.is_live and exists (
       select 1 from app_role_permission rp
       join app_permission p on p.permission_key = rp.permission_key
       where rp.role_key = $1 and p.module_key = m.module_key
     )
     order by m.sort_order`,
    [role_key],
  );
  const has = seen.rows.some((r) => r.module_key === "my_work");
  if (!has) allOk = false;
  console.log(
    `  ${role_key.padEnd(16)} ${has ? "SEES My Work" : "*** CANNOT SEE My Work ***"}  | tiles: ${seen.rows.map((r) => r.display_name).join(", ")}`,
  );
}

console.log(
  allOk
    ? "\nOK: every role sees the tile."
    : "\nFAILED: at least one role cannot see the tile; the module_key/permission join is wrong.",
);

await db.end();
process.exit(allOk ? 0 : 1);

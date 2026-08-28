// Read-only: what does the reassignment RPC require of a person?
// Writing a migration that adds external staff is pointless if the function
// that performs a handover rejects them.
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: fns } = await c.query(`
  select proname, pg_get_functiondef(oid) def
  from pg_proc
  where proname in ('request_project_responsible_change', 'decide_project_change_request')`);

for (const f of fns) {
  console.log(`=== ${f.proname} ===`);
  // Only the lines that constrain WHO may be assigned.
  for (const line of f.def.split("\n")) {
    if (/people|is_active|raise|exception|role|external/i.test(line)) {
      console.log("   " + line.trim().slice(0, 150));
    }
  }
  console.log();
}

const { rows: cons } = await c.query(`
  select conname, pg_get_constraintdef(oid) def
  from pg_constraint
  where conrelid in ('public.people'::regclass, 'public.project_responsibility'::regclass)`);
console.log("=== constraints on people / project_responsibility ===");
for (const c2 of cons) console.log(`   ${c2.conname}: ${c2.def.slice(0, 130)}`);

await c.end();

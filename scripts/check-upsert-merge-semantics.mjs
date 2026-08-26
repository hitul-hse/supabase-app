/*
 * Does a Supabase upsert with onConflict really NULL the columns you omit?
 *
 * The re-import warning rests entirely on this. If upsert merges instead of
 * replaces, the warning is wrong and I would be telling someone not to run a
 * safe script. If it replaces, a re-import silently erases 230 customer entity
 * links -- so the answer decides whether item 6 of the roadmap is advice or a
 * trap.
 *
 * PostgREST implements upsert as INSERT ... ON CONFLICT DO UPDATE with the
 * payload's columns, so the behaviour is a property of Postgres and reproducible
 * in PGlite. Testing it there rather than reasoning about it, and rather than
 * experimenting on 231 live rows.
 */
import { PGlite } from "@electric-sql/pglite";

const db = await new PGlite();
let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

await db.exec(`
  create table public.projects (
    id text primary key,
    name text not null,
    customer_legal_entity_id uuid,
    department text,
    budget_alert_percent integer not null default 80
  );
  insert into public.projects values
    ('10110_1', 'AWB order', '11111111-1111-1111-1111-111111111111', 'SAFETY', 90);
`);

const read = async () => (await db.query("select * from public.projects where id='10110_1'")).rows[0];
const before = await read();
console.log("before:", JSON.stringify(before), "\n");

/*
 * Exactly what PostgREST emits for
 *   .from("projects").upsert([{id, name}], { onConflict: "id" })
 * The payload names only id and name, so the SET list names only those.
 */
await db.exec(`
  insert into public.projects (id, name) values ('10110_1', 'AWB order')
  on conflict (id) do update set id = excluded.id, name = excluded.name
`);
const afterPartial = await read();
console.log("after upsert naming only (id, name):", JSON.stringify(afterPartial), "\n");

check("an omitted column is PRESERVED when the row already exists",
  afterPartial.customer_legal_entity_id === before.customer_legal_entity_id
    && afterPartial.department === before.department,
  "ON CONFLICT DO UPDATE only touches the columns in its SET list");

/*
 * So the real danger is narrower and worth stating precisely: the row survives,
 * but a payload that names a column with an undefined/absent JS value sends
 * NULL for it. The importer's payload includes `owner_person_id: owner?.id ?? null`
 * -- an explicit null -- which DOES overwrite.
 */
await db.exec(`
  insert into public.projects (id, name, department) values ('10110_1', 'AWB order', null)
  on conflict (id) do update set id = excluded.id, name = excluded.name, department = excluded.department
`);
const afterExplicitNull = await read();
console.log("after upsert naming department = null:", JSON.stringify(afterExplicitNull), "\n");
check("a column named with an explicit NULL IS overwritten",
  afterExplicitNull.department === null,
  "this is the real hazard: naming a column at all is enough to clear it");

/*
 * And the NOT NULL DEFAULT case, which is what I claimed about
 * budget_alert_percent. It is not reset either, for the same reason.
 */
check("a NOT NULL DEFAULT column keeps its value, it is not reset to the default",
  afterExplicitNull.budget_alert_percent === 90,
  `got ${afterExplicitNull.budget_alert_percent}, expected the stored 90 rather than the default 80`);

/* --------------------------------------------------------- the INSERT case */

// A genuinely new row is different: omitted columns take their default/NULL.
await db.exec(`
  insert into public.projects (id, name) values ('new_1', 'New order')
  on conflict (id) do update set id = excluded.id, name = excluded.name
`);
const fresh = (await db.query("select * from public.projects where id='new_1'")).rows[0];
check("a NEW row gets NULL/default for omitted columns (expected, not a bug)",
  fresh.customer_legal_entity_id === null && fresh.budget_alert_percent === 80);

console.log(failures === 0
  ? "\nUPSERT MERGES. The re-import warning must name the RIGHT hazard (see below)."
  : `\n${failures} problem(s)`);
console.log("\nCONCLUSION for docs/next-steps-2026-08-26.md item 6:");
console.log("  A re-import does NOT erase customer_legal_entity_id, department or");
console.log("  budget_alert_percent on EXISTING rows -- ON CONFLICT DO UPDATE only sets the");
console.log("  columns in the payload. My earlier warning overstated the risk.");
console.log("  What a re-import DOES do:");
console.log("    - overwrites every column the payload names, including with explicit nulls");
console.log("    - DELETEs and re-INSERTs person_assignments for all 231 project ids,");
console.log("      so any assignment not derivable from the workbook is lost");
console.log("    - leaves public.project_responsibility (288 rows) STALE, since the");
console.log("      importer never writes it; import-project-responsibility.mjs owns it");
console.log("    - creates rows for NEW order numbers with department and");
console.log("      customer_legal_entity_id unset, which then need re-linking");
process.exit(failures === 0 ? 0 : 1);

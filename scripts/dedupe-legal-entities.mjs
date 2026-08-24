/**
 * Dedupe crm.legal_entity: collapse duplicate canonical rows onto one survivor
 * using the table's OWN supersede mechanism (superseded_by_id + lifecycle_status
 * 'merged'). No rows are deleted, so referential history stays intact.
 *
 * Why this matters: a duplicated canonical row makes every roll-up join fan out.
 * `Addleshaw Goddard (Germany) LLP` x4 turned 231 projects into 237 join rows and
 * blocked 2 projects from resolving at all (the resolver refuses to guess between
 * identical candidates). That is the bug being fixed.
 *
 * Usage:
 *   node scripts\dedupe-legal-entities.mjs           # dry run (default)
 *   node scripts\dedupe-legal-entities.mjs --apply   # write, single transaction
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const APPLY = process.argv.includes("--apply");

function normName(s) {
  if (s == null) return "";
  let t = String(s).normalize("NFC").toLowerCase();
  t = t.replace(/\u00df/g, "ss").replace(/\u00e4/g, "ae").replace(/\u00f6/g, "oe").replace(/\u00fc/g, "ue");
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}
const LEGAL_FORMS = ["gmbh co kg","gmbh co kgaa","gmbh kg","ag co kg","gmbh","ag","kg","kgaa",
  "ug haftungsbeschraenkt","ug","ohg","gbr","se","ev","e v","mbh","mbb","partmbb","llp","ltd","limited",
  "llc","inc","corp","bv","b v","nv","sa","sarl","srl","spa","as","ab","oy","aps","sl","slu"];
function stripLegalForm(norm) {
  let t = ` ${norm} `, changed = true;
  while (changed) {
    changed = false;
    for (const f of LEGAL_FORMS) {
      const suf = ` ${f} `;
      if (t.endsWith(suf)) { t = t.slice(0, -f.length - 1); changed = true; }
    }
  }
  return t.trim();
}
const tokenKey = (n) => [...new Set(stripLegalForm(normName(n)).split(" ").filter(Boolean))].sort().join(" ");

/* ------------------------------------------------------------------ *
 * CURATED GROUP DECISIONS
 * Only groups listed here are merged. Anything else detected is REPORTED.
 * ------------------------------------------------------------------ */
const DECISIONS = [
  {
    match_norm: "addleshaw goddard germany llp",
    action: "merge",
    // Deterministic survivor: the row backing the LOWEST Lexware customer_number.
    // Stable across re-runs and independent of uuid ordering / created_at ties.
    survivor_rule: "lowest_lexware_customer_number",
    // Each duplicate carries an office identity that only exists as its alias.
    // Preserve it as a crm.location row on the survivor, so nothing is lost.
    preserve_as_locations: true,
    rationale:
      "One LLP = one legal person. All 4 rows share the identical legal_name, have NULL vat_id and NULL registration_number, and were created in the same import batch (2026-08-23T19:17:23.536Z). What actually distinguishes them is the OFFICE (Hamburg / Frankfurt / Muenchen / Berlin), visible only via their aliases and 4 separate Lexware billing accounts (10203, 10261, 10262, 10267). Offices are locations, not separate legal entities, so the correct model is one entity + 4 locations + 4 billing accounts. Merging is safe because no row holds conflicting register data.",
  },
];

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

/** Every FK pointing at crm.legal_entity, discovered from the catalog (not hardcoded). */
async function discoverReferences() {
  const r = await c.query(`
    select ns.nspname as schema_name, cl.relname as table_name,
           (select att.attname from unnest(con.conkey) k
              join pg_attribute att on att.attrelid=con.conrelid and att.attnum=k limit 1) as column_name
    from pg_constraint con
    join pg_class cl on cl.oid=con.conrelid
    join pg_namespace ns on ns.oid=cl.relnamespace
    where con.contype='f' and con.confrelid='crm.legal_entity'::regclass
      and array_length(con.conkey,1)=1
    order by 1,2`);
  return r.rows;
}

/** Unique constraints that include the FK column: repointing could collide there. */
async function uniqueGuards(schema, table, col) {
  const r = await c.query(`
    select con.conname,
           (select array_agg(att.attname::text order by att.attnum) from unnest(con.conkey) k
              join pg_attribute att on att.attrelid=con.conrelid and att.attnum=k) as cols
    from pg_constraint con
    where con.conrelid = format('%I.%I',$1::text,$2::text)::regclass
      and con.contype in ('u','p')`, [schema, table]);
  return r.rows.filter((x) => x.cols.includes(col));
}

async function findGroups() {
  // Only ACTIVE, not-yet-superseded rows can duplicate each other. Rows already
  // merged are history and must never be re-merged (keeps re-runs idempotent).
  const ents = (await c.query(`
    select id, legal_name, legal_form, vat_id, registration_number, country_code,
           lifecycle_status, review_status, superseded_by_id, external_source_id, created_at
    from crm.legal_entity
    where lifecycle_status = 'active' and superseded_by_id is null
    order by legal_name, created_at, id`)).rows;

  const exact = new Map(), token = new Map();
  for (const e of ents) {
    const n = normName(e.legal_name);
    if (!exact.has(n)) exact.set(n, []);
    exact.get(n).push(e);
    const t = tokenKey(e.legal_name);
    if (!t) continue;
    if (!token.has(t)) token.set(t, []);
    token.get(t).push(e);
  }
  const groups = [];
  for (const [k, rows] of exact) if (rows.length > 1) groups.push({ kind: "exact_name", key: k, rows });
  for (const [k, rows] of token) {
    if (rows.length < 2) continue;
    if (new Set(rows.map((r) => normName(r.legal_name))).size < 2) continue; // already an exact group
    groups.push({ kind: "near_miss", key: k, rows });
  }
  return { ents, groups };
}

async function refCounts(id, refs) {
  const out = [];
  for (const r of refs) {
    if (r.schema_name === "crm" && r.table_name === "legal_entity") continue; // self supersede link
    const q = await c.query(
      `select count(*)::int n from ${r.schema_name}.${r.table_name} where ${r.column_name} = $1`, [id]);
    if (q.rows[0].n > 0) out.push(`${r.schema_name}.${r.table_name}.${r.column_name}=${q.rows[0].n}`);
  }
  return out;
}

async function main() {
  await c.connect();
  console.log(APPLY ? "MODE: APPLY (writing, single transaction)"
                    : "MODE: DRY RUN (no writes; pass --apply to write)");

  const refs = await discoverReferences();
  console.log(`\n=== FK REFERENCES INTO crm.legal_entity (${refs.length}, from catalog)`);
  for (const r of refs) {
    const guards = await uniqueGuards(r.schema_name, r.table_name, r.column_name);
    console.log(`  ${r.schema_name}.${r.table_name}.${r.column_name}` +
      (guards.length ? `   [unique guard: ${guards.map((g) => g.cols.join("+")).join(", ")}]` : ""));
  }

  const { ents, groups } = await findGroups();
  console.log(`\n=== ENTITIES: ${ents.length}`);
  console.log(`=== DUPLICATE / NEAR-DUPLICATE GROUPS: ${groups.length}`);

  const plans = [];
  for (const g of groups) {
    console.log(`\n--- [${g.kind}] "${g.key}"  x${g.rows.length}`);
    const detail = [];
    for (const r of g.rows) {
      detail.push({
        id: r.id, legal_name: r.legal_name, legal_form: r.legal_form,
        vat_id: r.vat_id, reg_no: r.registration_number,
        lifecycle: r.lifecycle_status, superseded_by: r.superseded_by_id,
        referenced_by: (await refCounts(r.id, refs)).join(", ") || "(nothing)",
      });
    }
    console.table(detail);

    const d = DECISIONS.find((x) => x.match_norm === g.key);
    if (!d) {
      console.log(`  DECISION: REPORT ONLY - no curated decision for this group, NOT merging (would be a guess).`);
      continue;
    }
    if (d.action !== "merge") { console.log(`  DECISION: ${d.action}`); continue; }

    // Refuse to merge if rows disagree on hard register identity.
    const vats = new Set(g.rows.map((r) => r.vat_id).filter(Boolean));
    const regs = new Set(g.rows.map((r) => r.registration_number).filter(Boolean));
    if (vats.size > 1 || regs.size > 1) {
      console.log(`  DECISION: BLOCKED - rows disagree on vat_id(${[...vats]}) / registration_number(${[...regs]}). Different legal persons, needs a human.`);
      continue;
    }

    // Deterministic survivor selection.
    let survivor;
    if (d.survivor_rule === "lowest_lexware_customer_number") {
      const nums = await c.query(
        `select legal_entity_id, min(customer_number) cn from crm.lexware_customer
         where legal_entity_id = any($1::uuid[]) group by 1`, [g.rows.map((r) => r.id)]);
      const byId = new Map(nums.rows.map((r) => [r.legal_entity_id, r.cn]));
      const ranked = [...g.rows].sort((a, b) => {
        const an = byId.get(a.id) ?? "\uffff", bn = byId.get(b.id) ?? "\uffff";
        return an === bn ? String(a.id).localeCompare(String(b.id)) : String(an).localeCompare(String(bn));
      });
      survivor = ranked[0];
      console.log(`  survivor rule: ${d.survivor_rule} -> customer_number ${byId.get(survivor.id)}`);
    } else {
      survivor = [...g.rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    }
    const losers = g.rows.filter((r) => r.id !== survivor.id);
    console.log(`  DECISION: MERGE ${losers.length} row(s) into survivor ${survivor.id}`);
    console.log(`  why: ${d.rationale}`);
    plans.push({ group: g, decision: d, survivor, losers });
  }

  if (!plans.length) { console.log("\nNothing to merge."); await c.end(); return; }
  if (!APPLY) { console.log("\nDry run complete. No rows written."); await c.end(); return; }

  await c.query("begin");
  try {
    for (const p of plans) {
      const loserIds = p.losers.map((r) => r.id);

      // 1. Preserve office identity (only lives in the losers' aliases) as locations.
      if (p.decision.preserve_as_locations) {
        const al = await c.query(
          `select a.alias_text, le.legal_name
           from crm.legal_entity_alias a join crm.legal_entity le on le.id = a.legal_entity_id
           where a.legal_entity_id = any($1::uuid[])`, [[p.survivor.id, ...loserIds]]);
        for (const a of al.rows) {
          // The alias is "<canonical name> <City>"; the city is whatever trails the name.
          const city = normName(a.alias_text).startsWith(normName(a.legal_name))
            ? String(a.alias_text).trim().slice(String(a.legal_name).trim().length).trim()
            : "";
          if (city.length < 2) continue;
          const dup = await c.query(
            `select 1 from crm.location where legal_entity_id=$1 and coalesce(city,'')=$2`, [p.survivor.id, city]);
          if (dup.rowCount) continue;
          await c.query(
            `insert into crm.location (legal_entity_id, location_name, location_type, city, country_code,
                                        is_primary, review_status, review_reason)
             values ($1,$2,'OFFICE',$3,$4,false,'review_required',$5)`,
            [p.survivor.id, `${p.survivor.legal_name} ${city}`, city, p.survivor.country_code ?? "DE",
             "Derived from a duplicate crm.legal_entity row merged by scripts/dedupe-legal-entities.mjs; confirm address."]);
          console.log(`  + location ${city} on survivor`);
        }
      }

      // 2. Repoint every FK, honouring unique guards so we never violate one.
      for (const r of refs) {
        if (r.schema_name === "crm" && r.table_name === "legal_entity") continue;
        const guards = await uniqueGuards(r.schema_name, r.table_name, r.column_name);
        const tbl = `${r.schema_name}.${r.table_name}`;

        if (guards.length) {
          // Move only rows that would not collide with an existing survivor row.
          for (const g of guards) {
            const others = g.cols.filter((x) => x !== r.column_name);
            if (!others.length) continue;
            const on = others.map((x) => `t.${x} is not distinct from s.${x}`).join(" and ");
            const del = await c.query(
              `delete from ${tbl} t
               where t.${r.column_name} = any($1::uuid[])
                 and exists (select 1 from ${tbl} s where s.${r.column_name}=$2 and ${on})
               returning 1`, [loserIds, p.survivor.id]);
            if (del.rowCount) console.log(`  ~ ${tbl}: dropped ${del.rowCount} row(s) that would duplicate an existing survivor row under ${g.conname}`);
          }
        }
        const up = await c.query(
          `update ${tbl} set ${r.column_name} = $1 where ${r.column_name} = any($2::uuid[])`,
          [p.survivor.id, loserIds]);
        if (up.rowCount) console.log(`  -> ${tbl}.${r.column_name}: repointed ${up.rowCount} row(s)`);
      }

      // 3. Keep the losers' names reachable as aliases on the survivor.
      for (const l of p.losers) {
        if (normName(l.legal_name) !== normName(p.survivor.legal_name)) {
          const dup = await c.query(
            `select 1 from crm.legal_entity_alias where legal_entity_id=$1 and lower(alias_text)=lower($2)`,
            [p.survivor.id, l.legal_name]);
          if (!dup.rowCount) {
            await c.query(
              `insert into crm.legal_entity_alias (legal_entity_id, alias_text, alias_type, source_system,
                                                    lifecycle_status, review_status, review_reason)
               values ($1,$2,'MERGED_NAME','HSE HUB DEDUPE','active','review_required',$3)`,
              [p.survivor.id, l.legal_name, `Name of merged duplicate legal_entity ${l.id}.`]);
            console.log(`  + alias (merged name) ${l.legal_name}`);
          }
        }
      }

      // 4. Supersede, do not delete. This is the table's own mechanism.
      const sup = await c.query(
        `update crm.legal_entity
         set superseded_by_id = $1,
             lifecycle_status = 'merged',
             review_status    = 'review_required',
             review_reason    = $3,
             updated_at       = now()
         where id = any($2::uuid[])`,
        [p.survivor.id, loserIds,
         `Merged into ${p.survivor.id} by scripts/dedupe-legal-entities.mjs. ${p.decision.rationale}`]);
      console.log(`  = superseded ${sup.rowCount} duplicate row(s) -> ${p.survivor.id} (lifecycle_status='merged', nothing deleted)`);

      await c.query(
        `update crm.legal_entity set review_status='review_required',
           review_reason = coalesce(review_reason,'') || $2, updated_at = now() where id = $1`,
        [p.survivor.id, ` [Survivor of a ${p.group.rows.length}-way merge on ${new Date().toISOString()}; verify locations and billing accounts.]`]);
    }
    await c.query("commit");
    console.log("\ncommitted.");
  } catch (e) {
    await c.query("rollback");
    console.error(`\nROLLED BACK, no changes written: ${e.message}`);
    await c.end();
    process.exitCode = 1;
    return;
  }

  const after = await findGroups();
  const live = after.groups.filter((g) =>
    g.rows.filter((r) => r.lifecycle_status === "active").length > 1);
  console.log(`\n=== AFTER: active-row duplicate groups remaining: ${live.length}`);
  for (const g of live) console.log(`  ${g.kind} "${g.key}" x${g.rows.filter((r)=>r.lifecycle_status==='active').length}`);
  await c.end();
}

await main();

/**
 * Link public.projects.customer -> crm.legal_entity via crm.legal_entity_alias.
 *
 * PRODUCT.md: "All data joins go through canonical identity maps."
 * Therefore resolution is: normalise(projects.customer)
 *   -> crm.legal_entity.legal_name  (canonical)
 *   -> crm.legal_entity_alias.alias_text (curated identity map)
 * There is NO fuzzy matching at query time. Every non-exact link must exist
 * as an explicit, human-reviewable alias row.
 *
 * Usage:
 *   node scripts\link-project-customers.mjs            # dry run (default)
 *   node scripts\link-project-customers.mjs --apply    # write aliases/entities/backfill
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const APPLY = process.argv.includes("--apply");

/** Deterministic normalisation. Used ONLY to compare a source string against
 *  canonical names and curated aliases. Never used to invent a link. */
export function normName(s) {
  if (s == null) return "";
  let t = String(s).normalize("NFC").toLowerCase();
  t = t.replace(/\u00df/g, "ss")
       .replace(/\u00e4/g, "ae").replace(/\u00f6/g, "oe").replace(/\u00fc/g, "ue");
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 * CURATED DECISIONS
 * Each entry was derived from the 9 distinct unmatched customer strings.
 * kind: "alias"      -> attach source string to an existing legal_entity
 *       "new_entity" -> genuinely new company, create legal_entity (+alias if
 *                        the source spelling differs from the canonical name)
 *       "review"     -> ambiguous, DO NOT GUESS. Left unlinked, reported.
 * ------------------------------------------------------------------ */
export const DECISIONS = [
  {
    source: "Closer Go Germany Gmbh Stuttgart",
    kind: "alias",
    entity_legal_name: "Closer Go Germany GmbH",
    alias_type: "SOURCE_NAME",
    rationale:
      "City suffix + casing only ('Gmbh' vs 'GmbH', trailing ' Stuttgart'). Same precedent already curated in this table for 'RISE FX GmbH Stuttgart' and 'Addleshaw Goddard (Germany) LLP Hamburg'.",
  },
  {
    source: "ENERCON GmbH",
    kind: "new_entity",
    entity_legal_name: "ENERCON GmbH",
    legal_form: "GmbH",
    country_code: "DE",
    rationale:
      "No ENERCON row exists in crm.legal_entity and no near-miss candidate under legal-form stripping. Wind-energy manufacturer, unrelated to any existing 111 entities. Genuinely new.",
  },
  {
    source: "GEPLAHN-T GmbH",
    kind: "new_entity",
    entity_legal_name: "GEPLAHN-T GmbH",
    legal_form: "GmbH",
    country_code: "DE",
    rationale:
      "No GEPLAHN row exists in crm.legal_entity. Genuinely new company.",
  },
  {
    source: "GEPLAHN-T",
    kind: "alias",
    entity_legal_name: "GEPLAHN-T GmbH",
    alias_type: "SOURCE_NAME",
    rationale:
      "Same company as 'GEPLAHN-T GmbH', legal-form suffix simply omitted by the source system. Distinctive coined name, no other GEPLAHN entity exists, so the attachment is unambiguous.",
  },
  {
    source: "YPOG Partnerschaft von Rechtsanwälten",
    kind: "new_entity",
    entity_legal_name: "YPOG Partnerschaft von Rechtsanwälten mbB",
    legal_form: "PartmbB",
    country_code: "DE",
    rationale:
      "No YPOG row exists. This is the law-firm partnership arm. Kept SEPARATE from 'YPOG GmbH & Co. KG': German professional-services groups run the PartmbB (legal advice) and the GmbH & Co. KG (tax/advisory) as distinct legal entities, so merging them would be a wrong roll-up.",
  },
  {
    source: "YPOG GmbH & Co. KG",
    kind: "new_entity",
    entity_legal_name: "YPOG GmbH & Co. KG",
    legal_form: "GmbH & Co. KG",
    country_code: "DE",
    rationale:
      "No YPOG row exists. Distinct legal entity from the PartmbB above (different legal form = different legal person). Deliberately NOT aliased onto the partnership.",
  },
  {
    source: "YPOG Berlin",
    kind: "review",
    rationale:
      "AMBIGUOUS. 'YPOG Berlin' is a location label with no legal form. Both 'YPOG Partnerschaft von Rechtsanwälten mbB' and 'YPOG GmbH & Co. KG' operate from Berlin, so attaching it to either would be a guess that silently mis-attributes project 10905/10305_00404_501_01 revenue. Needs a human to say which entity billed it.",
  },
];

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function loadIdentityMap(client) {
  const entities = (await client.query(
    `select id, legal_name from crm.legal_entity where lifecycle_status='active'`)).rows;
  const aliases = (await client.query(
    `select legal_entity_id, alias_text from crm.legal_entity_alias where lifecycle_status='active'`)).rows;

  const canonical = new Map();   // norm -> [ids]
  for (const e of entities) {
    const n = normName(e.legal_name);
    if (!canonical.has(n)) canonical.set(n, []);
    canonical.get(n).push(e.id);
  }
  const alias = new Map();
  for (const a of aliases) {
    const n = normName(a.alias_text);
    if (!alias.has(n)) alias.set(n, new Set());
    alias.get(n).add(a.legal_entity_id);
  }
  return { entities, canonical, alias };
}

/** The ONLY resolution path. Returns {id} | {ambiguous} | null. */
function resolve(customer, map) {
  const n = normName(customer);
  if (!n) return null;
  const c1 = map.canonical.get(n);
  if (c1) return c1.length === 1 ? { id: c1[0], via: "canonical" }
                                 : { ambiguous: true, ids: c1, via: "canonical_duplicate" };
  const a1 = map.alias.get(n);
  if (a1) {
    const ids = [...a1];
    return ids.length === 1 ? { id: ids[0], via: "alias" }
                            : { ambiguous: true, ids, via: "alias_conflict" };
  }
  return null;
}

async function measure(client, map, label) {
  const projects = (await client.query(`select id, customer from public.projects`)).rows;
  let matched = 0;
  const unmatched = [], ambig = [];
  for (const p of projects) {
    const r = resolve(p.customer, map);
    if (r && r.id) matched++;
    else if (r && r.ambiguous) ambig.push({ ...p, ...r });
    else unmatched.push(p);
  }
  console.log(`\n=== ${label}: projects=${projects.length} matched=${matched} ambiguous=${ambig.length} unmatched=${unmatched.length}`);
  if (ambig.length) {
    console.log(`    AMBIGUOUS (blocked on purpose, needs data-quality fix in crm.legal_entity):`);
    for (const a of ambig) {
      console.log(`      ${a.id}  ${JSON.stringify(a.customer)}  ${a.via} -> ${a.ids.length} entity ids: ${a.ids.join(", ")}`);
    }
  }
  const distinct = [...new Set(unmatched.map((p) => p.customer))];
  if (distinct.length) {
    console.log(`    distinct unmatched values (${distinct.length}):`);
    for (const d of distinct) {
      const ids = unmatched.filter((p) => p.customer === d).map((p) => p.id);
      console.log(`      ${JSON.stringify(d)}  -> ${ids.length} project(s): ${ids.join(", ")}`);
    }
  }
  return { total: projects.length, matched, ambiguous: ambig, unmatched };
}

async function main() {
  await c.connect();
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes; pass --apply to write)");

  let map = await loadIdentityMap(c);
  const before = await measure(c, map, "BEFORE");

  console.log("\n=== DECISIONS");
  for (const d of DECISIONS) {
    console.log(`\n  [${d.kind.toUpperCase()}] ${JSON.stringify(d.source)}`);
    if (d.entity_legal_name) console.log(`      -> legal_entity: ${JSON.stringify(d.entity_legal_name)}`);
    console.log(`      why: ${d.rationale}`);
  }

  const hasFkCol = (await c.query(`
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='customer_legal_entity_id'`)).rowCount > 0;
  console.log(`\ncustomer_legal_entity_id column present: ${hasFkCol}`);

  if (!APPLY) {
    console.log("\nDry run complete. No rows written.");
    await c.end();
    return;
  }

  await c.query("begin");
  try {
    for (const d of DECISIONS) {
      if (d.kind === "review") continue;

      if (d.kind === "new_entity") {
        const existing = await c.query(
          `select id from crm.legal_entity where legal_name = $1`, [d.entity_legal_name]);
        let id;
        if (existing.rowCount) {
          id = existing.rows[0].id;
          console.log(`  entity exists, reused: ${d.entity_legal_name}`);
        } else {
          const ins = await c.query(
            `insert into crm.legal_entity (legal_name, legal_form, country_code, review_status, review_reason, notes)
             values ($1,$2,$3,'review_required',$4,$5) returning id`,
            [d.entity_legal_name, d.legal_form ?? null, d.country_code ?? null,
             "Created by scripts/link-project-customers.mjs from unmatched public.projects.customer text; confirm register data.",
             d.rationale]);
          id = ins.rows[0].id;
          console.log(`  + legal_entity ${d.entity_legal_name} [${id}]`);
        }
        // Alias only when the source spelling differs from the canonical name.
        if (normName(d.source) !== normName(d.entity_legal_name)) {
          await upsertAlias(id, d);
        }
        continue;
      }

      if (d.kind === "alias") {
        const ent = await c.query(
          `select id from crm.legal_entity where legal_name = $1`, [d.entity_legal_name]);
        if (!ent.rowCount) throw new Error(`alias target not found: ${d.entity_legal_name}`);
        await upsertAlias(ent.rows[0].id, d);
      }
    }

    if (hasFkCol) {
      map = await loadIdentityMap(c);
      const projects = (await c.query(`select id, customer from public.projects`)).rows;
      let n = 0;
      for (const p of projects) {
        const r = resolve(p.customer, map);
        if (r && r.id) {
          await c.query(
            `update public.projects set customer_legal_entity_id = $1
             where id = $2 and customer_legal_entity_id is distinct from $1`, [r.id, p.id]);
          n++;
        }
      }
      console.log(`\n  backfilled customer_legal_entity_id for ${n} project(s)`);
    } else {
      console.log("\n  NOTE: customer_legal_entity_id missing; run the migration then re-run --apply to backfill.");
    }

    await c.query("commit");
    console.log("\ncommitted.");
  } catch (e) {
    await c.query("rollback");
    console.error(`\nROLLED BACK: ${e.message}`);
    await c.end();
    process.exitCode = 1;
    return;
  }

  map = await loadIdentityMap(c);
  const after = await measure(c, map, "AFTER");
  console.log(`\n=== DELTA matched ${before.matched} -> ${after.matched}, unmatched ${before.unmatched.length} -> ${after.unmatched.length}`);
  await c.end();
}

async function upsertAlias(entityId, d) {
  const dup = await c.query(
    `select 1 from crm.legal_entity_alias
     where legal_entity_id = $1 and lower(alias_text) = lower($2)`, [entityId, d.source]);
  if (dup.rowCount) { console.log(`  alias exists: ${d.source}`); return; }
  await c.query(
    `insert into crm.legal_entity_alias
       (legal_entity_id, alias_text, alias_type, source_system, lifecycle_status, review_status, review_reason)
     values ($1,$2,$3,'HSE HUB PROJECTS','active','review_required',$4)`,
    [entityId, d.source, d.alias_type ?? "SOURCE_NAME", d.rationale]);
  console.log(`  + alias ${JSON.stringify(d.source)} -> ${d.entity_legal_name}`);
}

await main();

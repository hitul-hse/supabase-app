/**
 * Report: projects.customer -> crm.legal_entity linkage health.
 * Read-only. Usage: node scripts\report-customer-matching.mjs [--schema]
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

export function makeClient() {
  return new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
}

/** Canonical normalisation used by both the report and the resolver. */
export function normName(s) {
  if (s == null) return "";
  let t = String(s).normalize("NFC").toLowerCase();
  t = t.replace(/\u00df/g, "ss")
       .replace(/\u00e4/g, "ae").replace(/\u00f6/g, "oe").replace(/\u00fc/g, "ue");
  t = t.replace(/[^a-z0-9]+/g, " ").trim();
  return t;
}

/** Strip common German/intl legal-form suffixes, for near-miss grouping only. */
const LEGAL_FORMS = [
  "gmbh co kg", "gmbh co kgaa", "gmbh kg", "ag co kg", "gmbh", "ag", "kg", "kgaa",
  "ug haftungsbeschraenkt", "ug", "ohg", "gbr", "se", "ev", "e v", "mbh",
  "ltd", "limited", "llc", "inc", "corp", "bv", "b v", "nv", "sa", "sarl", "srl", "spa", "as", "ab", "oy", "aps",
];
export function stripLegalForm(norm) {
  let t = ` ${norm} `;
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of LEGAL_FORMS) {
      const suf = ` ${f} `;
      if (t.endsWith(suf)) { t = t.slice(0, -f.length - 1); changed = true; }
    }
  }
  return t.trim();
}

async function main() {
  const c = makeClient();
  await c.connect();
  const q = async (label, sql, params) => {
    try { const r = await c.query(sql, params); console.log(`\n### ${label}`); return r.rows; }
    catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
  };

  const cols = await q("COLUMNS crm.legal_entity / crm.legal_entity_alias / public.projects", `
    select table_schema, table_name, ordinal_position, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where (table_schema='crm' and table_name in ('legal_entity','legal_entity_alias'))
       or (table_schema='public' and table_name='projects')
    order by table_schema, table_name, ordinal_position`);
  if (cols) console.table(cols);

  const cons = await q("CONSTRAINTS on crm.legal_entity_alias", `
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid = 'crm.legal_entity_alias'::regclass`);
  if (cons) console.table(cons);

  const idx = await q("INDEXES on crm tables", `
    select tablename, indexname, indexdef from pg_indexes
    where schemaname='crm' and tablename in ('legal_entity','legal_entity_alias')`);
  if (idx) console.table(idx);

  if (process.argv.includes("--schema")) { await c.end(); return; }

  const hasFk = (await c.query(`
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='customer_legal_entity_id'`)).rowCount > 0;
  console.log(`\ncustomer_legal_entity_id present: ${hasFk}`);

  const projects = (await c.query(`select id, customer from public.projects order by id`)).rows;
  const entities = (await c.query(`select id, legal_name from crm.legal_entity`)).rows;
  let aliases = [];
  try {
    aliases = (await c.query(`select legal_entity_id, alias_text as alias from crm.legal_entity_alias where lifecycle_status = 'active' --  crm.legal_entity_alias`)).rows;
  } catch (e) { console.log(`alias read failed: ${e.message}`); }

  const byNorm = new Map();
  for (const e of entities) byNorm.set(normName(e.legal_name), e);
  const aliasMap = new Map();
  for (const a of aliases) aliasMap.set(normName(a.alias), a.legal_entity_id);

  const unmatched = [];
  let exact = 0, viaAlias = 0, empty = 0;
  for (const p of projects) {
    if (!p.customer || !String(p.customer).trim()) { empty++; continue; }
    const n = normName(p.customer);
    if (byNorm.has(n)) exact++;
    else if (aliasMap.has(n)) viaAlias++;
    else unmatched.push(p);
  }

  console.log(`\n### TOTALS  projects=${projects.length} empty_customer=${empty} exact=${exact} via_alias=${viaAlias} unmatched=${unmatched.length}`);

  // Near-miss grouping for unmatched values.
  const entStripped = new Map();
  for (const e of entities) {
    const k = stripLegalForm(normName(e.legal_name));
    if (!entStripped.has(k)) entStripped.set(k, []);
    entStripped.get(k).push(e);
  }
  const rows = unmatched.map((p) => {
    const n = normName(p.customer);
    const s = stripLegalForm(n);
    let cands = entStripped.get(s) || [];
    let reason = cands.length ? "legal_form_or_punctuation" : "";
    if (!cands.length) {
      // token-prefix containment: entity name is a prefix of the customer string (city suffix case)
      const near = entities.filter((e) => {
        const en = stripLegalForm(normName(e.legal_name));
        if (en.length < 4) return false;
        return s.startsWith(en + " ") || en.startsWith(s + " ");
      });
      if (near.length) { cands = near; reason = "prefix/city_suffix"; }
    }
    if (!cands.length) reason = "no_candidate";
    return {
      project_id: p.id,
      customer_raw: JSON.stringify(p.customer),
      normalised: n,
      reason,
      candidates: cands.map((e) => `${e.legal_name} [${e.id}]`).join(" | ") || "-",
    };
  });
  console.log("\n### UNMATCHED DETAIL");
  console.table(rows);

  if (hasFk) {
    const fk = (await c.query(`
      select count(*) total,
             count(*) filter (where customer_legal_entity_id is not null) linked,
             count(*) filter (where customer_legal_entity_id is null and coalesce(btrim(customer),'')<>'') unlinked_with_text
      from public.projects`)).rows;
    console.log("\n### FK COLUMN STATE"); console.table(fk);
  }
  await c.end();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) await main();


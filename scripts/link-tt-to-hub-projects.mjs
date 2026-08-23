/**
 * Link time.project.hub_project_id to the imported order rows.
 *
 * WHY. The Multi-Service Matrix and Customer Portfolio group projects by
 * SERVICE, which they read from time.project via hub_project_id -- the
 * deliberate text link between the vendor-synced time schema and the Hub's own
 * projects table (schema.sql keeps it a soft link so time never fails on a
 * missing Hub row). Production has 0 links, so every project counted as
 * "without service mapping" and both panels rendered empty.
 *
 * MATCHING per ADR-001: exact normalised name only. The importer already
 * proved 54 orders match a TT project this way; this writes those same links
 * onto time.project.
 *
 * SAFE WRT THE SYNC: import-trackingtime.mjs upserts on source_id and does not
 * carry hub_project_id in its payload, so the link survives sync runs.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "time" }, auth: { persistSession: false },
});

const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();

const page = async (client, table, select) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await client.from(table).select(select).order("id").range(f, f + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const hubProjects = await page(db, "projects", "id, name");
const ttProjects = await page(timeDb, "project", "id, name, hub_project_id");

const hubByName = new Map();
for (const p of hubProjects) {
  const k = norm(p.name);
  if (!hubByName.has(k)) hubByName.set(k, []);
  hubByName.get(k).push(p);
}

let linked = 0;
let ambiguous = 0;
let already = 0;
const links = [];
for (const tt of ttProjects) {
  const hits = hubByName.get(norm(tt.name)) ?? [];
  if (hits.length !== 1) {
    if (hits.length > 1) ambiguous += 1;
    continue;
  }
  if (tt.hub_project_id === hits[0].id) {
    already += 1;
    continue;
  }
  links.push({ ttId: tt.id, hubId: hits[0].id, name: tt.name });
}

console.log(`TT projects: ${ttProjects.length} | matched 1:1: ${links.length + already} | ambiguous: ${ambiguous} | already linked: ${already}`);
for (const l of links.slice(0, 10)) console.log(`  ${l.hubId}  <-  ${l.name.slice(0, 60)}`);
if (links.length > 10) console.log(`  ... and ${links.length - 10} more`);

if (DRY) {
  console.log("\nDRY RUN: nothing written.");
  process.exit(0);
}

for (const l of links) {
  const { error } = await timeDb.from("project").update({ hub_project_id: l.hubId }).eq("id", l.ttId);
  if (error) throw new Error(`link ${l.name}: ${error.message}`);
  linked += 1;
}
console.log(`\nlinked ${linked} TT projects to their Hub order rows.`);

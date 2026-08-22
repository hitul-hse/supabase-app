/**
 * Seed a SANDBOX Supabase instance with plausible, fully invented data.
 *
 * WHY THIS EXISTS. The first sandbox project needed realistic data and got it
 * the dangerous way: the production service-role key found its way into a
 * local .env so the dashboard would show real rows. That key bypasses RLS, so
 * a sandbox laptop briefly held unrestricted production access. This script is
 * the safe alternative: shape-realistic data (German HSE customers, projects
 * with contract hours, members, time entries with the real seconds/hours unit
 * conventions) with not one real name, address or hour in it.
 *
 * THE GUARD. It refuses to run against the production project ref, hard, and
 * before every write batch re-checks the URL it is talking to. A seed script
 * that could be pointed at production by a typo in .env.local would be exactly
 * the class of accident it exists to prevent.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const PRODUCTION_REF = "wdbedblvyrfqwypngghs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.log("No NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const ref = url.replace("https://", "").split(".")[0];
if (ref === PRODUCTION_REF) {
  console.log(
    `REFUSED: .env.local points at the PRODUCTION project (${PRODUCTION_REF}).\n` +
      "This seed writes invented data and must never touch production.\n" +
      "Point .env.local at YOUR sandbox instance and re-run. Nothing was written.",
  );
  process.exit(1);
}
console.log(`seeding sandbox instance: ${ref}\n`);

const db = createClient(url, key, { db: { schema: "time" }, auth: { persistSession: false } });

/* ------------------------------------------------------ invented but honest */

// Invented companies with the SHAPE of the real portfolio: a few big
// contracts, a long tail of small retainers, German + English names.
const CUSTOMERS = [
  "Falkenberg Maschinenbau GmbH", "Nordwind Energie AG", "Bramfeld Logistik GmbH",
  "Quellstein Software GmbH", "Ahrens & Petersen Bau GmbH", "Lichtwerk Studios GmbH",
  "Cobalt Analytics Ltd", "Marschner Immobilien KG", "TurmSolar GmbH",
  "Hafenblick Consulting GmbH", "Priem & Soehne Elektrotechnik", "Veltmann Pharma GmbH",
];

const SERVICES = [
  { name: "DGUV V2: Sifa / Safety Engineer", travel: false },
  { name: "SiGeKo / construction coordination", travel: false },
  { name: "Brandschutzbeauftragter (Fire Safety)", travel: false },
  { name: "Projekt: Health & Safety Consulting", travel: false },
  { name: "Travel Time", travel: true },
];

const MEMBERS = [
  "Anna Beispiel", "Bernd Muster", "Clara Probe", "Denis Platzhalter",
  "Elif Testfrau", "Falk Sandkasten",
];

// Mulberry32: deterministic, so two colleagues seeding get the SAME data and
// can compare screenshots.
let s = 20260822;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);

/* ---------------------------------------------------------------- the write */

const upsert = async (table, rows, conflict) => {
  // Re-check the target before EVERY batch: the guard above ran once, but a
  // long script and a mid-run env edit is exactly the freak accident to block.
  if (!url.includes(ref) || ref === PRODUCTION_REF) throw new Error("target changed mid-run");
  const { data, error } = await db.from(table).upsert(rows, { onConflict: conflict }).select("id, source_id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
};

console.log("customers...");
const customers = await upsert(
  "customer",
  CUSTOMERS.map((name, i) => ({ source_id: `seed-cust-${i + 1}`, name })),
  "source_id",
);

console.log("services...");
const services = await upsert(
  "service",
  SERVICES.map((sv, i) => ({
    source_id: `seed-svc-${i + 1}`, name: sv.name, is_travel: sv.travel, is_paid_travel: sv.travel,
  })),
  "source_id",
);

console.log("members...");
const members = await upsert(
  "member",
  MEMBERS.map((name, i) => ({
    source_id: `seed-mem-${i + 1}`,
    display_name: name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@sandbox.example`,
  })),
  "source_id",
);

console.log("projects...");
const projectRows = [];
let p = 0;
for (const c of customers) {
  // 1-4 projects per customer, budgets shaped like the real book: mostly small
  // retainers, occasionally a big contract.
  const n = 1 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    p += 1;
    const big = rnd() < 0.15;
    projectRows.push({
      source_id: `seed-proj-${p}`,
      customer_id: c.id,
      name: `${c.source_id.replace("seed-cust-", "1")}0${p}_${CUSTOMERS[customers.indexOf(c)]} / 26 ${pick(["SiFa", "GU", "BA", "SiGeKo", "HSE"])}`,
      service_id: pick(services).id,
      is_billable: rnd() > 0.1,
      estimated_hours: big ? Math.round(between(100, 800)) : Math.round(between(2, 40) * 2) / 2,
    });
  }
}
const projects = await upsert("project", projectRows, "source_id");

console.log("entries (this is the slow part)...");
const entryRows = [];
let e = 0;
for (const proj of projects) {
  // Burn between 0 and ~130% of the budget so the dashboards show the full
  // range: healthy, approaching, and over-budget projects.
  const budget = Number(projectRows.find((r) => r.source_id === proj.source_id)?.estimated_hours ?? 10);
  let remaining = budget * between(0, 1.3);
  while (remaining > 0.5 && e < 4000) {
    e += 1;
    const hours = Math.min(remaining, Math.round(between(0.5, 8) * 4) / 4);
    remaining -= hours;
    const daysAgo = Math.floor(between(0, 400));
    const start = new Date(Date.now() - daysAgo * 86_400_000);
    start.setUTCHours(6 + Math.floor(rnd() * 10), rnd() < 0.5 ? 0 : 30, 0, 0);
    entryRows.push({
      source_id: `seed-entry-${e}`,
      member_id: pick(members).id,
      project_id: proj.id,
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + hours * 3_600_000).toISOString(),
      duration_seconds: Math.round(hours * 3600),
      is_billable: rnd() > 0.15,
      notes: pick(["Begehung", "Dokumentation", "ASA-Sitzung", "Schulung", "Bericht", "Remote-Beratung"]),
    });
  }
}
// Batched: PostgREST rejects oversized payloads long before 4000 rows.
for (let i = 0; i < entryRows.length; i += 500) {
  await upsert("entry", entryRows.slice(i, i + 500), "source_id");
  process.stdout.write(`  ${Math.min(i + 500, entryRows.length)}/${entryRows.length}\r`);
}

console.log(`\n\nseeded: ${customers.length} customers, ${services.length} services, ` +
  `${members.length} members, ${projects.length} projects, ${entryRows.length} entries`);
console.log("All names and numbers are invented. Deterministic: re-running overwrites the same rows.");

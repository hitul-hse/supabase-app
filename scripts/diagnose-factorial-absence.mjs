// The reassignment picker has an `absence` field that is always null, because
// public.leave_requests is empty. Factorial's timeoff/leaves returned 644
// records, so the gap is closeable -- but only if those records actually say
// what a lead needs: WHO is away and BETWEEN WHICH DATES.
//
// Establish the shape and the coverage before designing a sync. 644 records
// across 43 employees could be years of history with nothing current, in which
// case the feature gains nothing today.
//
// GDPR: a leave record carries a reason and often a medical implication, which
// is special-category data under Art. 9. The allow-list here is tighter than the
// employee one, and no reason/description field is read at all.
// READ-ONLY. Nothing written, no name printed.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
if (!KEY) { console.log("BLOCKED: no FACTORIAL_API_KEY"); process.exit(2); }

const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY, Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

/*
 * Never read. A leave reason can reveal illness, pregnancy or disability, which
 * is Art. 9 special-category data. The product only needs to know that somebody
 * is unavailable on a date, not why.
 */
const FORBIDDEN = /reason|description|note|comment|medical|diagnosis|attachment|document/i;

const fetchAll = async (resource) => {
  const rows = [];
  let cursor = null;
  for (let p = 0; p < 30; p += 1) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("after_id", cursor);
    const r = await call(`/api/${VERSION}/resources/${resource}?${qs}`);
    if (r.status !== 200 || !Array.isArray(r.body?.data)) break;
    for (const row of r.body.data) {
      const kept = {};
      for (const [k, v] of Object.entries(row)) if (!FORBIDDEN.test(k)) kept[k] = v;
      rows.push(kept);
    }
    if (!r.body.meta?.has_next_page) break;
    const next = r.body.meta.end_cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return rows;
};

console.log("Can Factorial tell a team lead who is away?\n");

const leaves = await fetchAll("timeoff/leaves");
console.log(`timeoff/leaves: ${leaves.length} records\n`);

if (!leaves.length) { console.log("No leave records readable."); process.exit(1); }

// The shape, values redacted.
const first = leaves[0];
console.log("  record shape (values redacted):");
for (const [k, v] of Object.entries(first)) {
  const t = v === null ? "null" : Array.isArray(v) ? `[${v.length}]` : typeof v === "object" ? "{...}" : typeof v;
  console.log(`    ${k}: ${t}`);
}
const droppedKeys = [...new Set(leaves.flatMap((l) => Object.keys(l)))];
console.log(`\n  fields NEVER read (Art. 9 risk): anything matching ${FORBIDDEN}`);

// Does it carry the two things that matter?
const dateFields = droppedKeys.filter((k) => /date|start|end|from|to|on$/i.test(k));
const personFields = droppedKeys.filter((k) => /employee|person|member|user/i.test(k));
console.log(`\n  date-ish fields:   ${dateFields.join(", ") || "NONE"}`);
console.log(`  person-ish fields: ${personFields.join(", ") || "NONE"}`);

// Coverage: how much of this is current or future, i.e. useful for a lead today?
const today = new Date().toISOString().slice(0, 10);
const startKey = dateFields.find((k) => /^start|start_on|starts_on/i.test(k)) ?? dateFields[0];
const endKey = dateFields.find((k) => /^finish|end_on|ends_on|finish_on/i.test(k)) ?? dateFields[1];

console.log(`\n  using start="${startKey}" end="${endKey}", today=${today}`);

const withDates = leaves.filter((l) => l[startKey] && l[endKey]);
const current = withDates.filter((l) => String(l[startKey]) <= today && String(l[endKey]) >= today);
const future = withDates.filter((l) => String(l[startKey]) > today);
const past = withDates.filter((l) => String(l[endKey]) < today);

console.log(`    with usable dates: ${withDates.length}/${leaves.length}`);
console.log(`    absent TODAY:      ${current.length}   <- what a lead needs right now`);
console.log(`    upcoming:          ${future.length}`);
console.log(`    historical:        ${past.length}`);

// Approval state matters: a requested-but-unapproved leave is not an absence.
const statusFields = droppedKeys.filter((k) => /status|state|approved/i.test(k));
if (statusFields.length) {
  const sk = statusFields[0];
  const byStatus = {};
  for (const l of leaves) { const v = String(l[sk] ?? "(null)"); byStatus[v] = (byStatus[v] ?? 0) + 1; }
  console.log(`\n  ${sk}: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const approvedCurrent = current.filter((l) => /approv|accept/i.test(String(l[sk] ?? "")));
  console.log(`    of those absent today, approved: ${approvedCurrent.length}`);
}

// Leave TYPE without the reason: "holiday" vs "sick" is operationally different
// for a lead, and the type name is not itself Art. 9 data.
const typeFields = droppedKeys.filter((k) => /leave_type|type_id|type$/i.test(k));
console.log(`\n  type fields: ${typeFields.join(", ") || "NONE"}`);
const types = await fetchAll("timeoff/leave_types");
console.log(`  timeoff/leave_types: ${types.length} types`);
for (const t of types.slice(0, 12)) {
  const name = t.name ?? t.translated_name ?? "(unnamed)";
  console.log(`    id ${String(t.id).padStart(8)}  ${name}`);
}

console.log("\n  VERDICT:");
if (current.length > 0) {
  console.log(`    ${current.length} people are absent today. The absence field can be filled`);
  console.log("    and the reassignment picker stops saying 'unbekannt' for them.");
} else {
  console.log("    Nobody is absent today, so the field would still render unknown for");
  console.log("    everyone. Worth syncing anyway for upcoming leave, but say so honestly.");
}

console.log("\nREAD-ONLY: nothing written; no reason, note or name was read.");

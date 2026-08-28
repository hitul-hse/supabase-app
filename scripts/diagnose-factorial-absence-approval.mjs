// "of those absent today, approved: 0" is either a serious finding or a bug in
// my own filter, and building an absence feature on top of it without knowing
// which would be reckless.
//
// If genuinely zero of today's absences are approved, then `approved` does not
// mean what it looks like, or today's absentees are all unapproved -- and
// treating an unapproved request as an absence would tell a lead someone is away
// when they are at their desk. The opposite error (ignoring a real absence)
// hands work to someone who is off sick.
//
// READ-ONLY. No name, reason or note read.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY, Accept: "application/json" } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const FORBIDDEN = /reason|description|note|comment|medical|diagnosis|attachment|document|full_name/i;

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

const leaves = await fetchAll("timeoff/leaves");
const types = await fetchAll("timeoff/leave_types");
const typeName = new Map(types.map((t) => [String(t.id), t.name ?? t.translated_name ?? "(unnamed)"]));

const today = new Date().toISOString().slice(0, 10);
const inRange = (l, d) => String(l.start_on) <= d && String(l.finish_on) >= d;

console.log(`Is "approved" trustworthy? (today = ${today})\n`);

// 1. How does approval distribute over TIME? If old leave is approved and recent
//    leave is not, `approved` is likely an after-the-fact workflow state rather
//    than a permission to be absent.
const buckets = { past: { t: 0, f: 0, n: 0 }, current: { t: 0, f: 0, n: 0 }, future: { t: 0, f: 0, n: 0 } };
for (const l of leaves) {
  const b = inRange(l, today) ? "current" : String(l.finish_on) < today ? "past" : "future";
  const k = l.approved === true ? "t" : l.approved === false ? "f" : "n";
  buckets[b][k] += 1;
}
console.log("  approval by period:");
for (const [period, v] of Object.entries(buckets)) {
  const total = v.t + v.f + v.n;
  console.log(`    ${period.padEnd(8)} total ${String(total).padStart(3)}  approved ${String(v.t).padStart(3)}  not ${String(v.f).padStart(3)}  null ${String(v.n).padStart(3)}`);
}

// 2. The four absent today: what are they, and what is their approval state?
const current = leaves.filter((l) => inRange(l, today));
console.log(`\n  the ${current.length} absences covering today (employee ids only, no names):`);
for (const l of current) {
  console.log(`    emp ${String(l.employee_id).padEnd(10)} ${l.start_on} -> ${l.finish_on}  ` +
    `type=${typeName.get(String(l.leave_type_id)) ?? l.leave_type_id}  approved=${l.approved}  days=${l.days_taken}`);
}

// 3. Are the unapproved ones deleted/withdrawn rather than pending? A withdrawn
//    request must never count as an absence.
const withDeleted = current.filter((l) => l.deleted_at !== null && l.deleted_at !== undefined);
console.log(`\n  of those, soft-deleted: ${withDeleted.length}`);

// 4. THE DECIDING TEST: does the approval flag track leave TYPE? Some Factorial
//    setups auto-approve sick leave and never set the flag, which would make
//    "approved only" silently drop exactly the absences a lead most needs.
const byType = new Map();
for (const l of leaves) {
  const name = typeName.get(String(l.leave_type_id)) ?? String(l.leave_type_id);
  const cur = byType.get(name) ?? { t: 0, f: 0, n: 0 };
  cur[l.approved === true ? "t" : l.approved === false ? "f" : "n"] += 1;
  byType.set(name, cur);
}
console.log("\n  approval by leave type:");
for (const [name, v] of [...byType.entries()].sort((a, b) => (b[1].t + b[1].f + b[1].n) - (a[1].t + a[1].f + a[1].n))) {
  const total = v.t + v.f + v.n;
  const pct = total ? Math.round((v.t / total) * 100) : 0;
  console.log(`    ${name.padEnd(26)} ${String(total).padStart(3)} record(s), ${String(pct).padStart(3)}% approved` +
    (v.f ? `, ${v.f} explicitly not` : "") + (v.n ? `, ${v.n} null` : ""));
}

console.log("\n  WHAT THIS MEANS FOR THE SYNC:");
const currentApproved = current.filter((l) => l.approved === true).length;
if (current.length && currentApproved === 0) {
  const allRecent = leaves.filter((l) => String(l.start_on) >= today.slice(0, 4) + "-01-01");
  const recentApprovedPct = allRecent.length
    ? Math.round((allRecent.filter((l) => l.approved === true).length / allRecent.length) * 100) : 0;
  console.log(`    None of today's ${current.length} absences carries approved=true, while ${recentApprovedPct}% of this`);
  console.log("    year's records do. So `approved` is NOT simply always-true, and filtering");
  console.log("    on it would hide people who are genuinely away right now.");
  console.log("    => The sync should record the flag but NOT require it, and the UI must");
  console.log("       show the approval state so a lead can judge rather than be misled.");
} else {
  console.log(`    ${currentApproved} of ${current.length} current absences are approved; filtering on the flag is viable.`);
}

console.log("\nREAD-ONLY: nothing written; no name, reason or note was read.");

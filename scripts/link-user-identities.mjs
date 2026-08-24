// Link app_user_profile rows to real public.people rows.
//
//   node scripts/link-user-identities.mjs           dry run (default, no writes)
//   node scripts/link-user-identities.mjs --apply   perform the writes
//
// Why this exists: 11 of 20 app_user_profile rows have person_id = NULL.
// public.app_user_person_id() reads that column, and every RLS visibility
// helper (can_view_project / can_view_person) keys off it, so a NULL person_id
// means the user is invisible to themselves: zero projects, zero people.
//
// Resolution order per unlinked user:
//   1. Test/synthetic accounts  -> REPORT ONLY, never guessed, left unlinked.
//   2. Confident name match     -> link to that existing people row.
//   3. No match                 -> CREATE a real people row and link to it.
//
// Hard safety rule: the eight INACTIVE seed mockups (emp-1..emp-8) are never
// a valid link target, no matter how well a name appears to match.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const APPLY = process.argv.includes("--apply");

// Accounts that are not a real human. We refuse to invent an identity for
// these; a wrong link here would silently grant a tester real project data.
const TEST_ACCOUNTS = [
  /^invite\.flow\.test\./i,
  /^hituls18@gmail\.com$/i,
];

// The seed mockups. Never link a real login to one of these.
const FORBIDDEN_PERSON_IDS = new Set(
  ["emp-1", "emp-2", "emp-3", "emp-4", "emp-5", "emp-6", "emp-7", "emp-8"]);

// public.people.source is constrained to ('seed','factorial'); there is no
// 'masterdata' value in this database. Real staff rows are the is_active=true
// rows using the md-* id convention, which is what we mirror when creating.
const REAL_SOURCE = "seed";

// Fold German umlauts and strip accents so "Björn" matches a "bjoern@" local
// part and vice versa. Order matters: umlaut expansion before NFD stripping.
const norm = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// Compare an email local part against a person name. A local part may be
// "first", "first.last", or "first.lastname"; a name may be "First" or
// "First Last". We accept only unambiguous evidence.
const matchStrength = (localPart, personName) => {
  const l = norm(localPart);
  const p = norm(personName);
  if (!l || !p) return null;
  if (l === p) return "exact";
  const lTok = l.split(" ").filter(Boolean);
  const pTok = p.split(" ").filter(Boolean);
  // "bjoern.schoenemann" vs "Björn Schönemann"
  if (lTok.length > 1 && lTok.join("") === pTok.join("")) return "exact";
  // Single-token name ("Mathias") matching the first token of the local part.
  if (pTok.length === 1 && lTok[0] === pTok[0]) return "first-name";
  if (lTok.length === 1 && pTok.length > 1 && pTok[0] === lTok[0]) return "first-name";
  return null;
};

const slugFor = (localPart, taken) => {
  const base = "md-" + norm(localPart).split(" ")[0].replace(/[^a-z0-9]/g, "");
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const people = (await c.query("select id, name, department, is_active, source from public.people")).rows;
const takenIds = new Set(people.map((p) => p.id));
const linkedPersonIds = new Set(
  (await c.query("select person_id from public.app_user_profile where person_id is not null"))
    .rows.map((r) => r.person_id));

// Only active, non-mockup, not-already-claimed people are linkable.
const candidates = people.filter((p) =>
  p.is_active && !FORBIDDEN_PERSON_IDS.has(p.id) && !linkedPersonIds.has(p.id));

const unlinked = (await c.query(`
  select p.user_id, u.email, p.role_key, p.department
    from public.app_user_profile p
    join auth.users u on u.id = p.user_id
   where p.person_id is null
   order by p.role_key, u.email`)).rows;

console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
console.log(`people rows: ${people.length} | linkable candidates: ${candidates.length} | unlinked users: ${unlinked.length}`);
if (candidates.length) {
  console.log("Linkable candidates: " + candidates.map((p) => `${p.id}(${p.name})`).join(", "));
} else {
  console.log("Linkable candidates: NONE — every active people row is already claimed.");
}

const plan = [];
const reservedIds = new Set(takenIds);
const claimed = new Set();

for (const u of unlinked) {
  const localPart = String(u.email).split("@")[0];

  if (TEST_ACCOUNTS.some((re) => re.test(u.email) || re.test(localPart))) {
    plan.push({ ...u, action: "SKIP-TEST", target: null,
      note: "test/synthetic account - reported, not guessed" });
    continue;
  }

  const hits = candidates
    .filter((p) => !claimed.has(p.id))
    .map((p) => ({ p, strength: matchStrength(localPart, p.name) }))
    .filter((h) => h.strength);

  const exact = hits.filter((h) => h.strength === "exact");
  const loose = hits.filter((h) => h.strength === "first-name");
  const chosen = exact.length === 1 ? exact[0] : (exact.length === 0 && loose.length === 1 ? loose[0] : null);

  if (chosen) {
    if (FORBIDDEN_PERSON_IDS.has(chosen.p.id)) {
      throw new Error(`refusing to link ${u.email} to seed mockup ${chosen.p.id}`);
    }
    claimed.add(chosen.p.id);
    plan.push({ ...u, action: "LINK", target: chosen.p.id,
      note: `${chosen.strength} name match on "${chosen.p.name}"` });
    continue;
  }

  if (hits.length > 1) {
    plan.push({ ...u, action: "SKIP-AMBIGUOUS", target: null,
      note: `ambiguous: ${hits.map((h) => h.p.id).join(", ")}` });
    continue;
  }

  const newId = slugFor(localPart, reservedIds);
  reservedIds.add(newId);
  // Title-case the local part's first token for a readable display name.
  const first = localPart.split(/[._-]/)[0];
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  plan.push({ ...u, action: "CREATE", target: newId, newName: name,
    note: `no candidate matched; new people row (dept=${u.department ?? "null"})` });
}

const w = (s, n) => String(s ?? "").padEnd(n);
console.log("\n=== PROPOSED MAPPING ===");
console.log(w("email", 40) + w("role", 16) + w("action", 16) + w("person_id", 14) + "why");
console.log("-".repeat(120));
for (const p of plan) {
  console.log(w(p.email, 40) + w(p.role_key, 16) + w(p.action, 16) + w(p.target ?? "-", 14) + p.note);
}

const creates = plan.filter((p) => p.action === "CREATE");
const links = plan.filter((p) => p.action === "LINK");
const skips = plan.filter((p) => p.action.startsWith("SKIP"));
console.log(`\nsummary: ${links.length} link, ${creates.length} create+link, ${skips.length} skipped`);

// Guard: nothing in the plan may point at a seed mockup.
for (const p of plan) {
  if (p.target && FORBIDDEN_PERSON_IDS.has(p.target)) {
    throw new Error(`plan contains forbidden target ${p.target} for ${p.email}`);
  }
}

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  for (const p of plan) {
    if (p.action === "CREATE") {
      await c.query(
        `insert into public.people (id, name, role, department, is_active, source)
         values ($1,$2,$3,$4,true,$5)
         on conflict (id) do nothing`,
        [p.target, p.newName, "Consultant", p.department, REAL_SOURCE]);
    }
    if (p.action === "CREATE" || p.action === "LINK") {
      await c.query(
        "update public.app_user_profile set person_id=$1 where user_id=$2 and person_id is null",
        [p.target, p.user_id]);
      console.log(`  ${p.action}: ${p.email} -> ${p.target}`);
    }
  }
  await c.query("commit");
  console.log("\nCommitted.");
} catch (e) {
  await c.query("rollback");
  console.error("Rolled back: " + e.message);
  process.exitCode = 1;
}

const left = (await c.query(
  "select count(*)::int n from public.app_user_profile where person_id is null")).rows[0].n;
console.log(`app_user_profile rows still unlinked: ${left} (expected ${skips.length})`);

await c.end();

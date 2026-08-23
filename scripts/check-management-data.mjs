/**
 * The management dashboard's DATA contract, verified against the live
 * database. The UI can only be as honest as these joins; this pins them.
 *
 * Every number here was established by the 2026-08-23 audit and data round:
 * if a sync, import, or migration regresses one, this gate names it before a
 * user sees fiction.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ----------------------------------------------------- the order universe */

const { count: orders } = await db.from("projects").select("*", { head: true, count: "exact" });
check("public.projects holds the real order book (no demo rows)", orders >= 200, `${orders} orders`);

const { data: demo } = await db.from("projects").select("id").like("id", "prj-%");
check("the prj-* demo rows have not crept back", (demo ?? []).length === 0);

/* -------------------------------------------------------------- TT links */

const { count: linked } = await timeDb
  .from("project")
  .select("*", { head: true, count: "exact" })
  .not("hub_project_id", "is", null);
check(
  "TT->order links held (name + prefix + service rules)",
  (linked ?? 0) >= 120,
  `${linked} linked (123 at the 2026-08-23 round; the sync must not erode them)`,
);

/*
 * Every link must point at a REAL order. A dangling hub_project_id would make
 * the hour attribution silently drop those entries.
 */
const ttLinks = [];
for (let f = 0; ; f += 1000) {
  const { data } = await timeDb
    .from("project")
    .select("id, hub_project_id")
    .not("hub_project_id", "is", null)
    .order("id")
    .range(f, f + 999);
  if (!data?.length) break;
  ttLinks.push(...data);
  if (data.length < 1000) break;
}
const orderIds = new Set();
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("projects").select("id").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) orderIds.add(r.id);
  if (data.length < 1000) break;
}
const dangling = ttLinks.filter((t) => !orderIds.has(t.hub_project_id));
check("no TT link dangles at a missing order", dangling.length === 0, dangling.map((d) => d.hub_project_id).join(", ") || "");

/*
 * The link rules are exact-key only (ADR-001). A linked TT project's name must
 * begin with its order's Lexware customer number OR normalise to the exact
 * order name -- the two lawful rules. Anything else means a fuzzy match crept in.
 */
const orderNames = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("projects").select("id, name").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) orderNames.set(r.id, r.name);
  if (data.length < 1000) break;
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
const ttNames = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await timeDb.from("project").select("id, name").order("id").range(f, f + 999);
  if (!data?.length) break;
  for (const r of data) ttNames.set(r.id, r.name);
  if (data.length < 1000) break;
}
const unlawful = ttLinks.filter((t) => {
  const ttName = ttNames.get(t.id) ?? "";
  const lexware = /^(\d{5})_/.exec(t.hub_project_id)?.[1];
  const byPrefix = lexware && new RegExp(`^${lexware}[_\\s]`).test(ttName);
  const byName = norm(ttName) === norm(orderNames.get(t.hub_project_id));
  return !byPrefix && !byName;
});
check(
  "every link satisfies an exact-key rule (no fuzzy matching crept in)",
  unlawful.length === 0,
  unlawful.slice(0, 3).map((u) => `${ttNames.get(u.id)} -> ${u.hub_project_id}`).join(" | ") || `${ttLinks.length} links checked`,
);

/* ------------------------------------------------------------ hour truth */

/*
 * The displayed hours must equal the sum of linked TT entries. Spot-check the
 * heaviest order end to end rather than trusting the refresh script.
 */
const { data: heaviest } = await db
  .from("projects")
  .select("id, logged_hours")
  .gt("logged_hours", 0)
  .order("logged_hours", { ascending: false })
  .limit(1);
if (heaviest?.length) {
  const target = heaviest[0];
  const ttIds = ttLinks.filter((t) => t.hub_project_id === target.id).map((t) => t.id);
  let sum = 0;
  for (const ttId of ttIds) {
    for (let f = 0; ; f += 1000) {
      const { data } = await timeDb
        .from("entry")
        .select("id, duration_seconds")
        .eq("project_id", ttId)
        .not("duration_seconds", "is", null)
        .order("id")
        .range(f, f + 999);
      if (!data?.length) break;
      for (const e of data) sum += (Number(e.duration_seconds) || 0) / 3600;
      if (data.length < 1000) break;
    }
  }
  check(
    "the heaviest order's displayed hours equal its TT entries' sum",
    Math.abs(Number(target.logged_hours) - Math.round(sum * 10) / 10) < 0.11,
    `${target.id}: shown ${target.logged_hours}h vs summed ${sum.toFixed(1)}h`,
  );
}

/* -------------------------------------------------- customer master joins */

const { count: entities } = await db.schema("crm").from("legal_entity").select("*", { head: true, count: "exact" }).then(
  (r) => (r.error ? { count: null } : r),
);
if (entities === null) {
  console.log("  note: crm not readable via REST with this key; skipping entity counts (expected when exposure stays locked down)");
} else {
  check("legal entities present", entities >= 100, `${entities}`);
}

/* -------------------------------------------------------- contract periods */

const { count: periods } = await timeDb.from("project_contract_period").select("*", { head: true, count: "exact" });
check(
  "the coherent contract periods from the masterdata are recorded",
  (periods ?? 0) >= 4,
  `${periods} periods (4 imported 2026-08-23; the 10 with renewal-date artifacts stay in review)`,
);

console.log(
  failed === 0
    ? "\nMANAGEMENT DATA: links lawful, hours truthful, contracts recorded"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);

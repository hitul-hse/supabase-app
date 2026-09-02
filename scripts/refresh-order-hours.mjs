/**
 * Refresh public.projects hour columns from the hub_project_id links.
 *
 * The masterdata importer summed hours only for exact-NAME matches (54). Now
 * that 123 TT projects carry hub_project_id links (name + prefix + service
 * rules), the link table is the better source: one TT project can point at an
 * order it does not share a name with, and multiple TT projects can share one
 * order (e.g. three NS-Dokumentation activities on one Brandschutz contract).
 *
 * Sums are BOUNDED AT TODAY. time.entry carries planned work dated out to the
 * end of the year, and until 2026-09-02 this summed all of it, so an order
 * could read 398 h burned with 218 h actually worked (Mirantis; four orders
 * overstated by 373 h between them). Decision that day: planned time is not
 * logged time. The Overview and /projects already bound every figure at
 * now(), and this column must agree with the pages that show it, or the
 * same order reads two different burns depending on where you look.
 *
 * The sum is otherwise unwindowed. The masterdata's contract windows are
 * unreliable (Start Date often holds the NEXT renewal), and the order rows
 * carry sales' hours for the CURRENT term -- so consumed_percent is honest
 * for current-term contracts and conservative (over-stated) for renewed
 * ones. The contract period feature is where window-scoped burn lives; this
 * table is the management overview.
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

const page = async (client, table, select, tweak) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    let q = client.from(table).select(select).order("id").range(f, f + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const tt = await page(timeDb, "project", "id, hub_project_id", (q) => q.not("hub_project_id", "is", null));
// One timestamp for the whole run, so every order is bounded at the same
// instant and a run straddling midnight cannot count a day for some orders
// and not others. Matches check-order-hours-freshness.mjs, which compares
// against `started_at <= now()`.
const AS_OF = new Date().toISOString();
const entries = await page(timeDb, "entry", "id, project_id, duration_seconds, is_billable", (q) =>
  q.not("duration_seconds", "is", null).lte("started_at", AS_OF),
);
const orders = await page(db, "projects", "id, contract_hours, logged_hours");

const orderByTT = new Map(tt.map((t) => [t.id, t.hub_project_id]));
// Summed in SECONDS and divided once at the end. Summing per-entry hours
// accumulated float error and rounded 22.4997 down to 22.4 where the gate's
// SQL (sum of seconds, then round) says 22.5 -- three orders showed as 0.1 h
// understated on correct data. Integer seconds have no such error.
const sums = new Map(); // order id -> {loggedSec, billableSec}
for (const e of entries) {
  const order = orderByTT.get(e.project_id);
  if (!order) continue;
  const sec = Number(e.duration_seconds) || 0;
  const s = sums.get(order) ?? { loggedSec: 0, billableSec: 0 };
  s.loggedSec += sec;
  if (e.is_billable) s.billableSec += sec;
  sums.set(order, s);
}

console.log(`orders with hours from links: ${sums.size} (was 24 with >0h)`);

let updated = 0;
const previews = [];
for (const o of orders) {
  const s = sums.get(o.id);
  if (!s) continue;
  const logged = Math.round(s.loggedSec / 360) / 10;
  const billable = Math.round(s.billableSec / 360) / 10;
  const contract = Number(o.contract_hours) || 0;
  const consumed = contract > 0 ? Math.round((logged / contract) * 100) : 0;
  const status = contract > 0 ? (consumed >= 95 ? "CRITICAL" : consumed >= 80 ? "WARNING" : "NORMAL") : "NORMAL";
  const remaining = contract > 0 ? Math.round((contract - logged) * 10) / 10 : null;

  previews.push({ id: o.id, contract, logged, consumed, status });
  if (!DRY) {
    const { error } = await db
      .from("projects")
      .update({
        logged_hours: logged,
        billable_hours: billable,
        consumed_percent: consumed,
        remaining_hours: remaining,
        status,
      })
      .eq("id", o.id);
    if (error) throw new Error(`${o.id}: ${error.message}`);
    updated += 1;
  }
}

previews.sort((a, b) => b.consumed - a.consumed);
console.log("\nworst after refresh:");
for (const p of previews.slice(0, 12)) {
  console.log(`  ${String(p.consumed).padStart(5)}%  ${String(p.contract).padStart(6)}h contract  ${String(p.logged).padStart(7)}h logged  ${p.status.padEnd(8)} ${p.id}`);
}
console.log(`bounded at ${AS_OF} (planned entries after this instant are not counted)`);
console.log(DRY ? "\nDRY RUN: nothing written." : `\nupdated ${updated} order rows.`);

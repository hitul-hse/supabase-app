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
 *
 * EVERY RUN RECORDS ITSELF (2026-09-05). The bound instant is written to
 * public.projects.logged_hours_as_of on every linked order, including the ones
 * with nothing logged, and the entry read is bounded on created_at at the same
 * instant as started_at. That makes the stored figure re-derivable -- "the
 * entries that had started and had been imported by as_of" -- which is what
 * check-order-hours-freshness.mjs now holds it against, instead of the live sum
 * that no snapshot can ever equal for long. It is also how the gate found that
 * this script had not run since the 2026-09-02 hand-run: the nightly workflow
 * step was skipped four nights behind a red parity check, and separately this
 * file read `.env.local` with a bare readFileSync that ENOENTs on a runner (the
 * three scripts beside it in the workflow already used lib/gate-env.mjs).
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";
import { MIGRATION } from "./lib/order-hours-freshness.mjs";

const DRY = process.argv.includes("--dry-run");

// process.env first, .env.local as a local convenience -- the workflow injects
// secrets and has no file. A writer with no credentials must say so and fail,
// not skip: a green step that refreshed nothing is the failure this repo keeps
// producing.
const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("refresh-order-hours: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set -- nothing was refreshed");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const timeDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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
// and not others. Bounded on BOTH started_at and created_at: an entry
// imported after this instant belongs to the next run, and the gate
// re-derives the figure from exactly that definition.
const AS_OF = new Date().toISOString();
const entries = await page(timeDb, "entry", "id, project_id, duration_seconds, is_billable", (q) =>
  q.not("duration_seconds", "is", null).lte("started_at", AS_OF).lte("created_at", AS_OF),
);
const orders = await page(db, "projects", "id, contract_hours, logged_hours");

const orderByTT = new Map(tt.map((t) => [t.id, t.hub_project_id]));
const linked = new Set(orderByTT.values());
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

console.log(`linked orders: ${linked.size}; with hours from links: ${sums.size}`);

let updated = 0;
const previews = [];
const seen = new Set();
for (const o of orders) {
  if (!linked.has(o.id)) continue;
  seen.add(o.id);
  // A linked order with no entry yet is a measured zero, and it gets the as_of
  // like every other: "nothing logged as of Wed 10:12" is a statement, "no row
  // was touched" is not.
  const s = sums.get(o.id) ?? { loggedSec: 0, billableSec: 0 };
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
        logged_hours_as_of: AS_OF,
      })
      .eq("id", o.id);
    if (error) {
      const hint = /logged_hours_as_of/.test(error.message) ? ` -- paste ${MIGRATION} first` : "";
      throw new Error(`${o.id}: ${error.message}${hint}`);
    }
    updated += 1;
  }
}

// A link whose order is not in public.projects cannot be refreshed and should
// not be silently dropped from the count.
const dangling = [...linked].filter((id) => !seen.has(id));

previews.sort((a, b) => b.consumed - a.consumed);
console.log("\nworst after refresh:");
for (const p of previews.slice(0, 12)) {
  console.log(`  ${String(p.consumed).padStart(5)}%  ${String(p.contract).padStart(6)}h contract  ${String(p.logged).padStart(7)}h logged  ${p.status.padEnd(8)} ${p.id}`);
}
console.log(`bounded at ${AS_OF} (entries started or imported after this instant belong to the next run)`);
if (dangling.length) console.log(`${dangling.length} link(s) point at no public.projects row and were not refreshed: ${dangling.slice(0, 5).join(", ")}${dangling.length > 5 ? ", ..." : ""}`);
console.log(DRY
  ? `\nDRY RUN: nothing written (${previews.length} linked order rows would carry logged_hours_as_of = ${AS_OF}).`
  : `\nupdated ${updated} of ${previews.length} linked order rows, each stamped logged_hours_as_of = ${AS_OF}.`);
if (!DRY && updated !== previews.length) {
  console.error(`refresh-order-hours: ${previews.length - updated} linked order(s) were not written`);
  process.exit(1);
}

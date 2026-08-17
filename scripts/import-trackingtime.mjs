/**
 * Import TrackingTime into the `time` schema.
 *
 * Stage 2 and 3 of the three-stage process (PLATFORM-ARCHITECTURE.md §5):
 * land the vendor payload verbatim in `raw`, then transform into typed tables.
 *
 * Design decisions worth knowing before changing anything here:
 *
 *  * RAW FIRST, ALWAYS. Every fetched record is written to raw.vendor_record
 *    before any transform runs. If the transform is wrong we re-read from raw
 *    rather than re-pulling from a vendor that rate-limits us and may no longer
 *    hold the old value.
 *
 *  * IDEMPOTENT. Everything upserts on source_id, so re-running is safe and
 *    is the normal way to refresh. A second run must not duplicate an hour.
 *
 *  * PAGINATION IS PER-ENTITY. Measured against the live account:
 *      /projects  returns everything at once; page=2 is empty        (334 real)
 *      /customers IGNORES ?page entirely -- page 2 repeats page 1    (197 real)
 *      /tasks     genuinely pages at 100/page                        (600+ real)
 *    A single generic paging loop silently loses data on one of the three, so
 *    each is handled explicitly and paging stops when ids start repeating.
 *
 *  * ERRORS ARRIVE AS HTTP 200 with response.status = 500 in the body. res.ok
 *    is not a success check for this vendor; unwrap() is the only safe reader.
 *
 * Usage:
 *   node scripts/import-trackingtime.mjs            # last 180 days
 *   node scripts/import-trackingtime.mjs --days 30
 *   node scripts/import-trackingtime.mjs --dry-run  # fetch + transform, no writes
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  toEntryDraft,
  classifyService,
} from "../src/lib/time-transform.ts";

// --- config -----------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const DAYS = Number(args[args.indexOf("--days") + 1]) || 180;

/** .env.local is gitignored and holds the App Password; never log its value. */
function loadEnv() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();

const AUTH = ENV.TRACKINGTIME_AUTH;
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

if (!AUTH) {
  console.error("TRACKINGTIME_AUTH is not set. Add it to .env.local as base64('email:APP_PASSWORD').");
  process.exit(1);
}
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run.");
  process.exit(1);
}

const BASE = "https://api.trackingtime.co/api/v4";
const HEADERS = {
  Authorization: `Basic ${AUTH}`,
  Accept: "application/json",
  "User-Agent": "HSE Hub Import (info@hs-experts.com)",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSE_MS = 350;

// --- vendor API -------------------------------------------------------------

/**
 * The single most important function here. TrackingTime reports failures as
 * HTTP 200 with the real status inside the envelope, so a permissive reader
 * turns a failed call into "0 records" and the import looks like a success.
 */
function unwrap(body) {
  const status = body?.response?.status;
  if (status !== undefined && Number(status) >= 400) {
    throw new Error(`TrackingTime API ${status}: ${body?.response?.message ?? "no message"}`);
  }
  const data = body?.data ?? body;
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  // A wrong credential DOES fail loudly with a real 401, so this still matters.
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return unwrap(await res.json());
}

/**
 * Page until the vendor stops giving us anything new.
 *
 * The stop condition is "no new ids", not "fewer than a full page". /customers
 * ignores ?page and returns the identical set forever, so a page-count loop
 * never terminates and a length check never fires.
 */
async function getAllPaged(pathFn, idKey = "id", maxPages = 40) {
  const seen = new Set();
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await get(pathFn(page));
    if (!rows.length) break;
    const fresh = rows.filter((r) => !seen.has(String(r[idKey])));
    if (!fresh.length) break; // the /customers case: same rows again
    for (const r of fresh) {
      seen.add(String(r[idKey]));
      all.push(r);
    }
    await sleep(PAUSE_MS);
  }
  return all;
}

// --- database ---------------------------------------------------------------

const db = DRY_RUN
  ? null
  : createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const hash = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

/** Land verbatim payloads before transforming. Chunked to stay under limits. */
async function landRaw(entity, endpoint, records, accountRef, idKey = "id") {
  if (DRY_RUN || !records.length) return;
  const rows = records.map((r) => ({
    source: "trackingtime",
    entity,
    endpoint,
    source_id: String(r[idKey] ?? r.ID ?? ""),
    account_ref: String(accountRef),
    payload: r,
    payload_hash: hash(r),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .schema("raw")
      .from("vendor_record")
      .upsert(rows.slice(i, i + 500), { onConflict: "source,entity,source_id,account_ref" });
    if (error) throw new Error(`raw.vendor_record ${entity}: ${error.message}`);
  }
}

async function upsert(table, rows, onConflict) {
  if (DRY_RUN || !rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .schema("time")
      .from(table)
      .upsert(rows.slice(i, i + 500), { onConflict })
      .select("id, source_id");
    if (error) throw new Error(`time.${table}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

/** source_id -> internal id, for resolving foreign keys on the entry rows. */
function idMap(rows) {
  return new Map(rows.filter((r) => r.source_id).map((r) => [String(r.source_id), r.id]));
}

async function recordRun(entity, status, count, error) {
  if (DRY_RUN) return;
  await db
    .schema("raw")
    .from("sync_run")
    .insert({
      source: "trackingtime",
      entity,
      finished_at: new Date().toISOString(),
      status,
      record_count: count,
      error_message: error ?? null,
    });
}

// --- run --------------------------------------------------------------------

async function main() {
  console.log(`TrackingTime import${DRY_RUN ? " (DRY RUN -- no writes)" : ""}, last ${DAYS} days\n`);

  // Resolve the workspace explicitly. Without /:account_id/ the API silently
  // uses a default, so a multi-workspace login can import the wrong company.
  const accountId = ENV.TRACKINGTIME_ACCOUNT_ID ?? (await get("/me"))[0]?.account_id;
  if (!accountId) throw new Error("Could not resolve a TrackingTime account id.");
  const S = `/${accountId}`;
  console.log(`workspace: account ${accountId}`);

  // --- fetch ---------------------------------------------------------------
  // filter=ALL, not the bare endpoint. Measured: /users returns 19 (active
  // only) while ?filter=ALL returns 49 -- the other 30 are archived colleagues
  // who nonetheless logged 445 hours in the last 180 days. Fetching the default
  // set silently drops every one of those hours, because member_id is NOT NULL
  // and the entry is skipped when its user cannot be resolved. Note that
  // ?include_archived=true and ?status=ALL both return 19: they look like they
  // work and do nothing.
  const users = await get(`${S}/users?filter=ALL`);
  const activeCount = users.filter((u) => !u.is_archived).length;
  console.log(`  users: ${users.length} (${activeCount} active, ${users.length - activeCount} archived)`);
  await sleep(PAUSE_MS);

  const customers = await getAllPaged((p) => `${S}/customers?page=${p}`);
  console.log(`  customers: ${customers.length}`);

  const projects = await getAllPaged((p) => `${S}/projects?page=${p}`);
  console.log(`  projects: ${projects.length}`);

  const tasks = await getAllPaged((p) => `${S}/tasks?page=${p}&page_size=100`);
  console.log(`  tasks: ${tasks.length}`);

  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86400_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const events = await get(
    `${S}/events/flat?filter=COMPANY&from=${fmt(from)}&to=${fmt(to)}&include_custom_fields=true`,
  );
  console.log(`  events: ${events.length}\n`);

  // --- land raw ------------------------------------------------------------
  if (!DRY_RUN) {
    await landRaw("users", `${S}/users`, users, accountId);
    await landRaw("customers", `${S}/customers`, customers, accountId);
    await landRaw("projects", `${S}/projects`, projects, accountId);
    await landRaw("tasks", `${S}/tasks`, tasks, accountId);
    await landRaw("events-flat", `${S}/events/flat`, events, accountId, "ID");
    console.log("landed raw payloads\n");
  }

  // --- services ------------------------------------------------------------
  // Not a vendor endpoint (/services does not exist -- verified). The catalogue
  // is reconstructed from the names appearing on projects and events, which is
  // the only place it is exposed.
  const serviceByName = new Map();
  for (const p of projects) if (p.service?.id) serviceByName.set(p.service.name, String(p.service.id));
  for (const e of events) if (e["Service Id"]) serviceByName.set(e["Service"], String(e["Service Id"]));
  serviceByName.delete(undefined);
  serviceByName.delete(null);

  const serviceRows = [...serviceByName].map(([name, sourceId]) => ({
    source_id: sourceId,
    name,
    ...(({ isTravel, isPaidTravel, isInternal }) => ({
      is_travel: isTravel,
      is_paid_travel: isPaidTravel,
      is_internal: isInternal,
    }))(classifyService(name)),
  }));
  const services = await upsert("service", serviceRows, "name");
  console.log(`services: ${DRY_RUN ? serviceRows.length : services.length}`);

  // --- customers -----------------------------------------------------------
  const customerRows = customers.map((c) => ({
    source_id: String(c.id),
    name: c.name,
    is_archived: Boolean(c.is_archived),
  }));
  const customerOut = await upsert("customer", customerRows, "source_id");
  const customerIds = idMap(customerOut);
  console.log(`customers: ${DRY_RUN ? customerRows.length : customerOut.length}`);

  // --- projects ------------------------------------------------------------
  const serviceIds = idMap(services);
  const projectRows = projects.map((p) => ({
    source_id: String(p.id),
    customer_id: p.customer?.id ? (customerIds.get(String(p.customer.id)) ?? null) : null,
    name: p.name,
    code: p.code ?? null,
    service_id: p.service?.id ? (serviceIds.get(String(p.service.id)) ?? null) : null,
    is_billable: p.billing?.is_billable !== false,
    is_archived: Boolean(p.is_archived),
    // estimated_time is fractional HOURS on this entity, unlike events.
    estimated_hours: typeof p.estimated_time === "number" ? p.estimated_time : null,
  }));
  const projectOut = await upsert("project", projectRows, "source_id");
  const projectIds = idMap(projectOut);
  console.log(`projects: ${DRY_RUN ? projectRows.length : projectOut.length}`);

  // --- tasks ---------------------------------------------------------------
  const taskRows = tasks.map((t) => ({
    source_id: String(t.id),
    project_id: t.project_id ? (projectIds.get(String(t.project_id)) ?? null) : null,
    name: t.name ?? null,
    task_type: t.type === "GHOST" ? "GHOST" : "PERSONAL",
    is_archived: Boolean(t.is_archived),
  }));
  const taskOut = await upsert("task", taskRows, "source_id");
  const taskIds = idMap(taskOut);
  console.log(`tasks: ${DRY_RUN ? taskRows.length : taskOut.length}`);

  // --- members -------------------------------------------------------------
  // weekly_hours comes from the per-weekday schedule the vendor carries on every
  // user -- a real contracted figure, and the honest utilisation denominator.
  const memberRows = users.map((u) => {
    const s = u.schedule ?? {};
    const weekly = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
      .map((d) => Number(s[d]) || 0)
      .reduce((a, b) => a + b, 0);
    return {
      source_id: String(u.id),
      email: u.email ?? null,
      display_name: [u.name, u.surname].filter(Boolean).join(" ").trim() || u.email || `User ${u.id}`,
      role: ["ADMIN", "MANAGER", "PROJECT_MANAGER", "CO_WORKER"].includes(u.role) ? u.role : "CO_WORKER",
      status: ["REGISTERED", "VERIFIED", "INVITED"].includes(u.status) ? u.status : "REGISTERED",
      is_archived: Boolean(u.is_archived),
      weekly_hours: weekly > 0 ? weekly : 40,
    };
  });
  const memberOut = await upsert("member", memberRows, "source_id");
  const memberIds = idMap(memberOut);
  console.log(`members: ${DRY_RUN ? memberRows.length : memberOut.length}`);

  // --- rates ---------------------------------------------------------------
  // One open-ended row per member. The vendor has no history to import, but the
  // table is dated from the start because history cannot be reconstructed later
  // and re-costing last year at this year's rate is simply wrong.
  if (!DRY_RUN) {
    for (const u of users) {
      const mid = memberIds.get(String(u.id));
      if (!mid) continue;
      const rate = u.billing?.hourly_rate ?? null;
      const cost = u.billing?.hourly_cost ?? null;
      if (rate === null && cost === null) continue;

      const { data: open } = await db
        .schema("time")
        .from("member_rate")
        .select("id, hourly_rate, hourly_cost")
        .eq("member_id", mid)
        .is("valid_to", null)
        .limit(1);

      const cur = open?.[0];
      // Only write when the figure actually changed -- otherwise every run
      // would append a duplicate row and destroy the history it exists to keep.
      if (cur && Number(cur.hourly_rate) === Number(rate) && Number(cur.hourly_cost) === Number(cost)) continue;

      const today = new Date().toISOString().slice(0, 10);
      if (cur) {
        await db.schema("time").from("member_rate").update({ valid_to: today }).eq("id", cur.id);
      }
      await db
        .schema("time")
        .from("member_rate")
        .insert({ member_id: mid, hourly_rate: rate, hourly_cost: cost, valid_from: today });
    }
    console.log("rates: reconciled");
  }

  // --- entries -------------------------------------------------------------
  let skipped = 0;
  let skippedSeconds = 0;
  const unresolvedMembers = new Map();
  const entryRows = [];
  for (const e of events) {
    const d = toEntryDraft(e);
    if (!d) {
      skipped++;
      continue;
    }
    const memberId = memberIds.get(d.memberSourceId);
    // An entry with no known member cannot be stored -- member_id is NOT NULL
    // by design, because unattributable time is not time tracking.
    if (!memberId && !DRY_RUN) {
      // Loud, not silent. This is how 445 hours nearly went missing: /users
      // returns only active colleagues, so every archived person's time was
      // being dropped with no signal at all.
      skipped++;
      skippedSeconds += d.durationSeconds;
      unresolvedMembers.set(d.memberSourceId, (unresolvedMembers.get(d.memberSourceId) ?? 0) + 1);
      continue;
    }
    entryRows.push({
      source_id: d.sourceId,
      member_id: memberId ?? null,
      task_id: d.taskSourceId ? (taskIds.get(d.taskSourceId) ?? null) : null,
      project_id: d.projectSourceId ? (projectIds.get(d.projectSourceId) ?? null) : null,
      customer_id: d.customerSourceId ? (customerIds.get(d.customerSourceId) ?? null) : null,
      service_id: d.serviceSourceId ? (serviceIds.get(d.serviceSourceId) ?? null) : null,
      started_at: d.startedAt,
      ended_at: d.endedAt,
      duration_seconds: d.durationSeconds,
      is_billable: d.isBillable,
      is_billed: d.isBilled,
      notes: d.notes,
      timezone: d.timezone,
      source_system: d.sourceSystem,
      is_calendar: d.isCalendar,
    });
  }

  const entryOut = await upsert("entry", entryRows, "source_id");
  console.log(`entries: ${DRY_RUN ? entryRows.length : entryOut.length} (skipped ${skipped})`);

  if (unresolvedMembers.size) {
    console.warn(
      `\nWARNING: ${skipped} events (${(skippedSeconds / 3600).toFixed(1)}h) reference ` +
        `${unresolvedMembers.size} TrackingTime user id(s) missing from /users?filter=ALL:`,
    );
    for (const [id, n] of unresolvedMembers) console.warn(`  user ${id}: ${n} events`);
    console.warn("Those hours are NOT imported. Investigate before trusting any total.\n");
  }

  const totalSeconds = entryRows.reduce((a, r) => a + (r.duration_seconds ?? 0), 0);
  const billableSeconds = entryRows
    .filter((r) => r.is_billable)
    .reduce((a, r) => a + (r.duration_seconds ?? 0), 0);
  console.log(
    `\ntotal ${(totalSeconds / 3600).toFixed(1)}h, billable ${(billableSeconds / 3600).toFixed(1)}h ` +
      `(${totalSeconds ? Math.round((billableSeconds / totalSeconds) * 100) : 0}%)`,
  );

  await recordRun("events-flat", "ok", entryRows.length, null);
  console.log(DRY_RUN ? "\ndry run complete -- nothing written" : "\nimport complete");
}

main().catch(async (err) => {
  console.error(`\nimport failed: ${err.message}`);
  try {
    await recordRun("events-flat", "failed", null, err.message);
  } catch {
    /* the run record is best-effort; the real error is already reported */
  }
  process.exit(1);
});

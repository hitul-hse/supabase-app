// Discovery runner — read-only reconnaissance against a vendor API.
//
// Stage 1 of the three-stage integration process in
// docs/architecture/PLATFORM-ARCHITECTURE.md §5: discover, then model, then own.
// This script does discover, and nothing else. It performs GETs only, writes no
// vendor data anywhere, and produces field inventories for a human to read
// before any DDL is written.
//
// Usage (keys come from .env.local or the environment; never pass them on the
// command line, where they land in shell history):
//
//   node scripts/discover/run.mjs asana
//   node scripts/discover/run.mjs trackingtime
//   node scripts/discover/run.mjs factorial
//   node scripts/discover/run.mjs all
//
// Output goes to docs/discovery/<source>/<entity>.md plus a .json alongside.
// That directory is gitignored: vendor payloads contain real names, emails and
// salary data, so the default is that nothing lands in the repo.
//
// Deliberate safety properties:
//   - GET only. No method other than GET is ever issued.
//   - Sample-capped, so a discovery run cannot become a full export.
//   - Retry-After is honoured exactly (required by Asana: rejected requests
//     still count against the quota, so retrying early makes it worse).
//   - Credentials are never printed, including in error messages.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, renderMarkdown } from "./inventory.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT_ROOT = join(REPO, "docs", "discovery");

/** Enough records to see the shape; not so many that this becomes an export. */
const SAMPLE_LIMIT = 200;
/** Stay far below every documented concurrency cap — discovery is not a race. */
const PAGE_PAUSE_MS = 350;

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

/** Read .env.local without a dependency, and without echoing any value. */
function loadEnv() {
  const env = { ...process.env };
  const file = join(REPO, ".env.local");
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
  return env;
}

const ENV = loadEnv();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

/**
 * GET with rate-limit respect. Never logs headers or the URL's query string,
 * because tokens are sometimes passed as query parameters by these vendors.
 */
async function get(url, headers, { attempt = 0 } = {}) {
  const res = await fetch(url, { method: "GET", headers });

  if (res.status === 429) {
    // Use the header value, never a hard-coded minute: the quota window is
    // evaluated more often than once per minute, so Retry-After is usually
    // shorter than 60s and is the only accurate number available.
    const wait = Number(res.headers.get("retry-after") ?? "5");
    if (attempt >= 4) throw new Error(`rate limited repeatedly (gave up after ${attempt} retries)`);
    console.log(`   rate limited — waiting ${wait}s as instructed`);
    await sleep(wait * 1000);
    return get(url, headers, { attempt: attempt + 1 });
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `auth rejected (HTTP ${res.status}). Check the key's scopes — do not paste the key anywhere to debug it.`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// connectors
//
// Each returns { entity, endpoint, records }. Endpoint choices err toward the
// cheap, wide reads that reveal shape — not toward completeness.
// ---------------------------------------------------------------------------

const CONNECTORS = {
  /**
   * Asana. Paid domains allow 1500 req/min so volume is comfortable, but the
   * cost limiter is driven by opt_fields width — so we ask for the fields we
   * would actually model, and no more.
   */
  asana: {
    label: "Asana",
    envKey: "ASANA_ACCESS_TOKEN",
    help:
      "Create a Personal Access Token at https://app.asana.com/0/my-apps and set ASANA_ACCESS_TOKEN.\n" +
      "   Use a token dedicated to this integration — Asana allocates rate limits per token.",
    async run(token) {
      const base = "https://app.asana.com/api/1.0";
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      const out = [];

      const me = await get(`${base}/users/me`, headers);
      out.push({ entity: "user-me", endpoint: "/users/me", records: [me.data] });

      const workspaces = me.data?.workspaces ?? [];
      if (!workspaces.length) {
        console.log("   no workspaces on this token — nothing further to sample");
        return out;
      }
      const ws = workspaces[0].gid;
      console.log(`   workspace: ${workspaces[0].name} (${workspaces.length} total)`);

      const paged = async (path, entity, optFields) => {
        const records = [];
        let url = `${base}${path}${path.includes("?") ? "&" : "?"}limit=100${
          optFields ? `&opt_fields=${optFields}` : ""
        }`;
        while (url && records.length < SAMPLE_LIMIT) {
          const page = await get(url, headers);
          records.push(...(page.data ?? []));
          const next = page.next_page?.uri;
          url = next && records.length < SAMPLE_LIMIT ? next : null;
          if (url) await sleep(PAGE_PAUSE_MS);
        }
        out.push({ entity, endpoint: path, records: records.slice(0, SAMPLE_LIMIT) });
        console.log(`   ${entity}: ${records.length} records`);
      };

      await paged(`/workspaces/${ws}/users`, "users", "name,email,photo");
      await paged(`/workspaces/${ws}/teams`, "teams", "name,description");
      await paged(
        `/workspaces/${ws}/projects`,
        "projects",
        "name,archived,color,created_at,current_status,due_on,start_on,notes,owner,team,workspace,public",
      );

      // Tasks only from the first non-archived project: the point is the shape
      // of a task, and pulling every task in the domain is an export, not
      // discovery.
      const projects = out.find((o) => o.entity === "projects")?.records ?? [];
      const live = projects.find((p) => !p.archived) ?? projects[0];
      if (live) {
        console.log(`   sampling tasks from project: ${live.name}`);
        await paged(
          `/projects/${live.gid}/tasks`,
          "tasks",
          "name,completed,completed_at,created_at,modified_at,due_on,due_at,assignee,assignee_status,notes,num_subtasks,parent,projects,memberships,tags,custom_fields",
        );
      }

      return out;
    },
  },

  /**
   * TrackingTime. Limits are not published, so this is deliberately gentle.
   * events/flat is the bulk read their own Power BI integration uses, which
   * makes it the most likely production sync surface — worth inventorying even
   * though it is the widest payload here.
   */
  trackingtime: {
    label: "TrackingTime",
    envKey: "TRACKINGTIME_AUTH",
    help:
      "Set TRACKINGTIME_AUTH to base64('email:APP_PASSWORD').\n" +
      "   Generate an App Password in TrackingTime — the normal login password will not work.",
    async run(auth) {
      const base = "https://api.trackingtime.co/api/v4";
      const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
      const out = [];

      // These vendors vary in whether the payload is bare or wrapped in
      // { data: [...] }, so normalise rather than assuming either.
      const unwrap = (r) => (Array.isArray(r) ? r : (r?.data ?? (r ? [r] : [])));

      const simple = async (path, entity) => {
        try {
          const body = await get(`${base}${path}`, headers);
          const records = unwrap(body).slice(0, SAMPLE_LIMIT);
          out.push({ entity, endpoint: path, records });
          console.log(`   ${entity}: ${records.length} records`);
        } catch (err) {
          // A 404 here is information — it tells us the endpoint isn't on this
          // plan — so record it rather than aborting the whole run.
          console.log(`   ${entity}: unavailable (${err.message.slice(0, 90)})`);
        }
        await sleep(PAGE_PAUSE_MS);
      };

      await simple("/users", "users");
      await simple("/customers", "customers");
      await simple("/projects", "projects");
      await simple("/tasks", "tasks");
      await simple("/services", "services");

      // A 60-day window: long enough to see real variety, short enough to stay
      // a sample. Also the endpoint where Google Calendar events should appear
      // if they are exposed at all — worth checking explicitly.
      const to = new Date();
      const from = new Date(to.getTime() - 60 * 86400_000);
      const fmt = (d) => d.toISOString().slice(0, 10);
      await simple(
        `/events/flat?filter=COMPANY&from=${fmt(from)}&to=${fmt(to)}&include_custom_fields=true`,
        "events-flat",
      );

      return out;
    },
  },

  /**
   * FactorialHR. The most sensitive payloads in the platform — expect salary,
   * contract and personal data, all of which the inventory flags as PII.
   */
  factorial: {
    label: "FactorialHR",
    envKey: "FACTORIAL_API_KEY",
    help:
      "An admin creates the key in Factorial under Configuration → API, then set FACTORIAL_API_KEY.",
    async run(key) {
      const base = "https://api.factorialhr.com/api/v1";
      const headers = { "x-api-key": key, Accept: "application/json" };
      const out = [];

      const simple = async (path, entity) => {
        try {
          const body = await get(`${base}${path}`, headers);
          const records = (Array.isArray(body) ? body : (body?.data ?? [])).slice(0, SAMPLE_LIMIT);
          out.push({ entity, endpoint: path, records });
          console.log(`   ${entity}: ${records.length} records`);
        } catch (err) {
          console.log(`   ${entity}: unavailable (${err.message.slice(0, 90)})`);
        }
        await sleep(PAGE_PAUSE_MS);
      };

      await simple("/employees", "employees");
      await simple("/teams", "teams");
      await simple("/locations", "locations");
      await simple("/leaves", "leaves");
      await simple("/leave_types", "leave-types");
      await simple("/attendance/shifts", "attendance-shifts");
      await simple("/contracts/contract_versions", "contract-versions");

      return out;
    },
  },
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function discover(name) {
  const conn = CONNECTORS[name];
  const credential = ENV[conn.envKey];

  console.log(`\n=== ${conn.label} ===`);

  if (!credential) {
    console.log(`   SKIPPED — ${conn.envKey} is not set.`);
    console.log(`   ${conn.help}`);
    return { name, skipped: true };
  }

  const sets = await conn.run(credential);
  const dir = join(OUT_ROOT, name);
  mkdirSync(dir, { recursive: true });

  let warnings = 0;
  for (const set of sets) {
    const inv = buildInventory({ source: conn.label, ...set });
    warnings += inv.warnings.length;
    writeFileSync(join(dir, `${set.entity}.md`), renderMarkdown(inv), "utf8");
    writeFileSync(join(dir, `${set.entity}.json`), JSON.stringify(inv, null, 2), "utf8");
  }

  console.log(`   → ${sets.length} inventories written to docs/discovery/${name}/`);
  console.log(`   → ${warnings} items flagged for a schema decision`);
  return { name, entities: sets.length, warnings };
}

async function main() {
  const arg = (process.argv[2] ?? "all").toLowerCase();
  const targets =
    arg === "all" ? Object.keys(CONNECTORS) : arg in CONNECTORS ? [arg] : null;

  if (!targets) {
    console.error(`Unknown source "${arg}". Known: ${Object.keys(CONNECTORS).join(", ")}, all`);
    process.exit(2);
  }

  console.log("Discovery — read-only. GET requests only; no vendor data is committed.");

  const results = [];
  for (const t of targets) {
    try {
      results.push(await discover(t));
    } catch (err) {
      console.error(`\n=== ${t} FAILED ===\n   ${err.message}`);
      results.push({ name: t, failed: true });
    }
  }

  console.log("\n--- summary ---");
  for (const r of results) {
    if (r.skipped) console.log(`${r.name}: skipped (no credential)`);
    else if (r.failed) console.log(`${r.name}: FAILED`);
    else console.log(`${r.name}: ${r.entities} entities, ${r.warnings} decisions flagged`);
  }

  const ran = results.filter((r) => !r.skipped && !r.failed);
  if (!ran.length) {
    console.log("\nNothing ran. Set the credentials above and re-run.");
  } else {
    console.log("\nRead the .md reports before writing any DDL. Model from observed shape, not docs.");
  }

  // A skipped source is not a failure — that's the normal state before keys
  // arrive. Only a real error should break a caller.
  process.exit(results.some((r) => r.failed) ? 1 : 0);
}

main();

// Applies the app_module repair from supabase/schema.sql to the LIVE project:
// moves the TrackingTime tile off the personal tracker and onto the
// organisation dashboard, and renames it.
//
// Why a script rather than "just run the SQL": the seed uses
// `on conflict do nothing`, so re-running schema.sql cannot correct a row that
// already exists. The tile is data, and the live database is the only place
// that matters -- a green PGlite gate proves the STATEMENT is right, not that
// anyone ran it.
//
// Idempotent and narrow, matching the SQL exactly: only a tile still sitting on
// '/time' is moved, so a deliberate re-route made in the admin UI survives.
// Re-running after a successful apply is a no-op and reports as such.
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.error("no .env.local — cannot reach the live project");
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

// Read first, so the output can say what actually changed rather than
// asserting success from a 2xx.
const before = await fetch(
  `${url}/rest/v1/app_module?select=module_key,display_name,tagline,href,is_live&module_key=eq.time`,
  { headers },
).then((r) => r.json());

const row = before[0];
if (!row) {
  console.error("no app_module row for module_key='time' — nothing to repair");
  process.exit(1);
}

console.log(`before: href=${row.href}  name="${row.display_name}"  live=${row.is_live}`);

if (row.href === "/time/dashboard") {
  console.log("already on the dashboard — no change");
} else if (row.href !== "/time") {
  // Narrow, deliberately. Someone re-routed this on purpose; do not clobber it.
  console.log(`href is "${row.href}", not "/time" — left alone (customised)`);
} else {
  const res = await fetch(`${url}/rest/v1/app_module?module_key=eq.time&href=eq./time`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      href: "/time/dashboard",
      display_name: "TrackingTime API Dashboard",
      tagline: "Company hours, projects, customers, budgets",
    }),
  });
  if (res.status >= 300) {
    console.error(`PATCH failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
}

// Re-read rather than trusting the PATCH response: the point is the end state.
const after = await fetch(
  `${url}/rest/v1/app_module?select=display_name,tagline,href,is_live&module_key=eq.time`,
  { headers },
).then((r) => r.json());

const now = after[0];
console.log(`after:  href=${now.href}  name="${now.display_name}"  live=${now.is_live}`);

const ok = now.href === "/time/dashboard" && now.display_name === "TrackingTime API Dashboard";
console.log(ok ? "\nPORTAL TILE: points at the dashboard" : "\nPORTAL TILE: NOT repaired");
process.exit(ok ? 0 : 1);

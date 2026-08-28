// Read-only: identify the entry we hold that TrackingTime no longer reports.
// Mirrors check-vendor-parity's exact endpoint, monthly slicing and ordered
// paging, so this cannot disagree with the gate for methodological reasons.
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const auth = env.TRACKINGTIME_AUTH;
const acct = env.TRACKINGTIME_ACCOUNT_ID;

async function tt(path) {
  const r = await fetch(`https://app.trackingtime.co/api/v4${path}`, {
    headers: { Authorization: `Basic ${auth}`, "TT-Account": acct },
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  const j = await r.json();
  return j.data ?? j;
}

const year = new Date().getUTCFullYear();
const byId = new Map();
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const rows = await tt(`/events/flat?filter=COMPANY&from=${year}-${mm}-01&to=${year}-${mm}-${last}&include_custom_fields=true`);
  for (const e of rows) byId.set(String(e.ID ?? e.id), e);
}
const ttIds = new Set(byId.keys());

const ours = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await admin.schema("time").from("entry")
    .select("id,source_id,duration_seconds,started_at,notes,is_calendar,member_id,task_id")
    .gte("started_at", `${year}-01-01T00:00:00.000Z`)
    .lt("started_at", `${year + 1}-01-01T00:00:00.000Z`)
    .not("duration_seconds", "is", null)
    .order("id", { ascending: true })
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  ours.push(...data);
  if (data.length < 1000) break;
}

const stale = ours.filter((r) => !ttIds.has(String(r.source_id)));
console.log(`vendor ${ttIds.size} events · ours ${ours.length} entries · stale ${stale.length}\n`);

for (const s of stale) {
  console.log(JSON.stringify(s, null, 2));
  // Confirm against the vendor directly rather than trusting the set difference:
  // a paging or filter artefact would look identical to a real deletion.
  try {
    const one = await tt(`/events/${s.source_id}`);
    console.log(`  direct lookup of event ${s.source_id}: ${JSON.stringify(one).slice(0, 300)}`);
  } catch (e) {
    console.log(`  direct lookup of event ${s.source_id}: ${e.message} (consistent with deletion)`);
  }
}

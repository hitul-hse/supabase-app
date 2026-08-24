// How tall are these pages really? Sign in as an exec (who sees everything, so
// worst case) and count the rendered rows per page. "Scrolling a lot" is a
// measurable quantity and this is it.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://hseportal.hs-experts.com";
const EMAIL = process.argv[2] ?? "bjoern.schoenemann@hs-experts.com"; // exec = most rows

const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await gen.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;

const jar = new Map();
const absorb = (r) => { for (const raw of (r.headers.getSetCookie?.() ?? [])) { const [p] = raw.split(";"); const i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); } };
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

let url = `${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`;
for (let i = 0; i < 6; i++) {
  const r = await fetch(url, { headers: { cookie: ck() }, redirect: "manual" });
  absorb(r);
  const loc = r.headers.get("location");
  if (!loc) break;
  url = loc.startsWith("http") ? loc : `${SITE}${loc}`;
}
console.log(`signed in as ${EMAIL}\n`);

const routes = ["/", "/my-work", "/projects", "/people", "/timesheets", "/dashboard/management", "/time/dashboard", "/team-lead", "/admin/roles"];

console.log("route".padEnd(26), "kb".padStart(6), "<tr>".padStart(6), "<table>".padStart(8), "tallest table");
for (const p of routes) {
  const r = await fetch(`${SITE}${p}`, { headers: { cookie: ck() } });
  if (!r.ok) { console.log(`${p.padEnd(26)} ${String(r.status).padStart(6)}`); continue; }
  const html = await r.text();

  const trs = (html.match(/<tr[\s>]/g) ?? []).length;
  const tables = (html.match(/<table[\s>]/g) ?? []).length;

  // Rows in the single biggest table, i.e. the one doing the scrolling.
  let tallest = 0;
  for (const m of html.split(/<table[\s>]/).slice(1)) {
    const end = m.indexOf("</table>");
    const seg = end >= 0 ? m.slice(0, end) : m;
    tallest = Math.max(tallest, (seg.match(/<tr[\s>]/g) ?? []).length);
  }

  console.log(
    p.padEnd(26),
    String(Math.round(html.length / 1024)).padStart(6),
    String(trs).padStart(6),
    String(tables).padStart(8),
    `  ${tallest} rows`,
  );
}

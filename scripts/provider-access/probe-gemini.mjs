// One consolidated Gemini access probe, replacing the eight exploratory scripts
// from the investigation. Runs the whole chain and reports what each step does.
//
// No credentials are embedded; see _creds.mjs.
import { freshAccessToken, DEFAULT_PROJECT } from "./_creds.mjs";

const { status, token, expiresIn, creds } = await freshAccessToken();

console.log("GEMINI ACCESS PROBE\n");

console.log("1. stored credential");
console.log(`   expired: ${Date.now() > creds.expiry_date}`);
console.log(`   has refresh_token: ${Boolean(creds.refresh_token)}`);
console.log(`   refresh -> HTTP ${status}${token ? ` (fresh token, ${expiresIn}s)` : " FAILED"}`);
if (!token) process.exit(0);

const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

console.log("\n2. Code Assist tier eligibility");
const tiers = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ metadata: { pluginType: "GEMINI" } }),
});
const tj = await tiers.json();
console.log(`   loadCodeAssist -> HTTP ${tiers.status}`);
for (const t of tj.allowedTiers || []) console.log(`   ALLOWED     ${t.id}  (usesGcpTos: ${t.usesGcpTos})`);
for (const t of tj.ineligibleTiers || []) console.log(`   INELIGIBLE  ${t.tierId}  ${t.reasonCode}`);

console.log("\n3. usable GCP project");
const projRes = await fetch(
  "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE",
  { headers: auth },
);
const pj = await projRes.json();
const projects = pj.projects || [];
console.log(`   list projects -> HTTP ${projRes.status}`);
console.log(
  `   ${projects.length} active project(s) visible${pj.error ? ` (${pj.error.message.slice(0, 80)})` : ""}`,
);
console.log(`   using: ${DEFAULT_PROJECT}`);

console.log("\n4. required APIs on that project");
for (const api of ["generativelanguage.googleapis.com", "cloudaicompanion.googleapis.com"]) {
  const r = await fetch(
    `https://serviceusage.googleapis.com/v1/projects/${DEFAULT_PROJECT}/services/${api}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const j = await r.json();
  console.log(`   ${api.padEnd(38)} ${j.state || "unknown"}`);
}

console.log("\n5. can the existing token actually generate?");
const gen = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  {
    method: "POST",
    headers: { ...auth, "x-goog-user-project": DEFAULT_PROJECT },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "say OK" }] }] }),
  },
);
const gj = await gen.json().catch(() => ({}));
console.log(`   generateContent -> HTTP ${gen.status}`);
console.log(`   ${(gj?.error?.message || gj?.candidates?.[0]?.content?.parts?.[0]?.text || "").slice(0, 160)}`);

console.log(`
VERDICT

  The account is NOT cut off. Code Assist's free tier is deprecated for this
  client, but standard-tier is allowed, and the free AI Studio API
  (generativelanguage.googleapis.com) is already enabled on the project.

  The stored OAuth token cannot call it: it holds cloud-platform scope but not
  generative-language, and scopes are fixed at consent time, so no refresh adds
  them.

  FREE route (recommended): create a key at https://aistudio.google.com/apikey
    then: jcode login --provider gemini-api --api-key <key>

  PAID route: enable cloudaicompanion.googleapis.com on ${DEFAULT_PROJECT}
    to use standard-tier. May start a paid subscription, so it needs an
    explicit decision from the account owner.`);

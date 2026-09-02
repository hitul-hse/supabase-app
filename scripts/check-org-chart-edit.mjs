/**
 * The org chart still records a hierarchy, on the current deployment.
 *
 * This is the regression guard for the reported failure. It does NOT try to force
 * deployment skew (that needs a redeploy mid-session, which cannot be staged from a
 * test); check-deploy-skew.mjs covers that half. What this proves is the part the
 * user was actually trying to do, end to end through the browser:
 *
 *   - "Björn is CEO, everyone gives updates to him": place someone under him and
 *     have it persist.
 *   - The refusal path still refuses: a reporting loop is rejected with a message
 *     rather than a broken page or a corrupt tree.
 *   - Neither path takes the page down.
 *
 * It restores whatever it changed, so it is safe against the live hierarchy.
 */
import { readFileSync } from "node:fs";
import { launchChromium } from "./lib/launch-chromium.mjs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.log("SKIP: no service-role key"); process.exit(0); }
const time = admin.schema("time");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Pick two real, active, non-archived people with accounts: a top-of-chart figure
// and somebody to place under them. Chosen from data rather than hardcoded, so this
// keeps working as the roster changes.
const { data: roster } = await time
  .from("member")
  .select("id, display_name, email, supervisor_member_id, is_archived, user_id")
  .eq("is_archived", false)
  .order("display_name");

const boss = roster.find((r) => (r.display_name ?? "").toLowerCase().includes("björn")) ?? roster[0];
const subordinate = roster.find((r) => r.id !== boss.id && r.user_id !== null && (r.email ?? "").includes("@"));
if (!boss || !subordinate) { console.log("SKIP: could not pick two people"); process.exit(0); }

const originalBoss = boss.supervisor_member_id;
const originalSub = subordinate.supervisor_member_id;
const setSup = async (id, sup) =>
  time.from("member").update({
    supervisor_member_id: sup,
    supervisor_source: sup === null ? null : "manual",
  }).eq("id", id);

const { data: execProfile } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1).maybeSingle();
const { data: execUser } = await admin.auth.admin.getUserById(execProfile.user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: execUser.user.email });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: verified } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const encoded = `base64-${Buffer.from(JSON.stringify({
  access_token: verified.session.access_token,
  refresh_token: verified.session.refresh_token,
  expires_at: verified.session.expires_at,
  expires_in: verified.session.expires_in,
  token_type: "bearer",
  user: verified.user,
})).toString("base64")}`;
const CHUNK = 3180;
const cookies = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
  cookies.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK) });
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies(cookies.map((c) => ({ ...c, domain: new URL(SITE).hostname, path: "/" })));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 500 || r.headers()["x-nextjs-action-not-found"]) {
    errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

const brokenPage = async () =>
  /This page couldn't load|This page couldn’t load|Application error|client-side exception/i.test(
    await page.locator("body").innerText(),
  );

const openEditorFor = async (name) => {
  const btn = page
    .locator(`div:has-text("${name}")`)
    .filter({ has: page.locator('button:text-is("EDIT")') })
    .last()
    .locator('button:text-is("EDIT")')
    .last();
  await btn.click({ timeout: 30_000 });
  await page.waitForTimeout(400);
};

try {
  // Start from a known state: the boss at the top, the other person unplaced.
  await setSup(boss.id, null);
  await setSup(subordinate.id, null);

  await page.goto(`${SITE}/people`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.getByRole("tab", { name: "Org chart" }).click();
  await page.waitForTimeout(1200);
  check("the org chart tab renders", /PLACED/.test(await page.locator("body").innerText()));

  // ── 1. The edit the user was making ──────────────────────────────────
  await openEditorFor(subordinate.display_name);
  const sel = page.locator('select[name="supervisor_member_id"]').locator("visible=true").first();
  const bossOption = await sel.locator(`option[value="${boss.id}"]`).count();
  check(`the top-of-chart person is offered as a manager`, bossOption > 0, boss.display_name);

  await sel.selectOption(String(boss.id));
  await page.locator('button:has-text("Save manager")').locator("visible=true").first().click();
  await page.waitForTimeout(5000);

  check("saving a reporting line does not break the page", !(await brokenPage()));
  const { data: saved } = await time
    .from("member").select("supervisor_member_id, supervisor_source").eq("id", subordinate.id).maybeSingle();
  check(
    "the reporting line is stored, attributed to a person",
    Number(saved?.supervisor_member_id) === Number(boss.id) && saved?.supervisor_source === "manual",
    JSON.stringify(saved),
  );
  const chartText = await page.locator("body").innerText();
  check(
    "the chart shows the new report under their manager",
    chartText.includes(subordinate.display_name) && /\d+ REPORT/.test(chartText),
    chartText.slice(chartText.indexOf("REPORTS TO"), chartText.indexOf("REPORTS TO") + 200).replace(/\s+/g, " "),
  );

  // ── 2. A loop is still refused, with words ───────────────────────────
  // Now that subordinate reports to boss, making boss report to subordinate closes
  // a cycle. It must be refused clearly -- not saved, and not a broken page.
  await openEditorFor(boss.display_name);
  const sel2 = page.locator('select[name="supervisor_member_id"]').locator("visible=true").first();
  await sel2.selectOption(String(subordinate.id));
  await page.locator('button:has-text("Save manager")').locator("visible=true").first().click();
  await page.waitForTimeout(5000);

  const afterLoop = await page.locator("body").innerText();
  check("a reporting loop is refused in words", /reporting loop/i.test(afterLoop));
  check("the refusal does not break the page", !(await brokenPage()));
  const { data: bossRow } = await time
    .from("member").select("supervisor_member_id").eq("id", boss.id).maybeSingle();
  check(
    "and nothing was written for the refused edit",
    bossRow?.supervisor_member_id === null,
    `boss now reports to ${bossRow?.supervisor_member_id}`,
  );

  check("no server errors or missing actions during either edit", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await setSup(boss.id, originalBoss);
  await setSup(subordinate.id, originalSub);
  console.log("\nhierarchy restored to its prior state");
}

console.log(failed === 0 ? "\nORG CHART EDIT: all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);

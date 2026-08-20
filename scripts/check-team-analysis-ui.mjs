/**
 * The per-team analysis, verified on PRODUCTION with both roles.
 * Waits for the deployment by polling for the new section's own text as an exec.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SITE = "https://hseportal.hs-experts.com";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const cookiesFor = async (email) => {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
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
  const out = [];
  for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
    out.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK), domain: new URL(SITE).hostname, path: "/" });
  }
  return out;
};

const browser = await chromium.launch();

const pageText = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1674, height: 1500 }, colorScheme: "dark" });
  await ctx.addCookies(await cookiesFor(email));
  await ctx.addInitScript(() => {
    localStorage.setItem("hse-hub-theme", "dark");
    // The onboarding tour keys off localStorage; mark it seen so it cannot cover
    // the page mid-verification, which blanked the previous screenshot run.
    localStorage.setItem("hse-hub-tour-completed", "1");
    localStorage.setItem("hseHubTourDone", "true");
  });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/team-lead`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const skip = page.locator('button:has-text("Skip tour")');
  if (await skip.count()) { await skip.first().click().catch(() => {}); await wait(500); }
  const text = await page.locator("body").innerText();
  await ctx.close();
  return text;
};

try {
  // Wait for the deployment: the exec's page must contain the new section header.
  const started = Date.now();
  let execText = "";
  for (;;) {
    execText = await pageText("hitul@hs-experts.com");
    if (/Analysis by team/i.test(execText)) {
      console.log(`deployed after ${Math.round((Date.now() - started) / 1000)}s\n`);
      break;
    }
    if (Date.now() - started > 480_000) { console.log("gave up waiting for the deployment"); process.exit(1); }
    await wait(20_000);
  }

  check("exec sees the segregated section", /Analysis by team/i.test(execText));
  check("exec sees a team count", /\d+ TEAMS/.test(execText), (execText.match(/\d+ TEAMS/) ?? [])[0]);
  check("exec sees the Tech team block", /Tech\b/.test(execText));
  check("exec sees the Operations team block", /Operations\b/.test(execText));
  check("the unassigned group is named, not dropped", /No team recorded/i.test(execText));
  check("per-team utilisation gauges render", /of nominal/i.test(execText));

  const dhText = await pageText("thorsten.krause@hs-experts.com");
  check("dept_head does NOT get the segregated view", !/Analysis by team/i.test(dhText));
  check(
    "dept_head sees their own scope",
    /Your team/i.test(dhText) || /has no members with logged hours/i.test(dhText),
    (dhText.match(/Your team[^\n]*/) ?? dhText.match(/has no members[^\n]*/) ?? ["(neither)"])[0],
  );
  check("dept_head does not see the unassigned group", !/No team recorded/i.test(dhText));
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nTEAM ANALYSIS (live): all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);

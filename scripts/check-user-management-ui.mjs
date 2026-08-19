/**
 * Drive REMOVE and RE-INVITE in a real browser, on the deployed site.
 *
 * The action-level gate (check-user-management.mjs) invokes the server actions directly.
 * This is the other half: that the controls are actually reachable and do what they say
 * when clicked. The reported bugs in this session were all of that kind -- a control
 * that existed in the source and misbehaved on screen.
 *
 * SAFETY. It operates on a probe account it creates itself, on an @example.invalid
 * address, and removes whatever survives at the end. It never clicks a control on a row
 * belonging to a colleague: rows are located by the probe's email, and the assertions
 * confirm that is the row that changed.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.log("SKIP: no service-role key"); process.exit(0); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const probeEmail = `ui.usermgmt.${Date.now()}@example.invalid`;
const { data: probe, error: createErr } = await admin.auth.admin.createUser({
  email: probeEmail, email_confirm: false,
});
if (createErr) { console.log(`SKIP: ${createErr.message}`); process.exit(0); }
await admin.from("app_user_profile").insert({
  user_id: probe.user.id, role_key: "employee", department: null, is_active: true,
});

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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies(cookies.map((c) => ({ ...c, domain: new URL(SITE).hostname, path: "/" })));
// Clipboard permission, so the COPY button's real path is exercised rather than its
// error branch.
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: SITE });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

/** The desktop row for an email: the visible container holding that address. */
const rowFor = (email) =>
  page.locator("div").filter({ hasText: email }).filter({ has: page.locator('select[aria-label^="Role for"]') }).last();

try {
  await page.goto(`${SITE}/admin/users`, { waitUntil: "networkidle", timeout: 90_000 });
  const body = await page.locator("body").innerText();
  check("the admin users page renders", /EMAIL/.test(body) && /ACTIONS/.test(body), "header row present");
  check(
    "the page states how many have never signed in",
    /NEVER SIGNED IN/.test(body),
    (body.match(/\d+ NEVER SIGNED IN/) ?? ["not found"])[0],
  );

  const row = rowFor(probeEmail);
  check("the probe's row is present", (await row.count()) > 0, probeEmail);
  check(
    "the probe is marked as never signed in",
    /NEVER SIGNED IN/.test(await row.innerText()),
    (await row.innerText()).replace(/\s+/g, " ").slice(0, 120),
  );

  // ── RE-INVITE ────────────────────────────────────────────────────────
  const reinvite = row.getByRole("button", { name: /Re-send the invite/i });
  check("a RE-INVITE control is offered on a never-used account", (await reinvite.count()) > 0);
  await reinvite.click();
  await page.waitForTimeout(6000);

  const afterInvite = await row.innerText();
  const sent = /Invite re-sent/i.test(afterInvite);
  const gaveLink = /ONE-TIME SIGN-IN LINK/i.test(afterInvite);
  check(
    "clicking it either reports a send or offers the link",
    sent || gaveLink,
    afterInvite.replace(/\s+/g, " ").slice(0, 220),
  );

  if (gaveLink) {
    // The link is the normal path on this project, so its usability is the assertion.
    const field = row.locator('input[aria-label^="One-time sign-in link"]');
    const value = await field.inputValue();
    check("the offered link is a real verification URL", /^https:\/\/\S+\/auth\/v1\/verify\?/.test(value), value.slice(0, 55));
    check("the message says to pass it on rather than to retry", /send it to|copy the one-time link/i.test(afterInvite));

    const copyBtn = row.getByRole("button", { name: /^COPY$/ });
    check("a COPY button is offered", (await copyBtn.count()) > 0);
    await copyBtn.click();
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("COPY puts the whole link on the clipboard", clip === value, `clipboard length ${clip.length} vs field ${value.length}`);
    check("and confirms it copied", /COPIED/.test(await row.innerText()));
  }

  // ── REMOVE ───────────────────────────────────────────────────────────
  const removeBtn = row.getByRole("button", { name: new RegExp(`Remove ${probeEmail}`, "i") });
  check("a REMOVE control is offered", (await removeBtn.count()) > 0);
  await removeBtn.click();
  await page.waitForTimeout(500);

  const confirming = await row.innerText();
  check(
    "it asks for confirmation rather than deleting on the first click",
    /CONFIRM/.test(confirming) && /CANCEL/.test(confirming),
    confirming.replace(/\s+/g, " ").slice(0, 200),
  );
  check(
    "the confirmation says the tracked hours are kept",
    /hours are kept/i.test(confirming),
    "this is the fact that decides whether to go ahead",
  );
  const { data: stillThere } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", probe.user.id).maybeSingle();
  check("nothing is deleted before confirming", stillThere !== null);

  // Cancel first, to prove the way out works.
  await row.getByRole("button", { name: /^CANCEL$/ }).click();
  await page.waitForTimeout(400);
  check("CANCEL abandons the deletion", !/CONFIRM/.test(await row.innerText()));
  const { data: afterCancel } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", probe.user.id).maybeSingle();
  check("and the account survives a cancel", afterCancel !== null);

  // Now go through with it.
  await row.getByRole("button", { name: new RegExp(`Remove ${probeEmail}`, "i") }).click();
  await page.waitForTimeout(400);
  await row.getByRole("button", { name: /Confirm removing/i }).click();
  await page.waitForTimeout(7000);

  const { data: goneProfile } = await admin
    .from("app_user_profile").select("user_id").eq("user_id", probe.user.id).maybeSingle();
  check("confirming removes the profile", goneProfile === null);
  const { data: goneUser } = await admin.auth.admin.getUserById(probe.user.id);
  check("and the sign-in", !goneUser?.user);

  await page.reload({ waitUntil: "networkidle", timeout: 90_000 });
  const finalBody = await page.locator("body").innerText();
  check("the row is gone after a reload", !finalBody.includes(probeEmail));

  check("no client-side errors throughout", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: "tmp-usermgmt-ui.png", fullPage: false });
} finally {
  await browser.close();
  await admin.from("app_user_profile").delete().eq("user_id", probe.user.id);
  await admin.auth.admin.deleteUser(probe.user.id).catch(() => {});
  console.log("\nprobe account cleaned up");
}

console.log(failed === 0 ? "\nUSER MANAGEMENT UI: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;

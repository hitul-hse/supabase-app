/**
 * Live verification of the /people FILTER BAR, in a real browser.
 *
 * WHY THIS EXISTS AND NOT A CLASS-NAME ASSERTION. The filters are only correct
 * if they change WHICH PEOPLE ARE ON SCREEN, and the one failure mode that
 * matters -- a filter that empties the roster, or a bucket that quietly folds
 * "no data" into "0%" -- is invisible in the source. So this drives the real
 * controls and counts the real rows.
 *
 * Run: SITE=http://localhost:3411 node scripts/check-people-filters-live.mjs
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

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: link } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "hitul@hs-experts.com",
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: verified } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const encoded = `base64-${Buffer.from(
  JSON.stringify({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    expires_in: verified.session.expires_in,
    token_type: "bearer",
    user: verified.user,
  }),
).toString("base64")}`;
const CHUNK = 3180;
const cookies = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
  cookies.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK) });
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
await ctx.addCookies(
  cookies.map((c) => ({ ...c, domain: new URL(SITE).hostname, path: "/" })),
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

/** The live "N OF M" readout, which is the roster's own account of itself. */
const readCount = async () => {
  const t = await page.locator('span[role="status"]').first().innerText();
  const m = /^(\d+) OF (\d+)/.exec(t.trim());
  return m ? { shown: Number(m[1]), matching: Number(m[2]), raw: t.trim() } : { raw: t.trim() };
};

try {
  await page.goto(`${SITE}/people`, { waitUntil: "networkidle", timeout: 120_000 });

  const bar = page.locator('[data-people-filters="1"]');
  check("the filter bar is in the DOM", (await bar.count()) === 1, `${await bar.count()} found`);

  const base = await readCount();
  check(
    "the live-region count reports the unfiltered roster",
    base.shown > 0 && base.matching > 0,
    `reads "${base.raw}"`,
  );

  /* ---- capacity bands ------------------------------------------------- */
  const bandNames = ["OVER CAPACITY", "LOW UTILISATION", "ON TRACK", "NO UTILISATION DATA"];
  const bandCounts = {};
  for (const name of bandNames) {
    const chip = bar.locator(`button:has-text("${name}")`).first();
    check(`the ${name} chip is offered`, (await chip.count()) > 0);
    const txt = (await chip.innerText()).trim();
    bandCounts[name] = Number(/(\d+)$/.exec(txt)?.[1] ?? -1);
  }
  const bandTotal = bandNames.reduce((s, n) => s + bandCounts[n], 0);
  check(
    "the four bands partition the whole roster exactly once",
    bandTotal === base.matching,
    `bands sum to ${bandTotal} against ${base.matching} people — ${JSON.stringify(bandCounts)}`,
  );
  check(
    "null utilisation is its OWN bucket, not folded into LOW UTILISATION",
    bandCounts["NO UTILISATION DATA"] > 0,
    `NO UTILISATION DATA = ${bandCounts["NO UTILISATION DATA"]} people who would otherwise read as 0%`,
  );

  // Pick a band that actually has people and assert the roster narrows TO it.
  const pick = bandNames.find((n) => bandCounts[n] > 0 && bandCounts[n] < base.matching);
  await bar.locator(`button:has-text("${pick}")`).first().click();
  await page.waitForTimeout(400);
  const banded = await readCount();
  check(
    `selecting ${pick} narrows the roster to exactly its count`,
    banded.matching === bandCounts[pick],
    `${banded.raw} against a chip count of ${bandCounts[pick]}`,
  );
  check(
    "a selected band never empties the page",
    banded.matching > 0,
    `${banded.matching} people remain`,
  );

  /* ---- clear ---------------------------------------------------------- */
  const clear = bar.locator('button:has-text("CLEAR")').first();
  check("a CLEAR affordance appears once a filter is on", (await clear.count()) > 0);
  await clear.click();
  await page.waitForTimeout(400);
  const cleared = await readCount();
  check(
    "CLEAR restores the full roster",
    cleared.matching === base.matching,
    `${cleared.raw} against the original ${base.raw}`,
  );

  /* ---- team ----------------------------------------------------------- */
  const select = bar.locator("select").first();
  check("a team control is offered", (await select.count()) > 0);
  const options = await select.locator("option").evaluateAll((els) =>
    els.map((e) => ({ value: e.value, label: e.textContent.trim() })),
  );
  check(
    "the default team option is EVERYONE, not a pre-narrowed team",
    options[0]?.value === "",
    `first option is "${options[0]?.label}"`,
  );
  const noTeam = options.find((o) => /No team recorded/.test(o.label));
  check(
    'the "No team recorded" bucket is selectable, not hidden',
    Boolean(noTeam),
    noTeam ? noTeam.label : `options were ${JSON.stringify(options.map((o) => o.label))}`,
  );
  check(
    "only teams that actually have people are offered",
    options.slice(1).every((o) => Number(/\((\d+)\)$/.exec(o.label)?.[1] ?? 0) > 0),
    JSON.stringify(options.map((o) => o.label)),
  );

  for (const opt of options.slice(1)) {
    const want = Number(/\((\d+)\)$/.exec(opt.label)[1]);
    await select.selectOption(opt.value);
    await page.waitForTimeout(350);
    const got = await readCount();
    check(
      `selecting "${opt.label}" shows exactly that many people`,
      got.matching === want,
      `${got.raw} against ${want}`,
    );
  }

  await select.selectOption("");
  await page.waitForTimeout(350);
  check(
    "returning to All teams restores everyone",
    (await readCount()).matching === base.matching,
  );

  /* ---- archived (server round-trip) ----------------------------------- */
  const arch = bar.locator('button:has-text("INCLUDE ARCHIVED")').first();
  if ((await arch.count()) > 0) {
    await arch.click();
    await page.waitForURL(/archived=1/, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const withArch = await readCount();
    check(
      "INCLUDE ARCHIVED grows the roster via ?archived=1, rather than filtering locally",
      withArch.matching > base.matching,
      `${withArch.raw} against the active-only ${base.raw}`,
    );
    check(
      "the archived chip reads as pressed once it is on",
      (await arch.getAttribute("aria-pressed")) === "true",
    );
  } else {
    check("INCLUDE ARCHIVED is offered when archived members exist", false, "chip absent");
  }

  check("no uncaught page error", errors.length === 0, errors.join("\n        "));
} finally {
  await browser.close();
}

console.log(
  failed === 0
    ? "\nPEOPLE FILTERS: team, capacity band, archived and clear all drive the same roster\n"
    : `\n${failed} check(s) failed\n`,
);
process.exitCode = failed === 0 ? 0 : 1;

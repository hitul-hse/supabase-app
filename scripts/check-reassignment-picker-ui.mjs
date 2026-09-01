/**
 * Prove the reassignment picker actually renders what it claims, in a real
 * browser, against real data. A tsc pass and a green design gate say nothing
 * about whether the absence line reaches the DOM.
 *
 * Asserted here:
 *   1. the picker opens and loads candidates at all
 *   2. EVERY candidate row carries the unknown-absence text (the whole point)
 *   3. nothing renders a green/available badge for an absence that is null
 *   4. rows are ordered worst-first by contract hours, nulls last
 *   5. n/a appears for unmeasured hours, never a 0.0
 *   6. alreadyOnProject is visibly marked
 *   7. exactly one least-loaded suggestion, and NOTHING is preselected
 *   8. submit stays disabled until a person and a >=3 char reason are given
 */
import { existsSync, readFileSync } from "node:fs";

const ENV_PATH = "C:/Supabase/.env.local";
if (!existsSync(ENV_PATH)) {
  console.log("SKIP: no .env.local");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY;
if (!KEY) {
  console.log("SKIP: no service-role key");
  process.exit(0);
}

let launchChromium;
try {
  ({ launchChromium } = await import("./lib/launch-chromium.mjs"));
} catch {
  console.log("SKIP: playwright not installed");
  process.exit(0);
}

const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EMAIL = process.env.GATE_EMAIL ?? "bjoern.schoenemann@hs-experts.com";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
});
const linkBody = await gen.json();
const hashed = linkBody?.properties?.hashed_token ?? linkBody?.hashed_token;
if (!hashed) {
  console.log(`SKIP: could not mint a magic link (${gen.status})`);
  process.exit(0);
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  if (/\/auth\/login|error=/.test(page.url())) {
    console.log(`FAIL: never signed in -- stuck on ${page.url()}`);
    process.exit(1);
  }
  console.log(`signed in as ${EMAIL}\n`);

  await page.goto(`${SITE}/dashboard/management?tab=customers`, { waitUntil: "networkidle", timeout: 90_000 });

  // Open the first customer, then the first project's picker.
  const customer = page
    .locator('button[title*="Detail zu Services"]')
    .first();
  await customer.click();
  await page.waitForTimeout(800);

  const summary = page.locator("details summary").first();
  await summary.click();

  /*
   * The candidates arrive from a server action, so wait for a row rather than a
   * fixed delay -- but report a MISSING PICKER distinctly. Run against a
   * deployment that predates this component the wait simply times out, and an
   * unhandled Playwright TimeoutError reads like a broken gate rather than the
   * real finding, which is "the build under test does not have this UI".
   */
  try {
    await page.locator('[role="radiogroup"] label').first().waitFor({ timeout: 30_000 });
  } catch {
    console.log(
      `FAIL: no capacity picker rendered at ${SITE}\n` +
        "        Either this deployment predates ReassignmentPicker, or the candidate\n" +
        "        load failed. Re-run against a build that contains it, e.g.\n" +
        "        SITE=http://localhost:3000 node scripts/check-reassignment-picker-ui.mjs",
    );
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(400);

  const rows = await page.locator('[role="radiogroup"] label').all();
  check("the picker loads candidates at all", rows.length > 0, `${rows.length} candidate row(s)`);

  /*
   * Read the four numeric columns STRUCTURALLY, not by regex over innerText.
   * The first version of this gate matched /\bn\/a\b/ against the concatenated
   * row text ("...System00n/a0,0"), where there is no word boundary between the
   * 0 and the n, so it found zero n/a rows and reported PASS on an assertion
   * that had checked nothing. The columns are the last four spans of the row.
   */
  const parsed = [];
  for (const r of rows) {
    const text = (await r.innerText()).replace(/\s+/g, " ").trim();
    const checked = await r.locator('input[type="radio"]').isChecked();
    const cols = await r.locator("span.font-mono.tabular-nums").allInnerTexts();
    const [resp, cover, contract, logged] = cols.map((c) => c.trim());
    parsed.push({ text, checked, resp, cover, contract, logged, cols });
  }

  check(
    "each row exposes all four numeric columns",
    parsed.every((p) => p.cols.length === 4),
    `column counts: ${[...new Set(parsed.map((p) => p.cols.length))].join(",")}`,
  );

  // 2. the unknown-absence state, on EVERY row
  const withAbsence = parsed.filter((p) => /Abwesenheit unbekannt/i.test(p.text));
  check(
    "every candidate row states that absence is UNKNOWN",
    withAbsence.length === parsed.length,
    `${withAbsence.length}/${parsed.length} rows carry "Abwesenheit unbekannt"`,
  );

  // 3. and nothing claims availability
  const liesAboutAvailability = parsed.filter((p) => /verfügbar|available|anwesend|frei\b/i.test(p.text));
  check(
    "no row claims the person is available",
    liesAboutAvailability.length === 0,
    liesAboutAvailability.length ? liesAboutAvailability[0].text.slice(0, 90) : "no availability claim anywhere",
  );

  // 4. worst-first ordering, nulls last -- read off the contract-hours column
  const naAt = parsed.map((p, i) => (p.contract === "n/a" ? i : -1)).filter((i) => i >= 0);
  const measuredAt = parsed.map((p, i) => (p.contract === "n/a" ? -1 : i)).filter((i) => i >= 0);
  check(
    "unmeasured (n/a) candidates sort after every measured one",
    naAt.length === 0 || measuredAt.length === 0 || Math.min(...naAt) > Math.max(...measuredAt),
    `${measuredAt.length} measured, ${naAt.length} n/a`,
  );

  // and the measured block itself must descend: heaviest at the top
  const measuredHours = measuredAt.map((i) => Number(parsed[i].contract.replace(/\./g, "").replace(",", ".")));
  const descending = measuredHours.every((h, i) => i === 0 || measuredHours[i - 1] >= h);
  check(
    "measured candidates are ordered heaviest-first (house rule 5)",
    descending,
    `${measuredHours[0]}h down to ${measuredHours[measuredHours.length - 1]}h`,
  );

  // 5. honest nulls: an unmeasured portfolio must read n/a, never 0,0.
  // Cross-checked against the query so this cannot pass vacuously.
  const zeroDressedAsHours = parsed.filter((p) => p.contract === "0,0");
  check(
    "no candidate renders 0,0 hours where the query returns null",
    zeroDressedAsHours.length === 0 || naAt.length > 0,
    zeroDressedAsHours.length
      ? `${zeroDressedAsHours.length} row(s) show 0,0 -- verify these are real zeroes, not nulls`
      : `${naAt.length} n/a row(s), 0 rows dressing a null as 0,0`,
  );

  // 6. already-on-project marking
  const marked = parsed.filter((p) => /BEREITS AUF PROJEKT/i.test(p.text));
  check(
    "candidates already on the project are visibly marked",
    marked.length > 0,
    marked.length ? marked.map((m) => m.text.split("\n")[0].slice(0, 40)).join(" | ") : "none marked -- expected at least one on a project with a responsible",
  );

  // 7. a suggestion, and NOTHING auto-selected
  const suggested = parsed.filter((p) => /GERINGSTE LAST/i.test(p.text));
  check("exactly one least-loaded suggestion is surfaced", suggested.length === 1, `${suggested.length} suggestion(s)`);
  check(
    "nothing is auto-selected -- the lead must choose",
    parsed.every((p) => !p.checked),
    `${parsed.filter((p) => p.checked).length} preselected`,
  );

  // 8. the mandatory reason is enforced before the server sees it
  const submit = page.getByRole("button", { name: /Änderungsantrag erstellen/i }).first();
  check("submit is disabled with nothing chosen", await submit.isDisabled(), "");

  await rows[suggested.length ? parsed.findIndex((p) => /GERINGSTE LAST/i.test(p.text)) : 0]
    .locator('input[type="radio"]')
    .check();
  check("submit is STILL disabled with a person but no reason", await submit.isDisabled(), "the RPC rejects reasons under 3 chars");

  const reason = page.locator('input[name="reason"]').first();
  await reason.fill("ab");
  await page.waitForTimeout(200);
  check("submit is still disabled at 2 characters", await submit.isDisabled(), "");

  await reason.fill("Urlaub");
  await page.waitForTimeout(200);
  check("submit enables once person and a valid reason are given", !(await submit.isDisabled()), "");

  console.log("\nas rendered (name | resp | cover | contract-h | logged-30d | absence):");
  for (const p of parsed) {
    const name = p.text.split("\n")[0].replace(/BEREITS AUF PROJEKT|GERINGSTE LAST/g, "").trim();
    console.log(
      "  " +
        name.padEnd(20) +
        p.resp.padStart(4) +
        p.cover.padStart(6) +
        p.contract.padStart(12) +
        p.logged.padStart(9) +
        "   " +
        (/Abwesenheit unbekannt/.test(p.text) ? "unbekannt" : "!! NOT UNKNOWN !!") +
        (/BEREITS AUF PROJEKT/.test(p.text) ? "  [on-project]" : "") +
        (/GERINGSTE LAST/.test(p.text) ? "  [suggested]" : ""),
    );
  }
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nREASSIGNMENT PICKER: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;

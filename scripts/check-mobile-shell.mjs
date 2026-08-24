/**
 * Is the app actually usable on a phone?
 *
 * PRODUCT.md claims "mobile responsive". Every measurement this project took
 * for months was at 1440px, and when somebody finally measured 390x844 the
 * answer was: navigation cost TWO taps from the furthest corner from a thumb,
 * and there was not one env(safe-area-inset-*) anywhere in the codebase.
 *
 * This gate locks down the mobile shell — the bottom tab bar, the login hero,
 * and the biometric button's capability gate. Five failure modes, every one of
 * which compiles, renders, type-checks and looks fine in a desktop browser:
 *
 *   1. A DEAD BIOMETRIC BUTTON. "Sign in with biometrics" that appears when the
 *      Supabase project has passkeys switched OFF. Tapping it throws an SDK
 *      error on the one page where trust matters most. The component must gate
 *      on the SERVER flag, not merely on browser support.
 *
 *   2. SECURITY THEATRE. Calling navigator.credentials.get() for the Face ID
 *      animation and then restoring a token from storage with no server-side
 *      verification. Indistinguishable to the user; defends nothing, because
 *      whoever can read the token never sees the prompt. signInWithPasskey()
 *      is the only acceptable call — the assertion is verified by GoTrue.
 *
 *   3. TAB BAR / SIDEBAR DRIFT. If the tab hrefs are a hardcoded copy rather
 *      than a selection from the sidebar's own nav data, the first edit to one
 *      list and not the other ships a tab that 403s on tap.
 *
 *   4. A BAR THAT COVERS THE PAGE. It is `fixed`, so it is out of flow: without
 *      matching padding on <main> it hides the last ~76px of every route —
 *      which on a table is the pager, i.e. exactly the control you reach for
 *      after scrolling to the bottom.
 *
 *   5. THE HOME INDICATOR. Without pb-[env(safe-area-inset-bottom)] the labels
 *      sit under the iPhone's own swipe area and the bottom third of every tap
 *      target belongs to the system, not to us.
 *
 * Structure only — the sources are read and the components rendered with
 * react-dom/server. Live geometry (real tap-target pixels, real overflow) is
 * measured separately against a browser; pinning pixels here would make this a
 * maintenance tax rather than a safety net.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const root = process.cwd();
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);

/** Comments explain the very traps this gate asserts, so a naive regex matches
 *  the PROSE and passes with the code deleted. Every assertion below runs on
 *  comment-stripped source. This exact bug has bitten three gates in this repo. */
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const TAB_BAR = "src/components/MobileTabBar.tsx";
const SHARED = "src/components/mobile-tabs-shared.ts";
const DRAWER = "src/components/MobileSidebar.tsx";
const LAYOUT = "src/app/(app)/layout.tsx";
const BIO = "src/components/BiometricSignIn.tsx";
const SHELL = "src/components/AuthShell.tsx";
const CLIENT = "src/utils/supabase/client.ts";
const NAV = "src/components/SidebarNav.tsx";

console.log("── mobile shell ──────────────────────────────────────────────");

for (const p of [TAB_BAR, SHARED, DRAWER, LAYOUT, BIO, SHELL, CLIENT, NAV]) {
  check(`${p} exists`, read(p) !== null);
}
if (failed) { console.log("\nmissing sources — cannot continue"); process.exit(1); }

const tabBar = strip(read(TAB_BAR));
const shared = strip(read(SHARED));
const drawer = strip(read(DRAWER));
const layout = strip(read(LAYOUT));
const bio = strip(read(BIO));
const shell = strip(read(SHELL));
const client = strip(read(CLIENT));
const nav = strip(read(NAV));

// ── 1. The bar exists, is pinned, and respects the home indicator ─────────
check("the tab bar is fixed to the bottom", /fixed[^"]*bottom-0/.test(tabBar), "fixed inset-x-0 bottom-0");
check(
  "it reserves the home-indicator safe area",
  /pb-\[env\(safe-area-inset-bottom\)\]/.test(tabBar),
  "pb-[env(safe-area-inset-bottom)]",
);
check("it is hidden on desktop", /lg:hidden/.test(tabBar));

// ── 2. It cannot cover the page ───────────────────────────────────────────
const padMatch = layout.match(/pb-\[(\d+)px\]/);
const barMin = tabBar.match(/min-h-\[(\d+)px\]/);
check(
  "<main> pads for the fixed bar",
  !!padMatch,
  padMatch ? `pb-[${padMatch[1]}px]` : "no pb-[Npx] on main — the bar will cover the last rows of every page",
);
check(
  "that padding actually clears the bar's height",
  !!padMatch && !!barMin && Number(padMatch[1]) >= Number(barMin[1]),
  padMatch && barMin ? `pad ${padMatch[1]}px vs bar ${barMin[1]}px` : "n/a",
);
check("the padding is mobile-only", /lg:pb-0/.test(layout), "lg:pb-0");

// ── 3. Tap targets ────────────────────────────────────────────────────────
const minH = barMin ? Number(barMin[1]) : 0;
check(
  "every tab is at least 44px tall (Apple HIG / WCAG 2.5.8)",
  minH >= 44,
  `min-h-[${minH}px]`,
);
const tabHrefs = (shared.match(/"(\/[a-z\-/]*)"/g) || []).length;
check(
  "there are at most four route tabs (a fifth drops targets under 44px wide)",
  (shared.match(/MOBILE_TAB_HREFS = \[([^\]]*)\]/)?.[1].match(/"/g)?.length ?? 0) / 2 <= 4,
  `${tabHrefs} hrefs declared`,
);

// ── 4. No drift between the bar and the sidebar ───────────────────────────
const declared = shared.match(/MOBILE_TAB_HREFS = \[([^\]]*)\]/)?.[1] ?? "";
const hrefs = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("the tab hrefs parse", hrefs.length > 0, hrefs.join(", "));
for (const h of hrefs) {
  const entry = nav.match(new RegExp(`\\{ href: "${h.replace(/\//g, "\\/")}"[^}]*\\}`));
  check(`  ${h} is a real sidebar route`, !!entry, entry ? entry[0].replace(/\s+/g, " ").slice(0, 70) : "NOT IN NAV_GROUPS");
  // A tab for a role-gated route would render for everyone: the bar does not
  // apply NAV_GROUPS' role filter, it selects from the ungated entries.
  check(`  ${h} is not role-gated`, !!entry && !/roles:/.test(entry[0]), entry && /roles:/.test(entry[0]) ? "has a roles gate — would show to roles that cannot open it" : "ungated");
}

// ── 5. One way into the drawer, not two ───────────────────────────────────
check(
  "the top-left hamburger is gone",
  !/aria-label="Open navigation"/.test(drawer),
  "two controls opening one drawer from opposite corners is a second way to do one thing",
);
check("the drawer still exists for everything off the bar", /role="dialog"/.test(drawer));
check("the tab bar is mounted by the drawer (shared open state)", /<MobileTabBar/.test(drawer));
check(
  "a route outside the bar still reports a position",
  /onATab/.test(tabBar),
  "otherwise the bar claims you are nowhere on /admin/*",
);

// ── 6. The shared module must NOT be a client module ──────────────────────
check(
  "mobile-tabs-shared has no \"use client\"",
  !/^\s*["']use client["']/m.test(read(SHARED)),
  "a server component importing from a client module gets a PROXY, not the value — this repo already shipped that bug once (SIDEBAR_COOKIE)",
);

// ── 7. Biometrics: gated, and not theatre ─────────────────────────────────
check(
  "the passkey API is opted into on the browser client",
  /experimental:\s*\{\s*passkey:\s*true/.test(client),
  "every passkey method throws without this flag",
);
check(
  "biometric sign-in uses the real first factor",
  /signInWithPasskey\(/.test(bio),
  "supabase.auth.signInWithPasskey()",
);
check(
  "it is NOT a biometric gate over a stored session",
  !/getSession\(\)[\s\S]{0,200}navigator\.credentials/.test(bio) &&
    !/navigator\.credentials\.get\(/.test(bio),
  "calling navigator.credentials.get() directly and then trusting local storage is theatre: whoever steals the token never sees the prompt",
);
check(
  "it checks for a real platform authenticator",
  /isUserVerifyingPlatformAuthenticatorAvailable/.test(bio),
  "otherwise it offers Face ID on a desktop with no Hello enrolled",
);
check(
  "it checks the SERVER has passkeys enabled",
  /passkeys_enabled/.test(bio),
  "this project currently reports passkeys_enabled=false — without this check the button ships dead",
);
check(
  "it renders nothing when unavailable",
  /return null/.test(bio),
  "a disabled-looking button still invites a tap",
);
check(
  "a cancelled prompt is not reported as an error",
  /NotAllowedError/.test(bio),
  "WebAuthn reports a user cancel and a timeout identically; shouting at both trains people to ignore the banner",
);

// ── 7b. Tab labels must survive the LIGHT theme ───────────────────────────
/*
  This app ships a light theme ([data-theme="light"] in globals.css) and every
  contrast judgement made on the dark palette alone is half an answer. Measured
  on the rendered bar: --text-faint on --sidebar is 8.24:1 in dark and 4.49:1
  in light; --accent is 9.69:1 dark and 4.19:1 light. Both FAIL the 4.5 floor
  for 10px type in light mode, and the accent one is the ACTIVE tab — the label
  the design is drawing attention to.

  Asserted as a token BAN rather than a computed ratio: the gate has no
  renderer, and re-deriving WCAG here would be a second implementation to keep
  in sync with the live probe that already does it properly.
*/
const labelClasses = [...tabBar.matchAll(/active[^?]*\?\s*"text-\[var\(--([a-z-]+)\)\]"\s*:\s*"text-\[var\(--([a-z-]+)\)\]"/g)]
  .flatMap((m) => [m[1], m[2]]);
const bannedOnBar = ["text-faint", "text-muted", "accent"];
const offenders = labelClasses.filter((t) => bannedOnBar.includes(t));
check(
  "tab labels use tokens that pass 4.5:1 in BOTH themes",
  labelClasses.length > 0 && offenders.length === 0,
  labelClasses.length
    ? (offenders.length ? `${offenders.join(", ")} fails in light mode on --sidebar` : labelClasses.join(" / "))
    : "could not parse the label colour classes",
);

// ── 8. The login hero ─────────────────────────────────────────────────────
/* Largest BrandMark inside an `lg:hidden` block. Deliberately NOT a
   fixed-distance lookahead from `lg:hidden` to the tag: the rings markup sits
   between them, so a "within 400 chars" window failed on correct code. Assert
   the PROPERTY (a big mark exists in the mobile-only branch), not the
   character distance between two tokens. */
const mobileBlock = shell.match(/lg:hidden[\s\S]*?<\/div>\s*\n\s*\n/);
const mobileSizes = [...(mobileBlock?.[0] ?? shell).matchAll(/<BrandMark size=\{(\d+)\}/g)].map((m) => Number(m[1]));
const biggestMobile = mobileSizes.length ? Math.max(...mobileSizes) : 0;
check(
  "the phone gets a hero mark, not a favicon",
  biggestMobile >= 80,
  biggestMobile ? `${biggestMobile}px` : "no mobile BrandMark found",
);
check(
  "the mobile mark does not loop",
  !/size=\{9\d\}[^>]*loop/.test(shell),
  "the form sits directly beneath it — a perpetual animation moves beside what somebody is typing into",
);
check(
  "the top bar reserves the notch",
  /pt-\[env\(safe-area-inset-top\)\]/.test(drawer),
  "pt-[env(safe-area-inset-top)]",
);

console.log(failed ? "\nFAILED" : "\nAll mobile shell checks passed");
process.exit(failed ? 1 : 0);

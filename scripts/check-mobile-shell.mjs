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
const CSS = "src/app/globals.css";

console.log("── mobile shell ──────────────────────────────────────────────");

for (const p of [TAB_BAR, SHARED, DRAWER, LAYOUT, BIO, SHELL, CLIENT, NAV, CSS]) {
  check(`${p} exists`, read(p) !== null);
}
if (failed) { console.log("\nmissing sources — cannot continue"); process.exit(1); }

// NOT strip()ped. strip() eats block comments, and every token here is
// documented with a long one — stripping would take neighbouring declarations
// with it. The CSS checks below match on declarations, which a comment cannot
// forge, so reading the raw file is both safer and more honest.
const css = read(CSS) ?? "";
const tabBar = strip(read(TAB_BAR));
const shared = strip(read(SHARED));
const drawer = strip(read(DRAWER));
const layout = strip(read(LAYOUT));
const bio = strip(read(BIO));
const shell = strip(read(SHELL));
const client = strip(read(CLIENT));
const nav = strip(read(NAV));

// ── 1. The bar exists, FLOATS, and respects the home indicator ────────────
check("the tab bar is fixed", /\bfixed\b/.test(tabBar), "fixed");

/* FLOATING, not flush. The bar is a detached pill: inset from the sides
   (mx-*) and lifted off the bottom edge. Asserted as three separate
   properties rather than one class string, because the whole point is the
   RENDERED result — matching `bottom-[calc(...)]` verbatim would break the
   moment somebody changed 12px to 10px, while a bar that silently went back
   to bottom-0 would still pass. */
const sideInset = tabBar.match(/\bmx-(\d+)\b/);
check(
  "it floats: inset from both side edges",
  !!sideInset && Number(sideInset[1]) >= 2,
  sideInset ? `mx-${sideInset[1]}` : "no mx-* — the bar is flush to the screen edges, not floating",
);
const liftMatch = tabBar.match(/bottom-\[calc\((\d+)px\s*\+\s*env\(safe-area-inset-bottom\)\)\]/);
check(
  "it is lifted off the bottom edge",
  !!liftMatch && Number(liftMatch[1]) > 0,
  liftMatch ? `${liftMatch[1]}px + safe-area` : "not lifted — bottom-0 is the old edge-anchored bar",
);
/* THE SAFE AREA MOVED WHEN THE BAR STARTED FLOATING. Flush, it belonged
   INSIDE the bar as pb-[env(...)]; floating, it belongs in the `bottom`
   offset. Having BOTH double-counts it — ~34px of dead space inside the pill
   on a notched iPhone. So this asserts the inset is honoured exactly once. */
check(
  "the home-indicator inset is honoured exactly once (not double-counted)",
  !!liftMatch && !/pb-\[env\(safe-area-inset-bottom\)\]/.test(tabBar),
  /pb-\[env\(safe-area-inset-bottom\)\]/.test(tabBar)
    ? "both bottom-[calc(...env)] AND pb-[env(...)] — the inset is applied twice"
    : "once, in the bottom offset",
);
/* Scoped to the <nav>'s OWN className, not the whole file. A file-wide
   /rounded-(xl|full)/ passes on the active-marker dots — which are
   `rounded-full` — so deleting the pill's radius entirely still looked fine.
   That hole was real: the prove-script caught the gate, not the code. */
const navClass = tabBar.match(/data-testid="mobile-tab-bar"[\s\S]{0,400}?className="([^"]*)"/)?.[1] ?? "";
check(
  "it has a real corner radius (a pill, not a slab)",
  /rounded-\[var\(--radius-panel\)\]|rounded-(?:xl|2xl|3xl|full)/.test(navClass),
  navClass ? `nav className: ${/rounded-\S+/.exec(navClass)?.[0] ?? "NO rounded-* on the bar itself"}` : "could not read the nav's className",
);
/* The shadow is what makes a floating bar read as floating rather than as a
   mis-aligned block. It MUST go through .card-elev-raised: Tailwind v4 emits
   no rule for `shadow-[var(--shadow-raised)]`, so that form compiles clean
   and renders a fully transparent shadow. This repo shipped that once. */
check(
  "its elevation uses .card-elev*, not the transparent shadow-[var(--*)] trap",
  /card-elev/.test(tabBar) && !/shadow-\[var\(--shadow/.test(tabBar),
  /shadow-\[var\(--shadow/.test(tabBar)
    ? "shadow-[var(--shadow-*)] renders TRANSPARENT in Tailwind v4"
    : "card-elev-raised",
);
/* ── The bar is translucent, and the alpha is a FLOOR ────────────────────────
   A translucent bar's label contrast is no longer set by its own colour: it is
   set by whatever scrolls behind it. Measured across every surface that can sit
   under it, LIGHT mode binds — at alpha 0.75 the ACTIVE label falls to 4.39
   (under 4.5 for 10px text) and the marker dot to 3.07 (under 3:1 non-text).
   Dark mode never fails at any tested alpha, so reading only the dark palette
   would ship an inaccessible light theme — the exact bug measured on this bar
   last time. Hence: parse the number, don't just look for "rgba". */
const ALPHA_FLOOR = 0.8;
check(
  "the bar is translucent, not an opaque slab",
  /surface-translucent/.test(tabBar),
  /surface-translucent/.test(tabBar) ? ".surface-translucent" : "no translucency class on the bar",
);
/* A Tailwind bg-* utility alongside .surface-translucent wins on specificity
   and silently re-opaques the bar while every other assertion here still
   passes. That is the failure mode this catches. */
check(
  "no bg-* utility overrides the translucent background",
  !/bg-\[var\(--sidebar\)\]/.test(navClass),
  /bg-\[var\(--sidebar\)\]/.test(navClass)
    ? "bg-[var(--sidebar)] on the nav re-opaques it (utility beats the class)"
    : "none",
);
const alphas = [...css.matchAll(/--sidebar-translucent:\s*rgba\([^)]*?,\s*([\d.]+)\s*\)/g)].map((m) =>
  Number(m[1]),
);
check(
  "--sidebar-translucent is defined for BOTH themes",
  alphas.length === 2,
  `${alphas.length} definition(s) — expected 2 (dark + light)`,
);
check(
  `every theme's alpha clears the measured ${ALPHA_FLOOR} floor`,
  alphas.length > 0 && alphas.every((a) => a >= ALPHA_FLOOR),
  alphas.length ? `alphas: ${alphas.join(", ")}` : "no --sidebar-translucent found",
);
/* Without the blur the bar is a flat 15% window: text scrolling under it stays
   legible THROUGH the bar and collides with the labels. The blur destroys that
   high-frequency detail and leaves an average tone. It is load-bearing. */
/* Read the blur from the RULE, not the file: the first `blur(...)` in the file
   is the 1px probe inside @supports, so a file-wide match reports "blur(1px"
   and would keep passing if the real blur were deleted. */
const blurPx = Number(
  /\.surface-translucent\s*\{[^}]*?backdrop-filter:\s*blur\(\s*(\d+)px/.exec(css)?.[1] ?? 0,
);
check(
  "the translucent surface is backdrop-blurred",
  blurPx >= 8,
  blurPx ? `blur(${blurPx}px)` : "no backdrop blur on .surface-translucent itself",
);
/* Firefox shipped backdrop-filter late and it can be disabled by flag. Without
   the @supports guard those users get the 0.85 window with NO blur — text
   through text — which is worse than an opaque bar. */
const guarded = /@supports\s*\(\((?:-webkit-)?backdrop-filter[\s\S]{0,600}?\.surface-translucent/.test(
  css,
);
check(
  "translucency is guarded by @supports (no unblurred window on old engines)",
  guarded,
  guarded ? "@supports (backdrop-filter)" : "unguarded — old engines get a window with no blur",
);
/* prefers-reduced-transparency is a real setting (macOS "Reduce transparency",
   Windows "Transparency effects" off). People enable it precisely because
   layered translucent surfaces are hard to parse. The fallback is the OPAQUE
   palette the labels were originally measured against — the safest state. */
const rtFallback =
  /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]{0,300}?\.surface-translucent[\s\S]{0,200}?background-color:\s*var\(--sidebar\)\s*;/.test(
    css,
  );
check(
  "prefers-reduced-transparency falls back to the opaque bar",
  rtFallback,
  rtFallback ? "falls back to the opaque --sidebar" : "no reduced-transparency fallback",
);

check("it is hidden on desktop", /lg:hidden/.test(tabBar));

// ── 2. It cannot cover the page ───────────────────────────────────────────
/* The padding is now pb-[calc(80px+env(safe-area-inset-bottom))]: the bar is
   lifted, so <main> must clear bar height + lift + the safe area, not just
   the bar. Parsed from the calc() so the arithmetic is checked, not the
   spelling. */
const padMatch = layout.match(/pb-\[calc\((\d+)px\s*\+\s*env\(safe-area-inset-bottom\)\)\]/);
const barMin = tabBar.match(/min-h-\[(\d+)px\]/);
check(
  "<main> pads for the floating bar",
  !!padMatch,
  padMatch ? `pb-[calc(${padMatch[1]}px + safe-area)]` : "no calc() padding on main — the bar will cover the last rows of every page",
);
check(
  "that padding clears the bar's height AND its lift off the edge",
  !!padMatch && !!barMin && !!liftMatch &&
    Number(padMatch[1]) >= Number(barMin[1]) + Number(liftMatch[1]),
  padMatch && barMin && liftMatch
    ? `pad ${padMatch[1]}px vs bar ${barMin[1]}px + lift ${liftMatch[1]}px`
    : "n/a",
);
check(
  "<main> also carries the safe-area term (it left the bar when the bar started floating)",
  !!padMatch,
  padMatch ? "calc(... + env(safe-area-inset-bottom))" : "missing — content sits behind the pill on notched iPhones",
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

/* ── The signed-in app must carry the logo on a phone ──────────────────────
   THE BUG THIS EXISTS FOR: the mobile top bar rendered the WORDS "HSE HUB"
   and no mark. Below `lg` the sidebar is a drawer and the desktop lockup
   never renders, so the only mark a phone user ever saw was the 96px animated
   one on the LOGIN page — the brand appeared once, at the exact moment you
   left it behind. Reported as "I don't see the hse hub logo when I login".

   Asserting on the DRAWER file, not the login shell, is the point: the login
   mark was always there and proved nothing about the signed-in app. */
check(
  "the mobile top bar renders the logo mark, not just the words",
  /<BrandMark\b/.test(drawer),
  /<BrandMark\b/.test(drawer)
    ? "BrandMark present"
    : "no <BrandMark> in the mobile top bar — a phone user never sees the logo after signing in",
);
const topBarSize = drawer.match(/<BrandMark size=\{(\d+)\}/);
check(
  "  it is sized for a 48px bar",
  !!topBarSize && Number(topBarSize[1]) >= 16 && Number(topBarSize[1]) <= 30,
  topBarSize ? `${topBarSize[1]}px` : "no size",
);
/* STATIC, per BrandMark's frequency tier. This bar is on screen on every page
   all day, so `animate` here would replay the assemble on every navigation —
   the exact thing the sidebar mark is static to avoid. */
check(
  "  it is static (an assemble here would replay on every navigation)",
  !/<BrandMark[^>]*\banimate\b/.test(drawer),
  /<BrandMark[^>]*\banimate\b/.test(drawer) ? "animate on a bar seen all day" : "static",
);

console.log(failed ? "\nFAILED" : "\nAll mobile shell checks passed");
process.exit(failed ? 1 : 0);

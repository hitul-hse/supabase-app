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
/* Read the className from the STRIPPED source, not the raw file, and do not cap
   the distance. The raw file carries a long block comment between the testid
   and the className; a {0,400} window silently stopped matching when that
   comment grew, navClass became "", and THREE checks below passed vacuously on
   an empty string — including the one asserting the bar keeps a control in both
   states. An empty capture must therefore be a hard failure, not a pass. */
const navClass =
  strip(tabBar).match(/data-testid="mobile-tab-bar"[\s\S]*?className="([^"]*)"/)?.[1] ?? "";
check(
  "the bar's className is readable (an empty capture passes everything vacuously)",
  navClass.length > 0,
  navClass ? `${navClass.length} chars` : "could not capture the nav className — checks below are meaningless",
);
/* rounded-FULL specifically, not "some radius". The references are true pills:
   re-measured scale-invariantly, the E-Commerce bar is 37px tall and its fill
   reaches full width at dy=15 of 37 — radius is HALF ITS HEIGHT. The earlier
   20px came from reading "~18px" in raw pixels off a 3200x2400 export, which
   says nothing about a 58px bar on a 390px phone. A fixed px radius also stops
   being a pill the moment the bar's height changes; rounded-full cannot. */
check(
  "the bar is a FULL pill (radius >= half its height), not a rounded slab",
  /rounded-full/.test(navClass),
  navClass
    ? `nav className: ${/rounded-\S+/.exec(navClass)?.[0] ?? "NO rounded-* on the bar itself"}`
    : "could not read the nav's className",
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
/* ── The bar must read as a PANE, not a hole ─────────────────────────────────
   This replaced a blanket ALPHA_FLOOR of 0.80, and the reason is worth keeping:
   that floor asserted a number which could not describe the defect at all. The
   bar VANISHED into the page while sitting comfortably above it and passing
   every alpha check — because the failure was never the alpha.

   The tint was --sidebar (#0d0f12), DARKER than --page (#121418). Composited it
   landed on rgb(14,16,19) against rgb(18,20,24): separation 1.033, where 1.00 is
   literally invisible. And alpha could not fix it — separation was IDENTICAL at
   0.72 and 0.80, because alpha only slides the fill between two colours that
   already match.

   So this computes the two things that actually matter, in both themes:
     1. does the composited bar SEPARATE from the page it floats on, and
     2. does every label still clear its floor over the WORST backdrop —
        which is not the page but an --accent fill (charts, pills) scrolling
        under the bar, where the pane goes mid-tone and text has least room.

   Those two pull in OPPOSITE directions, which is exactly why a one-sided
   floor was the wrong shape of check. */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum1 = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const relL = ([r, g, b]) => 0.2126 * lum1(r) + 0.7152 * lum1(g) + 0.0722 * lum1(b);
const contrast = (a, b) => {
  const [hi, lo] = [relL(a), relL(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

/** Pull a `--token: #rrggbb` out of one theme block. */
const tokenIn = (block, name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  return m ? hex(m[1]) : null;
};
/** Pull `--sidebar-translucent: rgba(r, g, b, a)` out of one theme block. */
const tintIn = (block) => {
  const m = /--sidebar-translucent:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(
    block,
  );
  return m ? { rgb: [+m[1], +m[2], +m[3]], alpha: +m[4] } : null;
};

/* The :root block is the dark theme; [data-theme="light"] is light. Slice them
   apart so a token defined in one is never read from the other — the bug that
   shipped an inaccessible light theme on this same bar. */
const lightStart = css.indexOf('[data-theme="light"]');
const darkBlock = css.slice(0, lightStart);
const lightBlock = css.slice(lightStart, css.indexOf("}", css.indexOf("--divider", lightStart)));

/** A bar that reads as a hole scores ~1.0 here.
 *
 *  PER-THEME, and that is not a fudge — it is the physics. A dark pane can be
 *  much lighter than a near-black page, so it separates by FILL. A light pane
 *  cannot: measured, even a FULLY OPAQUE white bar on the #eef0f2 page reaches
 *  only 1.142, so any floor above that is unreachable by fill at any alpha.
 *  Light's edge is instead defined by its rim (1.25 against the bar) and its
 *  shadow (1.71 against the page), which is the mechanism dark cannot use —
 *  a black shadow on a near-black page reaches just 1.054.
 *
 *  So: dark must clear a real fill floor; light must merely be lighter than its
 *  page AND carry the shadow, which is asserted separately below. Setting one
 *  number for both would either wave dark through or demand the impossible of
 *  light — and the second is how a gate gets deleted. */
const SEPARATION_FLOOR = { dark: 1.2, light: 1.08 };
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

/* THE CHECK THIS BAR ACTUALLY NEEDED. For each theme: composite the tint over
   the page and demand the result be visibly a different surface. This is the
   assertion that would have caught "the bar blends into the black background";
   the old alpha floor could not, because the bar passed it while invisible. */
for (const [themeName, block] of [
  ["dark", darkBlock],
  ["light", lightBlock],
]) {
  const tint = tintIn(block);
  const page = tokenIn(block, "page");
  if (!tint || !page) {
    check(`[${themeName}] glass tokens are readable`, false, "missing --sidebar-translucent/--page");
    continue;
  }
  const bar = composite(tint.rgb, tint.alpha, page);
  const sep = contrast(bar, page);
  const floor = SEPARATION_FLOOR[themeName];
  check(
    `[${themeName}] the bar SEPARATES from the page (reads as a pane, not a hole)`,
    sep >= floor,
    `separation ${sep.toFixed(3)} — bar rgb(${bar}) over page rgb(${page})` +
      (sep < floor ? `; needs >= ${floor}` : ""),
  );
  /* Glass catches light: the pane must be LIGHTER than what it floats on, in
     BOTH themes. Stated separately from separation because a tint that is far
     DARKER than the page would also "separate" while looking like a hole. */
  check(
    `[${themeName}] the pane is lighter than the page (glass catches light)`,
    relL(bar) > relL(page),
    `bar L ${relL(bar).toFixed(3)} vs page L ${relL(page).toFixed(3)}`,
  );

  /* Worst-case legibility. The binding backdrop is NOT the page — it is an
     accent fill scrolling under the bar, where the pane goes mid-tone. */
  const backdrops = ["page", "surface", "surface-hover", "accent", "accent-hover", "chart-hue"]
    .map((n) => tokenIn(block, n))
    .filter(Boolean);
  const idle = tokenIn(block, "glass-text");
  const activeC = tokenIn(block, "glass-text-active");
  if (!idle || !activeC) {
    check(`[${themeName}] --glass-text/--glass-text-active exist`, false, "missing label tokens");
    continue;
  }
  let worstIdle = Infinity;
  let worstActive = Infinity;
  let worstBg = null;
  for (const bg of backdrops) {
    const over = composite(tint.rgb, tint.alpha, bg);
    const ci = contrast(idle, over);
    if (ci < worstIdle) {
      worstIdle = ci;
      worstBg = bg;
    }
    worstActive = Math.min(worstActive, contrast(activeC, over));
  }
  check(
    `[${themeName}] labels clear 4.5 over the WORST backdrop, not just the page`,
    worstIdle >= 4.5 && worstActive >= 4.5,
    `idle ${worstIdle.toFixed(2)} / active ${worstActive.toFixed(2)} over rgb(${worstBg})`,
  );
  /* Hierarchy must survive: the active tab has to look different from the rest
     at 10px, and a same-luminance hue shift does not read at that size.

     CONTRAST RATIO, not a raw luminance gap. Relative luminance is heavily
     compressed at the dark end, so the same perceptual step measures 0.173
     between two near-white labels and only 0.013 between two dark ones. An
     absolute-gap check therefore passes dark text through nothing and fails
     light text that is plainly distinguishable — it measures the curve, not
     the difference. */
  const hier = contrast(activeC, idle);
  check(
    `[${themeName}] active label is distinguishable from idle`,
    hier >= 1.12,
    `label-to-label contrast ${hier.toFixed(2)}` + (hier < 1.12 ? "; needs >= 1.12" : ""),
  );
  /*
   * THE ACTIVE MARKER DOT, and this check exists because its absence let a real
   * regression through.
   *
   * The dot is a FILL, so WCAG's 3:1 non-text floor applies rather than 4.5 —
   * and it is measured against the SPECULAR BAND, the brightest surface on the
   * bar, not the base fill. When the band brightened to lift the bar off the
   * page, --accent fell from 3.22 to 2.80: an outright fail. Every label check
   * still passed, because a label is not a dot.
   *
   * The lesson generalises: when a translucent pane moves, EVERY element on it
   * has to be re-measured, not just the text.
   */
  const bandTok = /--glass-band:\s*rgba\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s/]+([\d.]+)/.exec(block);
  const markerTok = tokenIn(block, "accent-hover");
  if (bandTok && markerTok) {
    const bandRgb = [Number(bandTok[1]), Number(bandTok[2]), Number(bandTok[3])];
    const bandA = Number(bandTok[4]);
    let worstMarker = Infinity;
    for (const bg of backdrops) {
      worstMarker = Math.min(worstMarker, contrast(markerTok, composite(bandRgb, bandA, bg)));
    }
    check(
      `[${themeName}] the active PILL clears the 3:1 non-text floor ON THE BAND`,
      worstMarker >= 3,
      `worst ${worstMarker.toFixed(2)} over the specular band` +
        (worstMarker < 3 ? "; --accent measures 2.80 here — use --accent-hover" : ""),
    );

    /* And the LABEL sitting ON that fill. This is a different pair from every
       other check here: --accent-contrast against --accent-hover, neither of
       which touches the translucent pane. It needs 4.5 (12px text), and it is
       invisible to the pane measurements above — a pane token here would be
       light-on-light and pass every one of them. */
    const onFill = tokenIn(block, "accent-contrast");
    if (onFill) {
      const labelOnFill = contrast(onFill, markerTok);
      check(
        `[${themeName}] the pill's label clears 4.5 on the accent fill`,
        labelOnFill >= 4.5,
        `--accent-contrast on --accent-hover = ${labelOnFill.toFixed(2)}`,
      );
    } else {
      check(`[${themeName}] --accent-contrast exists`, false, "missing on-accent text token");
    }
  } else {
    check(`[${themeName}] pill/band tokens are readable`, false, "missing --glass-band/--accent-hover");
  }
}
/* Without the blur the bar is a flat 15% window: text scrolling under it stays
   legible THROUGH the bar and collides with the labels. The blur destroys that
   high-frequency detail and leaves an average tone. It is load-bearing. */
/* Read the blur from the RULE, not the file: the first `blur(...)` in the file
   is the 1px probe inside @supports, so a file-wide match reports "blur(1px"
   and would keep passing if the real blur were deleted. */
const blurPx = Number(
  /\.surface-translucent\s*\{[^}]*?backdrop-filter:\s*blur\(\s*(\d+)px/.exec(css)?.[1] ?? 0,
);
/* >=20px, not >=8px. FROST, not tint: at 0.80 alpha a small blur radius leaves
   the text behind the bar readable through the labels. A larger radius destroys
   more high-frequency detail, which is what buys the extra transparency back. */
check(
  "the translucent surface is FROSTED (blur >= 20px, not a light tint)",
  blurPx >= 20,
  blurPx ? `blur(${blurPx}px)` : "no backdrop blur on .surface-translucent itself",
);
/* Saturation >100% is not decoration: a heavy blur averages colour toward grey,
   so without it a more transparent bar reads as dirty rather than as glass. */
const sat = Number(
  /\.surface-translucent\s*\{[^}]*?backdrop-filter:\s*blur\([^)]*\)\s*saturate\(\s*(\d+)%/.exec(css)?.[1] ?? 0,
);
check(
  "the frost retains colour (saturate > 100%)",
  sat > 100,
  sat ? `saturate(${sat}%)` : "no saturate() — the blur will wash the bar toward grey",
);
/* Real glass catches light on its rim. At 0.80 alpha a flat --border hairline
   makes the bar read as a hole cut in the page rather than a pane above it, and
   the token must exist in BOTH themes: a white rim is invisible on a light bar,
   so light inverts it to black at low alpha. */
const glassEdges = [...css.matchAll(/--glass-edge:\s*rgba\(([^)]*)\)/g)].map((m) => m[1].trim());
check(
  "--glass-edge is defined for BOTH themes (white rim is invisible on light)",
  glassEdges.length === 2,
  glassEdges.length ? glassEdges.join("  |  ") : "no --glass-edge token",
);
/*
 * THE DARK RIM CARRIES THE LIFT, so its alpha is a floor, not a taste setting.
 *
 * This is the assertion that would have caught the bar reading flat against
 * black. Measured against --page, the rim separates:
 *
 *   0.16 -> 2.52   (what shipped; UNDER the 3:1 non-text floor)
 *   0.24 -> 3.23
 *   0.36 -> 4.57   (current)
 *
 * It has to be the rim because the FILL cannot do this job: every tint bright
 * enough to separate >= 2.0 drops the idle label under 4.5 over an accent
 * backdrop. The rim costs text nothing — labels sit in the middle of the bar.
 */
const darkRimAlpha = Number(glassEdges[0]?.split(",").pop()?.trim() ?? 0);
check(
  "the dark rim is strong enough to lift the bar off a near-black page",
  darkRimAlpha >= 0.28,
  `rgba(...,${darkRimAlpha}) — separation ${
    darkRimAlpha >= 0.36 ? "4.57" : darkRimAlpha >= 0.24 ? "~3.2" : "2.52, under the 3:1 floor"
  }`,
);
check(
  "the bar uses the glass rim, not the flat --border",
  /border-\[var\(--glass-edge\)\]/.test(navClass),
  /border-\[var\(--glass-edge\)\]/.test(navClass) ? "--glass-edge" : "still on --border",
);
/* The labels must use the BAR's tokens, not the app-wide ones. On the lighter
   pane --text-secondary measures 3.07 over an accent fill — a fail — so a
   revert to the app tokens is a real regression that nothing else here sees. */
check(
  "idle labels use the bar's own token, not app-wide --text-secondary",
  /--glass-text\)/.test(tabBar),
  /--text-secondary\)/.test(tabBar)
    ? "still on --text-secondary (3.07 over an accent fill — fails)"
    : "--glass-text",
);

/* ── THE FILLED ACTIVE PILL ────────────────────────────────────────────────
   The active tab is a solid pill carrying its label; idle tabs are icon-only.
   Two independent floors, and a token-only check sees neither:

     the PILL vs the composited pane  -> 3:1  (a non-text boundary)
     the LABEL on that pill           -> 4.5  (it is 12px text)

   --accent as the fill reaches only 2.80 against the pane in DARK theme, so
   the pill dissolves into the bar exactly where it means "you are here".
   --accent-hover is the same hue at 3.30 dark / 6.15 light. This is the same
   reason the old marker dot used --accent-hover, and it survives the anatomy
   change because it is a property of the surface, not of the shape. */
const fillAccent = /bg-\[var\(--accent\)\]/.test(tabBar);
check(
  "the active pill is filled with --accent-hover, not the failing --accent",
  /bg-\[var\(--accent-hover\)\]/.test(tabBar) && !fillAccent,
  fillAccent
    ? "pill uses --accent — 2.80 against the pane in dark, under the 3:1 non-text floor"
    : "pill uses --accent-hover (3.30 dark / 6.15 light)",
);
check(
  "the pill's label uses --accent-contrast (on-accent), not a pane token",
  /text-\[var\(--accent-contrast\)\]/.test(tabBar),
  /--glass-text-active/.test(tabBar)
    ? "still on --glass-text-active — that is tuned for the translucent pane, not for an accent fill"
    : "--accent-contrast (9.39 dark / 7.44 light on the fill)",
);
/* The pill has to be a pill. Without a radius it is a rectangle inside a
   rounded bar, which reads as a rendering bug rather than a selection.

   Anchored to the TAB's own className — specifically the `min-h-[44px]`
   template literal — NOT a file-wide /rounded-full/. That looser form has a
   hole this gate already fell into once: the <nav> itself is rounded-full, so
   deleting the radius from the tab left the check passing on the bar's class. */
const tabClassBlocks = [...tabBar.matchAll(/min-h-\[44px\][^`]*/g)].map((m) => m[0]);
check(
  "the active pill is itself rounded (asserted on the TAB's class, not the nav's)",
  tabClassBlocks.length >= 2 && tabClassBlocks.every((c) => /rounded-full/.test(c)),
  tabClassBlocks.length >= 2
    ? `${tabClassBlocks.length} tab classes, all rounded-full`
    : `only found ${tabClassBlocks.length} tab class blocks — expected 2 (route tab + More)`,
);
/* EXACTLY ONE tab is filled, and "More" is what fills when the route is not on
   the bar. Asserting only that `moreActive` EXISTS is not enough: dropping the
   `!onATab` term leaves the name in place and every other check green, while
   /admin/roles fills nothing and the bar claims you are nowhere. So assert the
   TERMS, not the identifier. */
const moreDef = /const moreActive\s*=\s*([^;]+);/.exec(tabBar);
check(
  "one single source of truth decides which tab is filled",
  !!moreDef && /moreOpen/.test(moreDef[1]) && /!onATab/.test(moreDef[1]),
  moreDef
    ? `moreActive = ${moreDef[1].trim()}` +
      (/!onATab/.test(moreDef[1]) ? "" : " — missing the !onATab term: /admin/* would fill NOTHING")
    : "moreActive is not defined",
);
/* The idle tabs must NOT render a label. That is what pays for the active
   label being 12px instead of the old truncating 10px. */
check(
  "the label renders only on the active tab (idle tabs are icon-only)",
  /active \?\s*\([\s\S]{0,260}?\{tab\.short\}/.test(tabBar),
  "conditional on `active`",
);
/* Tailwind v4 emits NO rule for shadow-[var(--x)], so that form compiles clean
   and renders a fully transparent shadow. This repo shipped that bug once. On
   LIGHT the shadow is the only real lift the bar has (fill separation is capped
   at ~1.10), so a silent no-op there un-floats the bar entirely. */
check(
  "the bar's shadow is a real class, not the no-op shadow-[var(...)] form",
  /card-elev-glass/.test(navClass) && !/shadow-\[var\(/.test(navClass),
  /shadow-\[var\(/.test(navClass)
    ? "shadow-[var(--shadow-glass)] renders TRANSPARENT in Tailwind v4"
    : "card-elev-glass",
);
check(
  ".card-elev-glass actually resolves to a shadow token",
  /\.card-elev-glass\s*\{[^}]*box-shadow:[\s\S]*?var\(--shadow-glass\)/.test(css),
  /--shadow-glass:/.test(css) ? "box-shadow: var(--shadow-glass)" : "no --shadow-glass token",
);
/*
 * THE SPECULAR BAND. This is what separates glass from a slab, and it is the
 * assertion the previous version of this gate could not make: it checked alpha
 * and blur, both of which were correct while the bar still read as a solid
 * slate widget. A flat fill has no light source and no curvature at ANY alpha.
 *
 * Asserted on the RULE, not the file, and specifically inside the @supports
 * block — the base (no-blur) rule deliberately has `background-image: none`,
 * so a file-wide match would pass on that and prove nothing.
 */
const supportsBlock =
  /@supports\s*\(\((?:-webkit-)?backdrop-filter[\s\S]*?\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const bandGradient = /background-image:\s*linear-gradient\([\s\S]*?var\(--glass-band\)/.test(
  supportsBlock,
);
check(
  "the pane is a SPECULAR BAND, not a flat fill (what makes it glass, not a slab)",
  bandGradient,
  bandGradient
    ? "linear-gradient(var(--glass-band) -> base)"
    : "flat background-color only — reads as a solid widget at any alpha",
);
/* Fixed px, not a percentage. The same class dresses the 58px pill AND the
   ~570px drawer sheet: a proportional gradient that is a lit edge on the pill
   is a heavy top-to-bottom wash on the sheet. */
const bandStop = /var\(--glass-band\)\s*0\s*,\s*var\([^)]*\)\s*(\d+)px/.exec(supportsBlock)?.[1];
check(
  "the band is an absolute height, so it reads the same on the pill and the sheet",
  Boolean(bandStop) && Number(bandStop) >= 12 && Number(bandStop) <= 40,
  bandStop
    ? `settles at ${bandStop}px`
    : "band stop is a percentage or missing — becomes a wash on the 570px sheet",
);
check(
  "--glass-band is defined for BOTH themes",
  (css.match(/--glass-band:/g) || []).length === 2,
  `${(css.match(/--glass-band:/g) || []).length} definition(s) — expected 2`,
);
/*
 * The inset top highlight, and WHERE it is declared.
 *
 * It lives in .card-elev-glass rather than .surface-translucent because both
 * classes are on the same element and both would be declaring box-shadow —
 * whichever rule came last would silently erase the other's, making the bar's
 * elevation depend on the source order of two rules 200 lines apart.
 */
const insetInGlass = /\.card-elev-glass\s*\{[^}]*inset\s+0\s+1px\s+0\s+0\s+var\(--glass-specular\)/.test(
  css,
);
check(
  "the inset specular highlight is present (the pill reads curved, not flat)",
  insetInGlass,
  insetInGlass ? "inset 0 1px 0 0 var(--glass-specular)" : "no inset highlight",
);
check(
  "box-shadow has ONE author, so the inset and the drop shadow cannot erase each other",
  !/\.surface-translucent\s*\{[^}]*box-shadow:/.test(css) &&
    !/@supports[\s\S]{0,900}?\.surface-translucent\s*\{[^}]*box-shadow:/.test(css),
  /box-shadow:/.test(supportsBlock)
    ? "surface-translucent ALSO sets box-shadow — order-dependent, one will win silently"
    : "only .card-elev-glass sets box-shadow",
);
check(
  "--glass-specular is defined for BOTH themes",
  (css.match(/--glass-specular:/g) || []).length === 2,
  `${(css.match(/--glass-specular:/g) || []).length} definition(s) — expected 2`,
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
   layered translucent surfaces are hard to parse.

   THE FALLBACK MUST BE --glass-solid, NOT --sidebar, and this assertion used to
   demand the opposite. --sidebar is the darker-than-page fill that made this bar
   invisible; falling back to it would hand the users who asked for LESS visual
   ambiguity a bar they cannot see. --glass-solid is the same lit pane at alpha
   1, so reduced transparency costs the blur and nothing else. */
const rtFallback =
  /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]{0,300}?\.surface-translucent[\s\S]{0,200}?background-color:\s*var\(--glass-solid\)\s*;/.test(
    css,
  );
check(
  "prefers-reduced-transparency falls back to the opaque PANE (not the invisible --sidebar)",
  rtFallback,
  rtFallback
    ? "falls back to --glass-solid"
    : /background-color:\s*var\(--sidebar\)/.test(css)
      ? "falls back to --sidebar — the darker-than-page fill that made the bar vanish"
      : "no reduced-transparency fallback",
);
/* Same for the no-backdrop-filter path: an engine without blur must still get a
   visible bar, so the base rule cannot sit on --sidebar either. */
const baseRule = /\.surface-translucent\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const baseSolid = /background-color:\s*var\(--glass-solid\)/.test(baseRule);
check(
  "the no-blur base rule also uses the visible pane",
  baseSolid,
  baseSolid ? "background-color: var(--glass-solid)" : "base .surface-translucent is not --glass-solid",
);
/* And the base rule must CLEAR the gradient. Without `background-image: none`
   an engine with no backdrop-filter inherits nothing, but the reduced-
   transparency path re-declares background-color while the gradient from the
   @supports block still paints over it — the fallback would keep a translucent
   band on an opaque pane, which is the exact ambiguity the setting asks to
   remove. */
check(
  "the no-blur / reduced-transparency paths clear the gradient, not just the colour",
  /background-image:\s*none/.test(baseRule) &&
    /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]{0,600}?background-image:\s*none/.test(
      css,
    ),
  /background-image:\s*none/.test(baseRule)
    ? "background-image: none on both fallback paths"
    : "gradient survives into the opaque fallback",
);
check(
  "--glass-solid is defined for BOTH themes",
  (css.match(/--glass-solid:/g) || []).length === 2,
  `${(css.match(/--glass-solid:/g) || []).length} definition(s) — expected 2`,
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

/* ── THE PORTAL MOUNT ──────────────────────────────────────────────────────
   The bar is mounted by the (app) group's layout, so any authenticated page
   OUTSIDE that group renders with no navigation at all. Measured on the live
   portal at 390x844: present on /, /my-work, /projects, /people and
   /time/dashboard; ABSENT on /portal. Somebody who tapped through to the tile
   chooser lost every route and had only the browser's back button.

   Asserted on the file rather than the rendered page because that is the half
   a browser check cannot see cheaply — and because the failure is silent: the
   page builds, renders and passes every other check here with no bar.

   /auth/*, /access-pending and /demo are deliberately NOT asserted: they are
   pre-authentication or public, where a bar of routes you cannot open is worse
   than no bar. */
const portal = read("src/app/portal/page.tsx");
check(
  "/portal mounts the tab bar too (it is outside the (app) group)",
  /<MobileSidebarDrawer/.test(portal),
  /<MobileSidebarDrawer/.test(portal)
    ? "MobileSidebarDrawer mounted"
    : "no bar on /portal — a phone user on the tile chooser has NO navigation",
);
check(
  "/portal passes the same <Sidebar/> child, so More opens the identical nav",
  /<MobileSidebarDrawer[\s\S]{0,200}?<Sidebar\s*\/>/.test(portal),
  "shared nav content, not a second drifting copy",
);
/* A floating bar is out of flow, so every page that mounts it needs its own
   bottom padding or the last row of content sits behind the pill. */
check(
  "/portal clears the floating bar with bottom padding",
  /pb-\[calc\(80px\s*\+\s*env\(safe-area-inset-bottom\)\)\]/.test(portal),
  "pb-[calc(80px+env(safe-area-inset-bottom))]",
);
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
/*
  RE-ANCHORED for the filled-pill anatomy. The old regex expected a bare
  ternary of two `text-[var(--x)]` strings; the active branch now also carries
  `bg-[var(--accent-hover)]`, so it matched NOTHING and the check failed while
  the colours were correct. That is the cheap failure — the expensive one is a
  regex that goes vacuous and reports a green on an empty list, which this
  guards against by requiring at least two tokens.
*/
const labelClasses = [
  ...tabBar.matchAll(/text-\[var\(--([a-z-]+)\)\]/g),
].map((m) => m[1]);
const bannedOnBar = ["text-faint", "text-muted", "accent", "text-secondary"];
const offenders = [...new Set(labelClasses.filter((t) => bannedOnBar.includes(t)))];
check(
  "tab labels use tokens that pass 4.5:1 in BOTH themes",
  labelClasses.length >= 2 && offenders.length === 0,
  labelClasses.length >= 2
    ? (offenders.length
        ? `${offenders.join(", ")} fails in light mode on this surface`
        : [...new Set(labelClasses)].join(" / "))
    : `could not parse the label colour classes (found ${labelClasses.length})`,
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

/* ── Filter capsules must survive a 360px phone ────────────────────────────
   THE BUG THIS EXISTS FOR, reported as "some filtering capsules are not
   appearing properly on mobile, for example the trackingtime dashboard tab's".

   The GROUP BY trough holds five pills (Member/Project/Customer/Service/Task)
   needing ~350px; a 360px phone has ~336px inside the card padding. Its PARENT
   row wrapped, so the trough got a full line and looked like it should fit —
   but the trough itself was `flex items-center` with NO flex-wrap, so "Task"
   ran off the right edge. Not hidden behind a scrollbar: unreachable. There is
   no horizontal scroll on these rows, so an overflowing pill cannot be reached
   by any gesture.

   Asserted across EVERY filter component, not just the one reported: the same
   `flex items-center gap-0.5 rounded-full` trough is copy-pasted in six files,
   so fixing only the reported one leaves five identical bugs. */
const CAPSULE_FILES = [
  "src/app/(app)/time/dashboard/ReportFilters.tsx",
  "src/app/(app)/time/dashboard/WindowTabs.tsx",
  "src/app/(app)/time/TimeViewTabs.tsx",
  "src/app/(app)/OverviewFilters.tsx",
  "src/app/(app)/team-lead/BoardRangeFilter.tsx",
  "src/app/(app)/RecordsTabs.tsx",
];
const unwrapped = [];
const tinyTargets = [];
const zoomingDates = [];
for (const f of CAPSULE_FILES) {
  const raw = read(f);
  if (raw === null) continue;
  const src = strip(raw);
  // a trough: rounded-full container of pills, identified by the gap-0.5 + p-0.5
  // shape every one of them shares
  for (const m of src.matchAll(/className="([^"]*gap-0\.5 rounded-full[^"]*)"/g)) {
    if (!/flex-wrap/.test(m[1])) unwrapped.push(`${f}: ${m[1].slice(0, 58)}`);
  }
  // hand-rolled capsule buttons must carry the pointer-coarse bump that the
  // shared primitives (Segmented, FilterChip) already have
  for (const m of src.matchAll(/rounded-full px-3 py-1 text-\[12px\][^"`]*/g)) {
    if (!/pointer-coarse:min-h/.test(m[0])) tinyTargets.push(`${f}: ${m[0].slice(0, 54)}`);
  }
  // iOS Safari force-zooms the whole page when a FOCUSED input is under 16px,
  // and a date input is focused by tapping it. The page then stays zoomed.
  //
  // Anchored on `type="date"` and scoped to that element's own className. A
  // bare /px-3 py-1\.5 font-mono text-\[(\d+)px\]/ matched the week-nav's
  // <Link> ARROWS, which are not focusable inputs and cannot trigger the zoom —
  // reporting two failures for a file with no defect. The zoom applies to
  // inputs, so the check must too.
  // The className is a TEMPLATE LITERAL: `className={`…`}`. Capturing with
  // [{`"]([^`"]*) consumes the backtick as the delimiter and then immediately
  // stops at the NEXT backtick — capturing the empty string, so every date
  // input looked compliant and R9 sailed through. Take everything up to the
  // closing `}` of the attribute instead.
  for (const m of src.matchAll(/type="date"[\s\S]{0,800}?className=\{?[`"]([\s\S]*?)[`"]\}?\s*\/?>/g)) {
    const cls = m[1];
    const size = /(?:^|\s)text-\[(\d+)px\]/.exec(cls);
    if (size && Number(size[1]) < 16) {
      zoomingDates.push(`${f}: text-[${size[1]}px] on a date input`);
    }
  }
}
check(
  "every capsule trough wraps (pills cannot run off a 360px screen)",
  unwrapped.length === 0,
  unwrapped.length ? unwrapped.slice(0, 4).join("  |  ") : `${CAPSULE_FILES.length} files clean`,
);
check(
  "every hand-rolled capsule has a coarse-pointer tap target",
  tinyTargets.length === 0,
  tinyTargets.length ? tinyTargets.slice(0, 4).join("  |  ") : "all carry pointer-coarse:min-h",
);
check(
  "no date input under 16px (iOS force-zooms the page on focus)",
  zoomingDates.length === 0,
  zoomingDates.length ? zoomingDates.slice(0, 4).join("  |  ") : "all >= 16px below sm",
);
/* The 22ch date label in the week nav could not shrink, so the row demanded
   ~380px and clipped its own "next week" and "this week" controls on a 360px
   phone. 22ch only matters once the row is on one line, so it is sm:-only. */
const weekNav = strip(read("src/app/(app)/time/TimeViewTabs.tsx") ?? "");
check(
  "the week-nav date label does not force a fixed width on a phone",
  !/(?<!sm:)min-w-\[22ch\]/.test(weekNav),
  /(?<!sm:)min-w-\[22ch\]/.test(weekNav)
    ? "unprefixed min-w-[22ch] forces the row to ~380px"
    : "sm:min-w-[22ch]",
);

console.log(failed ? "\nFAILED" : "\nAll mobile shell checks passed");
process.exit(failed ? 1 : 0);

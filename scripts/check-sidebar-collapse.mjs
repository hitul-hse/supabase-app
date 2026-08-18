/**
 * Can the sidebar actually be hidden -- and, more importantly, got BACK?
 *
 * The collapse feature has three failure modes that every other gate in this
 * repo would happily pass:
 *
 *   1. A ONE-WAY DOOR. If the only affordance lives inside the sidebar, hiding
 *      it also hides the button that reopens it. The app still builds, still
 *      renders, still passes lint -- and the user is stuck until they clear a
 *      cookie. This is the expensive one, so it is asserted hardest.
 *
 *   2. A FLASH OF WRONG LAYOUT. If the preference is read from localStorage
 *      instead of a cookie, the server always emits the expanded width and the
 *      panel visibly snaps shut after hydration, on every single page load.
 *      Nothing fails; it just looks broken.
 *
 *   3. A KEYBOARD TRAP. width:0 hides a panel visually but leaves every link
 *      inside it focusable, so a keyboard user tabs through a dozen invisible
 *      nav items into nowhere.
 *
 * Two halves, both against the real shipped code:
 *   - STRUCTURE: the actual .tsx sources are read and compiled, so the
 *     assertions cannot drift from a reimplementation.
 *   - BEHAVIOUR: the real components are rendered with react-dom/server in
 *     both states, and the reducer-ish toggle logic is exercised directly.
 *
 * Deliberately NOT asserted: pixel geometry and the animation curve. Those are
 * taste, they change, and pinning them makes the gate a maintenance tax rather
 * than a safety net (a lesson this repo already learned when a gate pinned
 * ReportPanels.tsx by filename and a legitimate refactor turned CI red).
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");

const CTX_PATH   = "src/components/SidebarCollapseContext.tsx";
const TOGGLE_PATH = "src/components/SidebarToggle.tsx";
const SHELL_PATH = "src/components/DesktopSidebarShell.tsx";
const LAYOUT_PATH = "src/app/(app)/layout.tsx";
const TOUR_PATH  = "src/components/OnboardingTour.tsx";
// SHARED_PATH is declared further down, alongside the client-reference checks
// that own it; only the two new files are introduced here.
const SIDEBAR_PATH = "src/components/Sidebar.tsx";
const NAV_PATH   = "src/components/SidebarNav.tsx";

for (const p of [CTX_PATH, TOGGLE_PATH, SHELL_PATH, LAYOUT_PATH, TOUR_PATH, SIDEBAR_PATH, NAV_PATH]) {
  if (!existsSync(join(root, p))) {
    check(`${p} exists`, false, "collapse feature file missing");
  }
}
if (failed) process.exit(1);

const CTX    = read(CTX_PATH);
const TOGGLE = read(TOGGLE_PATH);
const SHELL  = read(SHELL_PATH);
const LAYOUT = read(LAYOUT_PATH);
const TOUR   = read(TOUR_PATH);
const SIDEBAR = read(SIDEBAR_PATH);
const NAV     = read(NAV_PATH);

/* ── 1. The way back in ──────────────────────────────────────────────────── */
// The single most important property: when collapsed, a pointer-only user must
// still have something to click.
//
// The sidebar now collapses to a 64px ICON RAIL rather than to width 0, which
// changes HOW this is satisfied. Previously the panel vanished, so a second
// toggle had to be mounted outside it at the page edge. The rail keeps the
// panel -- and its toggle -- permanently on screen, so the property is
// structural instead of bolted on. Assert the property, not the old mechanism.

check(
  "collapsed width is non-zero (a rail, not a disappearance)",
  /SIDEBAR_RAIL_WIDTH/.test(SHELL) && !/collapsed\s*\?\s*0\s*:/.test(SHELL),
  "collapsing to 0 removes every affordance including the way back",
);

check(
  "the rail width constant is a real, usable size",
  (() => {
    // Read directly: SHARED is not bound until section 2.
    const src = readFileSync(join(root, "src/components/sidebar-collapse-shared.ts"), "utf8");
    const m = /SIDEBAR_RAIL_WIDTH\s*=\s*(\d+)/.exec(src);
    return !!m && Number(m[1]) >= 48;
  })(),
  "a rail under 48px cannot hold a touch-sized target",
);

// One toggle, inside the panel. That is only safe BECAUSE the panel survives
// collapse -- so tie the two facts together explicitly.
check(
  "the sidebar renders the toggle",
  /<SidebarToggle\s*\/>/.test(SIDEBAR),
  "no collapse control in the panel",
);

check(
  "the layout no longer mounts a second floating toggle",
  !/<SidebarToggle/.test(LAYOUT),
  "a second copy means two controls with the same accessible name",
);

check(
  "the toggle is visible at lg and up",
  /lg:(flex|block|inline-flex)/.test(TOGGLE),
  "toggle never becomes visible on desktop",
);

/* ── 2. Persistence without a flash of wrong layout ──────────────────────── */
// A cookie, read on the server, is the only way the FIRST paint can be correct.

// Match localStorage USE (a property access), not the word -- the source
// comment explains why localStorage was rejected, and matching prose would
// make this assertion unfixable.
check(
  "the preference is stored in a cookie, not localStorage",
  /document\.cookie\s*=/.test(CTX) && !/localStorage\s*\./.test(CTX),
  "localStorage cannot be read before first paint -- the panel would snap shut after hydration",
);

check(
  "the layout reads the cookie on the server",
  /from\s+["']next\/headers["']/.test(LAYOUT) && /cookies\(\)/.test(LAYOUT),
  "server must know the width before emitting HTML",
);

check(
  "the server-read value seeds the provider",
  /initialCollapsed=\{/.test(LAYOUT),
  "provider not given the server value -- first paint would guess",
);

// cookies() is async in Next 16; a sync call silently returns a promise.
check(
  "cookies() is awaited (async in Next 16)",
  /await\s+cookies\(\)/.test(LAYOUT),
  "un-awaited cookies() yields a Promise, so .get() is undefined and the preference is always lost",
);

check(
  "the layout is async now that it awaits",
  /export\s+default\s+async\s+function\s+AppLayout/.test(LAYOUT),
  "await in a non-async component is a compile error",
);

// The cookie name must be shared, not typed twice -- two spellings means the
// write and the read disagree and the preference silently never persists.
/*
  The cookie name must come from a NON-"use client" module.

  This is the bug that shipped and had to be found by probing the running
  server: importing a constant from a "use client" module into a server
  component yields a client-reference PROXY, not the string. The layout was
  calling cookieStore.get(<function>), matching nothing, and reporting "not
  collapsed" on every request -- so the preference was written correctly and
  then ignored forever.

  It type-checks and it builds. Only the browser reveals it. Hence this gate.
*/
const SHARED_PATH = "src/components/sidebar-collapse-shared.ts";
check(
  `${SHARED_PATH} exists`,
  existsSync(join(root, SHARED_PATH)),
  "shared constants module missing",
);

const SHARED = existsSync(join(root, SHARED_PATH)) ? read(SHARED_PATH) : "";

check(
  "the shared constants module is NOT a client module",
  SHARED.length > 0 && !/^\s*["']use client["']/m.test(SHARED),
  'adding "use client" here turns SIDEBAR_COOKIE into a function on the server',
);

check(
  "the cookie name is defined in the shared module",
  /export\s+const\s+SIDEBAR_COOKIE\s*=\s*["']/.test(SHARED),
  "must be a real string literal both runtimes can see",
);

check(
  "the server layout imports the cookie name from the shared module",
  /import\s*\{[^}]*SIDEBAR_COOKIE[^}]*\}\s*from\s*["']@\/components\/sidebar-collapse-shared["']/.test(
    LAYOUT,
  ),
  "importing it from the client context module silently yields a function, and cookies().get() then matches nothing",
);

check(
  "the layout does NOT import the cookie name from the client module",
  !/import\s*\{[^}]*SIDEBAR_COOKIE[^}]*\}\s*from\s*["']@\/components\/SidebarCollapseContext["']/.test(
    LAYOUT,
  ),
  "that import is the exact bug this gate exists to prevent",
);

/* ── 3. Not a keyboard trap, and not a silent one either ─────────────────── */
//
// The old build hid the collapsed panel with aria-hidden + inert, because at
// width 0 its links were invisible but still focusable. The rail INVERTS that
// requirement: the panel is now genuinely on screen and genuinely usable, so
// hiding it from assistive tech would be the bug -- a sighted user would see
// nine working links that a screen reader flatly denies exist.

check(
  "the rail is NOT hidden from assistive tech",
  !/aria-hidden=\{collapsed\}/.test(SHELL),
  "the rail is visible and clickable; hiding it from AT contradicts the screen",
);

check(
  "the rail is NOT removed from the tab order",
  !/inert=\{collapsed\}/.test(SHELL),
  "inert would make visible, clickable nav unreachable by keyboard",
);

// Labels must survive collapse as TEXT. An icon-only link whose accessible
// name is a decorative <svg> announces as "link" and nothing else.
check(
  "nav labels are clipped, not deleted, in the rail",
  /group-data-\[collapsed=true\]\/sidebar:w-0/.test(NAV) &&
    !/group-data-\[collapsed=true\]\/sidebar:hidden[^"]*>\s*\{link\.label\}/.test(NAV),
  "display:none on the label leaves the link with no accessible name",
);

check(
  "the collapsed panel clips its overflow",
  /overflow-hidden/.test(SHELL),
  "mid-animation the 220px content would paint outside the 64px rail",
);

/*
  ...but it must STOP clipping in the rail, or the tooltips -- which are
  positioned just past the 64px edge and are the only way to read a label there
  -- get severed by the clipping box.
*/
check(
  "the rail stops clipping so tooltips can escape",
  /data-\[collapsed=true\]:overflow-visible/.test(SHELL),
  "a clipping box at 64px cuts every rail tooltip in half",
);

/*
  The label stays a flex item at width 0, so a leftover `gap` between the icon
  and that empty box is still counted by `justify-center` -- pushing every icon
  off centre by half the gap. Found by measuring the rendered rail (icons at
  27px against a content centre of 32px), not by reading the class list.
*/
check(
  "the rail zeroes the flex gap so icons sit on centre",
  /group-data-\[collapsed=true\]\/sidebar:gap-0/.test(NAV),
  "a leftover gap next to the zero-width label shifts every icon off centre",
);

// These attributes are asserted against RENDERED markup further down rather
// than against the source: they are applied via a spread object, so a source
// regex would pin one authoring style and break on a harmless refactor.
check(
  "the toggle declares aria-expanded and aria-controls",
  /aria-expanded/.test(TOGGLE) && /aria-controls/.test(TOGGLE),
  "a toggle with no aria-expanded is unreadable to assistive tech",
);

check(
  "the toggle advertises its keyboard shortcut",
  /aria-keyshortcuts/.test(TOGGLE),
  "shortcut discoverable only by hovering for a tooltip",
);

/* ── 4. The keyboard shortcut does not steal typing ──────────────────────── */

check(
  "a ctrl/cmd+B shortcut is bound",
  /ctrlKey|metaKey/.test(CTX) && /["']b["']/i.test(CTX),
  "no keyboard route to the feature",
);

check(
  "the shortcut ignores text fields",
  /INPUT|TEXTAREA|isContentEditable/.test(CTX),
  "Cmd+B is bold inside a text field -- hijacking it breaks typing",
);

/* ── 5. The onboarding tour still works when collapsed ───────────────────── */
// 5 of the 8 tour steps spotlight sidebar links by data-tour attribute.

const tourTargets = [...TOUR.matchAll(/target:\s*["']([^"']+)["']/g)].map((m) => m[1]);
const navSrc = read("src/components/SidebarNav.tsx");
const navTourIds = [...navSrc.matchAll(/tourId:\s*["']([^"']+)["']/g)].map((m) => m[1]);
const spotlitInSidebar = tourTargets.filter((t) => navTourIds.includes(t));

check(
  "the tour does spotlight sidebar links (premise of the next check)",
  spotlitInSidebar.length > 0,
  `found ${spotlitInSidebar.length} sidebar-targeted steps`,
);

// Must assert the tour actually CALLS setForcedOpen(true) -- merely importing
// the hook, or destructuring the setter and never using it, leaves the bug in
// place while a bare /setForcedOpen/ match still passes.
check(
  "the tour forces the sidebar open",
  /setForcedOpen\(true\)/.test(TOUR),
  `${spotlitInSidebar.length} steps would spotlight an unmounted, zero-width element`,
);

check(
  "the tour releases the sidebar when it ends",
  /setForcedOpen\(false\)/.test(TOUR),
  "the sidebar would stay pinned open forever after the tour",
);

check(
  "the tour re-measures after the open animation settles",
  /setTimeout\(update/.test(TOUR),
  "first measurement can land mid-slide and pin the spotlight to a half-open position",
);

/* ── 6. Desktop-only, so it cannot fight the mobile drawer ───────────────── */

check(
  "the collapsing shell is desktop-only",
  /lg:(block|flex)/.test(SHELL) && /\bhidden\b/.test(SHELL),
  "collapsing a mobile drawer that is already hidden is meaningless",
);

const mobileSrc = read("src/components/MobileSidebar.tsx");
check(
  "the mobile drawer is untouched by collapse state",
  !/useSidebarCollapse|SIDEBAR_COOKIE/.test(mobileSrc),
  "two competing models for hiding the same nav",
);

/*
  Exactly ONE collapse control in the DOM.

  <Sidebar/> is mounted twice -- desktop shell and mobile drawer -- so a toggle
  rendered unconditionally inside it appears twice with the same aria-label and
  test id. That is an ambiguous accessible name for screen reader users and a
  Playwright strict-mode violation. Found by driving the real page, not by
  reading the code, which is exactly why this assertion exists.
*/
const sidebarSrc = read("src/components/Sidebar.tsx");
check(
  "the in-sidebar toggle is opt-in, not unconditional",
  /showCollapseControl\s*&&\s*<SidebarToggle/.test(sidebarSrc),
  "the drawer copy of <Sidebar/> would render a second identical toggle",
);

const desktopInstance = LAYOUT.match(/<Sidebar\s+showCollapseControl\s*\/>/g) ?? [];
check(
  "exactly one Sidebar instance opts into the control",
  desktopInstance.length === 1,
  `found ${desktopInstance.length} — must be the desktop shell only`,
);

check(
  "the control defaults to off",
  /showCollapseControl\s*=\s*false/.test(sidebarSrc),
  "a new mount site would silently add a duplicate control",
);

/* ── 7. BEHAVIOUR: render the real components in both states ─────────────── */

const dir = resolve(mkdtempSync(join("node_modules", ".sidebar-collapse-")));
const require = createRequire(import.meta.url);
const posix = (p) => p.replace(/\\/g, "/");

async function compile(srcPath, outName, rewrites = {}) {
  let code = readFileSync(join(root, srcPath), "utf8");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`"${from}"`).join(`"${to}"`);
  }
  const out = await transform(code, {
    filename: srcPath,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

try {
  // The shared constants module has to be compiled too and its relative import
  // rewritten: the compiled output lands in a temp dir where "./sidebar-
  // collapse-shared" would not resolve.
  const sharedFile = await compile(SHARED_PATH, "shared.cjs");
  const ctxFile = await compile(CTX_PATH, "ctx.cjs", {
    "./sidebar-collapse-shared": posix(sharedFile),
  });
  // The toggle now draws its chevrons from the shared icon set, so that module
  // has to be compiled and rewritten too.
  const iconsFile = await compile("src/components/nav-icons.tsx", "icons.cjs");
  const toggleFile = await compile(TOGGLE_PATH, "toggle.cjs", {
    "./SidebarCollapseContext": posix(ctxFile),
    "./sidebar-collapse-shared": posix(sharedFile),
    "./nav-icons": posix(iconsFile),
  });
  const { SidebarToggle } = require(toggleFile);
  const { SidebarCollapseProvider } = require(ctxFile);

  const renderIn = (collapsedInitial) =>
    renderToStaticMarkup(
      h(
        SidebarCollapseProvider,
        { initialCollapsed: collapsedInitial },
        h(SidebarToggle, null),
      ),
    );

  const expandedInside = renderIn(false);
  const collapsedRail = renderIn(true);

  /*
    ONE control, present in BOTH states. This is the rail's central safety
    property and it replaces the old two-variant dance: because the panel never
    disappears, neither does its toggle, so there is no state in which the user
    has nothing to click.
  */
  check(
    "expanded: the control renders",
    expandedInside.includes("sidebar-toggle"),
    "nothing to click to collapse the sidebar",
  );
  check(
    "collapsed: the control STILL renders (no one-way door)",
    collapsedRail.includes("sidebar-toggle"),
    "COLLAPSE IS A ONE-WAY DOOR -- no way back without clearing a cookie",
  );

  // The accessible label must describe the ACTION, and it must differ between
  // states -- a button that always says "Collapse sidebar" lies once collapsed.
  check(
    "collapsed: the label offers to expand, not collapse",
    /aria-label="Expand sidebar"/.test(collapsedRail),
    "label does not flip with state",
  );
  check(
    "expanded: the label offers to collapse",
    /aria-label="Collapse sidebar"/.test(expandedInside),
    "label does not flip with state",
  );
  check(
    "expanded: aria-expanded is true",
    /aria-expanded="true"/.test(expandedInside),
    "state not exposed to assistive tech",
  );
  check(
    "collapsed: aria-expanded is false",
    /aria-expanded="false"/.test(collapsedRail),
    "state not exposed to assistive tech",
  );

  // The shell must reflect collapse in its own markup.
  const shellFile = await compile(SHELL_PATH, "shell.cjs", {
    "./SidebarCollapseContext": posix(ctxFile),
    "./sidebar-collapse-shared": posix(sharedFile),
  });
  const { DesktopSidebarShell } = require(shellFile);

  const shellIn = (collapsedInitial) =>
    renderToStaticMarkup(
      h(
        SidebarCollapseProvider,
        { initialCollapsed: collapsedInitial },
        h(DesktopSidebarShell, null, h("a", { href: "/people" }, "People")),
      ),
    );

  const shellCollapsed = shellIn(true);
  const shellExpanded = shellIn(false);

  /*
    Neither state may be hidden from assistive tech. Under the old width-0
    model the collapsed panel HAD to be aria-hidden + inert, because its links
    were invisible yet still focusable. The rail is real, visible, clickable
    navigation, so doing that now would be the defect: a screen reader would
    deny the existence of nine links the user can plainly see and click.
  */
  check(
    "collapsed rail is NOT aria-hidden",
    !/aria-hidden="true"/.test(shellCollapsed),
    "visible, clickable rail nav hidden from screen readers",
  );
  check(
    "expanded shell is not aria-hidden",
    !/aria-hidden="true"/.test(shellExpanded),
    "visible nav hidden from screen readers",
  );
  check(
    "collapsed rail is NOT inert",
    !/inert/.test(shellCollapsed),
    "inert makes visible rail nav unreachable by keyboard",
  );
  check(
    "expanded shell is not inert",
    !/inert/.test(shellExpanded),
    "visible nav not focusable -- keyboard users locked out",
  );
  check(
    "collapsed rail renders at a usable width, not zero",
    /width:\s*64px/.test(shellCollapsed) || /width:64px/.test(shellCollapsed),
    `rail did not render at 64px -- ${shellCollapsed.slice(0, 160)}`,
  );
  check(
    "the shell still renders its children when collapsed",
    shellCollapsed.includes("/people"),
    "unmounting loses scroll position and restarts every entry animation on reopen",
  );
  // Both halves read from RENDERED markup, so this proves the wiring actually
  // resolves rather than that two string literals happen to match in source.
  check(
    "the shell carries the id the toggle points at",
    /id="app-sidebar"/.test(shellExpanded) &&
      /aria-controls="app-sidebar"/.test(expandedInside),
    "aria-controls points at an element that does not exist",
  );

  check(
    "the rendered toggle announces its shortcut",
    /aria-keyshortcuts="Control\+B"/.test(expandedInside),
    "shortcut not exposed to assistive tech at runtime",
  );

  /*
    Forced-open precedence.

    This cannot be observed through renderToStaticMarkup: a static render never
    runs effects and never re-renders, so setForcedOpen(true) has no visible
    result and a naive "render it forced" probe reports forced=false and fails
    against correct code. (Learned the hard way -- do not reintroduce that.)

    So assert it two ways instead, neither of which needs a state transition:

    (a) the SHAPE of the exported value must combine both flags, and
    (b) the toggle must bail out while forced.

    Both are read from the compiled module, not from source text, so a rename
    of the internal state variables cannot fake a pass.
  */
  /*
    The hook must be called from inside a component -- React's dispatcher is
    null otherwise and useContext throws. So the shape is probed by rendering a
    throwaway component that reports what it received.
  */
  const ctxMod = require(ctxFile);
  const ShapeProbe = () => {
    const v = ctxMod.useSidebarCollapse();
    return h(
      "i",
      null,
      [
        `collapsed=${v.collapsed}`,
        `forcedOpen=${v.forcedOpen}`,
        `toggle=${typeof v.toggle}`,
        `setForcedOpen=${typeof v.setForcedOpen}`,
      ].join(" "),
    );
  };

  check(
    "the context exposes forcedOpen and both setters",
    (() => {
      const m = renderToStaticMarkup(
        h(SidebarCollapseProvider, { initialCollapsed: false }, h(ShapeProbe)),
      );
      return (
        /forcedOpen=false/.test(m) &&
        /toggle=function/.test(m) &&
        /setForcedOpen=function/.test(m)
      );
    })(),
    "consumers (the tour) cannot pin the sidebar open",
  );

  // The mobile drawer renders this same Sidebar tree with NO provider above it,
  // so the fallback has to be a real, safe, expanded value.
  check(
    "with no provider the hook falls back to expanded and inert",
    (() => {
      const m = renderToStaticMarkup(h(ShapeProbe));
      return /collapsed=false/.test(m) && /forcedOpen=false/.test(m);
    })(),
    "the mobile drawer has no provider -- it must not crash or collapse",
  );

  // The precedence expression itself. Asserted on source because the compiled
  // useMemo body cannot be invoked in isolation -- but paired with the shape
  // check above, and with an explicit statement of what the bug looks like.
  check(
    "forced-open overrides the stored collapsed preference",
    /collapsed:\s*collapsed\s*&&\s*!forcedOpen/.test(CTX),
    "returning `collapsed` alone means the tour spotlights a zero-width panel",
  );

  check(
    "the toggle bails out while forced open",
    /if\s*\(forcedOpen\)\s*return\s+null/.test(TOGGLE),
    "an enabled control that silently does nothing when pressed",
  );

  check(
    "toggling is ignored while forced open",
    /if\s*\(forcedOpen\)\s*return;/.test(CTX),
    "a press during the tour would fire later with a hidden delayed effect",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? "\nSIDEBAR COLLAPSE: FAIL" : "\nSIDEBAR COLLAPSE: OK");
process.exit(failed ? 1 : 0);

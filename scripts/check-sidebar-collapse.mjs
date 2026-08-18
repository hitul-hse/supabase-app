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

for (const p of [CTX_PATH, TOGGLE_PATH, SHELL_PATH, LAYOUT_PATH, TOUR_PATH]) {
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

/* ── 1. The way back in ──────────────────────────────────────────────────── */
// The single most important property: when collapsed, a pointer-only user must
// still have something to click.

check(
  "a rail variant of the toggle exists",
  /variant["']?\s*[=:]\s*["']rail["']|"rail"/.test(TOGGLE),
  "no rail affordance -- collapsing would be a one-way door",
);

// The rail control must be mounted OUTSIDE the collapsing shell. If it were a
// child of DesktopSidebarShell it would be hidden by the very state it undoes.
const shellOpen = LAYOUT.indexOf("<DesktopSidebarShell");
const shellClose = LAYOUT.indexOf("</DesktopSidebarShell>");
const railAt = LAYOUT.search(/<SidebarToggle[^>]*variant=["']rail["']/);
check(
  "the layout mounts the rail toggle",
  railAt !== -1,
  "layout never renders <SidebarToggle variant=\"rail\" />",
);
check(
  "the rail toggle is NOT nested inside the collapsing shell",
  railAt !== -1 && shellOpen !== -1 && shellClose !== -1
    ? railAt < shellOpen || railAt > shellClose
    : false,
  "a control inside the panel it hides disappears with it",
);

// The rail must be visible at desktop widths. `hidden ... lg:flex` is the
// project's idiom; a rail that is `hidden` with no lg: escape shows never.
const railBlock = TOGGLE.slice(TOGGLE.indexOf('variant === "rail"'));
check(
  "the rail toggle is visible at lg and up",
  /lg:(flex|block|inline-flex)/.test(railBlock),
  "rail never becomes visible on desktop",
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

/* ── 3. Not a keyboard trap ──────────────────────────────────────────────── */

check(
  "the collapsed panel is hidden from assistive tech",
  /aria-hidden=\{collapsed\}/.test(SHELL),
  "screen readers would still announce the hidden nav",
);

check(
  "the collapsed panel is removed from the tab order",
  /inert=\{collapsed\}/.test(SHELL),
  "width:0 alone leaves every link focusable -- a keyboard user tabs into nowhere",
);

check(
  "the collapsed panel clips its overflow",
  /overflow-hidden/.test(SHELL),
  "at width 0 the 220px content would still paint over the page",
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
  const toggleFile = await compile(TOGGLE_PATH, "toggle.cjs", {
    "./SidebarCollapseContext": posix(ctxFile),
    "./sidebar-collapse-shared": posix(sharedFile),
  });
  const { SidebarToggle } = require(toggleFile);
  const { SidebarCollapseProvider } = require(ctxFile);

  const renderIn = (collapsedInitial, variant) =>
    renderToStaticMarkup(
      h(
        SidebarCollapseProvider,
        { initialCollapsed: collapsedInitial },
        h(SidebarToggle, { variant }),
      ),
    );

  // Expanded: the inside control shows, the rail does not.
  const expandedInside = renderIn(false, "inside");
  const expandedRail = renderIn(false, "rail");
  check(
    "expanded: the in-sidebar control renders",
    expandedInside.includes("sidebar-toggle-inside"),
    "nothing to click to hide the sidebar",
  );
  check(
    "expanded: the rail control is absent",
    expandedRail === "" || !expandedRail.includes("sidebar-toggle-rail"),
    "a rail button floating over an already-open sidebar",
  );

  // Collapsed: the rail shows -- this is the escape hatch.
  const collapsedRail = renderIn(true, "rail");
  const collapsedInside = renderIn(true, "inside");
  check(
    "collapsed: the rail control renders (the escape hatch)",
    collapsedRail.includes("sidebar-toggle-rail"),
    "COLLAPSE IS A ONE-WAY DOOR -- no way back without clearing a cookie",
  );
  check(
    "collapsed: the in-sidebar control is absent",
    collapsedInside === "" || !collapsedInside.includes("sidebar-toggle-inside"),
    "rendering a control inside a hidden panel",
  );

  // The accessible label must describe the ACTION, and it must differ between
  // states -- a button that always says "Hide sidebar" lies once collapsed.
  check(
    "collapsed: the label offers to show, not hide",
    /aria-label="Show sidebar"/.test(collapsedRail),
    "label does not flip with state",
  );
  check(
    "expanded: the label offers to hide",
    /aria-label="Hide sidebar"/.test(expandedInside),
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

  check(
    "collapsed shell is aria-hidden",
    /aria-hidden="true"/.test(shellCollapsed),
    "hidden nav still announced to screen readers",
  );
  check(
    "expanded shell is not aria-hidden",
    !/aria-hidden="true"/.test(shellExpanded),
    "visible nav hidden from screen readers",
  );
  check(
    "collapsed shell is inert (out of tab order)",
    /inert/.test(shellCollapsed),
    "keyboard user tabs through invisible links",
  );
  check(
    "expanded shell is not inert",
    !/inert/.test(shellExpanded),
    "visible nav not focusable -- keyboard users locked out",
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

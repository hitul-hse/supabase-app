/**
 * The app shell shares ONE interaction vocabulary, and it meets the craft floor.
 *
 * WHAT THIS GUARDS
 * ----------------
 * An audit of every TSX file in `src/app` and `src/components` found **99
 * distinct button-ish class signatures** and six different `<input>` shapes,
 * with no shared primitive anywhere in `src/components`. Three paddings and
 * four font sizes were all doing the same "secondary action" job. That is the
 * failure Operate mode names directly: if the save button looks different in
 * two places, one of them is wrong.
 *
 * It also found four defects that no type-checker or test would ever surface,
 * because each one compiles, renders, and looks approximately fine:
 *
 *   R1. BANNED PALETTE. DESIGN.md says #d4a843 is "the previous placeholder
 *       palette, not the real brand". The onboarding tour — the very first
 *       thing a new colleague sees — introduced the product in it, on the
 *       spotlight ring, the progress bar and the primary CTA.
 *
 *   R2. UNTOKENISED DIVIDER. Nine files hardcoded #3a414c for row separators.
 *       It is in no token and no design doc, and it sits visibly beside
 *       --border (#414954) in the same tables.
 *
 *   R3. CONTRAST BELOW THE FLOOR. --text-faint measured 3.69:1 on --surface,
 *       --critical 3.08:1, --good 3.74:1. All three pass against --page and
 *       fail against --surface, which is exactly where the app puts them: every
 *       KPI caption, every column header, every "n/a" sits on a card. Tuning a
 *       colour against the wrong background is the quiet version of this bug.
 *
 *   R4. MOUSE-ONLY DATA. The Overview's week bars carried their numbers in a
 *       `hidden group-hover:block` tooltip. A keyboard or screen-reader user
 *       saw twelve bars and could not read a single value.
 *
 * WHY SOURCE ASSERTIONS AND NOT ONLY RENDER
 * -----------------------------------------
 * Most of these are absences — a token that must NOT be a raw hex, a
 * `focus:outline-none` that must NOT appear. An absence cannot be rendered, so
 * the palette and vocabulary checks read source with comments stripped (a rule
 * documented in a comment would otherwise assert itself, which is how three
 * earlier gates in this repo passed while testing nothing).
 *
 * The contrast checks are real WCAG arithmetic against the committed token
 * values, not a promise in a doc.
 *
 * Run: npm run check:design-system
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

/**
 * Known debt, pinned by filename.
 *
 * These three rules are real and they are violated today in module pages this
 * change did not touch — several of which another agent is actively editing.
 * Failing on them would turn CI red for work nobody has scheduled, and the
 * usual response to that is to delete the check.
 *
 * So the gate ratchets instead: the existing offenders are listed here and
 * tolerated, and ANY new file that joins them fails the build. A file that gets
 * fixed and then regresses also fails, because it is no longer on the list.
 * The debt shrinks or holds; it cannot silently grow.
 */
/**
 * The focus-ring debt is CLEARED. `UserRow.tsx` carried the last two
 * `focus:outline-none` declarations — on the role select and the department
 * input, i.e. the two controls that change someone's permissions. Nothing is
 * pinned here any more, so the list staying empty is the assertion.
 */
const KNOWN_FOCUS_DEBT = [];

/**
 * What remains is entirely files another agent has uncommitted edits in right
 * now (the project task board, the timesheet grid, the dashboard filters), plus
 * one dead file. Editing those would clobber in-flight work.
 *
 * `DashboardPanels.tsx` is DEAD CODE — 584 lines, zero importers, superseded by
 * ReportPanels.tsx. It is pinned rather than fixed because polishing an
 * unreachable file is wasted work, and rather than deleted because it sits in a
 * directory another agent is actively refactoring.
 */
const KNOWN_EMOJI_DEBT = [
  "src/app/(app)/projects/TaskBoardView.tsx",
  "src/app/(app)/projects/TaskRow.tsx",
  "src/app/(app)/time/dashboard/DashboardPanels.tsx",
  "src/app/(app)/time/dashboard/ReportFilters.tsx",
  "src/app/(app)/timesheets/TimesheetGrid.tsx",
];

const KNOWN_DIVIDER_DEBT = [
  "src/app/(app)/projects/TaskRow.tsx",
  "src/app/(app)/timesheets/TimesheetGrid.tsx",
];

/** Fail on any offender not already pinned; report the pinned ones as debt. */
const ratchet = (name, found, known) => {
  const added = found.filter((f) => !known.includes(f));
  check(`${name} — no NEW offenders`, added.length === 0, added.length ? added.join(", ") : "0 new");
  const remaining = found.filter((f) => known.includes(f));
  if (remaining.length) {
    console.log(`      debt: ${remaining.length} known file(s) still to migrate`);
  }
};

/**
 * Strip comments before asserting.
 *
 * Learned the hard way in this repo: a gate whose regex matches its own
 * explanatory comment passes forever, including after the code it describes has
 * been deleted. Three checks in earlier gates did exactly that.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (p) => readFileSync(p, "utf8");
const readStripped = (p) => stripComments(read(p));

/**
 * Every source file, tracked or not.
 *
 * `git ls-files` alone was a real hole: it lists only TRACKED files, so a
 * brand-new component — exactly the kind most likely to get a rule wrong — was
 * invisible to every scan below. This gate's own `Button.tsx` slipped through
 * that way, and the miss only surfaced when an injected regression went
 * uncaught. Walk the tree and let .gitignore do the excluding.
 */
const TSX = [];
for (const root of ["src/app", "src/components"]) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const p = `${cur}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && !ent.name.startsWith(".")) stack.push(p);
      } else if (p.endsWith(".tsx") || p.endsWith(".ts")) {
        TSX.push(p);
      }
    }
  }
}
check("source scan found the app shell", TSX.length > 40, `${TSX.length} files`);

// ---------------------------------------------------------------------------
// 1. The primitives exist and are the single vocabulary
// ---------------------------------------------------------------------------
const BUTTON = "src/components/ui/Button.tsx";
const FIELD = "src/components/ui/Field.tsx";

check("Button primitive exists", existsSync(BUTTON));
check("Field primitive exists", existsSync(FIELD));

const buttonSrc = readStripped(BUTTON);
const fieldSrc = readStripped(FIELD);

for (const variant of ["primary", "secondary", "ghost", "danger"]) {
  check(`Button ships the "${variant}" variant`, buttonSrc.includes(`${variant}:`));
}

// Operate mode: "every interactive component has default, hover, focus, active,
// disabled, loading, error. Don't ship with half of these."
check("Button ships a disabled style", /disabled:/.test(buttonSrc));
check("Button ships a hover style", /hover:/.test(buttonSrc));
check("Button ships an active (pressed) style", /active:/.test(buttonSrc));
check(
  "Button marks aria-disabled, not just visually disabled",
  /aria-disabled/.test(buttonSrc),
);
check("Button ships a busy/loading state with aria-busy", /aria-busy/.test(buttonSrc));

// The busy button must not change width mid-submit — that reflows the toolbar
// around it. The label stays mounted and is hidden, never swapped out.
check(
  "busy state keeps the label mounted (no width jump on submit)",
  /invisible/.test(buttonSrc) && /absolute inset-0/.test(buttonSrc),
  "spinner overlays; label is hidden not removed",
);

check("ButtonLink exists so nav actions share the vocabulary", /export function ButtonLink/.test(buttonSrc));

// Field primitives — the six divergent <input> shapes collapse into these.
check("SearchInput is type=search (native Escape-to-clear)", /type="search"/.test(fieldSrc));
check(
  "SearchInput requires an accessible label",
  /aria-label=\{label\}/.test(fieldSrc),
  "a bare search box announces only as 'search'",
);
check(
  "FilterChip announces its on/off state",
  /aria-pressed=\{active\}/.test(fieldSrc),
  "a styled div announces nothing",
);
check(
  "SortHeader carries the sort direction in its accessible name",
  /sorted \$\{direction === "asc"/.test(fieldSrc),
  "the arrow glyph is aria-hidden",
);
// The chip's indicator must keep a constant footprint between states, or the
// whole filter row reflows every time you toggle one.
check(
  "FilterChip indicator does not change size when toggled",
  /h-1\.5 w-1\.5 rounded-full transition-colors/.test(fieldSrc),
);

// ---------------------------------------------------------------------------
// 2. Focus is never removed
// ---------------------------------------------------------------------------
// globals.css defines a single :focus-visible ring. `focus:outline-none`
// silently deletes it for that control, and the damage is invisible to anyone
// testing with a mouse.
const offenders = [];
for (const f of TSX) {
  const src = stripComments(read(f));
  if (/focus:outline-none/.test(src) && !/focus-visible:/.test(src)) offenders.push(f);
}
ratchet("focus ring is never removed without a replacement", offenders, KNOWN_FOCUS_DEBT);

const globals = read("src/app/globals.css");
check(
  "globals.css defines a :focus-visible ring",
  /:focus-visible\s*\{[^}]*outline:/.test(globals),
);

// ---------------------------------------------------------------------------
// 3. R1 — the banned gold palette is gone from the app shell
// ---------------------------------------------------------------------------
// Scoped to the app shell on purpose: /video and /demo are separate marketing
// surfaces with their own committed world, and are not what colleagues use.
const APP_SHELL = TSX.filter(
  (f) => !f.startsWith("src/app/video/") && !f.startsWith("src/app/demo/"),
);

const goldFiles = APP_SHELL.filter((f) => /#d4a843|#e0b84a|#f5c842/i.test(stripComments(read(f))));
check(
  "banned gold (#d4a843) absent from the app shell",
  goldFiles.length === 0,
  goldFiles.length ? goldFiles.join(", ") : "0 files",
);

// The tour is the first thing a new colleague sees, so it is called out by name.
const tour = readStripped("src/components/OnboardingTour.tsx");
check("onboarding tour uses the brand accent", /var\(--accent\)/.test(tour));
check("onboarding tour has no gold literal", !/#d4a843/i.test(tour));

// craft-floor: "Unicode glyphs or emoji standing in for an icon system."
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const emojiFiles = APP_SHELL.filter((f) => EMOJI.test(stripComments(read(f))));
ratchet("no emoji standing in for icons", emojiFiles, KNOWN_EMOJI_DEBT);

// ---------------------------------------------------------------------------
// 4. R2 — the divider is a token
// ---------------------------------------------------------------------------
check("--divider token is declared", /--divider:\s*#/.test(globals));

const hardDivider = APP_SHELL.filter((f) => /#3a414c/i.test(stripComments(read(f))));
ratchet("divider is the --divider token, not a hex literal", hardDivider, KNOWN_DIVIDER_DEBT);

// The files this change owns must be clean outright, not merely pinned.
for (const f of [
  "src/app/(app)/page.tsx",
  "src/app/(app)/people/PeopleDirectory.tsx",
  "src/components/OnboardingTour.tsx",
  "src/app/(app)/admin/users/UserRow.tsx",
  "src/app/(app)/leave/MyLeavePanel.tsx",
  "src/app/(app)/team-lead/TeamLeadBoard.tsx",
]) {
  check(`${f} uses no hex literal for the divider`, !/#3a414c/i.test(stripComments(read(f))));
}

// ---------------------------------------------------------------------------
// 4b. The status/action icon set replaced the Unicode glyphs
// ---------------------------------------------------------------------------
const icons = readStripped("src/components/nav-icons.tsx");
for (const name of ["IconCheck", "IconCross", "IconWarning", "IconArrowRight", "IconReplay"]) {
  check(`${name} exists in the icon set`, new RegExp(`export function ${name}\\b`).test(icons));
}

/**
 * The auth field class must not disable the focus outline.
 *
 * Called out separately from the ratchet because this single string is shared by
 * every input on every unauthenticated page. Losing the ring here makes the
 * whole sign-in flow unnavigable by keyboard — and unlike anywhere else in the
 * app, the user cannot work around it, because they have not got in yet.
 */
const authShell = readStripped("src/components/AuthShell.tsx");
const authInput = authShell.match(/authInputClass\s*=\s*\n?\s*"([^"]*)"/);
check("authInputClass exists", authInput !== null);
if (authInput) {
  check("auth inputs keep the focus ring", !/outline-none/.test(authInput[1]), authInput[1].slice(0, 60));
}

/**
 * A Server Action result must be announced, not just recoloured.
 *
 * Every one of these renders a message that appears without any focus change —
 * a screen-reader user gets no notification at all unless the container carries
 * a live-region role. The failure cases matter most: a rejected invite or a
 * refused permission change is precisely what a user must not be left to
 * discover by re-reading the page.
 */
for (const [f, expected] of [
  // Count, not presence: each of these renders BOTH a success and a failure
  // branch, and asserting "has a live region somewhere" would pass with the
  // error branch silently unannounced — which is the branch that matters.
  ["src/app/(app)/admin/users/InviteUserForm.tsx", 2],
  ["src/app/(app)/admin/users/UserRow.tsx", 2],
  // The per-person admin record (/admin/users/[userId]): two profile-level forms
  // and a per-entry editor, each announcing its own result. Counted rather than
  // merely present, because the failure branch -- a refused permission, an
  // invoiced entry -- is the branch that must not be silent.
  ["src/app/(app)/admin/users/[userId]/ProfileEditForms.tsx", 2],
  ["src/app/(app)/admin/users/[userId]/EntryRow.tsx", 2],
  ["src/app/(app)/leave/MyLeavePanel.tsx", 2],
  ["src/components/AuthShell.tsx", 1],
]) {
  const found = (stripComments(read(f)).match(/role="(alert|status)"/g) ?? []).length;
  check(`${f} announces every action result`, found >= expected, `${found} live region(s), need ${expected}`);
}

// The admin toggle says ACTIVE / INACTIVE in the same word to a screen reader
// unless the state is in the semantics, so aria-pressed is load-bearing here.
const userRow = readStripped("src/app/(app)/admin/users/UserRow.tsx");
check("admin status toggle carries aria-pressed", /aria-pressed=\{localActive\}/.test(userRow));
// title= is unreachable by keyboard and on touch, so a failed permission change
// must render its reason inline rather than hide it in a tooltip.
check("admin row shows the error text, not a title tooltip", !/title=\{error\}/.test(userRow));
// Both branches must render the message itself. The desktop row previously
// showed the literal word "Error" and hid the reason in a title= tooltip.
/*
 * A live-region role must be a literal, never swapped on a condition.
 *
 * role={error ? "alert" : "status"} looks like the careful version and is the
 * regression: assistive tech classifies the node when it mounts, so the swapped
 * role is announced as whatever it was first, or not at all. The fix is two
 * elements with fixed roles, which is what these files do.
 */
for (const f of [
  "src/app/(app)/admin/users/UserRow.tsx",
  "src/app/(app)/admin/users/[userId]/ProfileEditForms.tsx",
  "src/app/(app)/admin/users/[userId]/EntryRow.tsx",
]) {
  check(
    `${f} keeps live-region roles static`,
    !/role=\{/.test(readStripped(f)),
    "a role computed at render time is not reliably announced",
  );
}

check("admin row renders the error message itself", (userRow.match(/\{error\}/g) ?? []).length >= 2);

// ---------------------------------------------------------------------------
// 5. R3 — contrast, computed from the committed token values
// ---------------------------------------------------------------------------
const tokenOf = (name) => {
  const m = globals.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : null;
};

const luminance = (hex) => {
  const v = [0, 2, 4]
    .map((i) => parseInt(hex.slice(1).substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const PAGE = tokenOf("page");
const SURFACE = tokenOf("surface");
check("--page and --surface resolve", Boolean(PAGE && SURFACE), `${PAGE} / ${SURFACE}`);

// --surface is the load-bearing background here: the previous values were tuned
// against --page and failed on every card, which is where they actually live.
for (const name of ["text-primary", "text-secondary", "text-muted", "text-faint", "accent", "good", "critical", "warning"]) {
  const hex = tokenOf(name);
  if (!hex) {
    check(`--${name} is defined`, false);
    continue;
  }
  const onSurface = ratio(hex, SURFACE);
  const onPage = ratio(hex, PAGE);
  check(
    `--${name} meets 4.5:1 on BOTH --page and --surface`,
    onSurface >= 4.5 && onPage >= 4.5,
    `surface ${onSurface.toFixed(2)}:1, page ${onPage.toFixed(2)}:1`,
  );
}

// ---------------------------------------------------------------------------
// 6. R4 — data is reachable without a mouse
// ---------------------------------------------------------------------------
const overview = readStripped("src/app/(app)/page.tsx");

// A hover-only tooltip is the only path to a week's real numbers, so it must
// have a keyboard and assistive-tech equivalent.
const hoverOnly = /group-hover:block/.test(overview) && !/group-focus-visible:block/.test(overview);
check("chart readout is not hover-only", !hoverOnly);
/*
 * The chart moved: the hero figure is the shared AreaTrend in ui/Charts.tsx, so the
 * interaction layer to check lives THERE. The requirement is unchanged -- every point
 * must be keyboard-reachable and carry its own accessible name -- and the old page-level
 * grep would now pass vacuously (page.tsx has no chart markup left to get wrong) while a
 * regression inside Charts.tsx went unseen.
 */
const chartsSrc = readStripped("src/components/ui/Charts.tsx");
check(
  "chart points are focusable (a real button per point)",
  /<button[\s\S]{0,300}onFocus=\{\(\) => setActive\(i\)\}/.test(chartsSrc),
);
check("chart points carry an accessible label", /aria-label=\{p\.readout\}/.test(chartsSrc));
check(
  "the page actually renders the shared chart",
  /<AreaTrend|<TrendFigure/.test(overview),
  "the two checks above are about Charts.tsx, which only matters if the page uses it",
);

// ---------------------------------------------------------------------------
// 7. /people interaction layer
// ---------------------------------------------------------------------------
const dir = readStripped("src/app/(app)/people/PeopleDirectory.tsx");

check("people directory uses the shared SearchInput", /<SearchInput/.test(dir));
check("people directory uses shared FilterChip", /<FilterChip/.test(dir));
check("people directory has sortable columns", /<SortHeader/.test(dir));
check("people directory uses the shared ButtonLink", /<ButtonLink/.test(dir));

// The decisive data-honesty property, and the one a refactor is most likely to
// "simplify" away: `billablePercent: null` means "logged nothing at all", and
// coercing it to 0 puts an unmeasured person among the measured zeroes.
check(
  "sort pins unmeasured rows last in BOTH directions",
  /if \(av === null\) return 1;/.test(dir) && /if \(bv === null\) return -1;/.test(dir),
  "null is never multiplied by the sort factor",
);
check(
  "sort does not coerce null to 0",
  !/\?\?\s*0/.test(dir.slice(dir.indexOf("function sortPeople"))),
);
check(
  "name sort is locale-aware (German umlauts in the live roster)",
  /localeCompare\(b\.name,\s*"de"\)/.test(dir),
);

// A filtered-to-empty list is a different situation from an empty database and
// needs a different exit: relax the filter, not run a sync.
check(
  "filtered-empty state offers a way to clear the filters",
  /CLEAR \{activeFilterCount\}/.test(dir),
);

const section = readStripped("src/app/(app)/people/PeopleSection.tsx");
check("view switcher exposes real tab semantics", /role="tablist"/.test(section) && /aria-selected/.test(section));

// The Overview deep-links to /people?q=<name>; if the page stops reading the
// param the link still "works" and silently ignores the name.
check(
  "people page reads the ?q= deep link",
  /searchParams/.test(read("src/app/(app)/people/page.tsx")) &&
    /initialQuery/.test(section),
);
check(
  "overview utilisation rows link into /people",
  /\/people\?q=\$\{encodeURIComponent/.test(overview),
);

// ---------------------------------------------------------------------------
// 8. The leave form — asserted on source because the live page cannot reach it
// ---------------------------------------------------------------------------
/**
 * Every one of the six active `app_user_profile` rows has `person_id = NULL`,
 * so /leave renders "No person record is linked to your account" for everybody
 * and the request form never mounts. The browser proof therefore cannot
 * exercise these, and asserting the empty branch instead would be proving the
 * wrong thing. Source assertions it is, until somebody is linked.
 */
const leave = readStripped("src/app/(app)/leave/MyLeavePanel.tsx");

check("leave form uses the shared TextInput", /<TextInput/.test(leave));
check("leave form uses the shared Button", /<Button/.test(leave));
// A bare <input type="date"> announces as "date" and nothing else, so every
// field carries an explicit name — there are four in a row here.
check(
  "every leave field is individually named",
  (leave.match(/label="[^"]+"/g) ?? []).length >= 4,
  `${(leave.match(/label="[^"]+"/g) ?? []).length} labelled field(s)`,
);
// Cancel is icon-only and repeats per row, so a static label would announce
// the same words on every request in the list.
check(
  "cancel button names the request it cancels",
  /aria-label=\{`Cancel leave request for \$\{r\.start_date\}`\}/.test(leave),
);

// ---------------------------------------------------------------------------
// 9. The card system
// ---------------------------------------------------------------------------
/**
 * Every panel used to be a zero-radius box, and adjacent panels FUSED: the KPI
 * strip was one grid whose five cells shared hairlines, so five independent
 * facts about the business read as a single table row and none was scannable.
 *
 * The regressions these guard, each of which compiles and looks plausible:
 *
 *   C1. THE SHADOW THAT RENDERS NOTHING. `shadow-[var(--shadow-card)]` shipped
 *       first, and Tailwind 4 emitted NO rule for it -- measured in the built
 *       stylesheet: the token was defined, no matching class existed, and
 *       --tw-shadow stayed at its `0 0 #0000` default. Every card had a fully
 *       transparent shadow, and a browser check asserting "a shadow is set"
 *       PASSED on "rgba(0, 0, 0, 0) 0px 0px 0px 0px". Hence real CSS classes.
 *
 *   C2. AN INDISTINGUISHABLE HERO. --surface-accent's first value (#313d40) sat
 *       at 1.02 contrast against --surface: literally the same material, while
 *       carrying a token that claimed otherwise.
 *
 *   C3. ACCENT ON ACCENT. The nav's active row became a filled --accent pill,
 *       and the icon was still forced to --accent -- 1.0:1, invisible. Same trap
 *       for the badge, whose default colour is also --accent.
 *
 *   C4. THE EYEBROW COMING BACK. "HSE HUB / ANALYSE" above "Business overview".
 *       Banned outright by the craft floor, not merely discouraged.
 *
 *   C5. DUPLICATED CHROME. A mobile copy plus a `sm:` desktop copy of the top
 *       bar would put two "Search" and two user-name targets in the DOM -- the
 *       exact bug already fixed once on the sidebar collapse toggle.
 */
const css = read("src/app/globals.css");
const card = readStripped("src/components/ui/Card.tsx");

// C1 — the elevation must be a real emitted class, never a Tailwind arbitrary
// value, and the token itself must carry a non-zero OFFSET (a zero-offset halo
// is decoration, not depth).
check(
  // The label deliberately does NOT spell the arbitrary class out. Tailwind 4
  // scans scripts/ too, so a literal shadow-[...] in a string HERE was treated
  // as a utility to emit: it generated an invalid `--tw-shadow: var(...)` rule
  // into globals.css and every page 500ed with "Parsing CSS source code
  // failed". A gate must not be able to break the app it guards.
  "card elevation is a real CSS class, not the arbitrary shadow-[] form",
  /\.card-elev\s*\{[^}]*box-shadow:\s*var\(--shadow-card\)/.test(css) &&
    !/shadow-\[var\(--shadow-card\)\]/.test(card),
  "Tailwind 4 emits no rule for the arbitrary form; the shadow silently vanishes",
);
const shadowToken = /--shadow-card:\s*([^;]+);/.exec(css)?.[1] ?? "";
const shadowOffsets = (shadowToken.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
check(
  "--shadow-card has a non-zero offset and a blur",
  shadowOffsets.length >= 3 && shadowOffsets.some((v) => v !== 0),
  `offsets = [${shadowOffsets.join(", ")}]`,
);

// C2 — measure the hero tint against --surface, in real WCAG arithmetic. A
// token asserting "different material" that measures 1.02 is worse than no
// token, because the intent is recorded and the pixels disagree.
const hexOf = (name) => (new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css) ?? [])[1];
const relLum = (hex) => {
  const c = hex.replace("#", "");
  const v = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratioOf = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const surfaceAccent = hexOf("--surface-accent");
const surface = hexOf("--surface");
check(
  "--surface-accent is VISIBLY different from --surface (>= 1.10)",
  !!surfaceAccent && !!surface && ratioOf(surfaceAccent, surface) >= 1.1,
  `${surfaceAccent} vs ${surface} = ${surfaceAccent && surface ? ratioOf(surfaceAccent, surface).toFixed(3) : "?"}`,
);
// And text must still be readable ON that tint -- the whole point of measuring
// against the surface a colour is actually used on.
for (const token of ["--text-faint", "--text-muted", "--critical", "--warning", "--good"]) {
  const hex = hexOf(token);
  check(
    `${token} clears 4.5:1 on --surface-accent`,
    !!hex && ratioOf(hex, surfaceAccent) >= 4.5,
    `${hex} on ${surfaceAccent} = ${hex ? ratioOf(hex, surfaceAccent).toFixed(2) : "?"}:1`,
  );
}

// C3 — the active nav pill is filled, and NOTHING on it stays --accent.
const nav = readStripped("src/components/SidebarNav.tsx");
check(
  "active nav row is a filled accent pill",
  /active\s*\?\s*"bg-\[var\(--accent\)\]/.test(nav),
);
check(
  "active nav pill does NOT force its icon to --accent (accent on accent)",
  !/active \? "text-\[var\(--accent\)\]" : "text-current"/.test(nav),
  "an --accent icon on an --accent fill measures 1.0:1",
);
check(
  "badge on an active pill switches off the accent fill",
  /background:\s*active\s*\n?\s*\?\s*"var\(--accent-contrast\)"/.test(nav),
);

// C4 — the eyebrow is gone, and cannot come back through the shared header.
const header = readStripped("src/components/PageHeader.tsx");
check(
  "PageHeader never renders the `category` eyebrow",
  !/\{category\s*&&/.test(header) && !/\{category\}/.test(header),
  "accepted for compatibility, but must not reach the DOM",
);
check(
  "Overview page does not pass an eyebrow",
  !/category=/.test(readStripped("src/app/(app)/page.tsx")),
);

// C5 — chrome renders once. Two CSS-hidden copies is an ambiguous accessible
// name, not a responsive layout.
check(
  "top bar chrome is rendered exactly once in PageHeader",
  (header.match(/\{chrome\}/g) ?? []).length === 1,
  `${(header.match(/\{chrome\}/g) ?? []).length} render site(s)`,
);
// The reference shows a notification bell. There is no notification system, so
// a bell would be permanent chrome asserting something untrue -- the same class
// of defect as the old SyncBar claiming a pipeline that never ran was "ok".
const chrome = readStripped("src/components/TopBarChrome.tsx");
check(
  "top bar ships no fake notification bell",
  !/bell|notification/i.test(chrome.replace(/aria-label="[^"]*"/g, "")),
);
check(
  "top bar search points at a capability that exists",
  /\/people\?focus=1/.test(chrome),
);

// The card primitive must not become a nested-card factory: the craft floor bans
// nesting outright, and it is the usual way a card system decays.
check(
  "Card documents the no-nesting rule",
  /Do not nest a Card in a Card/.test(read("src/components/ui/Card.tsx")),
);

// StatTile owns the never-zero rule now, so it has to keep it.
check(
  "StatTile renders n/a for a missing value, never 0",
  /isMissing \? "n\/a"/.test(card) && /value === null/.test(card),
);
check(
  "StatTile suppresses the unit when the value is missing",
  /unit && !isMissing/.test(card),
  '"n/a h" is nonsense',
);

/*
  StatTile must forward unknown props to its root element.

  `data-metric` is how the deployed-page checks locate one specific figure.
  Without a `...rest` spread TypeScript still accepts the prop -- JSX permits
  extra props against an inline-typed component -- and React then drops it, so
  the attribute never reaches the DOM. The failure does not look like a missing
  attribute either: every selector on it reports "card not rendered", which
  sends you hunting a page that was correct all along.
*/
/*
  Scoped to StatTile's own body, deliberately. Card has a `...rest` spread too,
  so a file-wide /\.\.\.rest/ passes with StatTile's spread deleted -- it was
  testing Card and reporting on StatTile.
*/
const statTileBody = card.slice(card.indexOf("export function StatTile"));
check(
  "StatTile forwards unknown props (data-metric) to the DOM",
  /\.\.\.rest/.test(statTileBody) && /\{\.\.\.rest\}/.test(statTileBody),
  "without the spread, data-metric is silently dropped",
);
check(
  "the Overview still tags its KPI tiles with data-metric",
  /data-metric=\{metric\.key\}/.test(read("src/app/(app)/page.tsx")),
);

// The old SyncBar shipped a hardcoded near-black. It was the darkest surface in
// the app and belonged to no token.
check(
  "SyncBar uses a token, not the hardcoded #0b0d0f",
  !/#0b0d0f/.test(readStripped("src/components/SyncBar.tsx")),
);

// Segmented is the app's one mutually-exclusive control. Links, not buttons:
// every use changes a search param, and that must survive a reload and the back
// button.
/*
 * TYPE SCALE. A browser measurement of the rebuilt page found eight heavily-used
 * font sizes including 12.5/12 and 10.5/10/9.5 -- half-pixel steps, which are
 * imperceptible as hierarchy and make every new component a coin flip between
 * two values that look identical. Collapsed to 21 / 13 / 12 / 11 / 10.
 *
 * Scoped to the files this change owns: several module pages another agent is
 * editing still carry the old half-steps, and failing on those would turn CI red
 * for unscheduled work.
 */
const SCALE_OWNED = [
  "src/app/(app)/page.tsx",
  "src/components/ui/Card.tsx",
  "src/components/ui/Segmented.tsx",
  "src/components/PageHeader.tsx",
  "src/components/SyncBar.tsx",
];
for (const f of SCALE_OWNED) {
  const halfSteps = readStripped(f).match(/text-\[(?:\d+\.5)px\]/g) ?? [];
  check(
    `${f.split("/").pop()} uses whole-pixel type sizes`,
    halfSteps.length === 0,
    halfSteps.length ? `half-pixel steps: ${[...new Set(halfSteps)].join(", ")}` : "",
  );
}

const seg = readStripped("src/components/ui/Segmented.tsx");
check("Segmented options are links, not buttons", /<Link/.test(seg) && !/<button/.test(seg.split("export function IconButton")[0]));
check("Segmented marks the current option for assistive tech", /aria-current=\{active/.test(seg));
check("IconButton requires an accessible label", /label: string/.test(seg) && /aria-label=\{label\}/.test(seg));

console.log(failed ? "\nDESIGN SYSTEM: FAIL" : "\nDESIGN SYSTEM: OK");
process.exitCode = failed ? 1 : 0;

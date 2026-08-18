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
const KNOWN_FOCUS_DEBT = ["src/app/(app)/admin/users/UserRow.tsx"];

const KNOWN_EMOJI_DEBT = [
  "src/app/(app)/admin/users/InviteUserForm.tsx",
  "src/app/(app)/admin/users/page.tsx",
  "src/app/(app)/leave/MyLeavePanel.tsx",
  "src/app/(app)/projects/TaskBoardView.tsx",
  "src/app/(app)/projects/TaskRow.tsx",
  "src/app/(app)/team-lead/TeamLeadBoard.tsx",
  "src/app/(app)/time/dashboard/DashboardPanels.tsx",
  "src/app/(app)/time/dashboard/ReportFilters.tsx",
  "src/app/(app)/timesheets/TimesheetGrid.tsx",
  "src/components/AuthShell.tsx",
];

const KNOWN_DIVIDER_DEBT = [
  "src/app/(app)/admin/users/UserRow.tsx",
  "src/app/(app)/leave/MyLeavePanel.tsx",
  "src/app/(app)/projects/TaskRow.tsx",
  "src/app/(app)/team-lead/TeamLeadBoard.tsx",
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
]) {
  check(`${f} uses no hex literal for the divider`, !/#3a414c/i.test(stripComments(read(f))));
}

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
check("chart bars are focusable", /tabIndex=\{0\}/.test(overview));
check("chart bars carry an accessible label", /aria-label=\{readout\}/.test(overview));

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
console.log(failed ? "\nDESIGN SYSTEM: FAIL" : "\nDESIGN SYSTEM: OK");
process.exitCode = failed ? 1 : 0;

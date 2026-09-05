# Apple design system, applied to the HSE Hub

The reference every builder in the design pass reads first. Written 2026-09-05 from four
research angles (HIG foundations, macOS patterns, Apple's official Figma resources, and the
rig's own skill/agent library), each of which pulled Apple's rules from primary sources and
measured them against this repository. Nothing here is a vibe; every value carries a source
tag, and every place Apple and the house pulled apart is decided in §8.

## 0. The stance: Apple's SYSTEM on HSE's FACE

The HSE Hub keeps its face and borrows Apple's skeleton. **Apple contributes the system**:
the type scale and its ratios (10 · 11 · 12 · 13 · 15 · 17 · 22 · 26, leading 1.18–1.33,
hierarchy by weight before size), the semantic colour roles (four label levels, base and
elevated backgrounds, separators, fills, one tint), the hierarchy grammar (essential
information gets space, worst first, progressive disclosure, one prominent action per view),
the materials logic (glass is a functional layer for chrome, never content; thickness is
chosen for legibility, not colour), the layout rules (controls float above content,
≤ 2 levels in a sidebar, nothing critical at the bottom of a window, 28 × 28 pt controls with
12 pt of hit padding), the motion physics (critically damped springs, response on
pointer-down, interruptible, anchored origins, symmetric paths, fades under Reduce Motion),
and the component anatomy (sidebar, toolbar, table, popover, sheet, scope bar, status bar).
**HSE contributes the face**: HSE Teal `--accent` as the single brand colour, the near-black
dark world with a first-class light theme, Poppins for UI text, JetBrains Mono for figures and
labels, and the house conventions (10 rows per worked queue, page state in the URL,
worst-first ordering, honest counts, focus rings never removed, opaque sticky table headers,
separate rounded cards on a gap, "—" for a missing number). **On conflict the house
conventions win**, because they were paid for in incidents that Apple's guidelines never saw;
§8 records every such call and why. SF Pro, SF Symbols, Apple blue and Apple's dark greys do
not transfer — the first two by licence, the last two by brand.

### How to read the tags

- **[Apple]** — Apple states it; the source key follows (see §9). Quotes are verbatim.
- **[attr]** — commonly attributed to Apple, *not* found on an Apple page in this research.
  Never cite these as Apple's.
- **[HSE]** — an existing house rule, token or measured value, with the file it lives in.
- **[decision]** — decided by this document. The build pass implements it as written.
- **[measured]** — computed in this research against the committed token values
  (WCAG 2.x relative-luminance ratio, the same arithmetic as
  `scripts/check-design-system.mjs`).

### Canonical token vocabulary [decision, resolves C10]

The names in `src/app/globals.css` are canonical: `--page`, `--surface`, `--surface-2`,
`--surface-hover`, `--border`, `--border-strong`, `--divider`, `--text-primary`,
`--text-secondary`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`,
`--accent-contrast`, `--accent-wash`, `--good/--warning/--critical` (+ `-wash`),
`--surface-accent`, `--hero-gradient`, `--sidebar`, `--topbar`, `--sidebar-translucent`,
`--glass-*`, `--radius-sm/--radius/--radius-lg/--radius-card/--radius-panel`,
`--card-gap`, `--content-max`, `--sidebar-width`, `--sidebar-rail-width`, `--shadow-*`,
`--ease-out`, `--ease-settle`. The names in `DESIGN.md` §Color tokens (`--bg-0..3`,
`--teal*`, `--text-0..2`, `--green/--amber/--red`) describe the marketing/demo world and do
**not** exist in CSS; a builder who writes them ships a transparent element. Tokens this
document asks to ADD are listed in §2.6 and §5; they are the only new names allowed.

---

## 1. Typography

### 1.1 What Apple states, and what transfers

- macOS default text size **13 pt, minimum 10 pt** [Apple: HIG/typography, HIG/accessibility].
  iOS default 17 / minimum 11 — the Hub ships a mobile tab bar, so the iOS floor binds on touch
  surfaces.
- "In general, avoid light font weights… prefer Regular, Medium, Semibold, or Bold font
  weights, and avoid Ultralight, Thin, and Light" [Apple: HIG/typography].
- "Minimize the number of typefaces you use" [Apple: HIG/typography]. Apple states **no
  numeric cap** on text styles per screen; "use at most N styles" is folklore [attr].
- "Adjust font weight, size, and color as needed to emphasize important information" and
  "maintain the relative hierarchy… when people adjust text sizes" [Apple: HIG/typography].
- Leading: "tight leading" for one-to-two-line list rows, and "If you need to display three or
  more lines of text, avoid tight leading even in areas where height is limited"
  [Apple: HIG/typography]. Tight/loose = **−2 pt / +2 pt** [Apple: WWDC20 10175].
- Tracking is size-specific: "the system font dynamically adjusts tracking at every point
  size" [Apple: HIG/typography]. Apple's table (SF Pro, 1/1000 em): 10 pt +12 · 11 +6 · 12 0 ·
  13 −6 · 15 −16 · 17 −26 · 20 −23 · 22 −12 · 24 +3 · 26 +8 [Apple: HIG/typography]. Those
  numbers are SF metrics and do **not** apply to Poppins; only the shape transfers (positive
  below 12, tightest 17–20, back toward zero above 24).
- Optical sizes: SF has a Text/Display transition "between 17 and 28 points"
  [Apple: WWDC20 10175]. Poppins has no `opsz` axis; the split has to be emulated with two
  treatments (§1.3).
- Monospaced digits: Apple's move is tabular figures *in the UI font* ("each digit occupies
  the same amount of space, which makes it easier to read numbers that are stacked
  vertically") [Apple: UIFont.monospacedDigitSystemFont docs]. The house goes further:
  JetBrains Mono for figures [HSE: DESIGN.md §Typography], and `body { font-variant-numeric:
  tabular-nums }` for every Poppins number [HSE: globals.css].
- Text enlargement: "give people the option to enlarge text by at least 200 percent"
  [Apple: HIG/accessibility]. Browser zoom scales CSS px, so px classes are acceptable; the
  layout must survive 200 % zoom (tables collapse columns before they truncate).
- Contrast by size: up to 17 pt **4.5:1**; 18 pt and up, or bold at any size, **3:1**
  [Apple: HIG/accessibility]; "strive for a contrast ratio of 7:1, especially in small text"
  [Apple: HIG/dark-mode].
- Licence: SF Pro may not be used "for the purpose of creating mock-ups of user interfaces to
  be used in software products running on any non-Apple operating system"
  [Apple: developer.apple.com/fonts]. The system font is off the table regardless of brand.

### 1.2 The macOS built-in text styles (the ladder the Hub mirrors) [Apple: HIG/typography]

| Style | Weight | Size pt | Line height pt | Ratio | Emphasized |
|---|---|---|---|---|---|
| Large Title | Regular | 26 | 32 | 1.23 | Bold |
| Title 1 | Regular | 22 | 26 | 1.18 | Bold |
| Title 2 | Regular | 17 | 22 | 1.29 | Bold |
| Title 3 | Regular | 15 | 20 | 1.33 | Semibold |
| Headline | **Bold** | 13 | 16 | 1.23 | Heavy |
| Body | Regular | 13 | 16 | 1.23 | Semibold |
| Callout | Regular | 12 | 15 | 1.25 | Semibold |
| Subheadline | Regular | 11 | 14 | 1.27 | Semibold |
| Footnote | Regular | 10 | 13 | 1.30 | Semibold |
| Caption 1 | Regular | 10 | 13 | 1.30 | Medium |
| Caption 2 | **Medium** | 10 | 13 | 1.30 | Semibold |

Structural facts to keep: Headline is Body's size with weight added (hierarchy by weight, not
size); UI leading runs 1.18–1.33 and never 1.5+; every role has an emphasized partner one or
two weight steps up.

### 1.3 The Hub type scale (Poppins + JetBrains Mono) [decision]

1 pt = 1 CSS px. Sizes are whole pixels; `12.5px` and `11.5px` are banned
[HSE: Field.tsx header]. Tracking values are an **HSE proposal shaped like Apple's curve**,
to be tuned by eye in the build pass — they are not Apple's numbers [decision]. Poppins is a
wide geometric face, so its display sizes want mild negative tracking where SF's want
positive; the shape (near-zero at 12–13, tightest at the largest UI sizes, no single value
for all sizes) is what transfers.

| Role | Apple analogue | Face | px / line-height | Weight | Tracking | Use it for | Class / token today → target |
|---|---|---|---|---|---|---|---|
| `t-large` | Large Title | Poppins | 26 / 32 | 600 | −0.015em | sign-in headline; the Overview hero title; nothing else in the shell | **ADD** `.t-large` |
| `t-title` | Title 1 | Poppins | 22 / 26 | 600 | −0.01em | the page `h1` in `PageHeader` at ≥ sm | today `text-[17px] sm:text-[19px]` → **ADD** `.t-title` |
| `t-title-2` | Title 2 | Poppins | 17 / 22 | 600 | −0.005em | page `h1` on mobile; `DrillDialog` title | **ADD** `.t-title-2` |
| `t-title-3` | Title 3 | Poppins | 15 / 20 | 600 | 0 | `CardHeader` title; a section heading inside a page | **ADD** `.t-title-3` (replaces the mono 10 uppercase card title in `DataTable` header only where a card title is prose; see §5.6) |
| `t-headline` | Headline | Poppins | 13 / 16 | 600 | 0 | row title in a two-line cell, `EmptyState` title, form legend, emphasised cell | today `text-[13px] font-medium` → **ADD** `.t-headline` |
| `t-body` | Body | Poppins | 13 / 16 | 400 | 0 | comfortable table cells (worked queues), dialog body, form labels, ≤ 2-line prose | **ADD** `.t-body`; DESIGN.md "Tables: 13px body" |
| `t-callout` | Callout | Poppins | 12 / 15 | 400 (500 inside controls) | 0 | dense table cells (ledgers), inputs, selects, nav items, `md` buttons, chips | today `text-[12px]` everywhere — the Hub's de-facto body |
| `t-subhead` | Subheadline | Poppins | 11 / 14 | 400 | +0.005em | hints under tiles, footnotes, `sm` buttons, "no rows" text inside a table | today `text-[11px]` |
| `t-label` | Caption 2 (Medium at 10) | **JetBrains Mono** | 10 / 13 | 500 | +0.08em, uppercase | column headers, KPI captions, sidebar group headers, pager copy, `meta` line | house token `font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]` [HSE: UI-CONVENTIONS] |
| `fig-xl` | Large Title | JetBrains Mono | 26 / 32 | 500 | 0 | the one hero figure per page (hero-tone card) | **ADD** `.fig-xl` |
| `fig-lg` | Title 1 | JetBrains Mono | 22 / 26 | 500 | 0 | `StatTile` value, summary-strip value | today `font-mono text-[22px]` |
| `fig-md` | Title 3 | JetBrains Mono | 15 / 20 | 500 | 0 | inline totals, dialog headline figure | **ADD** `.fig-md` |
| `fig` | one step under the row's sans role | JetBrains Mono | 11 / 15 in a `t-callout` row; 12 / 16 in a `t-body` row | 400 | 0 | numeric table cells, IDs, codes | today `font-mono text-[11px]` in ledgers |

Rules that come with the table:

1. **Weights.** 400 body, 500 controls and labels, 600 headings and emphasis, 700 only for
   display ≥ 26 px on Persuade pages. **Poppins 300 and 800 are banned in the app shell**
   [decision, resolves C1; Apple: "avoid… Light"]. The `font-thin/extralight/light` audit in
   the typographer's gate must return zero hits under `src/app/(app)` and `src/components`.
2. **Floors.** No Poppins below 11 px. Mono at 10 px only as `t-label` (Apple's macOS floor
   is 10 [Apple]). On touch surfaces (`MobileTabBar`, `MobileSidebar`, `MobileDisclosure`)
   nothing below 11 px (the iOS floor) [decision, resolves C2].
3. **Leading.** The table's line heights are the standard. *Tight* (−2 px) is allowed for a
   two-line cell (project name over its code: 12/13); never for three or more lines
   [Apple: HIG/typography]. *Loose* (+2 px) for paragraphs. `leading-relaxed` (1.625) and
   DESIGN.md's 1.6 are for prose on Persuade pages and long descriptions only — UI text at
   the same size sits at 1.23–1.33 [decision, resolves C2-hig].
4. **Two optical treatments** replace SF's `opsz` axis [decision]: *text* (< 17 px: 400/500,
   zero or slightly positive tracking, leading from the table) and *display* (≥ 22 px: 600,
   negative tracking, leading ≤ 1.2). 17 px is the crossover and takes the text treatment
   with 600 weight. DESIGN.md's `−0.03em` stays reserved for the 88 px marketing display.
5. **How many roles one screen may use** [decision; Apple states no number]. An operate
   page uses at most **four Poppins roles + `t-label` + two figure sizes** — typically
   `t-title` (once), `t-title-3` (card headers), `t-callout` (rows), `t-subhead` (hints),
   `t-label`, `fig-lg` and `fig`. A dialog adds `t-title-2`; a two-line cell adds
   `t-headline`. Never two roles one step apart doing the same job on the same screen
   (that is how 12 and 12.5 px both shipped).
6. **Tabular figures.** Every number in a column is `fig` (mono). Every number inside a
   sentence stays Poppins and inherits `tabular-nums` from `body`. Hours to one decimal,
   percent as integers, "—" for a missing value [HSE: UI-CONVENTIONS; DESIGN.md §Data
   tables 6; decision resolves C11: "—", never "n/a", in any cell or tile].
7. **Emphasis.** Emphasis inside a role is +1 weight step (400 → 500, 500 → 600) or a colour
   step up the label ladder — never a size step [Apple: Headline = Body + weight].
8. **German.** Every role is checked with the `de` strings: German runs ~30 % longer and a
   label that fits in EN and wraps in DE is a defect [HSE: i18n-engineer agent].

---

## 2. Colour and dark mode

### 2.1 Apple's semantic roles → house tokens

Apple's rule: "Avoid redefining the semantic meanings of dynamic system colors… don't use the
separator color as a text color, or secondary text label color as a background color"
[Apple: HIG/color]. The house tokens already form the ladder; this table fixes the meaning
of each name.

| Apple role [Apple: HIG/color, HIG/labels] | Apple's purpose (quoted) | House token | Measured on `--surface` dark / light |
|---|---|---|---|
| `label` | "Primary information" | `--text-primary` | 15.06 / 15.71 |
| `secondaryLabel` | "A subheading or supplemental text" | `--text-secondary` | 9.21 / 9.09 |
| `tertiaryLabel` | "Text that describes an unavailable item or behavior"; placeholder | `--text-muted` | 7.45 / 6.36 |
| `quaternaryLabel` | "Watermark text"; least important | `--text-faint` — **but see §2.2** | 7.18 / 5.57 |
| `placeholderTextColor` | placeholder in a control | `--text-muted` (`placeholder-[var(--text-muted)]` in `Field.tsx`) | as above |
| `disabledControlTextColor` | text of an unavailable control | `--text-faint` + `cursor-not-allowed` | as above |
| `headerTextColor` | "text of a header cell in a table" | `--text-faint` in `t-label` (column headers) | as above |
| `linkColor` | text that functions as a link | `--accent` | 8.45 / 5.20 |
| `separatorColor` / `gridColor` | between rows; "gridlines… in a table" | `--divider` | 1.10 / 1.26 vs surface |
| `opaqueSeparator` / box border | outlines a surface | `--border` | 1.19 / 1.41 vs surface |
| control bezel | outline of a control | `--border-strong` | 1.60 / 1.71 vs surface |
| `keyboardFocusIndicatorColor` | the focus ring | `--accent`, 2 px, offset 2 (`:focus-visible` in globals.css) | — |
| `controlAccentColor` | "buttons, selection highlighting, and sidebar icons" | `--accent` (+ `--accent-hover`, `--accent-contrast`) | — |
| `selectedContentBackgroundColor` | selected row/item in a key window | `--accent` fill + `--accent-contrast` text (nav pill, `Segmented` chosen) | — |
| `unemphasizedSelectedContentBackgroundColor` | selection when the window is not key | not emulated on the web [decision] | — |
| `alternatingContentBackgroundColors` | zebra rows | **ADD** `--row-alt` (§2.6); off by default | — |
| `systemFill` ladder | fills for shapes of increasing size | `--surface-hover` (neutral), `--accent-wash` (tinted), `--good/-warning/-critical-wash` (status) | — |
| `findHighlightColor` | search-match highlight | `--warning-wash` + `--text-primary` [decision] | — |

Backgrounds [Apple: HIG/color "Primary for the overall view · Secondary for grouping content
… · Tertiary for grouping… within secondary elements"; HIG/dark-mode base vs elevated]:

| Apple level | House token | Dark value | Light value | Role [decision] |
|---|---|---|---|---|
| primary / base | `--page` | `#121418` | `#eef0f2` | the page ground |
| secondary / elevated 1 | `--surface` | `#1a1e24` (1.10 above page) | `#ffffff` | cards, tables, panels, the sticky table header |
| recessed (macOS `underPageBackground` / `controlBackground` semantics) | `--surface-2` | `#14171c` (**darker** than surface) | `#f2f4f5` | inset tracks (`Segmented`), input wells, code, disabled fills — **never** a "nested card" (§2.3) |
| hover fill | `--surface-hover` | `#232933` (1.14 above surface) | `#e9edee` | hover on rows, items, ghost buttons |
| elevated 2 (popover, menu, tooltip, dialog) | **ADD** `--surface-raised` | candidate `#20262e` (1.10 above surface, 1.21 above page) | `#ffffff` + `--shadow-raised` | overlays; see §4 |
| hero tone | `--surface-accent` + `--hero-gradient` | `#1c2a26` (1.12 vs surface) | `#dcebe6` | one card per page [HSE: Card.tsx] |
| chrome | `--sidebar`, `--topbar` | `#0d0f12` (darker than page) | `#e4e7ea` | the desktop shell; see §4.2 |

### 2.2 Findings from measuring the ladder [measured]

- **The comments in `globals.css` are stale.** `--text-faint` is annotated "4.70:1 on
  --surface"; against the committed `--surface #1a1e24` it is **7.18:1**, and the whole
  ladder sits above 7:1 in dark (primary 15.06, secondary 9.21, muted 7.45, faint 7.18,
  accent 8.45, good 7.70, critical 7.20, warning 7.26). The surfaces were darkened after the
  comments were written. Recompute before trusting any ratio quoted in a comment.
- **`--text-muted` and `--text-faint` are 1.04:1 apart in dark** (`#a7aeb3` vs `#a3abb1`),
  1.14 in light. Apple's four label levels are visibly distinct steps [Apple: WWDC19 214,
  "four levels of text colors… emphasize which elements are important relative to others"].
  Two tokens with one appearance is a ladder with a missing rung.
- Light theme: `--accent #1f7a67` as text on a hovered row (`--surface-hover #e9edee`) is
  **4.41:1 — below 4.5**. `--accent-hover #17604f` is 6.31 there. `--text-faint` on light
  hover is 4.72.
- The gate checks eight tokens against `--page` and `--surface` only
  [HSE: check-design-system.mjs L383-398]; `--surface-hover` is where accent links and
  captions actually sit while the pointer is on the row.

### 2.3 Decisions [decision]

1. **Four distinct label levels, all legible.** Apple's quaternary is watermark-grade
   (attributed alpha ≈ 0.18 [attr]) and would fail the house 4.5:1 floor; the Hub does not
   use watermark text, so the fourth rung is *caption ink*, not a watermark. Retune
   `--text-faint` so it reads one step below `--text-muted` while staying ≥ 5.5:1 on
   `--surface` and ≥ 4.5:1 on `--surface-hover`, in both themes. Dark candidates measured:
   `#949ca2` (6.00 surface / 6.62 page / 5.25 hover, 1.24 vs muted) or `#8f979d` (5.64 /
   6.22 / 4.93, 1.32 vs muted). Light: `#505d65` (6.79 / 5.94 / 5.76, 1.07 vs muted — light
   needs `--text-muted` lightened one step as well, since the room is on that side). The
   colour engineer picks the pair whose muted↔faint contrast is ≥ 1.2 in both themes.
2. **Elevation in dark = lighter, one step per layer** [Apple: HIG/dark-mode "the elevated
   colors are brighter, making foreground interfaces appear to advance"]. Order: `--page` <
   `--surface` < `--surface-raised` (overlays) with `--surface-hover` as the hover fill on
   any of them. `--surface-2` is darker than `--surface` and therefore means *recessed*;
   using it to nest one panel in another inverts the system and is banned (nesting is
   banned anyway [HSE: Card.tsx]). Foreground tokens do not change with the level
   [Apple: WWDC19 "foreground colors don't change"].
3. **Not pure black, and not because of Apple.** Apple's dark system background *is* pure
   black [Apple: WWDC19 214 "pure black in dark mode"]; "avoid pure black" is Material
   Design folklore [attr]. The Hub's `#121418` is a brand choice [HSE: DESIGN.md "always
   teal-dark bg"] and stays; cite the house, never Apple, for it.
4. **Status colours: keep the house values; cite the house for their chroma.** Apple does
   *not* say "desaturate in dark mode" — its dark variants are marginally brighter and *more*
   saturated (green 52,199,89 → 48,209,88; red 255,56,60 → 255,66,69) [Apple: HIG/color
   specifications]. The house `--good #4cc3a6 / --warning #d9a13b / --critical #f0917a`
   are lowered-chroma so they clear 4.5:1 as *text* on both surfaces [HSE: globals.css]; that
   is a house decision and it is correct for text-bearing status. What transfers from Apple:
   every status colour ships as a **light / dark / increased-contrast** set
   [Apple: HIG/color "provide light and dark variants, and an increased contrast option for
   each"], so **ADD** a `@media (prefers-contrast: more)` block that raises each of the eight
   text tokens and both status washes (see §2.6).
5. **One tint, sparingly** [Apple: HIG/color "Apply color sparingly… To emphasize primary
   actions, apply color to the background rather than to symbols or text… Refrain from adding
   color to the background of multiple controls"; HSE: Button.tsx "The one accent-filled
   control"]. On operate pages `--accent` means exactly two things: *interactive* (links,
   the one primary button, focus ring) and *current* (nav pill, chosen segment, current
   page). It is **not** a status colour and **not** decoration:
   - healthy/on-track status → `--good`, not `--accent` (resolves the `burnColor` and
     UI-CONVENTIONS "accent for healthy" conflict; see §8 #5);
   - KPI figures → `--text-primary`; teal on a figure only inside the one hero-tone card;
   - sidebar icons stay `currentColor` grey at rest, teal only on the current item
     (Apple's default tints all sidebar icons with the accent [Apple: HIG/sidebars], which
     would put teal on nine controls at once — Apple's own "refrain from… multiple controls"
     and the house rule both say no);
   - nav badges are neutral (`--surface-hover` + `--text-secondary`); `--critical-wash`
     only for a count that needs attention.
6. **Never colour alone** [Apple: HIG/color, HIG/accessibility "distinct shapes or icons"]:
   status = icon + text + colour. `IconCheck`/`IconWarning`/`IconCross`/`IconDot` exist for
   this.
7. **Follow the system, keep the switch** (resolves C5). Apple: "Avoid offering an
   app-specific appearance setting" [Apple: HIG/dark-mode]. The Hub keeps `ThemeToggle`
   because the documented boot order is already Apple's spirit — stored choice, then OS
   preference, then dark [HSE: ThemeToggle.tsx] — and a dark-only history means flipping
   colleagues' portals without asking is the greater harm. Both themes stay first-class;
   every new token is defined in `:root` and `[data-theme="light"]`.
8. **Soften white images on dark** [Apple: HIG/dark-mode "Soften the color of white
   backgrounds"]: `img.on-dark { filter: brightness(.92) }` for logos and screenshots with
   white grounds, dark theme only.
9. **Test with Increase Contrast and Reduce Transparency, separately and together**
   [Apple: HIG/dark-mode]. The colour engineer's gate runs both emulations.

### 2.4 Apple's published system colours (reference only — not the Hub's palette) [Apple: HIG/color, updated 2025-06-09]

Kept here so nobody re-fetches them. The pattern is what matters: dark = slightly brighter;
increased-contrast = darker in light, lighter in dark.

| Name | Light | Dark | IC light | IC dark |
|---|---|---|---|---|
| Red | #FF383C | #FF4245 | #E9152D | #FF6165 |
| Orange | #FF8D28 | #FF9230 | #C55300 | #FFA056 |
| Yellow | #FFCC00 | #FFD600 | #A16A00 | #FEDF43 |
| Green | #34C759 | #30D158 | #008932 | #4AD968 |
| Teal | #00C3D0 | #00D2E0 | #008198 | #3BDDEC |
| Blue | #0088FF | #0091FF | #1E6EF4 | #5CB8FF |
| Gray → Gray6 (light) | #8E8E93 · #AEAEB2 · #C7C7CC · #D1D1D6 · #E5E5EA · #F2F2F7 | | | |
| Gray → Gray6 (dark) | #8E8E93 · #636366 · #48484A · #3A3A3C · #2C2C2E · #1C1C1E | | | |

Apple's caveat: "Avoid hard-coding system color values… may fluctuate from release to
release" [Apple: HIG/color]. Apple publishes **no RGB** for the label/separator/fill roles;
the alphas circulating (label 100 % / 60 % / 30 % / 18 %) are [attr].

### 2.5 The tinted wash and selection

- `--accent-wash` (14 % accent) is the *selected/current* fill for rows and chips
  [decision]; `--surface-hover` is hover; the two must be distinguishable when both apply
  (a hovered selected row keeps the wash and adds a `--border-strong` left rule, not a
  second fill).
- Selection in a list is a full-row highlight, not a ring: "use a focus ring for a text or
  search field, but use a highlight in a list or collection" [Apple: HIG/focus-and-selection].
- The current nav item is accent fill + `--accent-contrast` text — Apple's key-window
  selection appearance [Apple: HIG/focus-and-selection "white text and a background
  highlight that matches the app's accent color"].

### 2.6 Tokens to ADD (colour engineer owns; both themes; each with a measured comment)

| Token | Purpose | Dark candidate | Light candidate | Constraint |
|---|---|---|---|---|
| `--surface-raised` | popovers, menus, tooltips, dialogs | `#20262e` | `#ffffff` | dark: ≥ 1.08 above `--surface`, hover on it uses `--surface-hover` (`#232933`, 1.04 above the candidate — acceptable only with the shadow; else pick `#1f252c`/`#262d37` as the pair) |
| `--row-alt` | zebra stripe for > 8-column crosstabs only | `#202429` (white @ 0.025 over surface, 1.07) | `#f7f8f9` | ≤ 1.08 vs surface so the stripe is a guide, not a row state |
| `--scrim` | dialog backdrop | `rgba(0,0,0,0.5)` | `rgba(23,32,38,0.35)` | Apple's "dark dimming layer of 35 % opacity" is for clear glass over bright media [Apple: HIG/materials]; the dialog scrim is a house value |
| `--focus-ring` | alias of `--accent` for the ring | `var(--accent)` | `var(--accent)` | exists implicitly; naming it lets `prefers-contrast: more` widen it |
| `@media (prefers-contrast: more)` block | Apple's increased-contrast variant set | primary `#ffffff`, secondary `#d5dadd`, muted `#c2c8cc`, faint `#b4bbc0`; borders one step stronger; washes at 0.22 | primary `#000000`, secondary `#26313a`, muted `#3a464f`, faint `#44515a` | every pair ≥ 7:1 on both surfaces; the ring widens to 3 px |

---

## 3. Layout

### 3.1 What Apple states

- "Leverage large displays to present more content in fewer nested levels and with less need
  for modality, while maintaining a comfortable information density that doesn't make people
  strain" [Apple: HIG/designing-for-macos]. Viewing distance "about 1 to 3 feet".
- "Make essential information easy to find by giving it sufficient space"; "place the most
  important items near the top and leading side"; "Take advantage of progressive disclosure"
  [Apple: HIG/layout].
- "Controls and navigation components like sidebars and tab bars appear on top of content
  rather than on the same plane"; use "a scroll edge effect… Instead of a background"
  [Apple: HIG/layout]. Hard style "for… pinned table headers" [Apple: WWDC25 356].
- "Avoid placing controls or critical information at the bottom of a window. People often move
  windows so that the bottom edge is below the bottom of the screen" [Apple: HIG/layout];
  "Avoid putting critical information or actions at the bottom of a sidebar"
  [Apple: HIG/sidebars].
- Control size macOS **default 28 × 28 pt, minimum 20 × 20 pt**; iOS **44 × 44 / 28 × 28**;
  "about **12 points** of padding around elements that include a bezel… about **24 points**"
  around bezel-less elements [Apple: HIG/accessibility]. Buttons: "a hit region of at least
  44x44 pt… whether they use a fingertip, a pointer" [Apple: HIG/buttons] — hit region, not
  visual size.
- "In general, show no more than two levels of hierarchy in a sidebar" [Apple: HIG/sidebars].
  Toolbar: "aim for a maximum of three groups"; title "under 15 characters"; one `.prominent`
  action, trailing [Apple: HIG/toolbars].
- "As someone resizes a window, defer switching to a compact view for as long as possible…
  prefer hiding tertiary columns such as inspectors as the view narrows" [Apple: HIG/layout].
- Shapes: "Fixed shapes have a constant corner radius; Capsules use a radius that's half the
  height; Concentric shapes calculate their radius by subtracting padding from the parent's"
  [Apple: WWDC25 356]. Dense macOS controls stay rounded-rect; only Large controls go capsule.
- Apple publishes **no** grid unit, window margin, sidebar width, toolbar height, row height
  or modern control height. "8 pt grid", "20 pt margins", "sidebar rows 22–32", "toolbar
  52/38", "controls 16/19/22/28" are all [attr]. `NSTableView.rowHeight` default 16 applies
  only to the custom size style [Apple: AppKit docs].

### 3.2 The Hub's layout constants [decision, reconciled with DESIGN.md's 12/16/24 rhythm]

| Constant | Value | Status |
|---|---|---|
| Base unit | 4 px; rhythm 8 · 12 · 16 · 24 · 32 | [HSE: DESIGN.md §Spacing; impeccable layout.md] — cite the house, not Apple |
| Page padding | 16 px (< 640) / 24 px (≥ 640) | [HSE: `.page-shell`] |
| Content max width | 1600 px, centred | [HSE: `--content-max`] |
| Card gap | 12 px (`--card-gap`); 16 px between card groups; 24 px between page sections | [HSE] |
| Card padding | 16 px (dense operate cards) / 20 px (chart and hero cards) | [decision; DESIGN.md says 20–24, the operate density wants 16] |
| Sidebar | 220 px expanded / 64 px rail; item row 32 px (min 28); rail icon target 40 × 40 with 12 px padding each side; group header 8 px above, 4 px below | [HSE: `--sidebar-width`, sidebar-collapse-shared.ts]; Apple states no width; 12 px padding is Apple's bezel padding |
| Top bar (`PageHeader`) | ≈ 50 px: `t-title` 26 px line + 12 px padding above and below; in flow, not sticky; `border-b --border` | [decision] |
| Mobile tab bar | floating pill, item min-height 44, icon 20, label 12/1 | [HSE: MobileTabBar.tsx]; 44 is Apple's iOS control default |
| Row heights | **compact 28** (ledgers: 25–50 rows, `t-callout` 12/15 + py-1.5 with tight leading), **standard 32** (worked queues and `DataTable` default: 12/16 + py-2), **comfortable 40** (touch lists) | [decision]; Apple states none; 28 = Apple's macOS control default |
| Control heights | `sm` 24 (11/14 + py-1; Apple macOS minimum is 20, WCAG 2.2 floor 24), `md` 32 (12/15 + py-1.5, `min-h-[32px]`), touch 44 (`pointer-coarse:`) | [HSE: Button.tsx SIZES; decision raises `sm` from ~22 to 24] |
| Icon-only buttons | 28 × 28 box minimum on desktop (Apple default), 44 on touch; 8 px between adjacent bezeled buttons, 12 px hit padding is the button's own box | [Apple: HIG/accessibility] |
| Inputs | 32 px (`t-callout` + py-1.5), bezel `--border-strong`, well `--page` | [HSE: Field.tsx CONTROL_BASE] |
| Chips | 24 px (`t-label` + py-1), rounded-full; 36 px on coarse pointers | [HSE: FilterChip] |
| Radii | `--radius-sm 4` (buttons, inputs, nav rows), `--radius 6` (chips that are not pills, tooltips), `--radius-lg 8` (popovers, menus), `--radius-card 12` (cards, dialogs), `--radius-panel 20` (the auth card), 9999 (pills, segments) | [HSE: globals.css] — DESIGN.md's 6/10/14 are the marketing values |
| Concentric children | `inner = max(outer − padding, 2px)` for anything drawn inside a rounded parent (a filled segment inside a `Segmented` track: track 9999 → segment 9999; a chip inside a 12 px card at 16 px padding → chip 4) | [Apple: WWDC25 356] — additive, not a change to the ladder |
| Breakpoints | structural, not fluid: 640 (page padding), 1024 (`lg:` — sticky detail panels, 5-across strips), 1280 (tables should fit without sideways scroll), 1600 (cap) | [HSE + decision]; test at halves and thirds of 1440 and 1920 [Apple: HIG/layout] |
| Collapse order as width shrinks | detail/inspector column first → sidebar to rail → charts under `MobileDisclosure` → columns (tertiary first) → never the nav | [Apple: HIG/layout "prefer hiding tertiary columns"] |
| Bottom of the window | nothing critical: the pager sits at the foot of a bounded card, not the page; the connection dot may stay at the sidebar foot (passive status); logout and tour move into the user-chip menu | [Apple: HIG/layout, HIG/sidebars; decision resolves macOS conflict 4] |
| Page height | ≤ 3 screens on first load; table bodies bounded at ~60 vh | [HSE: DESIGN.md §Data tables 5, 8; check-table-scroll-budget.mjs] |

### 3.3 Grouping grammar [Apple: HIG/layout; HSE: UI-CONVENTIONS §Cards vs controls]

- A **Card** is a top-level panel with a heading or an aggregate. Controls are never cards.
  Never Card-in-Card; group inside a card with spacing and `CardDivider`.
- Hero tone once per page.
- Group by proximity before drawing a container: 8 px inside a group, 16 px between groups,
  24 px between sections; a divider only where proximity is not enough.
- Align leading edges: charts share the ledger's left edge [Apple: HIG/charts "align the
  leading edge of a chart with the leading edge of other views"].

---

## 4. Materials and elevation

### 4.1 What Apple states

- "Apple platforms feature two types of materials: Liquid Glass, and standard materials."
  Liquid Glass "forms a distinct functional layer for controls and navigation elements — like
  tab bars and sidebars — that floats above the content layer." "Don't use Liquid Glass in
  the content layer… use Standard materials for elements in the content layer, such as app
  backgrounds." "Use Liquid Glass effects sparingly" [Apple: HIG/materials, 2025-09-09].
- "Thicker materials, which are more opaque, can provide better contrast for text… Thinner
  materials… help people retain their context." Regular variant "when components have a
  significant amount of text, such as alerts, sidebars, or popovers"; clear variant only
  "over visually rich backgrounds" [Apple: HIG/materials].
- "Liquid Glass appears more opaque in larger elements like sidebars to preserve legibility"
  [Apple: HIG/color].
- Vibrancy: "Regardless of the material you choose, use vibrant colors on top of it"; "avoid
  using quaternary on top of the thin and ultraThin materials" [Apple: HIG/materials].
- macOS names its materials by purpose — `sidebar`, `menu`, `popover`, `sheet`, `toolTip`,
  `headerView`, `contentBackground`, `underPageBackground` — and deprecated the
  appearance-named ones [Apple: AppKit NSVisualEffectView.Material].
- "In macOS, inactive windows don't use Materials… which makes them appear subdued"
  [Apple: HIG/windows].

### 4.2 The Hub's material vocabulary [decision]

A data tool has exactly one reason to blur: chrome that genuinely floats over scrolling
content. Everything that carries numbers is opaque.

| Material | Where | Recipe | Notes |
|---|---|---|---|
| **M0 content** (Apple `contentBackground` / standard material) | cards, tables, the sticky table header, inputs, dialogs, the `PageHeader` | opaque `--surface` (dialogs `--surface-raised`); `--shadow-card` | the sticky header is `bg-[var(--surface)]` and stays so: "translucency over moving digits is worse than no header at all" [HSE: DESIGN.md §Data tables 3] — this overrides apple-design §12 for tables (§8 #4) |
| **M1 recessed** (`underPageBackground`) | `Segmented` track, input wells, code | `--surface-2` / `--page` | darker = recessed; never used to nest |
| **M2 raised** (`popover`, `menu`, `toolTip`) | popovers, menus, tooltips, `SearchableSelect` list | opaque `--surface-raised`, `--border-strong`, `--shadow-raised`, radius `--radius-lg` (tooltips `--radius`) | Apple would use the regular material; opaque is the "thick" end of Apple's own scale and is what text-heavy overlays get [Apple: "alerts, sidebars, or popovers"] |
| **M3 desktop chrome** (`sidebar`, toolbar) | `Sidebar`, rail, `PageHeader` | opaque `--sidebar` / `--topbar` | Apple's macOS sidebar is translucent to the *desktop behind the window*, which the web has no equivalent for, and no content scrolls beneath the Hub's sidebar (it is a split-view pane). Stays opaque [decision, resolves macOS conflict 3]. If the `PageHeader` is ever made sticky it adopts M4, not a blur over numbers |
| **M4 glass** (Liquid Glass functional layer) | `MobileTabBar`, `MobileSidebar` sheet — the only surfaces content scrolls under [HSE: globals.css L11-16] | `.surface-translucent` + `.card-elev-glass`: `--sidebar-translucent` (#2f3742 @ 0.72, separation 1.33 over page), 24 px specular band `--glass-band`, `blur(28px) saturate(180%)`, rim `--glass-edge` (0.36 → 4.57:1), `--shadow-glass`; text `--glass-text` / `--glass-text-active` | every number here was measured against the worst backdrop (an accent fill) [HSE: globals.css]; do not touch without re-measuring. Nothing else in the app gets `backdrop-filter` |
| **M5 scrim** | behind `DrillDialog`, behind the mobile sheet | `--scrim` (ADD) | "Dim to focus, separate to keep flow": modal = scrim; non-blocking panel = no scrim [HSE: apple-design §12] |

Rules:

1. **Glass only on chrome that floats over content; never in the content layer; never glass
   on glass** [Apple: HIG/materials; apple-design §12 "Never stack a light translucent
   surface on another"].
2. **Vibrancy on glass**: `--glass-text` (#e8ebed) and `--glass-text-active` (#ffffff),
   weight 500, tracking +0.01em — never `--text-secondary` (3.07:1 over the worst backdrop)
   and never `--accent` as text on glass [HSE: globals.css L86-99; Apple: "use vibrant
   colors on top of it"]. Colour lives on solid layers.
3. **Fallbacks are mandatory**: `@supports` without `backdrop-filter` and
   `prefers-reduced-transparency: reduce` → `--glass-solid` (#333c48 / #ffffff), no gradient,
   no blur [HSE: globals.css L762-800; Apple: HIG/dark-mode "Reduce Transparency"].
   `prefers-contrast: more` → the solid pane plus a `--border-strong` rim.
4. **Elevation on dark is fill + rim, on light it is shadow** [HSE: measured in globals.css:
   a black shadow over `--page` separates only 1.054; the same over the light page 2.070].
   So dark overlays lean on `--surface-raised` + `--glass-edge`/`--border-strong`; light
   overlays lean on `--shadow-raised`. Both ship both; only the load-bearing one differs.
5. **Scroll-edge effect**: allowed only under floating chrome (M4). Under the opaque sticky
   table header the hairline `shadow-[0_1px_0_var(--border)]` is the "hard" scroll edge
   Apple prescribes for pinned headers [Apple: WWDC25 356] and stays.
6. **Cards do not lift on hover unless they are interactive as an object**; `.card-elev`'s
   1 px lift and low glow are the ceiling [HSE: globals.css]. Rows inside a card use tint, not
   lift.
7. **Inactive window subduing** is not emulated (no key-window concept on the web)
   [decision].

---

## 5. Components, per surface

Each table names the macOS pattern the surface *is*, its anatomy, sizes, and states. Sizes
refer to §1.3 roles and §3.2 constants. "Press" is the pointer-down state Apple requires for
every custom button ("Always include a press state" [Apple: HIG/buttons]).

### 5.1 The nav shell (`Sidebar`, `SidebarNav`, `DesktopSidebarShell`, `PageHeader`, `TopBarChrome`, `MobileTabBar`)

| Aspect | Spec |
|---|---|
| macOS pattern | `NSSplitViewController` with a full-height **sidebar** item (`Material.sidebar` semantics, ≤ 2 levels) + a per-window **toolbar** (leading: title; trailing: search, user menu, one prominent action). Mobile = **tab bar** in the Liquid Glass layer [Apple: HIG/sidebars, HIG/toolbars, HIG/tab-bars] |
| Anatomy (sidebar) | header: brand mark + collapse toggle (stays here; see §8 #12) → groups: ANALYSE / RECORDS / ADMIN as `t-label` headers (mono 10, `tracking-[0.12em]`) → items: icon 16 + label `t-callout` 12/15 (500) + optional badge (mono 10, 600, neutral) → footer: connection-status dot only |
| Anatomy (top bar) | leading `t-title` 22/26 (17/22 < sm) + `meta` as mono 10 non-uppercase `--text-faint`; trailing chrome (search, notifications, user chip) `ml-auto`; `actions` row wraps below; ≤ 3 groups; ≤ 1 primary button; title ≤ 15 characters where the language allows, and never the app name [Apple: HIG/toolbars] |
| Sizes | width 220 / rail 64; item 32 px tall, `px-3`, radius `--radius-sm`; rail icon target 40 × 40; badge 16 px tall; top bar ≈ 50 px; tab-bar items min-h 44, icon 20 |
| Rest | icon + label `--text-secondary`; group header `--text-faint` |
| Hover | `--surface-hover` fill + `--text-primary`; tint only, no scale, 150 ms [Apple: HIG/pointing-devices "a hover effect that includes tint, but not scale and shadow"] |
| Current (`aria-current`) | `--accent` fill + `--accent-contrast` text; icon inherits; rail shows the same pill; persistent [Apple: HIG/split-views "persistently highlight the current selection"] |
| Press | none on navigation (a link), 100 ms fill darken acceptable |
| Focus | 2 px `--accent` ring, offset −2 inside the pill (exists) |
| Collapsed rail | labels visually hidden, tooltip (M2) on hover **and** keyboard focus, `pointer-fine` only; state persisted in the cookie so first paint is right [HSE: DesktopSidebarShell] |
| Keyboard | `Option-Command-F`-style jump to search is a Mac convention [Apple: HIG/keyboards]; on the web bind `/` and `Ctrl/⌘-K` to focus the search field; never override browser shortcuts |
| Don't | teal on every sidebar icon; actions at the sidebar foot; a second copy of the chrome for mobile (duplicate accessible names) [HSE: PageHeader.tsx] |

### 5.2 `/my-work`

| Aspect | Spec |
|---|---|
| macOS pattern | a **content list with a scope bar** over a **multi-column table** — the Mail/Finder shape [Apple: HIG/search-fields "Use a scope bar to filter among clearly defined search categories… Default to a broader scope"; HIG/lists-and-tables] |
| Anatomy | `PageHeader` (meta = counts) → summary strip (§5.5, five `StatTile`s, replacing the fused grid) → disclosure (`<details>`, `t-callout` summary, inline-SVG chevron, not "▶") → view `Segmented` (Projects · Customers — a URL-bearing tab view) → role `FilterChip`s with counts from the full list, "all" default → `DataTable` |
| Sizes | strip tiles per §5.5; `Segmented` 28 px; chips 24 px; table rows 32 (standard); header 32 |
| Chip rest / hover / selected / focus | bezel `--border-strong` + `--text-secondary` / `--surface-hover` / **filled** `--accent-wash` + `--accent` bezel + `--text-primary` (outline-only selection reads as disabled on dark [HSE: Segmented.tsx]) / ring |
| Segment rest / hover / chosen | track `--surface-2` (recessed); segment text `--text-secondary` / `--surface-hover` / `--accent` pill + `--accent-contrast`, `aria-current` |
| Table | per §5.6; the two-line PROJECT cell = `t-callout` name over `fig` code with tight leading |
| Empty branches | three distinct states (unlinked account / load failed / no projects) — keep; copy per §5.9 |
| Decisions | the fused `MyWorkSummary` grid becomes `StatTile`s on `--card-gap` (§8 #14); the disclosure glyph becomes an SVG (§8 #13); view toggle stays `Segmented` with noun labels (§8 #10) |

### 5.3 `/projects`

| Aspect | Spec |
|---|---|
| macOS pattern | an **Activity Monitor / Numbers window**: filter toolbar → totals bar → charts → sortable multi-column table [Apple: HIG/search-fields inline placement; HIG/lists-and-tables; HIG/charts] |
| Anatomy | `FreshnessBanner` (passive status near what it describes [Apple: HIG/feedback]) → filter Card: `SearchInput` (search-as-you-type [Apple: "start search immediately when a person types"]), customer token select (`SearchableSelect` = pop-up with tokens), billable `Segmented` (3 nouns), facet chips with counts, live "N of M", Clear → `ProjectTotalsStrip` (five `StatTile`s with drill-downs) → chart cards sharing the ledger's left edge → ledger → `Pager` |
| Ledger sizes | compact rows **28 px**, text `t-callout` **12** (not 12.5), numerics `fig` 11/15 right-aligned, header `t-label` with reserved sort-arrow width, sticky opaque header, burn bar fixed 0–100 % [Apple: HIG/charts "fixed range… 0%… 100%"] with the percent beside it (never colour alone) |
| Row rest / hover / current / focus | `--surface` / `--surface-hover` tint / `--accent-wash` + 2 px `--accent` left rule when the row is the URL-selected item / ring on the row link |
| Status colour | healthy `--good`, warning `--warning`, over `--critical` — `--accent` is not a status (§2.3 #5) |
| Decisions | filter state moves into the URL (§8 #16); a context menu on rows (Open, Copy name) is optional and must duplicate main-UI actions [Apple: HIG/context-menus]; resizable columns are Apple's ask [Apple: "Let people resize columns"] and deferred — not a Hub incident |

### 5.4 The pager (`Pager.tsx`, `usePager`, the `Link` pager in `customer-master/import-review`)

| Aspect | Spec |
|---|---|
| macOS pattern | **none** — Apple has no pagination; the analogues are the scrolling table plus the **Finder status bar** count ("the total number of items in a window, the number of selected items") [Apple: HIG/windows] |
| Why it exists anyway | constant page height; "Show 30 more" pushed its own control away with every click [HSE: Pager.tsx; UI-CONVENTIONS 1–3]. House wins (§8 #11) |
| Anatomy | count line `t-label` "1–25 OF 334 PROJECTS" / "SEITE X VON Y – N CASES" (`aria-live`) + PREV / NEXT + page-size choice (25 · 50 · 100 · ALL for ledgers; 10 fixed for worked queues) |
| Sizes | controls **24 px** min (today ≈ 20 px at `py-0.5`; Apple macOS minimum 20, WCAG 2.2 floor 24); gap 8; touch 44; current page `--accent` |
| States | rest bezel `--border` + `--text-secondary`; hover bezel `--accent` + text `--accent`; disabled `opacity-35` + `cursor-not-allowed` — **dim, never hide** [Apple: menus dim unavailable items]; focus ring |
| Placement | at the foot of the bounded card (fine: the card ends there, not the window); for tables longer than one screen the count also appears in the card header so the size of the work is visible before scrolling [Apple: HIG/layout bottom-of-window rule] |
| State | worked queues (10 rows): URL `?page=N`, server-rendered `<Link>`s, filter resets to page 1, out-of-range clamps [HSE: UI-CONVENTIONS 2]. `DataTable`/`Pager` component state is accepted for client-sorted report tables **as a known deviation**; the tables specialist closes it by syncing `page` (and size) to the URL without a server round-trip |

### 5.5 The summary strip (`StatTile` in `Card.tsx`, `ProjectTotalsStrip`, `MyWorkSummary`)

| Aspect | Spec |
|---|---|
| macOS pattern | the **Finder status bar / Numbers instant-calculation bar** — aggregates of the current set, rendered as separate tiles because a fused bar reads as one record [HSE: Card.tsx]; Apple accepts either |
| Anatomy | caption `t-label` → value `fig-lg` 22/26 mono 500 `--text-primary` → hint `t-subhead` 11/14 `--text-muted`; optional drill-down (the number is the control → `DrillDialog`); one hero-tone tile per page at most |
| Sizes | padding 16; gap `--card-gap` 12; 5-across ≥ lg, 2-across < sm; min height 76; radius `--radius-card` |
| Rest / hover / press / focus | `--surface` + `--border` / (drillable only) `--border-strong` + `.card-elev` 1 px lift / `translate-y-px` / ring on the number button |
| Loading | skeleton with the tile's exact geometry [HSE: UI-CONVENTIONS §Cards] |
| Rules | derives from the same filtered rows as the table it summarises; "don't require interaction to reveal critical information" [Apple: HIG/charts] — the headline is visible, the popup optional; nouns as captions; teal on a figure only in the hero tile |

### 5.6 Tables and rows (`DataTable`, `ProjectsLedger`, `SortHeader`)

| Aspect | Spec |
|---|---|
| macOS pattern | `NSTableView` in the **bordered / full-width multi-column** style with click-to-sort headers [Apple: HIG/lists-and-tables, AppKit NSTableView.Style] |
| Anatomy | card header: title (`t-label` 600 today; a prose title may use `t-title-3`) + count → toolbar: search (32 px), page size, CSV → sticky `thead` (`t-label`, opaque `--surface`, hairline) → rows → footer: footnote `t-subhead` + pager |
| Column rules | headings are nouns, no punctuation [Apple] in mono uppercase [HSE, §8 #2]; click sorts, descending first for measures, click again reverses [Apple: "re-sort… in the opposite direction"; HSE: `descFirst`]; `aria-sort` and `<th scope>`; nulls sort last both ways and render "—" [HSE: `cmpNum`]; numerics right-aligned `fig`; text left; `compact` columns `px-2`; first column frozen past ~8 columns [HSE: DESIGN.md 4] |
| Sizes | standard rows 32 (queues, `DataTable` default), compact 28 (ledgers), comfortable 40 (touch); header 32; body bounded ~60 vh, skipped under ~15 rows; page size 25 default with ALL, 10 for worked queues |
| Row rest / hover / current / disabled | `--surface`, `--divider` rule / `--surface-hover` tint (150 ms) / `--accent-wash` + 2 px `--accent` left rule (only where a sticky detail panel or URL selection exists) / `--text-muted` |
| Zebra | off by default (a 1.07 stripe on dark is noise); **on** via `--row-alt` for > 8-column crosstabs, which is the case Apple names ("help people track row values across columns, especially in a wide table") [Apple: HIG/lists-and-tables] |
| Truncation | end-truncate + `title` tooltip [HSE]; Apple's middle ellipsis for identifiers [Apple] is not natively available on the web — codes get their own compact column instead (§8 #17) |
| Hierarchy | hierarchical data → an outline (disclosure rows), not a flat table [Apple: HIG/outline-views]; ≤ 2 levels |
| Empty inside a table | one `t-subhead` line centred, `--text-faint`, states *why* (§5.9) |
| Don't | translucent sticky header; hover lift on rows; "n/a" or 0 for unknown; alphabetical attention lists [HSE: UI-CONVENTIONS 5] |

### 5.7 Chips, links, buttons (`Button.tsx`, `FilterChip`, `Segmented`)

| Aspect | Spec |
|---|---|
| macOS pattern | push buttons (bezeled), bezel-less toolbar/text buttons, scope-bar segments, links [Apple: HIG/buttons, HIG/segmented-controls] |
| Buttons | `primary` (the one `--accent` fill per view, `--accent-contrast` text), `secondary` (bezel `--border-strong`), `ghost` (bezel-less, `--text-secondary`), `danger` (`--critical-wash` + `--critical` bezel; solid red only on hover) — "Keep the number of prominent buttons to one or two per view"; "Use style — not size — to visually distinguish the preferred choice"; never primary for a destructive action [Apple: HIG/buttons] |
| Sizes | `sm` 24 (`t-subhead`, `px-2.5`), `md` 32 (`t-callout` 500, `px-3`), touch 44 via `pointer-coarse:`; icon-only 28 × 28 min; radius `--radius-sm`; labels verb-first, title-case in EN, ellipsis when more input follows [Apple: HIG/buttons, HIG/menus] |
| States (all four variants) | hover tint 150 ms; **press** `translate-y-px` (exists) — Apple's mandatory press state; disabled `--text-faint`, no hover, `aria-disabled`; focus ring; `busy` keeps the label mounted so width never changes [HSE: Button.tsx] |
| Links | `--accent` only when interactive (Apple: same colour must not also decorate); underline on hover/focus; in tables the row's primary cell is the link, not the whole row unless a detail panel exists; external links get `IconArrowRight`/an external glyph |
| Chips (`FilterChip`) | 24 px pill, `t-label`; selected = filled wash (§5.2); a count inside the chip is `fig`; `pointer-coarse:min-h-[36px]` |
| Segmented | 2–5 (Apple: ≤ 5–7) equal segments, nouns, text or icons never mixed, URL links with `aria-current`, chosen = accent pill on a recessed track [HSE: Segmented.tsx; Apple: HIG/segmented-controls] |
| Don't | `scale(1.04)` hover on operate pages (§8 #8); teal text that is not a link; a `<button>` that only changes a URL param (use a `Link`) |

### 5.8 Popovers, tooltips, dialogs, menus (`DrillDialog`, `SearchableSelect`, rail tooltip, user-chip menu, `MobileSidebar`)

| Aspect | Spec |
|---|---|
| macOS patterns | **popover** (small amount of functionality, arrow to source, one at a time), **tooltip**, **sheet** (modal, dims the parent), **menu** [Apple: HIG/popovers, HIG/offering-help, HIG/sheets, HIG/menus] |
| Tooltip | M2 material, `t-callout` 12/15, radius `--radius`, ≤ 75 characters, never repeats the control's name, appears on hover *and* keyboard focus after a short delay (Apple states "after a moment", no number; 400 ms is a house value), 150 ms fade, no arrow needed at 8 px offset |
| Popover / menu | M2 material, radius `--radius-lg`, `--shadow-raised`; anchored at the trigger with `transform-origin` there [HSE: apple-design §7]; never covers its trigger; one at a time, never nested; closes on outside click and Escape; "Always save work when automatically closing a nonmodal popover" [Apple]; items 32 px, hover `--surface-hover`, chosen = `IconCheck` + `--text-primary` (not colour alone); ≤ 3 groups, separators between; unavailable items hidden in context menus, dimmed in menus [Apple: HIG/context-menus, HIG/menus] |
| Dialog (`DrillDialog`) | opaque `--surface-raised`, radius `--radius-card`, `--scrim` behind; title `t-title-2`, kicker `t-label`, headline figure `fig-md`; rows must sum to the headline [HSE]; Escape and an explicit Close; focus trapped and returned to the trigger; a row that leads somewhere is a link, never a second popup [HSE: DrillDialog.tsx]; "Display only one sheet at a time" [Apple] |
| Sheet (`MobileSidebar`) | M4 glass; enters and exits along the same edge; drag-to-dismiss with velocity handoff (§6); scrim; Close button in the sheet |
| Alerts | only for irreversible actions; title says what happened ("Sync failed for 3 rows"), never "Error"; Cancel always present, destructive never the default [Apple: HIG/alerts] |
| Don't | a popover for a warning; a cascade of popovers; auto-dismiss of anything actionable ("Prefer dismissing views with an explicit action" [Apple: HIG/accessibility]) |

### 5.9 Empty, loading, error and partial states (`EmptyState`, skeletons, `FreshnessBanner`, footnotes)

| Aspect | Spec |
|---|---|
| Apple's rules | "Show something as soon as possible… placeholder text, graphics, or animations as content loads" [Apple: HIG/loading]; "Show people when a command can't be carried out and help them understand why" [Apple: HIG/feedback]; at startup "show cached or placeholder data and a nonintrusive label that describes the problem" [Apple: HIG/alerts]; "Avoid vague terms like loading" [Apple: HIG/progress-indicators]; keep copy short, titles ≤ 2 lines [Apple: HIG/alerts]. Apple has **no** empty-state component; Mail's "No Message Selected" is one secondary-colour line [attr — observed, not stated] |
| Loading | skeletons that mirror the exact geometry (tile, row, chart box), teal-tinted shimmer [HSE: DESIGN.md]; a spinner only inside a control (`Button busy`) or beside the thing it describes; never a full-page spinner; never a layout jump when data lands |
| Empty | `EmptyState`: title `t-headline` 13/16 (one line) + description `t-callout` `--text-muted` (≤ 2 lines, ≤ 140 characters) + one action; the dashed `--border-strong` frame stays — it holds the slot's geometry the way a skeleton does. Four distinct copies, because with RLS an empty table is a normal state [HSE: uxui.md]: *nothing yet* (what would put something here), *not permitted* (which role can see it), *partial sync* (what is missing and since when), *load failed* (retry). Never show a control the role cannot use |
| Error | inline, near the item, `--critical-wash` band + `IconWarning` + one sentence + retry; a modal alert only when the action was irreversible |
| Partial | the honest count ("10 von 257") and a one-line footnote stating what is missing [HSE: UI-CONVENTIONS 6]; the `FreshnessBanner` is the model |
| Don't | "Loading…" as the only word; a bare grey sentence; an illustration; a spinner replacing a table (the header and filters stay while rows load) |

---

## 6. Motion

### 6.1 The physics [HSE: `.claude/skills/apple-design/SKILL.md` §1–§11, §14; Apple: WWDC18 803, WWDC23 10158, HIG/motion, HIG/accessibility]

1. **Respond on pointer-down**, not on release: the press state fires instantly (100 ms
   ease-out), the action commits on pointer-up; ~10 px of hysteresis before a drag commits
   [Apple: WWDC18 "Everything needs to respond instantly"; hysteresis "usually 10 points"].
2. **Springs, critically damped by default.** Apple's two-parameter model: damping ratio
   (1.0 = no overshoot) and response (time-to-target, seconds). "Start with 100% damping, or
   no overshoot… when you're tuning elastic behaviors"; **80 % damping** only when a gesture
   carried momentum [Apple: WWDC18]. "When you're not sure, use a spring with bounce 0…
   cautious about using values higher than around 0.4" [Apple: WWDC23]. SwiftUI's shipped
   defaults: `Animation.default` = spring response **0.55**, dampingFraction **1.0**
   [Apple: SwiftUI docs]; `.smooth` bounce 0 / `.snappy` 0.15 / `.bouncy` 0.3, all
   duration 0.5 [Apple: SwiftUI docs]; `interactiveSpring` response 0.15, damping 0.86
   [Apple: SwiftUI docs]. The apple-design skill's table (move 1.0/0.4, rotation 0.8/0.4,
   drawer 0.8/0.3) is [attr] — the transcript states the damping ratios, not the responses.
3. **Interruptible.** Animate from the *presentation* value, never the target; carry velocity
   through a re-target; no `pointer-events: none` during a transition; no CSS transitions on
   anything gesture-driven; decompose X and Y springs [HSE: apple-design §3; Apple: WWDC23
   "a spring animation uses the velocity it had when it was retargeted"].
4. **Velocity handoff and momentum projection** for anything thrown:
   `project(v, d = 0.998) = (v / 1000) · d / (1 − d)`, then snap to the nearest target and
   hand the release velocity to the spring [HSE: apple-design §5–§6; the formula is from the
   WWDC18 sample code — [attr] as to exact constants].
5. **Rubber-band at edges**: `overshoot · dim · 0.55 / (dim + 0.55 · |overshoot|)`
   [HSE: apple-design §9].
6. **Spatial consistency**: enter and exit along the same path; overlays originate at their
   trigger (`transform-origin`); mirrored easing on reversal [HSE: apple-design §7;
   Apple: HIG/motion "if someone reveals a view by sliding it down from the top, they don't
   expect to dismiss the view by sliding it to the side"].
7. **Restraint**: "avoid adding motion to UI interactions that occur frequently"; "Let
   people cancel motion"; "Don't add motion for the sake of adding motion" [Apple:
   HIG/motion]. Intensity scales with input directness — trackpad/pointer motion is "more
   subdued" than touch [Apple: HIG/motion].
8. **Compositor only**: `transform` and `opacity`; bounded `filter` on M4 only; never
   `transition: all`; never animate row height or width [HSE: globals.css; apple-design §11].
   The one ruled exception is the sidebar collapse (§6.2 "Sidebar collapse ↔ rail"): a
   `width` transition, because a transform cannot deliver a change of the content
   column's width; it is guarded by a frame-time measurement, not a property list
   [HSE: DesktopSidebarShell.tsx].
9. **Reduce Motion** replaces, it does not merely shorten: "Tightening animation springs…
   Tracking animations directly with people's gestures… Avoiding animating depth changes…
   Replacing transitions in x-, y-, and z-axes with fades… Avoiding animating into and out of
   blurs" [Apple: HIG/accessibility]. House: entrances are removed outright; overlays may
   keep a 150 ms opacity fade; no scale, no translate, no blur transitions, no looping halo,
   no count-up [HSE: globals.css L926+; decision].
10. **Avoid sustained oscillation near 0.2 Hz** [Apple: HIG/motion (visionOS), applied
    generally by apple-design §14]. The chart `endpoint-halo` at 3.2 s (0.31 Hz) is close to
    that band — keep it whisper-level (0.10–0.22 opacity) and off under Reduce Motion (it is).

### 6.2 Concrete values per interaction [decision; Motion/Framer `type: "spring"` unless stated]

Motion's `{ duration, bounce }` API maps onto Apple's response/damping: `bounce: 0` = damping
1.0; `bounce: 0.2` ≈ damping 0.8 [HSE: apple-design §4]. Framer Motion `^13` is installed;
add nothing [HSE: package.json].

| Interaction | Mechanism | Value | Reduced motion | Source of the number |
|---|---|---|---|---|
| Press feedback (buttons, tiles, chips) | CSS | `active:translate-y-px` (or `scale(0.98)`), 100 ms `ease-out` | keep (it is feedback, not motion) | apple-design §1; HSE Button.tsx |
| Hover tint (rows, nav, ghost buttons) | CSS | `transition-colors` 150 ms | keep | HSE `duration-150`; impeccable animate.md 100–150 ms feedback |
| Focus ring | none | instant | — | Apple: rely on system focus effects |
| Tooltip | CSS | opacity 150 ms in / 100 ms out, no transform | keep | HSE SidebarNav |
| Popover / menu / dropdown | spring | `duration: 0.28, bounce: 0`, `scale .96 → 1` + opacity, origin at trigger; exit 120 ms fade along the same path | 150 ms fade only | Apple `.smooth` shape; impeccable 150–300 routine |
| Dialog (`DrillDialog`) | spring | panel `duration: 0.35, bounce: 0`, `scale .96 → 1` + opacity; scrim 200 ms ease; exit 150 ms | fade 150 ms | Apple `.smooth`; 300–500 overlay band |
| Mobile sheet (`MobileSidebar`) enter/exit | spring | `duration: 0.4, bounce: 0` from its edge | fade 150 ms | DESIGN.md `{bounce:0, duration:0.4}` |
| Mobile sheet drag / release | gesture + spring | 1:1 tracking, 10 px hysteresis, rubber-band 0.55 past the edge; on release: project, snap, `velocity` handed over; **`bounce: 0.15, duration: 0.4` only when release velocity > 0** (a flick), else `bounce: 0` | track 1:1, settle with `bounce: 0` | Apple WWDC18 80 % damping after momentum; `.snappy` 0.15 |
| Sidebar collapse ↔ rail | CSS | width 220 → 64 over 220 ms `--ease-out`; labels fade 120 ms; content column reflows on the same curve | instant | HSE DesktopSidebarShell (measure: must stay one transition, no layout thrash) |
| Segmented / tab change | CSS | pill background 150 ms; content swaps without transition | keep | Apple: frequent interaction, no motion |
| Sort / page / filter re-render | none | rows swap in place, no entrance | — | Apple: frequent interactions; HSE: motion is page-load only |
| Page load (server-rendered) | CSS keyframes | `.rise-in` 0.45 s `--ease-out` (12 px rise); `.stagger` step **30 ms, capped at 6 children** so the last child settles ≤ 600 ms (today's 45 ms × 8 ends at 795 ms, over the house's own ceiling); `.bar-grow` 0.7 s `--ease-settle` | removed outright (exists) | HSE globals.css; decision resolves C9 (§8 #9) |
| Chart draw on load | CSS | `chart-draw` 0.9 s, `chart-fill-in` 0.6 s — the single allowed "authored focal entrance" per page, ≤ 800 ms | removed (exists) | impeccable animate.md 500–800 single focal |
| Card hover (`.card-elev`) | CSS | 1 px lift, glow, 250 ms `--ease-settle` | no transform (exists) | HSE |
| Theme switch | CSS | `background-color`/`color` 200 ms ease on `body` only (avoid the brightness jump) — optional | none | apple-design §14 "ease dark↔light theme changes" |
| Count-up numbers | none on operate pages | figures render final | — | Apple: motion optional; HSE: the numbers are the point |
| CTA hover scale (1.04), icon hover scale (1.08), tilt cards, particles | Persuade pages only | as DESIGN.md | off | §8 #8 |

Gates the motion engineer runs: max frame time under 32 ms during any transition (rAF
sampling via `scripts/lib/launch-chromium.mjs`); the interrupt test (open, close, re-open
before settle: no jump); `grep -rnE "transition-all|transition: all"` = 0; every new
`@keyframes` has a reduced-motion branch; `<MotionConfig reducedMotion="user">` verified
around Framer trees (DESIGN.md's "respects prefers-reduced-motion automatically" is only
true when configured).

---

## 7. Iconography

### 7.1 SF Symbols is platform-only

- The symbol/font licence restricts SF Symbols and SF Pro to Apple platforms and forbids
  mock-ups for non-Apple software [Apple: developer.apple.com/fonts; HIG/sf-symbols "not… in
  app icons, logos, or any other trademarked use"]. **No SF glyphs in the Hub.**
- What transfers is Apple's *discipline*, not its glyphs [Apple: HIG/sf-symbols]:
  "Each of the nine symbol weights… corresponds to a weight of the San Francisco system
  font, helping you achieve precise weight matching between symbols and adjacent text";
  "three scales: small, medium (the default), and large… defined relative to the cap
  height"; rendering modes monochrome / hierarchical / palette / multicolor; "The outline
  variant works well in toolbars, lists"; "fill variant… places where you use an accent
  color to communicate selection"; "Apply symbol animations judiciously".

### 7.2 What the Hub uses: `src/components/nav-icons.tsx` [HSE]

| Rule | Value | Why |
|---|---|---|
| Source | hand-drawn inline SVG in `nav-icons.tsx`, registered in `NAV_ICONS`; no icon dependency (adding one to draw a dozen glyphs "is a poor trade") | [HSE: nav-icons.tsx header] |
| Grid | `16 × 16` viewBox, drawn on a 1 px grid at `.5` offsets so edges land on device pixels | [HSE] |
| Stroke | `stroke="currentColor"`, `strokeWidth 1.5`, round caps and joins, `fill="none"` — never filled at rest | [HSE]; 1.5 px at 16 px matches Poppins 400/500 at 12–13 px optically (Apple's weight-matching rule) |
| Scales | render at **12** (inside chips and `t-label`), **16** (default: nav, tables, buttons), **20** (tab bar, `t-title` rows) — three scales, like Apple's small/medium/large; the box scales the stroke proportionally (20 px → 1.875 px effective, which is the weight a 600 label wants) | [decision; Apple: three scales] |
| Alignment | `vertical-align: -0.125em` next to text; in a flex row `items-center` with `gap-1.5` (6 px) at 12–13 px text, `gap-2` at 15 px+ | [decision; Apple: scale relative to cap height] |
| Colour modes | **monochrome** (`currentColor`) is the default and inherits the label level; **hierarchical** = the same hue at 100 / 50 / 25 % opacity layers, only for status glyphs (`IconWarning` ring + mark); **palette / multicolor** never (rainbow ban) | [Apple: rendering modes; HSE: DESIGN.md "No rainbow"] |
| Variants | outline at rest; a **filled** variant only for the current/selected state, where the accent already communicates selection — and the nav pill already does that, so today no filled variants exist | [Apple: fill "where you use an accent color to communicate selection"] |
| Semantics | every icon is `aria-hidden`, `focusable="false"`; an icon is never the accessible name; icon-only buttons carry `aria-label` | [HSE; Apple: HIG/accessibility "Provide alternative text labels"] |
| Status | `IconCheck` / `IconCross` / `IconWarning` / `IconDot` beside the colour, never colour alone | [Apple: HIG/color] |
| Disclosure | an SVG chevron (rotate `IconArrowRight` 90°, or add `IconChevron`) — the "▶" character is banned in app-shell files | [HSE: UI-CONVENTIONS; check-design-system.mjs glyph ratchet] |
| Motion | none at rest; a symbol may *replace* (cross-fade 150 ms) on state change; no bounce/wiggle; loading = `Button busy` spinner only | [Apple: "Apply symbol animations judiciously"] |
| Adding an icon | draw on the same grid, same stroke, same optical weight as `IconHome` (compare at 16 and 20 px side by side), register in `NAV_ICONS`, name it by meaning (`IconTimesheets`), never by picture | [decision] |
| Emoji / unicode glyphs | banned in `src/app/(app)` and `src/components` (gate ratchet) | [HSE] |

---

## 8. Conflicts resolved

Every place Apple and the house pulled apart, with the winner and the reason. "House" means
DESIGN.md, docs/UI-CONVENTIONS.md, a component header, or a gate. Numbers in brackets cross-
reference the research angles (C1–C11 skill-library; hig #1–14; macOS #1–17).

| # | Apple states | House states | Winner | Why |
|---|---|---|---|---|
| 1 | "avoid… Light" weights [HIG/typography] | Poppins loaded at 300 [DESIGN.md] (C1, hig 3) | **Apple** | 300 is banned in the app shell; allowed ≥ 32 px on Persuade pages only. No incident argues for light UI text |
| 2 | column headings "title-style capitalization" nouns [HIG/lists-and-tables] | `font-mono text-[10px] tracking-[0.08em]` uppercase labels [UI-CONVENTIONS] (C2, C8, macOS 2) | **House** | brand; Apple's wording rule (nouns, no punctuation) is kept inside the mono uppercase form. The impeccable craft-floor "eyebrow ban" applies to eyebrows above headings (already removed in `PageHeader`), not to column captions |
| 3 | "default to the platform's system font" [apple-design §15] | Poppins + JetBrains Mono [DESIGN.md] (C3) | **House** | brand, and the SF licence forbids it anyway |
| 4 | translucent chrome; "scroll edge effects, not hard dividers" [HIG/layout; apple-design §12] | opaque sticky table header; `--sidebar-translucent` is the only surface content scrolls under [DESIGN.md 3; globals.css] (C4, macOS 3) | **House** | "translucency over moving digits is worse than no header at all" — a measured incident. Glass stays on the mobile tab bar and sheet only; desktop chrome stays opaque (nothing scrolls beneath a split-view sidebar). The header hairline is Apple's own "hard" style for pinned headers |
| 5 | "Avoid using the same color to mean different things" [HIG/color] | `var(--accent)` for healthy/active [UI-CONVENTIONS tokens]; `burnColor` healthy = accent; badge default accent | **Apple** (and the house majority) | DESIGN.md "status colors only for meaning" and Button.tsx "accent = primary action / current selection, never decoration" already say this; `--good` exists and passes 4.5:1 on both surfaces. Healthy → `--good`; active/current → `--accent`. UI-CONVENTIONS' token line is to be amended by the builder |
| 6 | four distinct label levels [WWDC19] | `--text-muted` ≈ `--text-faint` (1.04 apart) (hig 6, C16) | **Apple** | retune faint one visible step down, keeping ≥ 5.5:1 on `--surface` and ≥ 4.5:1 on `--surface-hover` (§2.3 #1). Apple's watermark-grade quaternary is *not* adopted — the house 4.5:1 floor wins over Apple's alpha |
| 7 | dark elevation = lighter surface [HIG/dark-mode] | `--surface-2` darker than `--surface` (hig 7) | **Both** | `--surface-2` is redefined as *recessed*; overlays get a new lighter `--surface-raised`. No token changes value |
| 8 | "avoid adding motion to UI interactions that occur frequently"; hover = tint not scale [HIG/motion, HIG/pointing-devices] | `scale(1.04)` CTA hover, `scale(1.08)` icon hover, tilt cards, particles [DESIGN.md] | **Apple on operate pages, house on Persuade pages** | DESIGN.md itself scopes tilt/particles to Persuade; the scale hovers follow them |
| 9 | Operate mode: "No orchestrated page-load sequences" [impeccable operate.md]; Apple: motion optional, brief | `.rise-in` / `.stagger` / `.bar-grow` page-load vocabulary [globals.css] (C9) | **House, tightened** | the vocabulary is ≤ 500 ms per element, CSS-only, removed under Reduce Motion, and never re-runs on sort/page/filter. Tightened: stagger step 30 ms, cap 6, so the whole choreography ends ≤ 600 ms |
| 10 | main-area view switching = tab view, not a segmented control [HIG/segmented-controls] | `Segmented` (URL links) for view switching (macOS 6) | **House** | on the web a URL-bearing segmented control *is* a tab view; keep nouns, ≤ 5 options, `aria-current` |
| 11 | no pagination; scrolling tables + a status-bar count [HIG/windows] | 10-row worked queues, 25-row ledgers, page in the URL [UI-CONVENTIONS 1–3] (macOS 7, C7) | **House** | measured incident (17.7-screen page). Apple's count line is adopted in the card header as well as the foot |
| 12 | sidebar toggle at the toolbar's far leading edge [HIG/toolbars] | toggle in the sidebar header (macOS 5) | **House** | the rail keeps the toggle in the same place at both widths; the top bar's leading slot is the title on mobile |
| 13 | disclosure is a control, not a character [NSButton.BezelStyle.disclosure] | "▶" in `my-work/page.tsx` (macOS 12) | **Apple = house** | both ban it; replace with an SVG chevron |
| 14 | status bar may be one fused bar [HIG/windows] | fused grids banned; separate cards on a gap [Card.tsx] (macOS 13) | **House** | `MyWorkSummary` becomes `StatTile`s; Apple is indifferent |
| 15 | zebra rows "especially in a wide table" [HIG/lists-and-tables] | hover tint + dividers, no zebra (macOS 15) | **Both** | zebra only on > 8-column crosstabs via `--row-alt` |
| 16 | "Restore the previous state" [HIG/launching] | page state in the URL [UI-CONVENTIONS 2] vs `ProjectsExplorer` component state (macOS 14) | **House = Apple** | filter state moves to the URL |
| 17 | middle-ellipsis for identifiers [HIG/lists-and-tables] | end truncation + `title` (macOS 8) | **House** | no native middle truncation on the web; codes get a compact column of their own |
| 18 | persistent selection + trailing inspector [HIG/panels] | ledgers navigate away; queues use `lg:sticky` detail panels [UI-CONVENTIONS 4] (macOS 9) | **House** | rule 4 is the web form of the inspector; ledgers stay links; a URL-selected row gets the current-row highlight |
| 19 | ≥ 44 × 44 hit region even for pointers [HIG/buttons]; macOS 28 default / 20 min [HIG/accessibility] | 32 px `md`, ~20 px pager controls, 28 px rows, 44 on `pointer-coarse` (C7, macOS 11) | **Blend** | desktop: 28 × 28 minimum for icon-only, 24 px absolute floor (WCAG 2.2), 32 default; touch: 44. Rows are wide, so Apple's "hit region, not visual size" is satisfied by the row itself |
| 20 | "Avoid offering an app-specific appearance setting" [HIG/dark-mode] | `ThemeToggle` (C5) | **House** | boot order already follows the OS for first-time users; removing the switch would flip a dark-only history on colleagues who never asked |
| 21 | body leading for 13 pt is 16 pt (1.23) [HIG/typography] | "Body: line-height 1.6" [DESIGN.md] (hig 2) | **Apple in the UI, house in prose** | 1.6 is for long-form on Persuade pages and long descriptions |
| 22 | tracking is size-specific (SF table) | "−0.03em" flat display tracking [DESIGN.md] (hig 1, figma) | **Apple's rule, HSE's numbers** | Poppins gets its own curve (§1.3); −0.03em only at the 88 px marketing display |
| 23 | JetBrains Mono is stricter than Apple's tabular-digits-in-the-UI-font | mono for figures [DESIGN.md] (hig 4) | **House** | plus `tabular-nums` on every Poppins number (already global) |
| 24 | custom colours need light, dark **and** increased-contrast variants [HIG/color] | light + dark only (hig 9) | **Apple** | add the `prefers-contrast: more` block (§2.6) |
| 25 | pure black dark background [WWDC19]; no "desaturate" rule | `#121418`; lowered-chroma status colours [globals.css] | **House** | brand and measured contrast; the brief's premise that these are Apple rules is corrected here — cite the house |
| 26 | "n/a" for a missing number [AGENTS.md, ui-craftsman] vs "—" [DESIGN.md 6, DataTable.tsx] (C11) | — | **"—"** | the table primitive and the data-table rules are the majority and the gate reads them |
| 27 | DESIGN.md token names vs globals.css names (C10) | — | **globals.css** | the gate reads globals.css; DESIGN.md's names do not exist in CSS |
| 28 | Apple: short empty states, one line, no frame (observed) | `EmptyState` with a dashed frame and a paragraph (macOS 17) | **Blend** | frame stays (holds geometry), copy capped at title + 2 lines + 1 action, four distinct reasons |
| 29 | Apple: sidebar icons take the accent [HIG/sidebars] | grey icons, teal only on the current item (macOS 1) | **House** | Apple's own "refrain from adding color to… multiple controls" agrees |
| 30 | "Avoid putting critical… actions at the bottom of a sidebar" [HIG/sidebars] | logout, tour, status at the sidebar foot (macOS 4) | **Apple** | logout and tour move to the user-chip menu; the passive status dot may stay |

Aligned without a decision: base/elevated ↔ `--surface` above `--page`; one tint ↔
`Button.primary`; reverse-on-reclick sorting ↔ `DataTable`; ≥ 4.5:1 ↔ the gate; progressive
disclosure ↔ 10-row queues with honest counts; "essential information gets space" ↔
drill-downs; "don't override keyboard shortcuts" and "prefer explicit dismissal" ↔ house
rules; frosted mobile bar ↔ Apple's chrome-only glass with a solid fallback.

---

## 9. Sources

### Reached (primary)

The HIG HTML pages are a JS-rendered SPA and return only a `<title>` to a fetcher; every
HIG value above was read from Apple's DocC data endpoint,
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`
(HTTP 200 for all pages named below, fetched 2026-09-05), with the human-readable URL
`https://developer.apple.com/design/human-interface-guidelines/<page>`. Page freshness from
each page's change log: Typography 2025-12-16, Color 2025-12-16 (system colour values
updated 2025-06-09), Materials 2025-09-09, Motion 2025-09-09, Layout 2025-09-09, SF Symbols
2025-07-28, Accessibility 2025-06-09, Dark Mode 2024-08-06; Sidebars, Menus, Scroll views
carry entries up to 2026-06-08. Rendered copies are in the session scratchpad
(`…/scratchpad/hig-found-2589732/*.md`, `…/scratchpad/hig/*.md`, `…/scratchpad/appkit/*.md`).

| Key | Page |
|---|---|
| HIG/typography | typography — text styles, tracking tables, default/minimum sizes, weight and leading rules |
| HIG/color | color — semantic roles, system colour values, accent rules, Liquid Glass colour |
| HIG/dark-mode | dark-mode — base/elevated, 4.5:1 / 7:1, appearance setting, white backgrounds |
| HIG/layout | layout — grouping, controls above content, scroll edge, bottom-of-window, size classes |
| HIG/materials | materials — Liquid Glass vs standard, thickness, vibrancy, 35 % dimming |
| HIG/motion | motion — purpose, optional, brevity, frequent interactions, 0.2 Hz |
| HIG/accessibility | accessibility — 200 %, contrast table, control sizes, 12/24 pt padding, Reduce Motion list |
| HIG/sf-symbols | sf-symbols — weights, scales, rendering modes, variants, animations |
| HIG/labels, HIG/lists-and-tables, HIG/outline-views, HIG/column-views, HIG/sidebars, HIG/toolbars, HIG/tab-views, HIG/split-views, HIG/panels, HIG/windows, HIG/popovers, HIG/sheets, HIG/modality, HIG/menus, HIG/context-menus, HIG/pop-up-buttons, HIG/pull-down-buttons, HIG/segmented-controls, HIG/search-fields, HIG/token-fields, HIG/disclosure-controls, HIG/scroll-views, HIG/loading, HIG/progress-indicators, HIG/feedback, HIG/alerts, HIG/onboarding, HIG/charts, HIG/buttons, HIG/focus-and-selection, HIG/pointing-devices, HIG/keyboards, HIG/offering-help, HIG/settings, HIG/entering-data, HIG/launching, HIG/designing-for-macos | the component and platform pages quoted in §3–§5 |
| AppKit | `https://developer.apple.com/documentation/appkit/` — `nstableview/rowheight` (default 16.0, custom style only), `nstableview/intercellspacing`, `nstableview/style-swift.enum`, `nstableview/rowsizestyle-swift.enum`, `nscontrol/controlsize-swift.enum` (no values), `nsvisualeffectview/material-swift.enum`, `nswindow/toolbarstyle`, `nstoolbar/sizemode` (32/24 px icons, legacy), `nssplitviewcontroller`, `nssplitviewitem`, `nscolor/*label*`, `nsfont/systemfontsize` (no value printed) |
| SwiftUI | `https://developer.apple.com/documentation/swiftui/animation/default` (spring 0.55 / 1.0), `…/animation/spring(duration:bounce:blendduration:)`, `…/animation/smooth(duration:extrabounce:)` and siblings (0 / 0.15 / 0.3, 0.5 s), `…/animation/interactivespring(...)` (0.15 / 0.86 / 0.25), `…/material`, `…/font/leading` |
| UIKit | `https://developer.apple.com/documentation/uikit/uifont/monospaceddigitsystemfont(ofsize:weight:)` |
| WWDC18 803 | Designing Fluid Interfaces — `https://developer.apple.com/videos/play/wwdc2018/803/` (100 % / 80 % damping, 10 pt hysteresis, principles) |
| WWDC19 214 | Implementing Dark Mode — `https://developer.apple.com/videos/play/wwdc2019/214/` (pure black, elevated lighter, four label levels) |
| WWDC20 10175 | The details of UI typography — `https://developer.apple.com/videos/play/wwdc2020/10175/` (tight/loose ±2 pt, Text/Display 17–28 pt) |
| WWDC20 10104 | Adopt the new look of macOS — `https://developer.apple.com/videos/play/wwdc2020/10104/` (toolbar symbols 13 pt medium large-scale; sidebar scaling) |
| WWDC23 10158 | Animate with springs — `https://developer.apple.com/videos/play/wwdc2023/10158/` (bounce 0 default, ≤ 0.4, velocity carry-over) |
| WWDC25 356 | Get to know the new design system — `https://developer.apple.com/videos/play/wwdc2025/356/` (scroll edge soft/hard, fixed/capsule/concentric shapes, control sizes) |
| WWDC26 250 | Principles of Great Design — `https://developer.apple.com/videos/play/wwdc2026/250/` (the eight principles quoted by the apple-design skill) |
| Apple fonts licence | `https://developer.apple.com/fonts/` |
| Apple design resources | `https://developer.apple.com/design/resources/` → Figma macOS 27 `https://www.figma.com/community/file/1651309434229735362/macos-27` (structure read via the Figma MCP: 22 text styles, `Colors` collection with a six-level label ladder, `Sizes` collection with per-control radii and no spacing scale, sidebar/toolbar/table/popover component sets) |

### Rig files read

`src/app/globals.css`, `DESIGN.md`, `docs/UI-CONVENTIONS.md`, `AGENTS.md`,
`src/components/nav-icons.tsx`, `src/components/ui/{Card,Button,Field,Segmented}.tsx`,
`src/components/{Pager,PageHeader,EmptyState,DrillDialog,ThemeToggle,MobileTabBar,SidebarNav,sidebar-collapse-shared}.tsx/ts`,
`src/components/data-table/DataTable.tsx`, `src/app/(app)/my-work/page.tsx`,
`scripts/check-design-system.mjs`, `.claude/skills/apple-design/SKILL.md`,
`.claude/skills/impeccable/reference/*.md`, `~/.claude/skills/{ui-ux-pro-max,design-system}`,
`~/.claude/skills-library/{apple-hig-expert,mobile-ios-design,a11y-audit}`,
`~/.claude/agents-library/{ui-visual-validator,design-review,accessibility-expert,a11y-architect}.md`.

### Not reached, not verified, or corrected

- **Apple publishes no RGB/alpha for label, separator or fill roles.** The alphas in
  circulation (100 / 60 / 30 / 18 %; separator 0.29 / 0.6) are [attr].
- **Apple publishes no sidebar width, toolbar height, list row height, modern control
  height, grid unit or window margin.** "8 pt grid", "20 pt margins", rows 22–32, toolbars
  52/38, controls 16/19/22/28, sidebar text 11/13/15 are all [attr]. They live only as
  geometry inside the Figma/Sketch kits, which the Figma MCP could not read: the account is
  a Starter plan with a View seat (20 tool calls/month, library import "Not permitted").
  Duplicating the community file into the account and reading `Sizes` with
  `get_variable_defs` would upgrade these to Apple-stated; do it if a number is ever
  load-bearing.
- **`web.archive.org` is blocked** for the fetcher, so the 2019–2022 HIG sidebar metrics
  table could not be re-read; the old URL trees return 404.
- **No HIG page for "inspectors", "selection" or "empty states"** exists (404); guidance
  was assembled from Panels/Windows/Split views and Loading/Feedback/Alerts.
- The apple-design skill's spring table (response 0.4 / 0.3) and momentum constants are
  [attr]: the WWDC18 transcript states 100 % and 80 % damping only.
- **Not Apple:** "avoid pure black", "desaturate in dark mode", "use at most N text styles",
  "8 pt grid", "44 pt for everything on desktop" (Apple's macOS default is 28).
- **Corrected in the repo's own comments:** the contrast ratios annotated in `globals.css`
  were computed against older, lighter surfaces; current ratios are in §2.2.
- WWDC19 "Designing Audio-Haptic Experiences" session id not re-verified.

---

## 10. The agent roster for the build pass

Five purpose-built agents, one aspect each. Save each block verbatim as
`.claude/agents/<name>.md`; they follow the conventions of the 46 active agents (`name`,
`description`, `tools`, `model`). All five inherit the house rules from `~/.claude/CLAUDE.md`:
never touch `supabase/migrations` or RLS; never write `.env*`; no new dependencies without
asking (`framer-motion ^13` is already installed); check `~/.code-sentry/latest.md` after
edits; run `graphify update .` after code changes; load `docs/APPLE-DESIGN-REFERENCE.md`
(this file, "APPLE_REF") first — it outranks every other design source on a conflict.

Recommended run order: colour engineer (tokens) → typographer (roles) → layout engineer →
tables specialist → motion engineer; each on its own worktree, each gating before hand-off.

### 10.1 `.claude/agents/apple-typographer.md`

```markdown
---
name: apple-typographer
description: Owns the type system of the HSE Hub app shell — the role scale, weights, tracking, leading and numerals of docs/APPLE-DESIGN-REFERENCE.md §1, built on Apple's text-style discipline but set in Poppins + JetBrains Mono. Use for any change to font sizes, weights, letter-spacing, line-height, label/caption/figure styles, or EN/DE text fit. Not for colour, layout, tables or motion.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You set type for an operations console used all day at 1–3 ft (Apple, "Designing for macOS"). The brand face is fixed; Apple contributes the SYSTEM: roles, ratios, weight discipline, size-specific tracking and leading. The decided scale is APPLE_REF §1.3 — implement it, do not re-derive it.

## Load before editing (in this order)
1. `docs/APPLE-DESIGN-REFERENCE.md` §0, §1, §8 (rows 1, 2, 21, 22, 23, 26).
2. `DESIGN.md` §Typography and §Anti-patterns ("always Poppins, always weighted").
3. `docs/UI-CONVENTIONS.md` §"The house tokens" (numbers `font-mono tabular-nums`; labels `font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]`).
4. `.claude/skills/apple-design/SKILL.md` §15 and `.claude/skills/impeccable/reference/typeset.md`, `reference/operate.md` §Typography (light-on-dark compensated on three axes).
5. `src/app/globals.css` `:root` and `[data-theme="light"]`; `src/components/ui/Field.tsx` header (the 11.5/12/12.5 px audit); `src/components/PageHeader.tsx`; `src/components/data-table/DataTable.tsx`; `src/components/ui/Card.tsx` (`StatTile`).
6. `node .claude/skills/impeccable/scripts/context.mjs --target <file>` once per session.

## The rules you implement (APPLE_REF §1.3)
- The ladder 10 · 11 · 12 · 13 · 15 · 17 · 22 · 26 with line heights 13 · 14 · 15 · 16 · 20 · 22 · 26 · 32 [Apple: HIG/typography]. Add the role classes `.t-large .t-title .t-title-2 .t-title-3 .t-headline .t-body .fig-xl .fig-md` to `globals.css` (both themes are colour-agnostic here) and document them in DESIGN.md §Typography.
- Weights 400 / 500 / 600; 700 only ≥ 26 px on Persuade pages; **300 and 800 banned in the shell** (decision #1).
- Floors: Poppins ≥ 11 px; mono 10 px only as `t-label`; touch surfaces ≥ 11 px.
- Leading from the table; tight (−2 px) only for two-line cells; 1.6 only for prose.
- Tracking per role from §1.3 (an HSE proposal — tune by eye, never cite Apple's SF table for Poppins).
- Emphasis = +1 weight step or a label-level step, never a size step.
- ≤ 4 Poppins roles + `t-label` + 2 figure sizes per screen.
- A missing number renders "—" (decision #26).
- `PageHeader` h1 → `t-title` (22/26) at ≥ sm, `t-title-2` below; ledgers → 12 px, never 12.5.

## Non-negotiables (HSE)
- Poppins for UI, JetBrains Mono for figures and labels. Never `system-ui`, SF Pro or Inter.
- Whole-pixel sizes; every role is a named class in `globals.css`, never an ad-hoc `text-[Npx]` that is not in §1.3.
- Change a role in the primitive (`Card`, `Button`, `Field`, `Segmented`, `DataTable`, `Pager`), not at call sites.
- Column-header form stays mono uppercase (decision #2).
- Test every changed role with the `de` strings: a label that fits in EN and wraps in DE is a defect.

## Acceptance gates (all green; paste the output)
- `npm run check:design-system`.
- `node .claude/skills/impeccable/scripts/detect.mjs --json --scope type src/app src/components`.
- Zero offenders: `grep -rnE "text-\[[0-9]+\.[0-9]+px\]" src/app src/components`; `grep -rnE "text-\[[0-9]px\]" src/app src/components`; `grep -rnE "font-(thin|extralight|light|extrabold|black)\b" "src/app/(app)" src/components`.
- `npx tsc --noEmit && npx eslint src && npm run build`; `node scripts/run-ui-gates.mjs`.
- Screenshots at 1440×900 in both `data-theme` values and at 200 % zoom, EN and DE, for every touched route; say which states you actually saw.
- Read `~/.code-sentry/latest.md`; `graphify update .`.

## Do not stop at the checklist
Read the component for what it renders first, then apply these rules. If you could not view the UI, say so instead of asserting it looks right.
```

### 10.2 `.claude/agents/dark-mode-color-engineer.md`

```markdown
---
name: dark-mode-color-engineer
description: Owns colour semantics, both appearances, materials, contrast and status/chart colour in the HSE Hub — implementing docs/APPLE-DESIGN-REFERENCE.md §2 and §4 (Apple's label ladder, base/elevated model, one tint, material thickness logic) on the HSE teal token set. Use for any token, surface, glass, contrast, theme-parity, increased-contrast or status-colour change. Not for type, layout, tables or motion.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You keep one accent (HSE teal), two appearances, and a measured material system honest. The comments in `globals.css` record ratios against OLDER surfaces (APPLE_REF §2.2) — recompute before you trust a number, and write the new number next to every token you touch.

## Load before editing
1. `docs/APPLE-DESIGN-REFERENCE.md` §0 (canonical token names), §2, §4, §8 (rows 5, 6, 7, 20, 24, 25, 27, 29).
2. `src/app/globals.css` in full — the measured comments on `--sidebar-translucent`, `--glass-band`, `--glass-edge`, `--glass-text`, `--text-faint`, `--surface-accent`; the `:root` and `[data-theme="light"]` blocks; `.surface-translucent` and its `@supports` / `prefers-reduced-transparency` fallbacks.
3. `scripts/check-design-system.mjs` L362-398 (the WCAG arithmetic and the eight gated tokens) and its R1–R4 history.
4. `src/components/ui/Card.tsx` (hero tone), `src/components/ui/Button.tsx` (the one accent fill), `src/components/ThemeToggle.tsx`, `src/components/MobileTabBar.tsx`, `src/components/SidebarNav.tsx` (badge and current-item colours), `src/app/(app)/projects/ProjectPanels.tsx` (`burnColor`).
5. `.claude/skills/apple-design/SKILL.md` §12, §14; `~/.claude/skills/ui-ux-pro-max/references/pro-rules.md` L37-45; the `dataviz` skill for any chart colour.

## The rules you implement (APPLE_REF §2.3, §2.6, §4.2)
- Four distinct label levels: retune `--text-faint` one visible step below `--text-muted` (≥ 1.2 between them) while ≥ 5.5:1 on `--surface` and ≥ 4.5:1 on `--surface-hover`, both themes. Candidates and ratios are in §2.3 #1.
- Add `--surface-raised` (overlays, lighter than `--surface` in dark), `--row-alt`, `--scrim`, `--focus-ring`, and the `@media (prefers-contrast: more)` block — both themes, each with a measured comment. `--surface-2` means recessed; never use it to nest.
- `--accent` = interactive + current only. Healthy status → `--good` (fix `burnColor`; amend the UI-CONVENTIONS token line to say so). Nav badges neutral. KPI figures `--text-primary`; teal on a figure only in the hero card.
- Light theme: accent-as-text on a hovered row must use a value ≥ 4.5:1 on `--surface-hover` (`--accent` is 4.41 there; `--accent-hover` is 6.31).
- Glass only on `MobileTabBar` and `MobileSidebar`; desktop chrome and every table stay opaque (decision #4). Fallbacks for no-`backdrop-filter`, `prefers-reduced-transparency` and `prefers-contrast: more` are mandatory.
- `img.on-dark` softening for white-ground images in dark.
- Keep `ThemeToggle` (decision #20); both themes first-class.
- Do not cite Apple for "no pure black" or "desaturated status colours" — cite the house (decision #25).

## Non-negotiables (HSE)
- Every token exists in `:root` AND `[data-theme="light"]`, named by role, documented in DESIGN.md; never a raw hex in a component.
- The eight gated tokens hold ≥ 4.5:1 on `--page` and `--surface`; extend the gate so they also hold on `--surface-hover`, and add every new text-bearing token to the loop.
- No gold `#d4a843`, no rainbow, no pure white in dark.

## Acceptance gates
- `npm run check:design-system` (extended as above).
- Theme parity, zero diff: `diff <(sed -n '/^:root {/,/^}/p' src/app/globals.css | grep -oE '^\s*--[a-z0-9-]+' | sort -u) <(sed -n '/^\[data-theme="light"\] {/,/^}/p' src/app/globals.css | grep -oE '^\s*--[a-z0-9-]+' | sort -u)`.
- For every new foreground/background pair: a `scripts/check-*.mjs` assertion that can fail (`node scripts/check-new-gates-can-fail.mjs`).
- `node scripts/check-theme-and-figures.mjs`; screenshots of every touched route in both themes at 1440×900, plus `page.emulateMedia({ forcedColors: "active" })` and, where supported, reduced transparency — say which you ran.
- Charts: `--viz-*` tokens only; dataviz palette validator run.
- `npx tsc --noEmit && npx eslint src && npm run build`; `~/.code-sentry/latest.md`; `graphify update .`.

## Do not stop at the checklist
A value that passes on `--page` and fails on `--surface-hover` is the quiet version of R3; measure where the text actually sits while the pointer is on it. Then look at the screen.
```

### 10.3 `.claude/agents/macos-layout-engineer.md`

```markdown
---
name: macos-layout-engineer
description: Owns the app-shell layout grammar of the HSE Hub — sidebar/rail, top bar, content width, spacing, card-vs-control decisions, density, row and control heights, hit targets, page-height budgets, responsive structure and the nav shell — implementing docs/APPLE-DESIGN-REFERENCE.md §3, §4 and §5.1. Use for any change to page structure, panels, navigation chrome, spacing or breakpoints. Not for type, colour, table internals or motion.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You lay out a desktop-first operations console with a mobile tab bar. Apple's brief for large displays: "present more content in fewer nested levels and with less need for modality, while maintaining a comfortable information density". Density is a feature here.

## Load before editing
1. `docs/APPLE-DESIGN-REFERENCE.md` §3, §4, §5.1, §5.5, §8 (rows 4, 9, 12, 14, 19, 28, 30).
2. `docs/UI-CONVENTIONS.md` in full; the reference pager in `src/app/(app)/customer-master/import-review/page.tsx`.
3. `DESIGN.md` §Spacing & layout, §Page-level design patterns, §Data tables 1–8, §Anti-patterns.
4. `src/components/ui/Card.tsx`, `ui/Segmented.tsx`, `Pager.tsx`, `DesktopSidebarShell.tsx`, `Sidebar.tsx`, `SidebarNav.tsx`, `TopBarChrome.tsx`, `PageHeader.tsx`, `MobileTabBar.tsx`, `MobileSidebar.tsx`, `sidebar-collapse-shared.ts`, `EmptyState.tsx`.
5. `src/app/globals.css` tokens `--sidebar-width 220`, `--sidebar-rail-width 64`, `--content-max 1600`, `--card-gap 12`, radii 4/6/8/12/20, `.page-shell`.
6. `.claude/skills/impeccable/reference/layout.md` and `reference/operate.md`; `.claude/skills/apple-design/SKILL.md` §7, §16.

## The rules you implement (APPLE_REF §3.2, §5.1, §5.5, §5.9)
- Row heights compact 28 / standard 32 / comfortable 40; control heights sm 24 / md 32 / touch 44; icon-only buttons ≥ 28 × 28 on desktop; 24 px absolute floor; 8 px between adjacent bezeled buttons.
- Sidebar item rows 32 px, rail target 40 × 40 with 12 px padding; ≤ 2 levels; group headers `t-label`; toggle stays in the sidebar header (decision #12); logout and tour move into the user-chip menu, the status dot may stay (decision #30).
- `PageHeader` ≈ 50 px, in flow, opaque, `border-b`; leading title, trailing chrome, ≤ 3 groups, ≤ 1 primary button.
- Card padding 16 (dense) / 20 (chart, hero); gaps 12 / 16 / 24; concentric child radii `max(outer − padding, 2px)`.
- `MyWorkSummary` → `StatTile`s on `--card-gap` (decision #14); `EmptyState` copy capped (decision #28).
- Collapse order as width shrinks: inspector → rail → charts → tertiary columns → never the nav. Test at halves and thirds of 1440 and 1920.
- Nothing critical at the bottom of the window; counts visible at the top of long tables too.
- Apple states no grid unit, margin, sidebar width or toolbar height — cite the house for 12/16/24, 220/64 and ≈ 50.

## Non-negotiables (HSE)
- UI-CONVENTIONS 1–6 verbatim; DESIGN.md §Data tables 1, 5, 8 (bounded bodies, ≤ 3 screens).
- Cards: top-level panels only; controls are not cards; never Card-in-Card; hero tone once per page; skeletons mirror geometry.
- No emoji/unicode glyphs in app-shell files; inline SVG from `nav-icons.tsx`; the "▶" in `my-work/page.tsx` becomes a chevron (decision #13).
- Focus rings stay; overlays escape their container (portal), never clipped.
- Desktop chrome stays opaque; glass only where content scrolls beneath (decision #4).

## Acceptance gates
- `npm run check:table-scroll-budget`; `node scripts/check-page-length.mjs` (SKIP is not PASS — say so); `node scripts/check-sidebar-collapse.mjs`; `node scripts/run-ui-gates.mjs`; `npm run check:design-system`.
- `node .claude/skills/impeccable/scripts/detect.mjs --json --scope layout <touched files>`.
- Hit-target audit with `scripts/lib/launch-chromium.mjs` (session recipe in `scripts/check-theme-and-figures.mjs` L24-45): `boundingBox()` of every `a, button, [role=button], input, select` on touched routes: ≥ 24 × 24 at 1440×900, ≥ 44 × 44 on the mobile tab bar at 390×844. Report the smallest found.
- `npx tsc --noEmit && npx eslint src && npm run build`; `~/.code-sentry/latest.md`; `graphify update .`.

## Do not stop at the checklist
State the spatial thesis (primary path, what groups, what leads) before moving boxes. Then read the page for what it actually renders.
```

### 10.4 `.claude/agents/tables-lists-specialist.md`

```markdown
---
name: tables-lists-specialist
description: Owns every list, table, queue, pager, detail panel, chip row and in-table empty state in the HSE Hub, and the DataTable/Pager/Field primitives — implementing docs/APPLE-DESIGN-REFERENCE.md §5.2–§5.4, §5.6–§5.7 and §5.9 (Apple's lists-and-tables rules inside the house conventions). Use for any tabular or list UI. Not for chart, type, colour or motion work.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You make dense data scannable. Apple: "the row-based format is especially well suited to making text easy to scan and read". House: a reporting surface that cannot show you a row is not a reporting surface.

## Load before editing
1. `docs/APPLE-DESIGN-REFERENCE.md` §5.2, §5.3, §5.4, §5.6, §5.7, §5.9, §8 (rows 2, 10, 11, 13, 15, 16, 17, 18, 26).
2. `docs/UI-CONVENTIONS.md` in full; reference implementation `src/app/(app)/customer-master/import-review/page.tsx`.
3. `DESIGN.md` §Data tables 1–8.
4. `src/components/data-table/DataTable.tsx` (the `Column` contract), `src/components/Pager.tsx`, `src/components/ui/Field.tsx` (`SearchInput`, `FilterChip`, `SortHeader`, `SearchableSelect`), `src/components/ui/Segmented.tsx`, `src/components/EmptyState.tsx`, `src/components/DrillDialog.tsx`, `src/app/(app)/projects/{ProjectsExplorer,ProjectsLedger}.tsx`, `src/components/my-work/MyWorkTables.tsx`.
5. `scripts/check-table-scroll-budget.mjs`, `check-page-length.mjs`, `check-data-table-primitive.mjs`, `audit-tables.mjs`.
6. `.claude/skills/ui-ux-pro-max/references/quick-reference.md` (`sortable-table`, `number-tabular`, `focus-not-obscured`); `.claude/skills/impeccable/reference/operate.md`; `.claude/agents/uxui.md` §Priorities 3–5.

## The rules you implement (APPLE_REF §5)
- Headings: nouns, no punctuation, in the mono uppercase house form; click sorts (descending first for measures), click again reverses; `aria-sort`, `<th scope>`; nulls last both ways, rendered "—".
- Rows: standard 32 / compact 28 / comfortable 40; hover tint only; current row `--accent-wash` + 2 px `--accent` left rule where a detail panel or URL selection exists; zebra only for > 8-column crosstabs via `--row-alt`.
- Ledger text 12 px (never 12.5), numerics `fig` 11/15 right-aligned; healthy = `--good`.
- Filter chips: 24 px, selected = filled wash; `Segmented` = URL links, nouns, ≤ 5.
- `ProjectsExplorer` filter state → URL; worked queues use the `Link` pager; `DataTable`/`Pager` sync page and size to the URL without a server round-trip.
- Pager controls ≥ 24 px; disabled dimmed, never hidden; count in the card header for tables over a screen.
- In-table empty state: one `t-subhead` line that says why; `EmptyState` with four distinct copies (nothing yet / not permitted / partial sync / load failed).
- Codes get a compact column (end truncation + `title` stays; decision #17).

## Non-negotiables (HSE)
- UI-CONVENTIONS 1–6 and DESIGN.md §Data tables 1–8 verbatim: 10 rows for worked queues, 25–50 for ledgers, URL page state, filter resets to page 1, out-of-range clamps, sticky **opaque** header, bounded body ~60 vh, honest totals, ≤ 3 screens, "—" for missing.
- Worst first: severity, then size, then name.
- CSV exports exactly what is on screen. Paged reads: `.order()` before `.range()`.

## Acceptance gates
- `npm run check:table-scroll-budget`; `node scripts/check-page-length.mjs`; `node scripts/check-data-table-primitive.mjs`; `node scripts/audit-tables.mjs`; `node scripts/check-dashboard-tables.mjs`; `npm run check:parallel-paging` if a query changed.
- `npm run check:design-system`; `node scripts/run-ui-gates.mjs`.
- Manual matrix, reported honestly: populated / empty / denied-by-RLS / partial-sync; page 1, last page, `?page=999` (clamps), filter change (resets); sticky header opaque while rows scroll; DE strings in every header.
- `npx tsc --noEmit && npx eslint src && npm run build`; `~/.code-sentry/latest.md`; `graphify update .`.

## Do not stop at the checklist
Read the page's data flow first (a filter read but never applied is the ordinary bug), then apply these rules on top.
```

### 10.5 `.claude/agents/apple-motion-engineer.md`

```markdown
---
name: apple-motion-engineer
description: Owns every animation and transition in the HSE Hub — entrances, state changes, drawers/sheets/dialogs, popovers, press/hover feedback, sidebar collapse, reduced-motion behaviour — implementing docs/APPLE-DESIGN-REFERENCE.md §6 (Apple's fluid-interface physics inside the house "three moves, under 500 ms" vocabulary). Use for any motion work or motion review. Not for static layout, type or colour.
tools: Read, Edit, Write, Bash, Grep, Glob
model: inherit
---

You are the design engineer for motion. Apple's bar: "Brief and precise feedback animations feel lightweight and unobtrusive"; "Don't make people wait for an animation to complete". The house bar: the numbers are the point; motion announces the page and must never delay it.

## Load before editing
1. `docs/APPLE-DESIGN-REFERENCE.md` §6 (the value table is the contract), §8 (rows 8, 9).
2. `.claude/skills/apple-design/SKILL.md` §1–§11, §14 (interruptibility, velocity handoff, projection, rubber-band, anchored origins; note its spring-response table is commonly attributed, not Apple-stated).
3. `.claude/skills/emil-design-eng/SKILL.md` (Before/After review table); `.claude/skills/animate`, `review-animations`, `find-animation-opportunities`.
4. `.claude/skills/impeccable/reference/animate.md` (100–150 feedback · 150–300 routine · 300–500 overlay · one ≤ 800 focal entrance) and `reference/operate.md` §Motion.
5. `DESIGN.md` §Motion principles; `src/app/globals.css` L848-972 (the vocabulary, `--ease-out`, `--ease-settle`, the reduced-motion blocks, `brand-mark-assemble`, chart classes).
6. `src/components/animations/PageTransition.tsx`, `MobileSidebar.tsx`, `MobileDisclosure.tsx`, `DrillDialog.tsx`, `DesktopSidebarShell.tsx`, `ui/Button.tsx`.
7. `package.json`: `framer-motion ^13` is installed — use it; add nothing.

## The rules you implement (APPLE_REF §6.2)
- Critically damped by default (`bounce: 0`); bounce (≤ 0.15) only after a flick with release velocity > 0, never on tables, forms or navigation.
- Press 100 ms on pointer-down; hover tint 150 ms; tooltip 150/100; popover `duration 0.28, bounce 0` from the trigger origin; dialog 0.35 + scrim 200 ms; sheet 0.4; sidebar collapse 220 ms `--ease-out`.
- Gesture-driven surfaces (`MobileSidebar`, `MobileDisclosure`): 1:1 tracking, 10 px hysteresis, rubber-band 0.55, projection then snap, velocity handed to the spring, animate from the presentation value, no CSS transitions.
- Page-load vocabulary stays (decision #9) but the stagger step becomes 30 ms capped at 6 children; nothing re-animates on sort/page/filter; hover scale, tilt and particles are Persuade-only (decision #8).
- Reduce Motion: entrances removed; overlays fade 150 ms; no scale/translate/blur transitions; halo and count-ups off. Wrap Framer trees in `<MotionConfig reducedMotion="user">`.
- Compositor properties only; never `transition: all`; never animate row height/width.
- Overlays enter and exit along the same path from the trigger's `transform-origin`.

## Acceptance gates
- `review-animations` pass on the diff, as a Before/After table.
- Zero offenders: `grep -rnE "transition-all|transition: all" src/app src/components`; `grep -rnE "duration-(700|1000)" "src/app/(app)" src/components`; every new `@keyframes`/`animate` has a reduced-motion branch; `grep -c "prefers-reduced-motion" src/app/globals.css` does not decrease.
- Frame evidence via `scripts/lib/launch-chromium.mjs`: `performance.now()` deltas across ~60 rAF ticks during each transition; max frame > 32 ms fails — or state that it was not measured.
- Interrupt test: open, close, re-open before settle — no jump (screenshot mid-flight).
- `npm run check:design-system`; `node scripts/run-ui-gates.mjs`; `npx tsc --noEmit && npx eslint src && npm run build`; `~/.code-sentry/latest.md`; `graphify update .`.

## Do not stop at the checklist
Decide "should this animate at all?" first. Then read the component: a motion bug is usually a state bug wearing a transition.
```

### 10.6 Library activations that support the roster (not copied in this pass)

- Skills: `~/.claude/skills-library/apple-hig-expert` (HIG-audit protocol; its `references/`
  and `scripts/` are missing from the library copy — use it as a checklist), `mobile-ios-design`
  (`references/hig-patterns.md` values only), `a11y-audit` (WCAG 2.2 scan/fix/verify).
- Agents: `~/.claude/agents-library/ui-visual-validator.md` (evidence-first visual QA),
  `accessibility-expert.md`, and `design-review.md` after editing its `tools:` to
  `Read, Grep, Glob, Bash` and pointing its browser phase at `scripts/lib/launch-chromium.mjs`.
- Do not activate `framer-motion` (Disney principles vs the no-bounce rule) or any ja-JP stub.
- Primary aesthetic/method for the pass: **impeccable** (Operate mode + craft floor);
  consult `emil-design-eng` for motion and `ui-ux-pro-max` for tables, a11y and the Liquid
  Glass checklist. Never stack `taste-skill`, `minimalist-skill` or `high-end-visual-design`
  on top — each contradicts the brand or the operate density.

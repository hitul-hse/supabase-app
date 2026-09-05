# HSE Hub — Design System

## Brand source
Real brand extracted from **hs-experts.com** (the company's live website).
Typography, colours, and logo are authoritative — not invented.

## Visual world
**HSE Teal** — professional, trustworthy, safety-focused. Near-black background with teal
undertone, warm-white type, HSE teal accent. Feels like a precision instrument built for
safety professionals: confident, data-rich, human.

## Color tokens (real brand — extracted from hs-experts.com)

> The token NAMES in this section are the marketing page's (`--bg-0`, `--teal`,
> `--text-0`). The app shell is authoritative in `src/app/globals.css`
> (`--page`, `--surface`, `--accent`, `--text-primary` …), and
> `check-design-system` enforces those, not these. Same brand, two vocabularies;
> do not invent a third.

### App-shell colour semantics (globals.css; docs/APPLE-DESIGN-REFERENCE.md §2, §4)

Every token below exists in `:root` (dark) and `[data-theme="light"]`, and the
gate measures each text token on `--page`, `--surface`, `--surface-hover` and
`--surface-raised` in BOTH themes. Ratios are WCAG 2.x, dark / light.

**Four label levels** (Apple's label ladder, each rung a visible step):
`--text-primary` 15.06 / 15.71 on `--surface` → `--text-secondary` 9.21 / 9.09 →
`--text-muted` 7.45 / 6.97 → `--text-faint` 6.00 / 5.57. Muted-to-faint is
1.24 / 1.25 (it was 1.04 / 1.14 — two names, one appearance). `--text-faint` is
caption ink, not a watermark: its floor is 5.5 on `--surface` and 4.5 on
`--surface-hover` (5.25 / 4.72 measured).

**Backgrounds — elevation in dark is LIGHTER, one step per layer:**
`--page` < `--surface` (cards, tables; 1.10 above page) < `--surface-raised`
(popovers, menus, tooltips, dialogs; dark `#20262e`, 1.10 above surface; light
white + `--shadow-raised`). `--surface-hover` is the hover fill on any of them.
`--surface-2` is DARKER than `--surface` and means RECESSED — the Segmented
track, input wells, code, disabled fills — never a nested panel. `--row-alt`
(1.07 / 1.06 vs surface) is the zebra stripe for > 8-column crosstabs only.
`--scrim` (black 0.5 / page-ink 0.35) sits behind modals via `.scrim`, a dim
and nothing else: APPLE_REF §4.2 gives M5 one ingredient and reserves
`backdrop-filter` for M4 (the mobile tab bar and sheet), and a 4 px scrim
blur measured 33–50 ms per frame of the dialog's own entrance. The
reduced-transparency / increased-contrast block still pins
`backdrop-filter: none` on `.scrim` so the gate can read that no blur comes
back.

**One tint:** `--accent` means INTERACTIVE (links, the one primary button,
`--focus-ring`) and CURRENT (nav pill, chosen segment, current page, active
sort). Healthy status is `--good` — in light it was byte-identical to the
accent and is now a distinct green (`#15733a`). KPI figures are
`--text-primary`; teal on a figure only inside the one hero-tone card. Nav
badges are neutral (`--surface-hover` + `--text-secondary`). The light accent
is `#1c7360` so a link on a hovered row clears 4.5 (4.85; `#1f7a67` was 4.41).

**Increased contrast:** `@media (prefers-contrast: more)` overrides every text
token in both themes to ≥ 7:1 on surface, page and hover (dark lighter, light
darker — Apple's pattern), lifts borders one step, washes to 0.22, widens the
focus ring to 3px and makes the frosted mobile bar solid. Dark theme also
softens white-ground images: `img.on-dark { filter: brightness(.92) }`.

### Backgrounds
- `--bg-0`: #0e1517  (deepest surface — near-black with teal undertone)
- `--bg-1`: #141d1f  (raised surface / cards)
- `--bg-2`: #1a2628  (hover)
- `--bg-3`: #203032  (active / selected)

### HSE Teal (primary brand accent)
- `--teal`:        #91C2B7  ← from hs-experts.com h1 color rgb(145,194,183)
- `--teal-deep`:   #29474B  ← from hs-experts.com link color rgb(41,71,75)
- `--teal-light`:  #B0D4CC  (highlight / gradient end)
- `--teal-muted`:  rgba(145,194,183,0.12)
- `--teal-border`: rgba(145,194,183,0.22)
- `--teal-glow`:   0 0 40px rgba(145,194,183,0.2)

### Text
- `--text-0`: #F0F4F3  (warm white with teal tint — headings)
- `--text-1`: #8FA8A5  (secondary labels)
- `--text-2`: #5A7470  (muted / metadata)

### Borders
- `--border`:        rgba(145,194,183,0.08)
- `--border-strong`: rgba(145,194,183,0.16)

### Status
- `--green`: #4ade80
- `--amber`: #fbbf24
- `--red`:   #f87171

## Typography (real brand font)
- **Display/UI:** `Poppins` — loaded at 300/400/500/600/700 (src/app/layout.tsx)
  - Loaded from Google Fonts (same as hs-experts.com)
  - Persuade pages only: large display 700 at ≥ 26px, `-0.03em` tracking at the
    88px marketing display; prose at line-height 1.6
- **Mono:** `JetBrains Mono` at 400/500 — figures, IDs, codes, labels. Nothing
  above 500 exists for it: `font-semibold` on a mono span is a synthesised
  faux-bold, not a weight.

### App-shell type roles (globals.css `@utility`; docs/APPLE-DESIGN-REFERENCE.md §1.3)

The shell sets type through named roles, never through an ad-hoc `text-[Npx]`.
The ladder is 10 · 11 · 12 · 13 · 15 · 17 · 22 · 26 — Apple's macOS text
styles, set in the house faces. One size, one line height, one weight and one
tracking per role; colour is chosen at the call site from the label ladder
(§App-shell colour semantics), so every role reads identically in both themes.

| Role | Face | px / lh | Weight | Tracking | Use it for |
| --- | --- | --- | --- | --- | --- |
| `t-large` | Poppins | 26 / 32 | 600 | −0.015em | sign-in headline; the one hero title. Not elsewhere in the shell |
| `t-title` | Poppins | 22 / 26 | 600 | −0.01em | the page `h1` (`PageHeader`) at ≥ sm |
| `t-title-2` | Poppins | 17 / 22 | 600 | −0.005em | page `h1` below sm; `DrillDialog` title |
| `t-title-3` | Poppins | 15 / 20 | 600 | 0 | `CardHeader` / `DataTable` title; a section heading inside a page |
| `t-headline` | Poppins | 13 / 16 | 600 | 0 | `EmptyState` title, a disclosure title, a legend, an emphasised cell |
| `t-body` | Poppins | 13 / 16 | 400 | 0 | comfortable rows, dialog body, ≤ 2-line prose |
| `t-callout` | Poppins | 12 / 15 | 400 (+`font-medium` inside a control) | 0 | dense rows (ledgers, `DataTable`), inputs, nav items, `md` buttons, tooltips — the shell's de-facto body |
| `t-subhead` | Poppins | 11 / 14 | 400 | +0.005em | hints under tiles, footnotes, `sm` buttons, the "no rows" line inside a table |
| `t-label` | JetBrains Mono | 10 / 13 | 500 | +0.08em | column headers, KPI captions, sidebar group headers, pager copy, the meta line, chips and badges. Uppercase is the content's job |
| `fig-xl` | JetBrains Mono | 26 / 32 | 500 | 0 | the one hero figure per page |
| `fig-lg` | JetBrains Mono | 22 / 26 | 500 | 0 | `StatTile` value, a panel's headline figure |
| `fig-md` | JetBrains Mono | 15 / 20 | 500 | 0 | inline totals, the `DrillDialog` headline figure |
| `fig` | JetBrains Mono | 11 / 15 | 400 | 0 | every number in a table column, IDs, codes |

Rules that come with the table:

1. **Weights.** 400 words, 500 controls / labels / figures, 600 headings and
   emphasis. **300 and 800 are banned in the app shell**; 700 only on Persuade
   pages at ≥ 26px. Emphasis inside a role is one weight step up
   (`t-callout font-medium`), or one step up the label ladder — never a size
   step. Never stack two roles on one element.
2. **Leading.** The role's line height is the standard. `t-tight` (−2px) is for
   a two-line cell — a name over its code — and never for three or more lines;
   `t-loose` (+2px) is for a paragraph. `leading-relaxed` and 1.6 are prose
   values for Persuade pages.
3. **Tracking** is size-specific and HSE's own curve for Poppins (near zero at
   12–13px, negative from 17px up, +0.005em at 11px, +0.08em on mono labels):
   never one `tracking-*` for every size, never SF Pro's table.
4. **Floors.** No Poppins under 11px. Mono at 10px only as `t-label`. Nothing
   under 11px on a touch surface. Whole pixels only — 12.5 and 11.5 are gone.
5. **Figures.** Every number in a column is `fig` (mono, tabular by nature);
   a number inside a sentence stays Poppins and inherits `tabular-nums` from
   `body`. Hours to one decimal, percent as integers, `—` for a missing value.
6. **Per screen:** at most four Poppins roles + `t-label` + two figure sizes —
   typically `t-title`, `t-title-3`, `t-callout`, `t-subhead`, `t-label`,
   `fig-lg`, `fig`. A dialog adds `t-title-2`; a two-line cell adds
   `t-headline`. Two roles one step apart doing the same job on one screen is
   how 12 and 12.5 both shipped.
7. **German.** Every role is checked with the `de` strings; a label that fits
   in EN and wraps in DE is a defect.

## Logo
- `/public/hse-logo.png` — 14KB PNG, valid
- Always rendered via `next/image` for optimisation
- Size: 22–48px depending on context
- Never use text-only "HSE HUB" pill when the logo is available

## Spacing & layout
- **Content padding:** 24px (mobile: 16px)
- **Card padding:** 20px–24px
- **Grid gaps:** 12px (dense) / 16px (normal) / 24px (airy)
- **Section vertical padding:** py-24 (96px) on marketing pages
- **Border radius:** 6px (small), 10px (cards), 14px (modals), 9999px (pills)
- **Container max-width:** 5xl (1024px) for content, 4xl (896px) for prose

## Motion principles (emilkowalski / framer-motion)
- **Easing:** `cubic-bezier(0.23, 1, 0.32, 1)` — strong ease-out, never `linear`
- **Springs:** `{ type:"spring", bounce:0, duration:0.4 }` — critically damped
- **Entrance:** `translateY(20px) scale(0.98)` → `translateY(0) scale(1)` + opacity
- **Stagger:** 0.05s between rows, 0.08s between card groups
- **Hover:** `scale(1.04) translateY(-2px)` on CTAs, `scale(1.08)` on icon buttons
- **No bounce** on data tables, form fields, or navigation
- **Tilt cards:** `rotateX/Y` via `useSpring` + `useMotionValue` for glow tracking
- **Particles:** 22 floating teal specks, `easeInOut` loop, 10–22s duration
- Framer Motion does NOT respect `prefers-reduced-motion` by default (its
  `reducedMotion` config defaults to `"never"` — measured: with the OS setting on,
  every JS spring still ran at full amplitude while every CSS entrance was
  correctly disabled). The app shell mounts `MotionConfig reducedMotion="user"`
  (`src/components/animations/MotionProvider.tsx`), which makes transforms
  instant and keeps opacity cross-fades. Springs are the constants in
  `src/components/animations/springs.ts`, written as Apple's (response,
  damping ratio) in Motion's physics form via `appleSpring()`:
  `SPRING_POPOVER` 0.28, `SPRING_UI` 0.35, `SPRING_MOVE` 0.4 (all damping
  1.0) and `SPRING_FLICK` 0.4 / 0.85 for a flicked sheet only. Physics form
  on purpose: motion-dom 13 zeroes the velocity handed to any `bounce` /
  `duration` / `visualDuration` spring, so a released drag would restart
  from rest. The `{ bounce: 0, duration: 0.4 }` above is the demo page's
  shorthand and is NOT the same spring (Motion's `duration` solves for the
  settle time, roughly a response of 0.27).
- Sidebar collapse is CSS (`width` 220 → 64 over 220 ms `--ease-out`, the
  pane inset and label opacity on the same curve), the one ruled exception
  to transform/opacity-only (APPLE_REF §6.2); it is guarded by a frame-time
  measurement, not a property list.

## Components

### Nav (demo page)
- Height 56px, frosted glass: `rgba(14,21,23,0.88)` + `backdrop-blur(20px) saturate(160%)`
- Border bottom: `var(--border)`
- Logo + "HSE HUB" label + company name | Nav links | GitHub + Sign in CTA
- Sign in button: solid teal (`#91C2B7`), dark text (`#0e1517`)

### Video player
- Rounded-2xl, teal inset border glow
- Controls auto-hide after 3.2s, reveal on mouse move
- Play/pause: 80px circle, teal glassmorphism, spring scale on hover
- Scrubber: teal gradient fill bar
- Download link: teal text, top-right

### Stat tiles
- 2×2 on mobile → 4-across on sm+
- Teal count-up number, muted label
- Separated by `var(--border)` hairlines
- CountUp eases with cubic-out over 1800ms

### Feature rows
- Numbered (01–06) in JetBrains Mono, coloured per feature
- Slide in from left on scroll (stagger 50ms)
- Arrow icon appears on group hover
- Tags: coloured badge per feature

### Stack cards
- TiltCard: 3D rotateX/Y spring + radial glow tracking cursor
- Icon + label + sub-description
- Background: `var(--bg-1)`, border: `var(--border)`

### Buttons (marketing page)
- **Primary CTA:** solid teal fill, dark text, teal glow shadow on hover
- **Secondary:** transparent, `var(--border-strong)` border, white text

## Page-level design patterns

### Operate pages (app shell — dark with subtle teal accents)
- Sidebar: 220px, teal active indicator
- Tables: 13px body, teal-tinted row highlights
- Loading: teal-tinted skeleton shimmer

### Persuade pages (demo — full cinematic treatment)
- Full-viewport hero, 88px Poppins display with teal gradient
- Tagline from real company: "If nothing happens, we've done our job."
- Particle field: 22 floating teal specks
- Grid texture: rgba(145,194,183,0.08) hairlines
- Glow blobs: teal radial gradients, heavily blurred

## Data tables

Measured against production at 1440×900, `/dashboard/management?tab=customers` was
**17.7 screens** tall (177 rows in one unpaged table); `?tab=risks` 4.3, `/team-lead`
3.7, `/admin/roles` 2.6. A reader looking for one row scrolled past a hundred to get
there, and the column headers left the screen on the way. These eight rules exist to
make that shape impossible to ship again. Enforced by
`npm run check:table-scroll-budget`.

1. **Any table whose row count is not fixed by the schema renders through
   `src/components/data-table/DataTable.tsx`.** A table over a query result has no
   ceiling — 17 rows in staging is 177 in production — and paging, sorting, search,
   sticky headers and honest counts are five separate things every author would
   otherwise re-decide. Hand-rolled `<table>` is fine only for a genuinely bounded
   matrix (roles × permissions, a 7-row rating legend), and that table still owes
   rules 3, 5, 6 and 8.

2. **Default page size 25.** Twenty-five 12px rows plus a header is roughly one
   screen, so the first page is the whole answer and the pager is the exception
   rather than the routine. `ALL` stays offered — some readers want one long list
   deliberately, and taking that away just moves the complaint.

3. **Sticky header, always.** A column of bare numbers with the header scrolled off
   is unreadable, and this is the failure that survives paging: even 25 rows outscroll
   a header inside a bounded body. The sticky cell needs an opaque background
   (`bg-[var(--surface)]`), because translucency over moving digits is worse than no
   header at all.

4. **A crosstab wider than ~8 columns freezes its first column**
   (`freezeFirstColumn`). Past eight columns the table scrolls sideways, and a row of
   numbers whose label has slid off the left edge cannot be attributed to anyone. Only
   opt in when the first column IS the label — a frozen number column is noise, and
   the pinned cell pays for an opaque background with its hover tint.

5. **The body scrolls inside a bounded card; the page does not grow.**
   `maxBodyHeight` (house default ~60vh) keeps the surrounding page navigable, so the
   filter above and the footnote below stay reachable while the rows move. The
   opposite pattern — an appending "Show 30 more" — pushes its own control further
   away with every click, which is the specific bug `check-page-length.mjs` locks
   down. Skip the cap under ~15 rows: a scrollbar inside a five-row table reads as
   broken.

6. **A missing number renders as an em dash, never as zero.** `0 h` is a claim that
   somebody logged nothing; `—` says we do not know. They lead to opposite decisions,
   and the ones that matter here are staffing ones. Corollary for sorting: nulls sort
   last in **both** directions (`cmpNum`), or reversing a "worst first" column floats
   the rows with no data to the top of the first screen.

7. **A collapsed or paged table still states its total.** `"1–25 of 177"`,
   `"all 177 rows"`, or a `summary` line while shut. A fixed-height list with no count
   is indistinguishable from a truncated one, and a collapsed panel with no count is
   indistinguishable from an empty one — so the reader stops trusting every other
   number on the page.

8. **No page exceeds 3 screens on first load.** The gate's budget. Header, filters,
   KPI tiles and a chart fit comfortably in two; the third is slack. Anything past
   that is a table that failed rules 2 or 5, and the number is the only assertion the
   user's actual complaint ("too much scrolling") can be tested by.

## Anti-patterns (never do)
- No gold/amber (#d4a843) — that was the previous placeholder palette, not the real brand
- No pure white backgrounds — always teal-dark bg
- No rainbow coloring — teal as the single brand accent, status colors only for meaning
- No bounce animations on data tables or form fields
- No flat uninflected text — always Poppins, always weighted

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
> `--text-0`). The app shell is authoritative in `src/app/globals.css:130-407`
> (`--page`, `--surface`, `--accent`, `--text-primary` …), and
> `check-design-system` enforces those, not these. Same brand, two vocabularies;
> do not invent a third.

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
- **Display/UI:** `Poppins` — 300/400/500/600/700/800 weights
  - Loaded from Google Fonts (same as hs-experts.com)
  - Large display: 700–800 weight, -0.03em tracking
  - Body: 400 weight, comfortable line-height 1.6
  - Labels/badges: 500–600 weight, tracking-widest uppercase
- **Mono:** `JetBrains Mono` — feature numbers, IDs, code values

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
  instant and keeps opacity cross-fades. Springs are the two constants in
  `src/components/animations/springs.ts`: `SPRING_UI` (damping 1.0, response
  0.3) and `SPRING_MOVE` (1.0, 0.4); the `{ bounce: 0, duration: 0.4 }` above is
  the same family written with Motion's older key.

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

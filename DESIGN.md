# HSE Hub — Design System

## Brand source
Real brand extracted from **hs-experts.com** (the company's live website).
Typography, colours, and logo are authoritative — not invented.

## Visual world
**HSE Teal** — professional, trustworthy, safety-focused. Near-black background with teal
undertone, warm-white type, HSE teal accent. Feels like a precision instrument built for
safety professionals: confident, data-rich, human.

## Color tokens (real brand — extracted from hs-experts.com)

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
- Framer Motion respects `prefers-reduced-motion` automatically

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

## Anti-patterns (never do)
- No gold/amber (#d4a843) — that was the previous placeholder palette, not the real brand
- No pure white backgrounds — always teal-dark bg
- No rainbow coloring — teal as the single brand accent, status colors only for meaning
- No bounce animations on data tables or form fields
- No flat uninflected text — always Poppins, always weighted

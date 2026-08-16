# HSE Hub — Design System

## Visual world
**Goldsmith** — dark professional tool aesthetic. Near-black backgrounds, warm white type, gold accent (#d4a843 primary, #b8922e deep, #f0c060 highlight). Feels like a Bloomberg terminal meets a luxury brand: confident, data-rich, elegant.

## Color tokens

### Background
- `--bg-base`: #0c0c0d (near-black, primary surface)
- `--bg-elevated`: #141415 (cards, sidebars)
- `--bg-overlay`: #1a1a1b (modals, dropdowns)
- `--bg-subtle`: #1f1f20 (hover states, row highlights)

### Gold accent
- `--gold-primary`: #d4a843
- `--gold-deep`: #b8922e
- `--gold-highlight`: #f0c060
- `--gold-muted`: rgba(212, 168, 67, 0.15)
- `--gold-border`: rgba(212, 168, 67, 0.25)
- `--gold-glow`: 0 0 32px rgba(212, 168, 67, 0.3)

### Text
- `--text-primary`: #f5f5f0 (warm white, headings)
- `--text-secondary`: #a0a09a (secondary labels)
- `--text-muted`: #6b6b65 (metadata, placeholders)
- `--text-gold`: #d4a843 (accented labels, highlights)

### Borders
- `--border-subtle`: rgba(255,255,255,0.06)
- `--border-default`: rgba(255,255,255,0.10)
- `--border-strong`: rgba(255,255,255,0.16)

### Status
- `--status-green`: #4ade80
- `--status-amber`: #fbbf24
- `--status-red`: #f87171
- `--status-blue`: #60a5fa

## Typography
- **Display:** Inter, system-ui — 600-700 weight, tight tracking (-0.02em to -0.04em)
- **Body:** Inter, system-ui — 400-500 weight, normal tracking
- **Mono:** JetBrains Mono, monospace — used for IDs, codes, data values
- **Scale:** 11px / 12px / 13px / 14px / 16px / 18px / 24px / 32px / 48px / 64px / 96px

## Spacing & layout
- **Sidebar:** 220px fixed (desktop), 260px drawer (mobile)
- **Content padding:** 24px (mobile: 16px)
- **Card padding:** 20px–24px
- **Grid gaps:** 12px (dense) / 16px (normal) / 24px (airy)
- **Border radius:** 6px (small), 10px (cards), 14px (modals), 9999px (pills/badges)

## Motion principles (emilkowalski / framer-motion)
- **Spring physics:** stiffness 300, damping 30 for interactive elements
- **Fade + slide:** y: 16px → 0, opacity 0 → 1, duration 0.4s ease-out for page entrances
- **Stagger:** 0.05s between list items, 0.08s between card groups
- **Hover:** scale(1.02) + translateY(-2px) on cards, translateX(3px) on nav links
- **No bounce on data tables** — spring only on UI chrome, not data rows
- **Respect prefers-reduced-motion:** Framer Motion handles this automatically

## Components

### Sidebar
- 220px fixed, `--bg-elevated` background, 1px right border `--border-subtle`
- Logo: gold gradient pill "HSE HUB" at top
- Nav groups with 11px uppercase labels, 0.1em letter-spacing
- Active item: 2px gold left bar (layoutId animated), gold text, subtle gold bg
- Mobile: 48px fixed top bar + 260px slide-in drawer, backdrop blur

### Cards / stat tiles
- Background: `--bg-elevated` with `--border-subtle` border
- Hover: border brightens to `--border-default`, subtle gold glow in corner
- Metric: large number (32px, 700 weight) + label (12px, muted) + trend badge

### Buttons
- **Primary:** gold gradient (#d4a843 → #b8922e), near-black text, no border
- **Secondary:** transparent, `--border-default` border, `--text-primary` text
- **Ghost:** no border, muted text, hover brightens
- **Danger:** red border + text on hover

### Badges / pills
- Rounded-full, 11px font, 500 weight, uppercase
- Gold: `--gold-muted` bg, `--gold-primary` text
- Status: coloured bg at 15% opacity, matching text

### SyncBar
- Fixed bottom or top strip, `--bg-elevated`, source-system pills with freshness timestamps
- Pulsing green dot for synced recently, amber for stale over 1h, red for error

## Page-level design patterns

### Operate pages (app shell)
- Data tables: 13px body, 11px header labels, alternating row subtle bg
- Loading: skeleton shimmer animation (gold-tinted on dark bg)
- Empty states: centred icon + 16px heading + 14px description + CTA button

### Persuade pages (demo/marketing)
- Full viewport hero sections, large type (64px-96px display)
- Background: deep #0c0c0d with gold radial glow blobs (blurred, low opacity)
- Animated particle field (22 floating gold specks)
- Section transitions: fade + parallax scroll
- CTA: large gold gradient button with 32px box-shadow glow

## Anti-patterns (never do)
- No pure white backgrounds (#ffffff) — always warm or dark
- No flat, uninflected greys — always warm-tinted
- No abrupt cuts — every transition has easing
- No bounce animations on tables or form fields
- No gold on gold — ensure 4.5:1 contrast minimum

# UI conventions: long lists, tables, and review queues

Written 2026-08-23 after the customer-master review queue shipped as one
endless scroll. These rules exist so every future list lands right the first
time. Inspiration reviewed: outcrowd.io's case-study layouts -- what transfers
to an internal BI tool is their restraint (few things visible at once, strong
hierarchy, generous whitespace), not their marketing aesthetics.

## The rules

1. **Paginate anything a person works THROUGH.** A review queue, an approval
   list, an alert log: 10 rows per page. Working a queue means handling item
   by item, and an endless column forces scrolling past everything already
   done. Charts and dashboards AGGREGATE and are exempt; ledgers people scan
   may use larger pages (25-50).

2. **Page state lives in the URL** (`?page=N`), never in useState. Every list
   page in this app is a server component whose filters are searchParams;
   pagination that broke that would break the back button, shareable links,
   and refresh. Corollaries:
   - a FILTER change resets to page 1 (a filter defines a new list),
   - selecting an ITEM keeps its page, and a shared link with a selected item
     must jump to the page containing it,
   - out-of-range pages CLAMP to the last page rather than erroring: stale
     bookmarks should degrade, not 404.

3. **The pager is boring on purpose.** First / last / a one-step window around
   the current page / elided middle. Server-rendered `<Link>`s in the house
   tokens (`var(--accent)` for the current page, `font-mono text-[10px]`).
   Always show "SEITE X VON Y - N CASES" so the size of the remaining work is
   visible -- a queue you cannot size is a queue nobody finishes.

4. **Detail panels stick.** A master list with a detail panel keeps the detail
   `lg:sticky lg:top-4` so row N's detail is readable next to row N, not after
   a scroll back up. Pagination makes this work: with 10 rows, the sticky
   panel never drifts out of reach of the row it describes.

5. **Worst first, never alphabetical.** Attention lists (risks, overruns,
   review queues) order by severity, then size, then name. Alphabetical order
   is for phone books.

6. **Counts are honest.** If a list shows a slice, say so ("10 von 257").
   If data is partial (unmatched hours, unmapped orders), a one-line footnote
   states how much is missing. A silent omission reads as "everything is
   fine", which is a lie by layout.

## The house tokens, for any new list UI

- numbers: `font-mono tabular-nums`, hours to 1 decimal, percent as integers
- status colours: `var(--critical)`, `var(--warning)`, `var(--good)` for
  healthy, `var(--text-faint)` for unmeasured; never a hardcoded hex and never
  a fallback literal (`var(--warning, #d99b3d)` was one)
- `var(--accent)` means INTERACTIVE or CURRENT only: links, the one primary
  button, the focus ring, the current nav item / segment / page / sort. It is
  never a status colour and never decoration on a figure (docs/APPLE-DESIGN-
  REFERENCE.md §2.3 #5, §8 #5). Status is never colour alone: icon + text
- labels: `font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]`
- no emoji or unicode glyphs in app-shell files (check-design-system enforces
  this); use inline SVG
- focus rings stay (never `focus:outline-none` without a replacement)

## Reference implementation

`src/app/(app)/customer-master/import-review/page.tsx` -- the Pager component
and its hrefFor integration are the pattern to copy.

## Cards vs controls (the judgment call)

The app-wide language is separate rounded cards on a gap (see Card.tsx's
header comment for why fused grids are banned). The call that decides whether
something becomes a Card:

- **Card**: a top-level panel -- contains a heading or aggregates content
  (chart container, table wrapper, form section, approval list). Gets
  radius-card, elevation, CardHeader.
- **Not a card**: interactive chrome -- inputs, pills, tabs, dropdown items,
  org-chart nodes, badges. These keep compact styling on surface-2 tokens
  (see Segmented.tsx / Pill / IconButton for the reference treatment).
- **Never** nest Card in Card (the design gate bans it): group with spacing
  and CardDivider instead.
- **Hero tone once per page** -- the card carrying the primary chart or
  headline figure. Twice and the page flattens back to wallpaper.
- Loading skeletons mirror the card geometry they stand in for, or the page
  visibly jumps when data arrives.

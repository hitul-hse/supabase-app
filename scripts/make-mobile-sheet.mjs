// Replace the full-height opaque side drawer with a floating frosted bottom
// sheet, so "More" matches the pill it springs from and the references the user
// gave (Task Planner 27334830, E-Commerce Floating Navigation 27259789,
// Aurvia 27445911 -- all three float their surfaces and frost them).
//
// Measured problem, from scripts/inspect-mobile-nav.mjs on production:
//   tab bar : x=16 w=358 h=58, 12px off the bottom, rgba(...,0.80),
//             backdrop blur(24px) saturate(1.8), border rgba(0,0,0,0.08)
//   drawer  : x=0 y=0 w=260 h=844, radius 0px, backdrop "none", fully opaque
// The drawer is the desktop sidebar on a phone: square, edge-to-edge vertically,
// and reachable only by a thumb travelling to the far top-left of the screen.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/components/MobileSidebar.tsx";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

if (src.includes("data-testid=\"mobile-sheet\"")) { console.log("already a sheet"); process.exit(0); }

// ---------------------------------------------------------------- backdrop
const OLD_BACKDROP = `      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}`;

const NEW_BACKDROP = `      {/*
        Backdrop. Blurred as well as dimmed, which is the half of "frosted" that
        gets forgotten: the sheet can only read as glass if what is BEHIND it is
        visibly out of focus. bg-black/40 rather than /60 because the blur is now
        doing most of the separating, and a heavy scrim over a blur just reads as
        mud.

        It fades rather than appearing: an opacity step is the one transition
        that survives being interrupted mid-way, which matters here because the
        sheet can be dismissed before it has finished opening.
      */}
      <div
        className={\`fixed inset-0 z-40 bg-black/40 backdrop-blur-[3px] transition-opacity duration-200 lg:hidden \${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }\`}
        onClick={() => setOpen(false)}
        aria-hidden
      />`;

// ------------------------------------------------------------------ drawer
const OLD_DRAWER_START = `      {/* Slide-in drawer */}
      <div
        className={\`fixed top-0 left-0 z-50 h-full w-[260px] transform bg-[var(--sidebar)] shadow-2xl transition-transform duration-300 ease-in-out lg:hidden \${
          open ? "translate-x-0" : "-translate-x-full"
        }\`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >`;

const NEW_DRAWER_START = `      {/*
        A FLOATING BOTTOM SHEET, not a full-height side slab.

        WHY IT MOVED. The old drawer came in from the left edge, full height,
        square-cornered and fully opaque -- the desktop sidebar transplanted onto
        a phone. It was measured at x=0 y=0 w=260 h=844, radius 0, backdrop
        none, beside a tab bar that is a 358x58 frosted pill inset 16px with a
        24px blur. Two navigation surfaces in one app speaking two visual
        languages, and the one that opens FROM the pill was the one that looked
        least like it.

        It also fought the hand. "More" sits at the bottom-right of the pill,
        where the thumb already is; a panel that then anchors to the top-left is
        the furthest travel available on a 390x844 screen. A sheet rises from
        the same edge the tap happened on.

        THE GEOMETRY IS THE TAB BAR'S, deliberately. Same 16px side inset, same
        --glass-edge hairline, same surface-translucent (0.80 alpha over
        blur(24px) saturate(180%), with the @supports guard and the
        prefers-reduced-transparency fallback that class carries). Matching by
        REUSE rather than by eye means a future change to the glass reaches both,
        and the alpha stays the measured 4.5-contrast floor rather than a second,
        unmeasured value.

        rounded-t-[28px], not rounded-full. A pill radius on a sheet this tall
        would bow the top edge into an arch and eat the first row's corners; 28px
        is the tab bar's own 29px (half of 58) applied to the two corners that
        are actually visible, so the family resemblance holds without the shape
        becoming silly.

        max-h-[72svh] and svh, not vh. On mobile Safari, 100vh is the LARGEST
        viewport -- it excludes the browser chrome that is on screen when you
        open a sheet -- so a vh-sized panel is taller than the space it has and
        its last row hides behind the URL bar. svh is the small viewport, the
        honest one. 72% leaves the page visibly alive behind the sheet, which is
        what tells you this is a layer and not a new page.

        translate-y-full when closed: it slides from the bottom edge it belongs
        to. The old -translate-x-full slid it off the left, which is now the one
        direction nothing in this navigation lives.
      */}
      <div
        data-testid="mobile-sheet"
        className={\`surface-translucent card-elev-raised fixed inset-x-0 bottom-0 z-50 mx-2 flex max-h-[72svh] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--glass-edge)] transition-transform duration-300 ease-out lg:hidden \${
          open ? "translate-y-0" : "translate-y-full"
        }\`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        {/*
          The grab handle. It is not decoration: it is the affordance that says
          "this panel came from the bottom edge and goes back there", and every
          one of the reference shots has one. aria-hidden because it says
          nothing a screen reader needs -- the close button below is the real,
          named control.
        */}
        <div aria-hidden className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-9 rounded-full bg-[var(--text-faint)] opacity-40" />
        </div>`;

// ------------------------------------------------------------- close button
const OLD_CLOSE = `        {/* Close button inside drawer */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>`;

const NEW_CLOSE = `        {/*
          44x44, up from 28x28. The old close button was a 7x7 Tailwind box: 28px,
          well under the 44px minimum this codebase already holds its tab targets
          to, and placed in the corner a thumb reaches last. Same glyph, honest
          target, and it keeps its accessible name.
        */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-1.5 right-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>`;

// ------------------------------------------------------------------ content
const OLD_CONTENT = `        {/* Sidebar content (server-rendered, passed as children) */}
        <div className="h-full overflow-y-auto" onClick={() => setOpen(false)}>
          {children}
        </div>`;

const NEW_CONTENT = `        {/*
          h-full became min-h-0 + flex-1. Inside a flex column with a max height,
          h-full resolves against the PARENT's full height rather than the space
          left after the handle, so the list overflowed past the sheet's rounded
          bottom instead of scrolling within it.

          The bottom padding clears the home indicator AND the tab bar the sheet
          is layered over, so the last nav row is never sitting under either.
        */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(88px+env(safe-area-inset-bottom))]"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>`;

let out = src;
const apply = (oldStr, newStr, name) => {
  if (!out.includes(oldStr.replace(/\n/g, eol)) && !out.includes(oldStr)) {
    console.log(`MISS: ${name}`);
    return false;
  }
  const from = out.includes(oldStr) ? oldStr : oldStr.replace(/\n/g, eol);
  out = out.replace(from, newStr.replace(/\n/g, eol));
  console.log(`ok:   ${name}`);
  return true;
};

let all = true;
all = apply(OLD_BACKDROP, NEW_BACKDROP, "backdrop") && all;
all = apply(OLD_DRAWER_START, NEW_DRAWER_START, "sheet container") && all;
all = apply(OLD_CLOSE, NEW_CLOSE, "close button") && all;
all = apply(OLD_CONTENT, NEW_CONTENT, "scroll region") && all;

if (!all) { console.log("\nnot all anchors matched - nothing written"); process.exit(1); }

writeFileSync(path, out, "utf8");
console.log("\nMobileSidebar.tsx rewritten as a floating frosted bottom sheet");

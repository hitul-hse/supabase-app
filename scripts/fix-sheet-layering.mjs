// Two flaws visible in tmp-sheet-open.png that the assertions did not catch,
// because I only asserted geometry and not what the eye sees:
//
//  1. DEAD SPACE. The content ends at "SUPABASE LIVE" but the sheet keeps going
//     to 608px. That is my own pb-[calc(88px+...)] padding, added to clear the
//     tab bar - except the sheet is layered OVER the bar, so it clears nothing
//     and just leaves a blank slab. The sheet should be as tall as its content,
//     capped at 72svh, not always at the cap.
//
//  2. THE TAB BAR IS BEHIND THE SHEET. z-50 over z-30 means "More" - the control
//     that opened this - is invisible while it is open. The reference shots all
//     keep the bar visible with the sheet above it, and MobileTabBar already
//     tracks `moreOpen` to light the More tab, which is pointless if you cannot
//     see it.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/components/MobileSidebar.tsx";
let src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

// --- 1. the sheet hugs its content -----------------------------------------
const OLD_CLS = 'className={`surface-translucent card-elev-raised fixed inset-x-0 bottom-0 z-50 mx-2 flex max-h-[72svh] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--glass-edge)] transition-transform duration-300 ease-out lg:hidden ${';
const NEW_CLS = 'className={`surface-translucent card-elev-raised fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 mx-2 flex max-h-[68svh] flex-col overflow-hidden rounded-[28px] border border-[var(--glass-edge)] transition-transform duration-300 ease-out lg:hidden ${';

if (!src.includes(OLD_CLS)) { console.log("sheet class anchor missed"); process.exit(1); }
src = src.replace(OLD_CLS, NEW_CLS);

// --- 2. no more padding for a bar it now sits above ------------------------
const OLD_PAD = 'className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(88px+env(safe-area-inset-bottom))]"';
const NEW_PAD = 'className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"';
if (!src.includes(OLD_PAD)) { console.log("padding anchor missed"); process.exit(1); }
src = src.replace(OLD_PAD, NEW_PAD);

// --- 3. record why, next to the code --------------------------------------
const OLD_NOTE = "        translate-y-full when closed: it slides from the bottom edge it belongs";
const NEW_NOTE = `        IT SITS ABOVE THE TAB BAR, NOT OVER IT. bottom-[calc(84px+env(...))]
        clears the pill (58px tall, 12px off the bottom, plus breathing room) so
        the bar stays visible and "More" stays lit while its own panel is open.
        The first attempt covered the bar at z-50 and padded the sheet's content
        by 88px to compensate -- which cleared nothing, because the bar was
        underneath, and left a blank slab at the bottom of the sheet. Clearing it
        in the POSITION is what the layering actually needed.

        Fully rounded now, not rounded-t. A panel that floats clear of every edge
        has four visible corners; rounding only the top was correct while it was
        anchored to the bottom edge and wrong the moment it lifted off it.

        max-h-[68svh] with the content sized naturally: the sheet is as tall as
        its nine nav rows and no taller, and only starts scrolling when a longer
        list would exceed the cap.

        translate-y-full when closed: it slides from the bottom edge it belongs`;

if (src.includes(OLD_NOTE)) src = src.replace(OLD_NOTE, NEW_NOTE);

writeFileSync(path, src, "utf8");
console.log("sheet now clears the tab bar and hugs its content");

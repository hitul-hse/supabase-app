// The timer strip is gone, so request-cache.ts's explanation of WHY it exists
// now cites a component that no longer renders. The reasoning is still correct -
// the sidebar, top bar and requireProfile still each ask who is signed in - but
// a comment that names a deleted component reads as stale and gets distrusted.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/lib/queries/request-cache.ts";
let src = readFileSync(path, "utf8");

const before = src;

// The measured breakdown listed TimerBarSlot as one of the repeat callers.
src = src.replace(
  /^\s*\*\s*<TimerBarSlot\/>\s*getUser \+ profile lookup\s*$/m,
  " *   <TimerBarSlot/>   getUser + profile lookup   (since removed, 2026-08-25 --\n" +
  " *                                                 it wrote to the wrong table and\n" +
  " *                                                 had been used once ever)",
);

src = src.replace(
  /<TopBarChrome\/>, <TimerBarSlot\/>, and the page's own requireProfile\(\) gate/,
  "<TopBarChrome/> and the page's own requireProfile() gate",
);

writeFileSync(path, src, "utf8");
console.log(src === before ? "no change made" : "updated the stale references");

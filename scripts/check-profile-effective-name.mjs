/**
 * effectiveNameOf is what /profile actually renders in its header, so its
 * fallback chain has to hold even for inputs the app doesn't currently
 * produce: `??` alone would let a blank or whitespace-only display name
 * through as an empty header. This pins truthiness-after-trim as the rule,
 * independent of the DB check constraint that (today) prevents that value
 * from being stored in the first place.
 */
import { effectiveNameOf } from "../src/lib/queries/profile.ts";

let failures = 0;
const eq = (a, b, label) => {
  const ok = a === b;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(a)}`);
  if (!ok) failures++;
};

eq(effectiveNameOf("Lena Fischer", "Lena F. Fischer"), "Lena Fischer", "chosen display name wins");
eq(effectiveNameOf(null, "Lena Fischer"), "Lena Fischer", "null display name falls back to HR name");
eq(effectiveNameOf("", "Lena Fischer"), "Lena Fischer", "blank display name falls back to HR name");
eq(effectiveNameOf("   ", "Lena Fischer"), "Lena Fischer", "whitespace-only display name falls back to HR name");
eq(effectiveNameOf(null, null), "Team member", "missing HR record falls back to Team member");
eq(effectiveNameOf("", null), "Team member", "blank display name and no HR record falls back to Team member");
eq(effectiveNameOf("   ", "   "), "Team member", "whitespace-only display name and whitespace-only HR name falls back to Team member");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);

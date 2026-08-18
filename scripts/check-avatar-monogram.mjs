/**
 * The monogram is the fallback every account starts on, so it has to look
 * deliberate rather than broken. Two properties matter: initials are derived
 * predictably, and a person's colour is stable — a monogram that changed hue
 * between renders would read as a glitch.
 *
 * This imports the identity helpers from src/lib/avatar-identity.ts rather
 * than the Avatar component itself: the component is a JSX file that pulls
 * in next/image, neither of which node --experimental-strip-types can
 * process. The plain-TS module keeps this gate runnable directly.
 */
import { initialsOf, colorForName } from "../src/lib/avatar-identity.ts";

let failures = 0;
const eq = (a, b, label) => {
  const ok = a === b;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(a)}`);
  if (!ok) failures++;
};

eq(initialsOf("Lena Fischer"), "LF", "two names give two initials");
eq(initialsOf("Lena"), "L", "one name gives one initial");
eq(initialsOf("lena fischer"), "LF", "initials are uppercased");
eq(initialsOf("Lena van der Berg"), "LB", "first and last only");
eq(initialsOf("  "), "?", "blank falls back to ?");
eq(initialsOf(""), "?", "empty falls back to ?");
eq(colorForName("Lena Fischer"), colorForName("Lena Fischer"), "colour is stable for a name");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);

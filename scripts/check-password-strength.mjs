/**
 * The strength meter moved out of set-password so the profile page can reuse
 * it. Two meters that scored differently would be worse than one, so this
 * pins the scoring rather than merely checking the module imports.
 */
import { getPasswordStrength } from "../src/lib/password-strength.ts";

let failures = 0;
const eq = (actual, expected, label) => {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
};

eq(getPasswordStrength("").score, 0, "empty scores 0");
eq(getPasswordStrength("").label, "", "empty has no label");
eq(getPasswordStrength("abcdefgh").score, 1, "8 lowercase scores 1");
eq(getPasswordStrength("abcdefgh1").score, 2, "8 + digit scores 2");
eq(getPasswordStrength("Abcdefgh1").score, 3, "8 + digit + upper scores 3");
eq(getPasswordStrength("Abcdefgh1!").score, 4, "8 + digit + upper + symbol scores 4");
eq(getPasswordStrength("Abcdefghijklmn1!").score, 4, "score clamps at 4");
eq(getPasswordStrength("Abcdefgh1!").label, "Very strong", "label matches score 4");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);

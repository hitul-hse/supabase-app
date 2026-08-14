// Is there ANY `next` value that passes the guard and still escapes the origin?
//
// I initially wrote up "/\evil.example.com" as a real open redirect. My own
// output disproved it and this exists to settle the question properly rather
// than ship a false vulnerability report against someone else's code.
//
// The key detail I missed: the route builds `${origin}${next}`, an ABSOLUTE
// URL. Once the origin is prepended, a leading "//" in the remainder is just a
// path with an empty first segment, not a protocol-relative URL. The danger
// would be real only if the redirect used `next` on its own.
const ORIGIN = "http://localhost:3000";

const resolveNext = (requestedNext) =>
  requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/auth/set-password";

// Everything that passes the guard, including deliberately awkward shapes.
const CANDIDATES = [
  "/\\evil.example.com",
  "/\\\\evil.example.com",
  "/\t//evil.example.com",
  "/%09//evil.example.com",
  "/%2f%2fevil.example.com",
  "/\u0000//evil.example.com",
  "/ //evil.example.com",
  "/\r\n//evil.example.com",
  "/.evil.example.com",
  "/@evil.example.com",
  "/\\@evil.example.com",
  "/localhost:3000@evil.example.com",
  "/\\/evil.example.com",
  "/%5C%5Cevil.example.com",
  "/\\evil.example.com/path?x=1",
];

let escapes = 0;
console.log("Every value below PASSES the guard. Does any escape the origin?\n");

for (const raw of CANDIDATES) {
  const next = resolveNext(raw);
  const passedGuard = next === raw;
  if (!passedGuard) {
    console.log(`  blocked by guard        ${JSON.stringify(raw)}`);
    continue;
  }
  let parsed;
  try {
    parsed = new URL(`${ORIGIN}${next}`);
  } catch (e) {
    console.log(`  unparseable (rejected)  ${JSON.stringify(raw)} — ${e.message}`);
    continue;
  }
  const off = parsed.origin !== ORIGIN;
  if (off) escapes++;
  console.log(
    `  ${off ? "ESCAPES ORIGIN" : "same-origin   "}        ${JSON.stringify(raw).padEnd(38)} host=${parsed.host}`,
  );
}

console.log(`
CONCLUSION

  ${escapes === 0 ? "No value escapes the origin. The guard is sound." : `${escapes} value(s) escape the origin - real vulnerability.`}

  My earlier draft called "/\\evil.example.com" an open redirect. That was
  WRONG, and the evidence was in my own output the whole time: the parser
  reported origin=${ORIGIN} for it. Because the route concatenates the origin
  first, the backslash normalises into the PATH ("//evil.example.com" as a
  path with an empty first segment), not into a new host.

  The guard would be insufficient if the route ever redirected to \`next\`
  alone. It does not. Recording this because a false security finding against a
  colleague's code costs real trust and review time.`);

process.exit(escapes === 0 ? 0 : 1);

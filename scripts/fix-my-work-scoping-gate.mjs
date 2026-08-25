// check:my-work-scoping asserts that getMyWork resolves the caller through
// `supabase.auth.getUser()`, by grepping the source for that literal call.
//
// It no longer appears there, and the code is RIGHT. getMyWork now calls
// getSignedInUser(supabase) from request-cache.ts, which is a React cache()
// wrapper around exactly that call (request-cache.ts:115). That indirection was
// the performance fix: the shared app shell verifies the same session two or
// three times per render, and each raw call is a ~50ms round trip to the auth
// server for an answer that cannot change mid-render.
//
// So the gate is pinning a MECHANISM when what it means to protect is a
// PROPERTY: identity must come from the verified session, never from an
// argument a caller could supply. Re-express it that way, and accept either the
// direct call or the memoised wrapper - while still rejecting the thing that
// would actually be dangerous, a personId parameter.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-my-work-scoping.mjs";
let src = readFileSync(path, "utf8");

const OLD = `check(
  "it resolves the caller through auth.getUser()",
  /supabase\\.auth\\.getUser\\(\\)/.test(querySrc),
);`;

const NEW = `check(
  "it resolves the caller from the verified session, not from an argument",
  // Either the raw call or getSignedInUser(), the request-scoped memo in
  // request-cache.ts that wraps it (see request-cache.ts:115). Both end at
  // supabase.auth.getUser(); the wrapper exists because the app shell asks the
  // same question two or three times per render and each raw call is a ~50ms
  // round trip to the auth server.
  //
  // The mechanism is deliberately not pinned. What must hold is that the
  // identity is SERVER-VERIFIED and not passed in -- the parameter case is
  // asserted separately above, and that is the one that would let a page render
  // somebody else's book of work.
  /supabase\\.auth\\.getUser\\(\\)|getSignedInUser\\s*\\(/.test(querySrc),
);`;

if (!src.includes(OLD) && !src.includes(OLD.replace(/\n/g, "\r\n"))) {
  console.log("anchor missed");
  process.exit(1);
}
const from = src.includes(OLD) ? OLD : OLD.replace(/\n/g, "\r\n");
const to = src.includes(OLD) ? NEW : NEW.replace(/\n/g, "\r\n");
src = src.replace(from, to);

writeFileSync(path, src, "utf8");
console.log("assertion now covers the memoised wrapper too");

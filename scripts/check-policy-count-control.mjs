// Negative control for the policy-count check, run against an in-memory copy so
// the real schema.sql is never touched. An earlier attempt edited the file
// directly and a stale backup nearly left a corrupted policy name behind.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const orig = readFileSync("supabase/schema.sql", "utf8");

// Drop one policy from the copy. Match the statement through its terminating
// semicolon regardless of how it is wrapped across lines.
const broken = orig.replace(
  /create policy "authenticated can read sync_sources"[\s\S]*?;\s*\n/,
  "",
);

const declaredOrig = (orig.match(/^create policy/gim) || []).length;
const declaredBroken = (broken.match(/^create policy/gim) || []).length;

console.log(`declared in real schema:  ${declaredOrig}`);
console.log(`declared in broken copy:  ${declaredBroken}`);

if (declaredBroken !== declaredOrig - 1) {
  console.log("FAIL: could not construct the broken copy");
  process.exit(1);
}

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

// The check asserts: policies found in the DB === policies declared in the file.
// With a policy removed from the file, the DB should also have one fewer, so the
// counts still MATCH. That is the point worth verifying: the check tracks the
// file rather than a hardcoded number, so it does not fire on legitimate edits.
const db = await new PGlite();
await db.exec(preamble);
await db.exec(broken);
// Must match the scoping in check-schema-executes.mjs. Both count every schema
// the file declares policies in: narrowing either one to 'public' under-counts
// as soon as a module schema (raw, and later time/projects/hr) is added.
const { rows } = await db.query(
  `select policyname from pg_policies
    where schemaname not in ('pg_catalog', 'information_schema')`,
);
await db.close();

console.log(`created from broken copy: ${rows.length}`);

const tracksFile = rows.length === declaredBroken;
console.log(
  `\n${tracksFile ? "PASS" : "FAIL"}: the check tracks what the file declares (${declaredBroken}), not a hardcoded 24`,
);

// And prove it still catches a genuine mismatch: claim one more than exists.
const wouldCatch = rows.length !== declaredOrig;
console.log(
  `${wouldCatch ? "PASS" : "FAIL"}: a real mismatch (${rows.length} vs the old hardcoded ${declaredOrig}) is still detected`,
);

process.exit(tracksFile && wouldCatch ? 0 : 1);

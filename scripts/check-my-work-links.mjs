/*
 * Does the working-links feature on /my-work stay inside its scope?
 *
 * Three things are asserted, in order of how badly they fail:
 *
 * 1. SCOPING. The read is gated by can_view_project(project_id) and nothing
 *    else. If that policy were ever widened -- or a call site reached for the
 *    service role -- one person's customer links would render on another
 *    person's page. This is the same class as the budget-visibility hole found
 *    on 2026-09-03, where a policy existed and admitted everyone.
 * 2. CONTAINMENT. Links belong to /my-work only. hitul was explicit that the
 *    Overview tab stays the company-wide analysis surface, so a stray import
 *    there is a product regression even though it would typecheck.
 * 3. HONESTY. A project with no recorded link renders NOTHING, not "n/a" and
 *    not a placeholder chip. An absent link is not an unmeasured figure: there
 *    is nothing being withheld, so "n/a" would overstate the case, and ~80% of
 *    projects have no link at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
const check = (l, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`);
  if (!ok) failures += 1;
};

const q = readFileSync(join(REPO, "src/lib/queries/my-work.ts"), "utf8");
const tables = readFileSync(join(REPO, "src/components/my-work/MyWorkTables.tsx"), "utf8");
const migrationRaw = readFileSync(
  join(REPO, "supabase/migrations/20260903230000_project_link.sql"), "utf8");
/*
 * Statement assertions run against the SQL with `--` comments stripped.
 * Without this, a regex like /grant[^;]*to[^;]*anon/ matches straight across
 * the file header, because comment prose contains no semicolon to stop it --
 * which is exactly how this gate first reported a hole that did not exist.
 */
const migration = migrationRaw.replace(/--[^\n]*/g, "");
const overviewQuery = readFileSync(join(REPO, "src/lib/queries/overview-live.ts"), "utf8");
const overviewPage = readFileSync(join(REPO, "src/app/(app)/page.tsx"), "utf8");

/* ------------------------------------------------------------------ scoping */

check(
  "the only SELECT policy on project_link is can_view_project(project_id)",
  /using \(public\.can_view_project\(project_id\)\)/.test(migration) &&
    (migration.match(/create policy/g) ?? []).length === 1,
  "a link must be visible exactly when its project is -- no second policy, no permission key of its own",
);

check(
  "anon holds nothing on project_link",
  /revoke all on public\.project_link from anon/.test(migration) &&
    !/grant[^;]*to[^;]*anon/i.test(migration),
);

check(
  "authenticated is granted SELECT only, never write",
  /grant select on public\.project_link to authenticated/.test(migration) &&
    !/grant (insert|update|delete|all)[^;]*project_link[^;]*authenticated/i.test(migration),
);

check(
  "the query reads through the caller's own client, never the service role",
  /from\("project_link"\)/.test(q) && !/SERVICE_ROLE/.test(q),
);

check(
  "the paged read orders before ranging",
  /\.from\("project_link"\)[\s\S]{0,220}\.order\("project_id"\)[\s\S]{0,80}\.range\(/.test(q),
  "an unordered paged read returns an arbitrary partition, not a stable one",
);

/* -------------------------------------------------------------- containment */

check(
  "the Overview query does NOT read project_link",
  !/project_link/.test(overviewQuery),
  "the Overview tab is the company-wide analysis surface; working links belong to /my-work",
);

check(
  "the Overview page does NOT render links",
  !/project_link|MyLink|LINK_LABEL/.test(overviewPage),
);

/* ------------------------------------------------------------------ honesty */

check(
  "a project with no links renders nothing, not a placeholder",
  /r\.links\.length === 0 \? null :/.test(tables),
  'an absent link is not a withheld measurement, so it must not render "n/a"',
);

check(
  "an unrecognised link kind from the database is dropped, not rendered blank",
  /if \(!\(l\.kind in LINK_LABEL\)\) continue;/.test(q),
);

check(
  "outbound links carry rel=noopener noreferrer",
  /target="_blank"[\s\S]{0,80}rel="noopener noreferrer"/.test(tables),
);

check(
  "chip labels come from the shared LINK_LABEL map, so the UI cannot invent one",
  /LINK_LABEL\[l\.kind\]/.test(tables) && /export const LINK_LABEL/.test(q),
);

/* ------------------------------------------- no emoji or unicode glyph chips */

const linkCell = tables.slice(tables.indexOf('key: "links"'), tables.indexOf('key: "logged"'));
// eslint-disable-next-line no-control-regex
const nonAscii = linkCell.match(/[^\x00-\x7F]/g) ?? [];
check(
  "the links column uses plain ASCII labels, no emoji or glyphs",
  nonAscii.filter((c) => c !== "—" && c !== "·").length === 0,
  nonAscii.length ? `found: ${[...new Set(nonAscii)].join(" ")}` : "",
);

console.log(failures === 0 ? "\nMY WORK LINKS: OK" : `\nMY WORK LINKS: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

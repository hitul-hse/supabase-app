// Confirms the fixes are actually present in the pushed remote tree
// (origin/master), read straight out of git rather than from the working copy.
const { execFileSync } = require("node:child_process");

const show = (path) =>
  execFileSync("git", ["show", `origin/master:${path}`], { encoding: "utf8" });

// Page paths move around (e.g. into an (app) route group), so resolve each page
// by name from the remote tree instead of hardcoding a directory. A gate that
// silently disappears in a refactor is exactly what this needs to catch.
const remoteFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", "origin/master"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

const findPage = (suffix) => {
  const hits = remoteFiles.filter((f) => f.startsWith("src/app/") && f.endsWith(suffix));
  if (hits.length !== 1) {
    throw new Error(`expected exactly one ${suffix} under src/app/, found: ${hits.join(", ") || "none"}`);
  }
  return hits[0];
};

// The homepage is the one page.tsx whose directory is a route group or app root.
const findHomePage = () => {
  const hits = remoteFiles.filter((f) => /^src\/app\/(\([^)]+\)\/)?page\.tsx$/.test(f));
  if (hits.length !== 1) throw new Error(`expected one root page.tsx, found: ${hits.join(", ") || "none"}`);
  return hits[0];
};

const checks = [
  // Bug #2: server-side auth gates on every protected page.
  ...[
    [findHomePage(), "requireUser"],
    [findPage("people/page.tsx"), "requireUser"],
    [findPage("projects/page.tsx"), "requireUser"],
    [findPage("timesheets/page.tsx"), "requireUser"],
    [findPage("team-lead/page.tsx"), "requireProfile"],
    [findPage("admin/users/page.tsx"), "requireProfile"],
  ].map(([file, fn]) => ({
    name: `${file} gated with ${fn}()`,
    ok: new RegExp(`await ${fn}\\(`).test(show(file)),
  })),

  { name: "require-user.ts exists on remote", ok: show("src/utils/supabase/require-user.ts").includes("export async function requireUser") },

  // Bug #3: middleware fails closed.
  {
    name: "middleware redirects when env vars are missing",
    ok: /if \(!supabaseUrl \|\| !supabaseKey\) \{[\s\S]{0,400}?redirectToLogin\(\)/.test(
      show("src/utils/supabase/middleware.ts"),
    ),
  },
  {
    name: "middleware redirects on a thrown auth error",
    ok: /catch \(err\)[\s\S]{0,400}?redirectToLogin\(\)/.test(
      show("src/utils/supabase/middleware.ts"),
    ),
  },

  // Bug #1 + schema fixes.
  ...(() => {
    const sql = show("supabase/schema.sql");
    return [
      {
        name: "schema.sql creates people before projects",
        ok:
          sql.indexOf("create table if not exists people (") <
          sql.indexOf("create table if not exists projects ("),
      },
      {
        name: "schema.sql defines helper functions before the policies using them",
        ok:
          sql.indexOf("create or replace function can_view_project") <
          sql.indexOf('create policy "role-scoped read on projects"'),
      },
      { name: "approvals UPDATE policy has WITH CHECK", ok: /can update approval_decisions[\s\S]{0,400}?with check/.test(sql) },
      {
        name: "app_user_profile has exec write policies",
        ok:
          sql.includes("exec can insert profiles") &&
          sql.includes("exec can update profiles") &&
          sql.includes("exec can delete profiles"),
      },
      { name: "can_view_project joins on project_id", ok: sql.includes("pa.project_id = pr.id") && !sql.includes("pa.project_name = pr.name") },
      { name: "role helpers filter on is_active", ok: (sql.match(/where user_id = auth\.uid\(\) and is_active/g) || []).length === 3 },
    ];
  })(),

  // Bug #7: approvals surface failures.
  {
    name: "approval actions return a result instead of swallowing errors",
    ok: show(findPage("team-lead/actions.ts")).includes("Promise<ApprovalResult>"),
  },
  {
    name: "team lead board rolls back a failed approval",
    ok: show(findPage("team-lead/TeamLeadBoard.tsx")).includes("setDecisions(previous)"),
  },

  // Tooling + migration.
  { name: "npm run test:db is wired up", ok: JSON.parse(show("package.json")).scripts["test:db"] !== undefined },
  { name: "backfill migration is present", ok: show("supabase/migrations/backfill_person_assignments_project_id.sql").includes("set project_id = pr.id") },
];

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}: ${c.name}`);
  if (!c.ok) failed++;
}

const head = execFileSync("git", ["log", "-1", "--format=%h %s", "origin/master"], { encoding: "utf8" }).trim();
console.log(`\norigin/master = ${head}`);
console.log(failed ? `\n${failed} check(s) FAILED on the remote.` : `\nAll ${checks.length} checks present on the pushed remote.`);
process.exit(failed ? 1 : 0);

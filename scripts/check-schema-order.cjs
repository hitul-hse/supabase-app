// Verifies schema.sql can execute top-to-bottom: every table referenced by a
// foreign key, and every helper function called from a policy, must already be
// defined at the point of use. This is the class of bug that made the previous
// schema.sql unrunnable on a fresh project.
const fs = require("fs");

const sql = fs.readFileSync("supabase/schema.sql", "utf8");
const lines = sql.split(/\r?\n/);

const definedTables = new Set();
const definedFunctions = new Set();
const problems = [];

// Tables that live outside this file but exist in any Supabase project.
definedTables.add("auth.users");

const knownFnNames = [
  "app_user_role",
  "app_user_department",
  "app_user_person_id",
  "can_view_person",
  "can_view_project",
];

let currentTable = null;

lines.forEach((raw, i) => {
  const lineNo = i + 1;
  const line = raw.trim();
  const lower = line.toLowerCase();

  const createTable = lower.match(/^create table (?:if not exists )?([a-z0-9_.]+)/);
  if (createTable) {
    currentTable = createTable[1];
    definedTables.add(currentTable);
    return;
  }

  const createFn = lower.match(/^create (?:or replace )?function ([a-z0-9_]+)\s*\(/);
  if (createFn) {
    definedFunctions.add(createFn[1]);
    return;
  }

  // Foreign keys: the target table must already exist.
  const ref = lower.match(/references\s+([a-z0-9_.]+)\s*\(/);
  if (ref) {
    const target = ref[1];
    if (!definedTables.has(target)) {
      problems.push(
        `line ${lineNo}: foreign key references "${target}" before it is created (in table ${currentTable})`,
      );
    }
  }

  // Policies: any helper function called must already be defined.
  if (lower.includes("using (") || lower.includes("with check (")) {
    for (const fn of knownFnNames) {
      if (new RegExp(`\\b${fn}\\s*\\(`).test(lower) && !definedFunctions.has(fn)) {
        problems.push(`line ${lineNo}: policy calls ${fn}() before it is defined`);
      }
    }
  }

  // Policies must target a table that exists.
  const policyOn = lower.match(/^\s*on ([a-z0-9_]+) for (?:select|insert|update|delete|all)/);
  if (policyOn && !definedTables.has(policyOn[1])) {
    problems.push(`line ${lineNo}: policy targets table "${policyOn[1]}" before it is created`);
  }
});

// Structural assertions about the fixes.
const assertions = [
  {
    name: "people is created before projects",
    ok:
      sql.indexOf("create table if not exists people (") <
      sql.indexOf("create table if not exists projects ("),
  },
  {
    name: "approval_decisions update policy has WITH CHECK",
    ok: /exec and dept_head can update approval_decisions[\s\S]{0,400}?with check/i.test(sql),
  },
  {
    name: "app_user_profile has exec write policies",
    ok:
      sql.includes("exec can insert profiles") &&
      sql.includes("exec can update profiles") &&
      sql.includes("exec can delete profiles"),
  },
  {
    name: "can_view_project joins assignments on project_id, not project_name",
    ok:
      sql.includes("pa.project_id = pr.id") &&
      !sql.includes("pa.project_name = pr.name"),
  },
  {
    name: "role helpers filter on is_active",
    ok:
      (sql.match(/where user_id = auth\.uid\(\) and is_active/g) || []).length === 3,
  },
];

let failed = false;

if (problems.length) {
  failed = true;
  console.log("DEPENDENCY ORDER PROBLEMS:");
  for (const p of problems) console.log("  - " + p);
} else {
  console.log("dependency order: OK (all FK targets and policy functions defined before use)");
}

for (const a of assertions) {
  console.log(`${a.ok ? "PASS" : "FAIL"}: ${a.name}`);
  if (!a.ok) failed = true;
}

console.log(
  `\ntables: ${definedTables.size - 1}, functions: ${definedFunctions.size}, policies: ${
    (sql.match(/create policy/g) || []).length
  }`,
);

process.exit(failed ? 1 : 0);

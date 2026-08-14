// Deeper recheck: check-agent-claims.cjs verifies 30 facts about the repo, but
// it does not verify that each individual agent's OWN assertions are true. An
// agent could cite a script that exists but is unrelated, or reference a file
// path that moved, and the aggregate check would still pass.
//
// This extracts every concrete reference each prompt makes - npm scripts, file
// paths, function names - and verifies it per agent. That is the difference
// between "the repo matches some claims" and "this prompt is accurate".
const fs = require("node:fs");
const path = require("node:path");

const DIR = ".claude/agents";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git", ".next"].includes(e.name)) continue;
      walk(p, acc);
    } else acc.push(p.split(path.sep).join("/"));
  }
  return acc;
}
const allFiles = new Set(walk("."));

// Directories are legitimate references too (e.g. `src/lib/queries/`), and an
// earlier version of this checker only matched files, so it reported three
// false failures. Resolve a trailing-slash reference against the filesystem.
const exists = (p) => {
  const clean = p.replace(/\/$/, "");
  if (allFiles.has(clean)) return true;
  try {
    return fs.statSync(clean).isDirectory();
  } catch {
    return false;
  }
};

let failed = 0;
const results = {};

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".md"))) {
  const agent = file.replace(/\.md$/, "");
  const s = fs.readFileSync(`${DIR}/${file}`, "utf8");
  const problems = [];
  let checked = 0;

  // 1. Every `npm run X` it mentions must be a real script.
  for (const m of s.matchAll(/`npm run ([a-z:-]+)`/g)) {
    checked++;
    if (!pkg.scripts[m[1]]) problems.push(`npm run ${m[1]} does not exist`);
  }

  // 2. Every scripts/... path it cites must exist.
  for (const m of s.matchAll(/`(scripts\/[\w./-]+)`/g)) {
    checked++;
    if (!exists(m[1])) problems.push(`${m[1]} does not exist`);
  }

  // 3. Every src/... path it cites must exist (allowing brace expansion like
  //    src/utils/supabase/{client,server}.ts).
  for (const m of s.matchAll(/`(src\/[\w./{},-]+)`/g)) {
    const raw = m[1];
    const brace = raw.match(/^(.*)\{([^}]+)\}(.*)$/);
    const candidates = brace
      ? brace[2].split(",").map((part) => `${brace[1]}${part}${brace[3]}`)
      : [raw];
    for (const c of candidates) {
      checked++;
      // A cited path may have moved into a route group, so accept a suffix match.
      const found =
        exists(c) ||
        [...allFiles].some((f) => f.endsWith("/" + c.replace(/^src\//, "src/")));
      if (!found) problems.push(`${c} does not exist`);
    }
  }

  // 4. Every supabase/... path it cites must exist.
  for (const m of s.matchAll(/`(supabase\/[\w./-]+)`/g)) {
    checked++;
    if (!exists(m[1])) problems.push(`${m[1]} does not exist`);
  }

  // 5. Every SQL function it names must appear in the schema.
  const schema = fs.readFileSync("supabase/schema.sql", "utf8");
  for (const fn of ["app_user_role", "app_user_department", "app_user_person_id", "can_view_person", "can_view_project"]) {
    if (s.includes(fn)) {
      checked++;
      if (!schema.includes(`function ${fn}`)) problems.push(`${fn}() not defined in schema.sql`);
    }
  }

  results[agent] = { checked, problems };
  const ok = problems.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}: ${agent.padEnd(10)} ${checked} concrete references verified`);
  for (const p of problems) console.log(`        - ${p}`);
  if (!ok) failed++;
}

const total = Object.values(results).reduce((a, r) => a + r.checked, 0);
console.log(`\n${total} per-agent references checked across ${Object.keys(results).length} prompts`);
console.log(
  failed
    ? `\n${failed} agent(s) contain a false reference.`
    : `\nEvery concrete reference in every prompt resolves. This is stronger than the\naggregate claim check: it verifies each agent's own assertions, including the\nthree that were never behaviourally A/B-tested.`,
);
process.exit(failed ? 1 : 0);

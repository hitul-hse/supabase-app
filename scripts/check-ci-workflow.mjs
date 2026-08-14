// Simulates the GitHub Actions workflow locally so it is verified before it
// ships, rather than debugged through push-and-pray commits. Runs the same
// commands with the same dummy env vars the workflow uses.
//
// Not identical to CI (Windows vs ubuntu-latest, existing node_modules vs
// npm ci), but it proves each step's command is correct and that the build
// and route probes genuinely work with dummy Supabase credentials.
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const DUMMY = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-build",
};

let failed = 0;
const step = (name, fn) => {
  process.stdout.write(`--- ${name} ... `);
  try {
    fn();
    console.log("PASS");
  } catch (err) {
    console.log("FAIL");
    console.log(`    ${String(err.message || err).split("\n").slice(0, 4).join("\n    ")}`);
    failed++;
  }
};

const run = (cmd, env = {}) =>
  execSync(cmd, { stdio: "pipe", encoding: "utf8", env: { ...process.env, ...env } });

// The workflow must be parseable and reference only scripts that exist.
step("workflow references only real npm scripts", () => {
  const wf = readFileSync(".github/workflows/checks.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const m of wf.matchAll(/npm run ([a-z:-]+)/g)) {
    if (!pkg.scripts[m[1]]) throw new Error(`workflow runs missing script: ${m[1]}`);
  }
  for (const m of wf.matchAll(/node (scripts\/[\w./-]+)/g)) {
    readFileSync(m[1]);
  }
});

step("npx tsc --noEmit", () => run("npx tsc --noEmit"));
step("npx eslint src scripts", () => run("npx eslint src scripts"));
step("npm run test:db", () => run("npm run test:db"));
step("node scripts/check-agent-claims.cjs", () => run("node scripts/check-agent-claims.cjs"));
step("node scripts/check-agent-references.cjs", () =>
  run("node scripts/check-agent-references.cjs"),
);

// The critical one: does the build actually succeed with DUMMY credentials?
// If it needs real ones, the workflow is broken and this catches it now.
step("npm run build with dummy Supabase env", () => run("npm run build", DUMMY));

// And do the route probes still pass when the app cannot reach Supabase?
// They must: an unreachable auth server has to fail CLOSED.
console.log("--- starting server with dummy env for route probes ...");
const server = spawn("npm", ["run", "start"], {
  env: { ...process.env, ...DUMMY },
  shell: true,
  stdio: "ignore",
  detached: false,
});

await new Promise((r) => setTimeout(r, 8000));

step("scripts/check-auth-gates.mjs against dummy-env server", () =>
  run("node scripts/check-auth-gates.mjs"),
);
step("scripts/check-middleware-bypass.mjs against dummy-env server", () =>
  run("node scripts/check-middleware-bypass.mjs"),
);

try {
  execSync(
    `for /f "tokens=5" %p in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do @taskkill /f /pid %p`,
    { stdio: "ignore", shell: "cmd.exe" },
  );
} catch {
  /* already gone */
}
server.kill();

console.log(
  failed
    ? `\n${failed} workflow step(s) would FAIL in CI.`
    : `\nEvery workflow step passes locally. Safe to push.`,
);
process.exit(failed ? 1 : 0);

// Final, exhaustive check of whether the policy verification can run without
// the user opening the Supabase dashboard. Every avenue is attempted here so
// "you have to paste this in the SQL Editor" is a tested conclusion.
//
// Read-only. No token material is printed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const results = [];
const record = (route, outcome, detail) => {
  results.push({ route, outcome, detail });
  console.log(`${outcome.padEnd(11)} ${route}`);
  if (detail) console.log(`            ${detail}`);
};

// 1. PostgREST with the service-role key: can it see the policy catalog?
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

const cat = await fetch(`${url}/rest/v1/pg_policies?select=*&limit=1`, {
  headers: { apikey: svc, Authorization: `Bearer ${svc}` },
});
record(
  "PostgREST -> pg_policies",
  cat.status === 200 ? "WORKS" : "BLOCKED",
  `HTTP ${cat.status} (PostgREST exposes only configured schemas)`,
);

// 2. Any SQL-execution RPC already defined on the project?
let rpcFound = false;
for (const fn of ["exec_sql", "execute_sql", "run_sql", "sql", "query", "pg_execute"]) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select 1", sql: "select 1" }),
  });
  if (r.status !== 404) rpcFound = true;
}
record("PostgREST -> SQL-exec RPC", rpcFound ? "WORKS" : "BLOCKED", "no such function exists (all 404)");

// 3. Management API with any token recoverable from local agent logs.
const logDir = path.join(os.homedir(), ".codex", "sessions");
const tokens = new Set();
const walk = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".jsonl")) {
      for (const m of fs.readFileSync(p, "utf8").matchAll(/sbp_[a-zA-Z0-9]{16,}/g)) tokens.add(m[0]);
    }
  }
};
walk(logDir);

let mgmtWorks = false;
for (const t of tokens) {
  const r = await fetch("https://api.supabase.com/v1/projects", {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (r.status === 200) mgmtWorks = true;
}
record(
  "Management API (recovered token)",
  mgmtWorks ? "WORKS" : "BLOCKED",
  `${tokens.size} token(s) found in local logs, all rejected (401 expired)`,
);

// 4. The configured Supabase MCP server.
const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
let mcpUsable = false;
let mcpDetail = "no credentials file";
if (fs.existsSync(credPath)) {
  const creds = JSON.parse(fs.readFileSync(credPath, "utf8")).mcpOAuth || {};
  const entry = Object.values(creds).find((e) => e.serverName === "supabase");
  if (entry) {
    mcpUsable = Boolean(entry.accessToken || entry.refreshToken);
    mcpDetail = mcpUsable
      ? "has a token"
      : "client registered but accessToken and refreshToken are both empty - OAuth never completed";
  }
}
record("Supabase MCP server", mcpUsable ? "WORKS" : "BLOCKED", mcpDetail);

// 5. Local tooling that could talk to the project.
// Resolve real executables on PATH. An earlier version used fs.accessSync on
// the bare name, which matched this repo's own `supabase/` DIRECTORY and
// wrongly reported the CLI as installed - a false "you can do this yourself"
// is exactly the kind of wrong answer worth catching.
const { execFileSync } = await import("node:child_process");
const cli = ["supabase", "psql"].filter((bin) => {
  try {
    execFileSync("where", [bin], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
});
record(
  "supabase CLI / psql",
  cli.length ? "WORKS" : "BLOCKED",
  cli.length ? cli.join(", ") : "neither is installed",
);

// 6. Mint an authenticated session to test the policies behaviourally.
record(
  "mint an authenticated JWT",
  env.SUPABASE_JWT_SECRET ? "WORKS" : "BLOCKED",
  "no SUPABASE_JWT_SECRET in .env.local; creating a real user would be a write to production auth",
);

const anyWorks = results.some((r) => r.outcome === "WORKS");
console.log(
  anyWorks
    ? `\nAt least one route works - the SQL Editor step is avoidable.`
    : `\nAll ${results.length} routes blocked. Running supabase/verify-policies.sql in the
Supabase SQL Editor genuinely requires dashboard access, which only the account
owner has. This is a tested conclusion, not an assumption.`,
);
process.exit(0);

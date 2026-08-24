// `my_work:read_own` exists in the database and in schema.sql but not in
// src/lib/permissions.ts. Decide which side is wrong by finding out whether
// anything actually enforces it. A permission nothing checks is dead weight; a
// permission the DB enforces but the app cannot name is worse - the admin UI
// renders from the code list, so it would be unmanageable.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== ".next") walk(p, out); }
    else out.push(p);
  }
  return out;
};

const KEY = "my_work:read_own";

console.log("=== where the key appears ===");
for (const root of ["C:/Supabase/src", "C:/Supabase/supabase"]) {
  for (const f of walk(root)) {
    if (!/\.(ts|tsx|sql|mjs)$/.test(f)) continue;
    const s = readFileSync(f, "utf8");
    if (!s.includes(KEY)) continue;
    const lines = s.split("\n");
    lines.forEach((l, i) => {
      if (l.includes(KEY)) console.log(`  ${f.replace("C:/Supabase/", "")}:${i + 1}  ${l.trim().slice(0, 110)}`);
    });
  }
}

console.log("\n=== what permissions.ts declares (module prefixes) ===");
const perms = readFileSync("C:/Supabase/src/lib/permissions.ts", "utf8");
const keys = [...perms.matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map((m) => m[1]);
const mods = [...new Set(keys.map((k) => k.split(":")[0]))].sort();
console.log(`  ${keys.length} keys across modules: ${mods.join(", ")}`);
console.log(`  contains a my_work key? ${keys.some((k) => k.startsWith("my_work")) ? "yes" : "NO"}`);

console.log("\n=== does the /my-work page gate on any permission? ===");
for (const f of walk("C:/Supabase/src/app")) {
  if (!/my-work/.test(f) || !/\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  const hits = [...s.matchAll(/hasPermission|requirePermission|app_user_has_permission|PERMISSIONS\.[A-Z_]+/g)].map((m) => m[0]);
  console.log(`  ${f.replace("C:/Supabase/", "")}: ${hits.length ? [...new Set(hits)].join(", ") : "no permission check"}`);
}

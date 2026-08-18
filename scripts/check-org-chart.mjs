/**
 * Does the org chart builder behave on the cases that break tree code?
 *
 * Compiles the real module with Next's own SWC and drives it against a fake
 * Supabase client, so the logic under test is the shipped logic rather than a
 * reimplementation. A fake client is right here: the interesting inputs (a
 * three-member cycle, a supervisor who is archived, a chain six deep) do not
 * exist in the live data and should not be created there just to test them.
 *
 * The cases are the ones that produce silently wrong charts:
 *   - nobody has a supervisor            -> everyone unplaced, no invented root
 *   - a normal tree                       -> correct depth and subtree sizes
 *   - A -> B -> A                         -> reported as a cycle, not an infinite loop
 *   - a supervisor who is archived        -> treated as no supervisor, not a dangling parent
 *   - a supervisor caught in a cycle      -> the report is unplaced, not silently dropped
 *   - a lone person with no relationships -> unplaced, so an empty chart reads as empty
 *
 * Run: npm run check:org-chart
 */
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

await loadBindings();

const dir = resolve(mkdtempSync(join("node_modules", ".orgchart-")));
const req = createRequire(join(process.cwd(), "package.json"));
const posix = (p) => p.split("\\").join("/");

async function compile(src, out, rewrites = {}) {
  let code = readFileSync(src, "utf8");
  for (const [from, to] of Object.entries(rewrites)) code = code.split(`"${from}"`).join(`"${to}"`);
  const res = await transform(code, {
    filename: src,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, out);
  writeFileSync(file, res.code);
  return file;
}

// Stub people-live: only isSharedMailbox is used, and pulling in the real module
// would drag the Supabase client and time-dashboard along with it.
const peopleStub = join(dir, "people-live.cjs");
writeFileSync(
  peopleStub,
  `const SHARED = /^(info|jobs|no-reply|noreply|office|admin|team)@/i;
module.exports = { isSharedMailbox: (e) => e !== null && SHARED.test(e) };`,
);

const mod = req(await compile("src/lib/queries/org-chart-live.ts", "org-chart-live.cjs", {
  "./people-live": posix(peopleStub),
}));

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** A Supabase-shaped stub that returns the rows given. */
const clientFor = (rows) => ({
  schema: () => ({
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
    }),
  }),
});

// Shaped like a row of time.org_chart, which is what the builder reads. Not
// time.member: the table's policy scopes rows to whoever may see that person's
// TIME, which gave a real employee a hierarchy of one person.
const member = (id, name, over = {}) => ({
  member_id: id,
  display_name: name,
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@hs-experts.com`,
  account_role: "CO_WORKER",
  job_title: null,
  team: null,
  supervisor_member_id: null,
  supervisor_source: null,
  is_archived: false,
  has_account: false,
  ...over,
});

// ── 1. Nobody has a supervisor: no invented root ─────────────────────────
{
  const rows = [member(1, "Alice"), member(2, "Bob"), member(3, "Cara")];
  const out = await mod.getOrgChart(clientFor(rows));
  check("with no reporting lines, nobody is made the root", out.roots.length === 0, `${out.roots.length} root(s)`);
  check("everyone is listed as unplaced instead", out.unplaced.length === 3, `${out.unplaced.length} unplaced`);
  check("placedCount reports 0, so the UI can say the chart is empty", out.placedCount === 0, `placedCount=${out.placedCount}`);
  check("totalPeople still counts them", out.totalPeople === 3, `totalPeople=${out.totalPeople}`);
}

// ── 2. A normal tree: depth and subtree sizes ────────────────────────────
{
  const rows = [
    member(1, "Alice"),
    member(2, "Bob", { supervisor_member_id: 1, supervisor_source: "manual" }),
    member(3, "Cara", { supervisor_member_id: 1, supervisor_source: "manual" }),
    member(4, "Dan", { supervisor_member_id: 2, supervisor_source: "manual" }),
    member(5, "Eve", { supervisor_member_id: 4, supervisor_source: "manual" }),
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check("one root", out.roots.length === 1, out.roots.map((r) => r.name).join(", "));
  const alice = out.roots[0];
  check("the root counts everyone beneath it", alice?.totalReports === 4, `totalReports=${alice?.totalReports}`);
  check("the root is at depth 0", alice?.depth === 0, `depth=${alice?.depth}`);
  const bob = alice?.reports.find((r) => r.name === "Bob");
  check("a direct report is at depth 1", bob?.depth === 1, `depth=${bob?.depth}`);
  check("a middle manager counts its own subtree", bob?.totalReports === 2, `totalReports=${bob?.totalReports}`);
  const eve = bob?.reports[0]?.reports[0];
  check("a three-deep chain resolves", eve?.name === "Eve" && eve?.depth === 3, `${eve?.name} at depth ${eve?.depth}`);
  check("larger teams sort first", alice?.reports[0]?.name === "Bob", alice?.reports.map((r) => r.name).join(", "));
  check("nobody is unplaced", out.unplaced.length === 0, out.unplaced.map((m) => m.name).join(", "));
}

// ── 3. A cycle: reported, not looped ────────────────────────────────────
{
  const rows = [
    member(1, "Alice", { supervisor_member_id: 2, supervisor_source: "manual" }),
    member(2, "Bob", { supervisor_member_id: 1, supervisor_source: "manual" }),
    member(3, "Cara"),
  ];
  const started = Date.now();
  const out = await mod.getOrgChart(clientFor(rows));
  const elapsed = Date.now() - started;
  check("a two-member cycle terminates", elapsed < 2000, `${elapsed}ms`);
  check("the cycle is reported", out.cycles.length === 1, JSON.stringify(out.cycles));
  check("the cycle names both members", out.cycles[0]?.length === 2, JSON.stringify(out.cycles[0]));
  check("members of a cycle are not silently dropped", out.unplaced.some((m) => m.name === "Alice") && out.unplaced.some((m) => m.name === "Bob"), out.unplaced.map((m) => m.name).join(", "));
}

// ── 4. A three-member cycle ────────────────────────────────────────────
{
  const rows = [
    member(1, "Alice", { supervisor_member_id: 2, supervisor_source: "manual" }),
    member(2, "Bob", { supervisor_member_id: 3, supervisor_source: "manual" }),
    member(3, "Cara", { supervisor_member_id: 1, supervisor_source: "manual" }),
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check("a three-member cycle is detected once", out.cycles.length === 1, JSON.stringify(out.cycles));
  check("it names all three", out.cycles[0]?.length === 3, JSON.stringify(out.cycles[0]));
}

// ── 5. A supervisor who is archived ────────────────────────────────────
{
  const rows = [
    member(1, "Alice", { is_archived: true }),
    member(2, "Bob", { supervisor_member_id: 1, supervisor_source: "manual" }),
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check("an archived supervisor is excluded from the chart", out.totalPeople === 1, `totalPeople=${out.totalPeople}`);
  check(
    "their report is not parented to someone invisible",
    out.roots.length === 0 && out.unplaced.length === 1,
    `roots=${out.roots.length} unplaced=${out.unplaced.length}`,
  );
}

// ── 6. A shared inbox is not a colleague ───────────────────────────────
{
  const rows = [
    member(1, "Alice"),
    { ...member(2, "Info"), email: "info@hs-experts.com" },
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check("a shared inbox is left off the chart", out.totalPeople === 1, `totalPeople=${out.totalPeople}`);
}

// ── 7. A member reporting into a cycle ─────────────────────────────────
{
  const rows = [
    member(1, "Alice", { supervisor_member_id: 2, supervisor_source: "manual" }),
    member(2, "Bob", { supervisor_member_id: 1, supervisor_source: "manual" }),
    member(3, "Cara", { supervisor_member_id: 1, supervisor_source: "manual" }),
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check(
    "someone reporting into a cycle is surfaced, not lost",
    out.unplaced.some((m) => m.name === "Cara"),
    `unplaced: ${out.unplaced.map((m) => m.name).join(", ")}`,
  );
  const everyone = new Set([...out.unplaced.map((m) => m.name)]);
  const walk = (n) => { everyone.add(n.name); n.reports.forEach(walk); };
  out.roots.forEach(walk);
  check("every member appears somewhere in the output", everyone.size === 3, [...everyone].join(", "));
}

// ── 8. Teams are collected from what is recorded ───────────────────────
{
  const rows = [
    member(1, "Alice", { team: "Safety" }),
    member(2, "Bob", { team: "Safety", supervisor_member_id: 1, supervisor_source: "manual" }),
    member(3, "Cara", { team: "Lab", supervisor_member_id: 1, supervisor_source: "manual" }),
    member(4, "Dan"),
  ];
  const out = await mod.getOrgChart(clientFor(rows));
  check("only recorded teams are listed", JSON.stringify(out.teams) === JSON.stringify(["Lab", "Safety"]), JSON.stringify(out.teams));
  check("a person with no team is not given one", out.unplaced.find((m) => m.name === "Dan")?.team === null, "");
}

// ── 9. A read failure degrades to empty, not a crash ───────────────────
{
  const broken = {
    schema: () => ({ from: () => ({ select: () => ({ order: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }),
  };
  const out = await mod.getOrgChart(broken);
  check("a failed read returns an empty chart rather than throwing", out.totalPeople === 0 && out.roots.length === 0, JSON.stringify(out).slice(0, 80));
}

rmSync(dir, { recursive: true, force: true });
console.log(failed ? "\nORG CHART: the builder mishandles a real case\n" : "\nORG CHART: trees, cycles, orphans and archived supervisors all handled\n");
process.exit(failed ? 1 : 0);

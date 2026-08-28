/**
 * Does the data-hygiene page tell the truth about what it measured?
 *
 * The failure mode this page invites is specific and invisible from the outside.
 * Every panel shows a CAPPED list of rows, so "8 cases" rendering 5 rows is
 * normal and correct -- but only if the page says so. A capped list that
 * presents itself as complete is exactly what DESIGN.md rule 7 forbids, and the
 * page looks identical either way.
 *
 * So this gate calls the REAL query function against the REAL database and
 * asserts the invariants at runtime, rather than only reading the source. That
 * distinction matters: an earlier gate of mine asserted a constant against
 * itself and stayed green while the thing it guarded was broken. Source
 * assertions here are limited to properties that only exist in source (the exec
 * role gate, the JSX disclosure line); everything about the DATA is measured.
 *
 * Invariants:
 *   1. count >= rows.length for every finding. A count SMALLER than the rows
 *      rendered means count and rows come from different sets, and the reader
 *      has no way to tell which number is the lie.
 *   2. No finding has count 0 (that belongs in `clean`), and no title appears in
 *      both `findings` and `clean` -- either means a probe disagrees with itself.
 *   3. Every finding carries a non-empty remedy, a stable key, and unique row
 *      ids (duplicate React keys silently drop rows from the DOM).
 *   4. Every heuristic row states its reasoning in `detail`, so a guess cannot
 *      be acted on as a fact.
 *   5. Both duplicate directions the user reported are probed, and each probe is
 *      proven able to FIRE -- a probe that can only ever report zero is
 *      reassurance, not a check.
 *
 * READ-ONLY. Uses the service role deliberately: the point is ground truth,
 * unfiltered by RLS, which is also the exec view the page is gated to.
 *
 * Run: npm run check:data-hygiene-page
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}

let failures = 0;
const ok = (pass, label, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  if (!pass) { if (detail) console.log(`        ${detail}`); failures += 1; }
};

const PAGE = "src/app/(app)/data-hygiene/page.tsx";
const QUERY = "src/lib/queries/data-hygiene.ts";
const page = readFileSync(PAGE, "utf8");
const querySrc = readFileSync(QUERY, "utf8");

/* ------------------------------------------------- source-only properties -- */
/* These four exist only in source; there is no runtime observation of them
 * available from a node gate, so they are checked as text and nothing more is
 * claimed for them. */

ok(
  /requireProfile\(\s*"\/data-hygiene"\s*,\s*\[\s*"exec"\s*\]\s*\)/.test(page),
  "page is gated to exec (role array present, not just an auth check)",
  "requireProfile without the role array only verifies SOMEBODY is logged in",
);
ok(
  /hidden\s*>\s*0/.test(page) && /showing \{shown\} of \{finding\.count\}/.test(page),
  "page renders 'showing N of M' whenever rows are capped",
  "a truncated list with no stated total is indistinguishable from a complete one",
);
ok(
  /export const dynamic = "force-dynamic"/.test(page),
  "page is force-dynamic, so findings are never served stale",
);
ok(
  !/exactCount \+ suspectCount/.test(page) && /kind === "heuristic"/.test(page),
  "proven and suspected totals are never summed into a single figure",
  "one combined number invites acting on a guess as though it were a defect",
);
ok(
  /hygiene\.unavailable/.test(page) && /Report unavailable/.test(page),
  "page has an explicit 'unavailable' state rather than showing zero findings",
  "a non-exec seeing 'no findings' would read a partial report as a clean bill of health",
);

/* ------------------------------------------------------ the real thing ----- */

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { getDataHygiene } = await import("../src/lib/queries/data-hygiene.ts");
const h = await getDataHygiene(supabase);

ok(!h.unavailable, "service-role read produced a report (not 'unavailable')",
  "if this fails the probes cannot read the order book at all");

console.log(`        measured: ${h.findings.length} finding type(s), ${h.clean.length} clean check(s)`);

/* 1. count vs rows -- the invariant the page's disclosure line depends on. */
{
  const bad = h.findings.filter((f) => f.count < f.rows.length);
  ok(bad.length === 0, "every finding's count is >= the rows it renders",
    bad.map((f) => `${f.key}: count=${f.count} rows=${f.rows.length}`).join(" | "));
}

/* 2. no empty panels, no double-listing. */
{
  const empty = h.findings.filter((f) => f.count === 0);
  ok(empty.length === 0, "no finding has count 0 (those belong in `clean`)",
    empty.map((f) => f.key).join(", "));

  const titles = new Set(h.findings.map((f) => f.title));
  const both = h.clean.filter((t) => titles.has(t));
  ok(both.length === 0, "no check is reported as both a finding and clean",
    both.join(", "));

  const keys = h.findings.map((f) => f.key);
  ok(new Set(keys).size === keys.length, "finding keys are unique",
    "duplicate keys make React reuse the wrong panel");

  /*
   * Rows must be capped, or one prolific probe makes the whole report
   * unscrollable and buries the panels below it. 55 unowned orders rendered in
   * full measured 4.63 screens against a house budget of 3 -- caught by
   * check:table-scroll-budget only because the route was added to it.
   *
   * The bound is asserted here too, at the data layer, because it is cheap and
   * because the scroll gate needs a running server while this does not.
   */
  const ROW_CAP = 12;
  const overCap = h.findings.filter((f) => f.rows.length > ROW_CAP);
  ok(overCap.length === 0, `no finding renders more than ${ROW_CAP} rows`,
    overCap.map((f) => `${f.key}: ${f.rows.length} rows`).join(" | "));

  /*
   * And the cap must be DISCLOSED, not silent. At least one finding currently
   * exceeds it, so the "showing N of M" path must be live -- if nothing were
   * capped, that branch would never render and its correctness would be
   * unobserved.
   */
  const capped = h.findings.filter((f) => f.count > f.rows.length);
  ok(capped.length > 0,
    `${capped.length} finding(s) are capped, so the disclosure line is exercised`,
    "no finding is capped: the 'showing N of M' branch is never rendered and untested");
}

/* 3. remedy, and row identity. */
{
  const noAction = h.findings.filter((f) => !f.action || f.action.trim().length < 20);
  ok(noAction.length === 0, "every finding states a remedy of substance",
    noAction.map((f) => f.key).join(", ") || "");

  const dupRows = h.findings.filter((f) => new Set(f.rows.map((r) => r.id)).size !== f.rows.length);
  ok(dupRows.length === 0, "row ids are unique within each finding",
    dupRows.map((f) => f.key).join(", "));

  const emptySubject = h.findings.flatMap((f) =>
    f.rows.filter((r) => !r.subject || !String(r.subject).trim()).map((r) => `${f.key}/${r.id}`));
  ok(emptySubject.length === 0, "no row renders a blank subject",
    emptySubject.slice(0, 5).join(", "));
}

/* 4. heuristics must show their reasoning. */
{
  const unexplained = h.findings
    .filter((f) => f.kind === "heuristic")
    .flatMap((f) => f.rows.filter((r) => !r.detail || String(r.detail).trim().length < 10)
      .map((r) => `${f.key}/${r.id}`));
  ok(unexplained.length === 0, "every heuristic row explains itself in `detail`",
    unexplained.slice(0, 5).join(", "));

  const kinds = new Set(h.findings.map((f) => f.kind));
  ok([...kinds].every((k) => k === "exact" || k === "heuristic"),
    "every finding is labelled exact or heuristic", [...kinds].join(", "));
}

/* 5. both directions probed, and each probe can actually fire.
 *
 * This is the negative control. Asserting "the probe found N" proves nothing if
 * N could never be anything but 0. So: rebuild each direction from the same
 * source the page reads, independently, and require the page's count to match.
 * A probe that silently over-filters shows up as a disagreement.
 */
{
  /*
   * The two directions use DIFFERENT name comparisons, and the control has to
   * match each one or it manufactures a disagreement. This bit me writing the
   * gate: normalising both gave 3/10 against the page's 3/12, and the page was
   * right.
   *
   *  - name -> numbers  compares NORMALISED names, because "DRIVE beta" and
   *    "DRIVE Beta" are one customer and must not be reported as two customers
   *    that each have several numbers.
   *  - number -> names  compares RAW trimmed names, because a case-only variant
   *    under one account number is precisely the tidiness defect that panel
   *    exists to surface.
   */
  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const raw = (s) => String(s ?? "").trim();
  const lexwareOf = (id) => (/^(\d{5})_/.exec(String(id ?? "")) ?? [])[1] ?? null;

  // Page the order book the same way the query module does.
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("projects").select("id, customer").order("id").range(from, from + 999);
    if (error) { console.log(`        control read failed: ${error.message}`); break; }
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byName = new Map(), byNum = new Map();
  for (const p of all) {
    const lex = lexwareOf(p.id);
    if (!lex) continue;
    const n = norm(p.customer), r = raw(p.customer);
    if (n) {
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n).add(lex);
    }
    if (r) {
      if (!byNum.has(lex)) byNum.set(lex, new Set());
      byNum.get(lex).add(r);
    }
  }
  const ctlName = [...byName.values()].filter((s) => s.size > 1).length;
  const ctlNum = [...byNum.values()].filter((s) => s.size > 1).length;
  console.log(`        control: ${ctlName} name(s) over multiple numbers, ${ctlNum} number(s) over multiple names`);

  /*
   * Select by EXACT key. Substring matching is what made the first version of
   * this gate wrong: "number_many_names" contains "name", so a /name/ test
   * picked the number-direction panel and compared it against the wrong
   * control. Exact keys also mean a rename in the query module fails this gate
   * loudly instead of silently matching nothing.
   */
  const byKey = new Map(h.findings.map((f) => [f.key, f]));
  const nameF = byKey.get("name_many_numbers");
  const numF = byKey.get("number_many_names");

  // Each direction must be represented somewhere: as a finding, or as a clean
  // check. Absent from both means the direction is simply not probed.
  const nameProbed = Boolean(nameF) || h.clean.includes("One customer, several customer numbers");
  const numProbed = Boolean(numF) || h.clean.includes("One customer number, several customer names");
  ok(nameProbed, "the name -> multiple-numbers direction is probed");
  ok(numProbed, "the number -> multiple-names direction is probed");

  if (nameF) {
    ok(nameF.count === ctlName,
      `name-direction count agrees with an independent recount (${nameF.count})`,
      `page says ${nameF.count}, independent recount says ${ctlName}`);
  }
  if (numF) {
    ok(numF.count === ctlNum,
      `number-direction count agrees with an independent recount (${numF.count})`,
      `page says ${numF.count}, independent recount says ${ctlNum}`);
  }

  // The known live case: Lexware 10305 spans four companies. If the number
  // direction reports nothing while 10305 is in the data, it over-filters.
  const has10305 = (byNum.get("10305")?.size ?? 0) > 1;
  if (has10305) {
    ok(Boolean(numF) && numF.count > 0,
      "the known Lexware 10305 multi-company case reaches the page",
      "10305 spans multiple companies in the data but no finding reports it");
  }
}

/* The module must route zero-result probes to `clean` rather than rendering an
 * empty panel -- checked in source because a run where every probe fires would
 * otherwise leave it unobserved. */
ok(/clean\.push\(/.test(querySrc),
  "zero-result probes are routed to `clean`, not rendered as empty panels");

console.log(failures === 0
  ? "\nDATA HYGIENE PAGE IS HONEST: counts recount independently, capped lists disclosed, exec-gated"
  : `\n${failures} honesty check(s) failed on the data-hygiene page`);
/*
 * exitCode, not process.exit().
 *
 * Caught by an audit for this exact crash class: under CONTENTION this gate hit
 * the Windows libuv assert (UV_HANDLE_CLOSING, 0xC0000409) in 7 of 24 runs,
 * always after printing its verdict. Run alone it was 20/20 clean, which is why
 * it never showed up in targeted runs -- socket teardown is a race, so a quiet
 * machine hides it and a full suite does not.
 *
 * The Supabase client leaves undici keep-alive sockets open; process.exit()
 * tears the loop down on top of them. Setting exitCode lets Node drain them and
 * exit with the same status. Same fix as check-management-contract-hours-live.
 */
process.exitCode = failures === 0 ? 0 : 1;

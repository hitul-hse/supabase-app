/**
 * Does a hygiene probe ever claim more than its evidence supports?
 *
 * WHY THIS IS ITS OWN GATE
 * ------------------------
 * check-data-hygiene-page.mjs asks whether the COUNTS are true, and
 * check-data-hygiene-paging.mjs asks whether every row is REACHABLE. Neither
 * asks the question this page is actually gated on: when a panel says "these two
 * are DIFFERENT COMPANIES", or marks a row as one of the serious ones, is that
 * claim earned?
 *
 * That is the ADR-001 question. The ADR exists because merging two customer
 * records on name similarity is how the wrong invoices get pooled, and this page
 * makes the same class of claim in prose instead of in a write. A false
 * "different companies" sends somebody to Lexware to split an account that was
 * never pooled; a false "same company" hides a real one. Both are cheap to
 * introduce and invisible in review, because the panel looks identical either
 * way -- which is exactly the shape of defect a gate is for.
 *
 * EVERY CASE BELOW IS A BUG THAT WAS REAL
 * ---------------------------------------
 * Not hypotheticals. Each was found by feeding the probes hostile rows and
 * reading what they asserted:
 *
 *   - "3M" and "3M Deutschland" under one account number were reported as
 *     DIFFERENT COMPANIES. The classifier took the first word longer than two
 *     letters, so a short name yielded NO word at all and failed to match its
 *     own sibling. Short company names are common and the failure was silent.
 *   - "Die Werkstatt Nord" and "Die Firma Mueller" were reported as one company
 *     spelled twice, because the classifier compared raw first words and both
 *     begin with an article. This is the failure the previous point's fix was
 *     introduced for, so both directions are pinned here: fixing either one by
 *     breaking the other is the obvious wrong move.
 *   - An order named "TBD" was reported twice -- once as a placeholder, and
 *     again as a name sharing no word with its customer. A placeholder shares no
 *     word with anything BY DEFINITION, so the heuristic was inflating its own
 *     count with rows whose fix is stated in another panel.
 *   - One order with contract_hours = -100 cancelled 53 real hours out of
 *     "contracted hours unwatched", making the headline understate the problem.
 *   - An EMPTY order book was reported as a clean one. RLS filters rows rather
 *     than raising, so a reader without the grants got `[]` and no error; every
 *     probe then found nothing and the page rendered PROVEN ISSUES 0 in the
 *     `good` tone beside CHECKS CLEAN 8. The module documented a protection
 *     against exactly this and only implemented it for the throwing path.
 *
 * Runs against a fixture, so it needs no credentials and states exact expected
 * answers rather than "nothing looks obviously wrong".
 *
 * Run: npm run check:data-hygiene-claims
 */

let failures = 0;
const ok = (pass, label, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  if (!pass) { if (detail) console.log(`        ${detail}`); failures += 1; }
};

/** The one call shape `readAll` makes. Not a Supabase mock. */
function stubClient(rows) {
  return {
    from() {
      const q = {
        select: () => q,
        order: () => q,
        range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return q;
    },
  };
}

const mk = (id, name, customer, extra = {}) => ({
  id, name, customer,
  customer_legal_entity_id: null, owner_person_id: null, contract_hours: 1,
  ...extra,
});

const CASES = [
  // 20001 — a short name and its longer form. ONE company.
  mk("20001_00001_1_01", "3M Wartung", "3M"),
  mk("20001_00002_1_01", "3M Wartung", "3M Deutschland"),
  // 20002 — two different companies that happen to share a leading article.
  mk("20002_00001_1_01", "Nord Wartung", "Die Werkstatt Nord"),
  mk("20002_00002_1_01", "Mueller Wartung", "Die Firma Mueller"),
  // 20003 — one company, two spellings differing only in case.
  mk("20003_00001_1_01", "Susell Wartung", "DRIVE beta"),
  mk("20003_00002_1_01", "Susell Wartung", "DRIVE Beta"),
  // A placeholder order, which must be reported exactly once.
  mk("20004_00001_1_01", "TBD", "Contoso AG"),
  // A negative contract figure beside a real one.
  mk("20005_00001_1_01", "Contoso Wartung", "Contoso AG", { contract_hours: -100 }),
  mk("20005_00002_1_01", "Contoso Wartung 2", "Contoso AG", { contract_hours: 40 }),
];

const { getDataHygiene } = await import("../src/lib/queries/data-hygiene.ts");
const h = await getDataHygiene(stubClient(CASES));
const by = new Map(h.findings.map((f) => [f.key, f]));

ok(!h.unavailable, "the fixture produces a report");

/* ------------------ one account number, one or two companies ------------- */

{
  const f = by.get("number_many_names");
  ok(Boolean(f), "the number -> names probe fired on the fixture",
    "nothing to classify, so every check below would be vacuous");

  if (f) {
    const verdict = new Map(f.rows.map((r) => [r.subject, r.cells.verdict]));
    console.log(`        verdicts: ${JSON.stringify(Object.fromEntries(verdict))}`);

    ok(verdict.get("20001") === "spelling",
      "a short name and its longer form are ONE company (3M / 3M Deutschland)",
      `read as "${verdict.get("20001")}" — an over-claim of the ADR-001 kind: it sends `
      + "somebody to split an account that was never pooled");

    ok(verdict.get("20002") === "DIFFERENT COMPANIES",
      "two companies sharing a leading article are still two companies",
      `read as "${verdict.get("20002")}" — a real pooled account hidden as a spelling variant`);

    ok(verdict.get("20003") === "spelling",
      "a case-only variant is a spelling, not two companies",
      `read as "${verdict.get("20003")}"`);

    // severe drives the bar, the ordering and the impact line, so it must track
    // the verdict exactly rather than approximately.
    const mismatched = f.rows.filter((r) => r.severe !== (r.cells.verdict === "DIFFERENT COMPANIES"));
    ok(mismatched.length === 0, "the severity bar marks exactly the DIFFERENT-companies rows",
      mismatched.map((r) => `${r.subject}: severe=${r.severe} verdict=${r.cells.verdict}`).join(" | "));
  }
}

/* ---------------------- one defect, reported once ------------------------ */

{
  const placeholders = new Set((by.get("placeholder_names")?.rows ?? []).map((r) => r.id));
  const conflicts = new Set((by.get("order_name_conflict")?.rows ?? []).map((r) => r.id));

  ok(placeholders.has("20004_00001_1_01"),
    "the placeholder order is reported as a placeholder");
  const both = [...placeholders].filter((id) => conflicts.has(id));
  ok(both.length === 0,
    "no order is reported both as a placeholder AND as a name conflict",
    `${both.join(", ")} — the same defect counted twice, once as a fact and once as a `
    + "suspicion, which inflates the heuristic with rows whose fix is stated elsewhere");
}

/* -------------------- a headline that cannot understate ------------------ */

{
  const f = by.get("no_owner");
  const stated = Number(/(-?[\d.]+) contracted hours unwatched/.exec(f?.impact ?? "")?.[1]);
  const rawSum = CASES.reduce((s, c) => s + Number(c.contract_hours ?? 0), 0);
  const floored = CASES.reduce((s, c) => s + Math.max(0, Number(c.contract_hours ?? 0)), 0);

  ok(rawSum < 0 && floored > 0,
    `the fixture contains a poisoning negative (raw ${rawSum}, floored ${floored})`,
    "without one, the assertion below proves nothing");
  ok(stated === floored,
    `a negative contract figure cannot cancel real committed hours (reads ${stated})`,
    `impact says ${stated}, floored total is ${floored}, raw total is ${rawSum} — a negative `
    + "makes the headline understate how much unwatched work there is");
}

/* ------------------ nothing renders as a broken value -------------------- */

/*
 * Cheap, and it has caught two things already: a cell key with no column (so the
 * value existed and was never drawn) and blank subjects from whitespace-only
 * source data.
 */
{
  const NASTY = /(NaN|undefined|\[object Object\]|Infinity)/;
  const problems = [];
  for (const f of h.findings) {
    if (NASTY.test(f.impact)) problems.push(`${f.key}: impact "${f.impact}"`);
    for (const r of f.rows) {
      if (!String(r.subject).trim()) problems.push(`${f.key}/${r.id}: blank subject`);
      for (const c of f.columns) {
        if (r.cells[c.key] === undefined) problems.push(`${f.key}/${r.id}: no value for column "${c.key}"`);
        else if (NASTY.test(String(r.cells[c.key]))) problems.push(`${f.key}/${r.id}: ${c.key}="${r.cells[c.key]}"`);
      }
      for (const k of Object.keys(r.cells)) {
        if (!f.columns.some((c) => c.key === k)) problems.push(`${f.key}/${r.id}: cell "${k}" has no column and is never rendered`);
      }
    }
  }
  ok(problems.length === 0, "every declared column has a drawable value, and no value is a broken number",
    problems.slice(0, 6).join(" | "));
}

/* ---------------- an unreadable order book is never "clean" -------------- */

/*
 * The strongest claim this page can make wrongly is the reassuring one. Every
 * check above asks whether a stated defect is earned; this asks the inverse,
 * and it is the only direction in which being wrong looks like good news.
 */
{
  const empty = await getDataHygiene(stubClient([]));

  ok(empty.unavailable === true,
    "an empty order book is reported as unavailable, not as clean",
    `unavailable=${empty.unavailable}, findings=${empty.findings.length}, `
    + `clean=${empty.clean.length} — RLS filters rows rather than raising, so this is `
    + "the shape a reader without the grants actually sees, and it renders as a "
    + "clean bill of health issued to somebody who could not read a single order");

  ok(empty.unavailableReason === "denied",
    "the empty read names the permissions fault rather than an outage",
    `read "${empty.unavailableReason}" — "failed" would send an exec to check the `
    + "database when the answer is that this session cannot see the rows");

  ok(empty.clean.length === 0 && empty.findings.length === 0,
    "an unavailable report names no probe as clean",
    `clean=[${empty.clean.join(", ")}] — a named clean probe is positive evidence `
    + "that a check ran and passed, which is precisely what did not happen");
}

console.log(failures === 0
  ? "\nHYGIENE CLAIMS ARE EARNED: identity verdicts match their evidence, no defect is double-reported, no headline understates"
  : `\n${failures} claim check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;

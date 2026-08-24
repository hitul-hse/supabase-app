/**
 * Import masterdata responsibility (responsible + Vertretung) into
 * public.project_responsibility.
 *
 * Dry run by default; --apply writes, in ONE transaction, rolled back on any
 * error.
 *
 * WHY THIS IS A SEPARATE IMPORTER. reconcile-masterdata.mjs is read-only by
 * charter and reports contract hours/periods. This writes exactly one fact --
 * who owns a customer and who covers for them -- which no table held before.
 *
 * MATCHING. Identical to reconcile-masterdata.mjs and therefore to ADR-001:
 * an order reaches a project only by EXACT normalised name, 1:1. Ambiguous
 * (>1 hit) and unmatched rows are REPORTED, never guessed at and never
 * silently dropped. Same for person names that do not resolve to a
 * public.people row.
 *
 * Usage:
 *   node scripts/import-project-responsibility.mjs            # dry run
 *   node scripts/import-project-responsibility.mjs --apply    # write
 *   node scripts/import-project-responsibility.mjs --json     # machine report
 */
import { writeFileSync } from "node:fs";
import {
  connect,
  readOrders,
  splitPeople,
  norm,
} from "./report-masterdata-responsibility.mjs";

const APPLY = process.argv.includes("--apply");
const JSON_OUT = process.argv.includes("--json");

const client = await connect();
let transactionOpen = false;

try {
  /* ---------------------------------------------------------------- inputs */
  const orders = readOrders();
  const people = (await client.query(`select id, name, source from public.people`)).rows;
  const projects = (await client.query(`select id, name from public.projects`)).rows;

  /* ------------------------------------------------------- resolve people */
  // 'md-mathias' is the id the masterdata importer assigns, and the workbook
  // writes the same first name. Try the id form first, then the full name,
  // then the first name -- all exact after normalisation. No fuzz.
  const byId = new Map(people.map((p) => [p.id, p]));
  const byNorm = new Map();
  for (const p of people) {
    for (const k of [
      norm(p.name),
      norm(String(p.id).replace(/^md-/, "")),
      norm(String(p.name).split(/\s+/)[0]),
    ]) {
      if (k && !byNorm.has(k)) byNorm.set(k, p);
    }
  }
  const resolvePerson = (name) =>
    byId.get(`md-${norm(name)}`) ?? byNorm.get(norm(name)) ?? null;

  /* ----------------------------------------------------- resolve projects */
  const projByName = new Map();
  for (const p of projects) {
    const k = norm(p.name);
    if (!projByName.has(k)) projByName.set(k, []);
    projByName.get(k).push(p);
  }

  /* ------------------------------------------------------------- planning */
  const rows = [];          // what we would insert
  const seen = new Set();   // dedupe on the table's own unique key
  const unmatchedOrders = []; // order -> no/ambiguous project
  const unresolvedNames = []; // person name -> no people row
  const emptyOrders = [];     // order names nobody at all

  for (const o of orders) {
    const hits = o.orderName ? (projByName.get(norm(o.orderName)) ?? []) : [];
    if (hits.length !== 1) {
      unmatchedOrders.push({
        orderNo: o.orderNo,
        orderName: o.orderName,
        customer: o.customer,
        sheet: o.sheet,
        reason: hits.length > 1 ? "ambiguous" : "no_match",
        candidates: hits.map((p) => p.id),
        responsible: o.responsible,
        replacement: o.replacement,
      });
      continue;
    }
    const project = hits[0];

    let any = false;
    for (const [role, cell] of [
      ["responsible", o.responsible],
      ["replacement", o.replacement],
    ]) {
      for (const name of splitPeople(cell)) {
        any = true;
        const person = resolvePerson(name);
        if (!person) {
          unresolvedNames.push({
            name,
            role,
            orderNo: o.orderNo,
            projectId: project.id,
            projectName: project.name,
          });
          continue;
        }
        const key = `${project.id}|${person.id}|${role}`;
        if (seen.has(key)) continue; // the same person twice in one cell
        seen.add(key);
        rows.push({
          project_id: project.id,
          person_id: person.id,
          role,
          source: "masterdata",
          order_no: o.orderNo,
          _projectName: project.name,
          _personName: person.name,
        });
      }
    }
    if (!any) {
      emptyOrders.push({ orderNo: o.orderNo, orderName: o.orderName, sheet: o.sheet });
    }
  }

  /* --------------------------------------------------------------- report */
  const perPerson = new Map();
  for (const r of rows) {
    const k = `${r.person_id}|${r.role}`;
    perPerson.set(k, (perPerson.get(k) ?? 0) + 1);
  }

  console.log(`=== PLAN (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`  excel orders parsed:            ${orders.length}`);
  console.log(`  orders matched 1:1 to a project: ${orders.length - unmatchedOrders.length}`);
  console.log(`  rows to write:                  ${rows.length}`);
  console.log(`    responsible: ${rows.filter((r) => r.role === "responsible").length}`);
  console.log(`    replacement: ${rows.filter((r) => r.role === "replacement").length}`);
  console.log(`  distinct projects covered:      ${new Set(rows.map((r) => r.project_id)).size}`);

  console.log(`\n  per person (project count, from matched orders only):`);
  for (const [k, n] of [...perPerson.entries()].sort((a, b) => b[1] - a[1])) {
    const [pid, role] = k.split("|");
    console.log(`    ${String(n).padStart(4)}  ${pid.padEnd(14)} ${role}`);
  }

  console.log(`\n  NOT WRITTEN, reported (never silently dropped):`);
  console.log(`    orders with no/ambiguous project match: ${unmatchedOrders.length}`);
  for (const u of unmatchedOrders) {
    console.log(
      `      ${u.reason.padEnd(9)} ${u.orderNo}  ${(u.orderName || u.customer).slice(0, 46).padEnd(46)}` +
        ` resp=${u.responsible || "-"} repl=${u.replacement || "-"}`,
    );
  }
  console.log(`    person names not resolving to public.people: ${unresolvedNames.length}`);
  for (const u of unresolvedNames) console.log(`      ${u.role} "${u.name}" on ${u.orderNo}`);
  console.log(`    matched orders naming nobody at all: ${emptyOrders.length}`);
  for (const u of emptyOrders.slice(0, 12)) console.log(`      ${u.orderNo}  ${u.orderName.slice(0, 56)}`);
  if (emptyOrders.length > 12) console.log(`      ... and ${emptyOrders.length - 12} more`);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    excelOrders: orders.length,
    plannedRows: rows.length,
    responsibleRows: rows.filter((r) => r.role === "responsible").length,
    replacementRows: rows.filter((r) => r.role === "replacement").length,
    perPerson: Object.fromEntries(perPerson),
    unmatchedOrders,
    unresolvedNames,
    ordersNamingNobody: emptyOrders,
  };
  writeFileSync(
    ".context-bridge/masterdata-responsibility-import.json",
    JSON.stringify(report, null, 2),
  );

  if (!APPLY) {
    console.log(`\nDRY RUN: nothing written. Re-run with --apply to write.`);
    console.log(`report: .context-bridge/masterdata-responsibility-import.json`);
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    await client.end();
    process.exit(0);
  }

  /* ---------------------------------------------------------------- write */
  const exists = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'project_responsibility'`,
  );
  if (!exists.rowCount) {
    throw new Error(
      "public.project_responsibility does not exist. Apply " +
        "supabase/migrations/20260824160000_create_project_responsibility.sql first.",
    );
  }

  await client.query("begin");
  transactionOpen = true;

  const chunkSize = 200;
  let written = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params = [];
    const values = chunk.map((r, i) => {
      const o = i * 5;
      params.push(r.project_id, r.person_id, r.role, r.source, r.order_no);
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
    });
    // The unique key is the idempotency guarantee: re-running refreshes
    // provenance instead of duplicating the fact.
    const res = await client.query(
      `insert into public.project_responsibility (project_id, person_id, role, source, order_no)
       values ${values.join(", ")}
       on conflict (project_id, person_id, role)
       do update set source = excluded.source, order_no = excluded.order_no`,
      params,
    );
    written += res.rowCount;
  }

  const verify = await client.query(
    `select role, count(*)::int as n from public.project_responsibility group by role order by role`,
  );
  const total = await client.query(
    `select count(*)::int as n from public.project_responsibility`,
  );
  if (Number(total.rows[0].n) < rows.length) {
    throw new Error(
      `Verification failed: table holds ${total.rows[0].n} rows, expected at least ${rows.length}`,
    );
  }

  await client.query("commit");
  transactionOpen = false;

  console.log(`\n=== APPLIED ===`);
  console.log(`  rows upserted:      ${written}`);
  console.log(`  table now holds:    ${total.rows[0].n}`);
  for (const r of verify.rows) console.log(`    ${r.role}: ${r.n}`);
  console.log(`report: .context-bridge/masterdata-responsibility-import.json`);
} catch (error) {
  if (transactionOpen) await client.query("rollback").catch(() => {});
  console.error(`Responsibility import rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

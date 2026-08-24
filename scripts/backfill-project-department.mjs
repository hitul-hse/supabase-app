/**
 * Backfill public.projects.department, so the dept_head arm of RLS can fire.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * can_view_project() reads:
 *
 *   (app_user_role() = 'dept_head' and pr.department = app_user_department())
 *   or pr.owner_person_id = app_user_person_id()
 *   or exists (assignment for app_user_person_id())
 *
 * projects.department was NULL for all 231 rows, and `NULL = anything` is NULL,
 * never true. So that first arm could never fire and every department head
 * silently degraded to an ordinary employee seeing only their own work. It is
 * not an error, it is an absence: the app renders, the lists are just short.
 *
 * ── Where a department may legitimately come from ────────────────────────────
 *
 * Four candidates were investigated against the live data, not assumed:
 *
 *  A. people.department of the owner.  REJECTED. Only 9 of 231 projects resolve
 *     (people.department is NULL for the 9 masterdata consultants who own
 *     almost everything). It would populate 4% and mislabel nothing, but it is
 *     strictly worse than B and reads a different column than RLS compares.
 *
 *  B. app_user_profile.department of the owner.  CHOSEN as primary. This is the
 *     SAME COLUMN app_user_department() reads, so the comparison is guaranteed
 *     value-consistent by construction: no risk of writing 'Operations' where
 *     RLS expects 'OPERATIONS'. Resolves 176 of 231.
 *
 *  C. app_user_profile.department of the masterdata 'responsible'.  CHOSEN as
 *     the second tier, and it is also B's corroboration. Where both exist they
 *     agree on 148 projects and CONFLICT ON ZERO. Two independently-sourced
 *     facts (portal ownership, and a spreadsheet maintained by sales) agreeing
 *     148/148 is the strongest evidence available that this derivation reflects
 *     reality rather than an artefact. C adds no projects B misses here, but it
 *     is kept because it is the arm that survives if ownership is later
 *     reassigned. No project has two responsibles in different departments.
 *
 *  D. Service type (contract_type / the order-number service segment).
 *     REJECTED AS A DEFAULT, available behind --infer-from-service. Each
 *     contract_type does map to exactly one department in the observed data
 *     (Betriebsarzt->ORGA, everything else->OPERATIONS, 0 contract_types
 *     spanning two departments), which is tempting. But that mapping is
 *     DERIVED from the owner departments in B, so using it as independent
 *     evidence would be circular: it would launder an aggregate guess into a
 *     per-project fact. The 55 projects it would fill have NO owner and NO
 *     responsible, so for them the service type is the only signal there is,
 *     and a project's department would rest on nothing but "projects like this
 *     usually belong to X". That is exactly the invention this script refuses
 *     to make by default.
 *
 * ── What is deliberately left NULL ──────────────────────────────────────────
 *
 * 55 projects. Every one has owner_person_id IS NULL and no masterdata
 * responsible: there is no person anywhere in the data to inherit a department
 * from. They stay NULL and are reported. A partially-populated column that is
 * correct beats a fully-populated one that is wrong; leaving them NULL keeps
 * them VISIBLE as a data gap instead of burying them under a plausible guess.
 * Their real fix is assigning an owner, which is a human decision.
 *
 * Note this backfill does NOT widen anyone's access incorrectly: it can only
 * enable the dept_head arm. It grants a dept_head sight of their own
 * department's projects, which is precisely the designed intent.
 *
 * Usage:
 *   node scripts/backfill-project-department.mjs                      # dry run
 *   node scripts/backfill-project-department.mjs --apply              # write
 *   node scripts/backfill-project-department.mjs --infer-from-service # + tier D
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const INFER_SERVICE = process.argv.includes("--infer-from-service");

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local — this script observes the live project only.");
  process.exit(0);
}
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.log("SKIP: SUPABASE_DB_URL not set.");
  process.exit(0);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

let transactionOpen = false;
try {
  /* ------------------------------------------------------------------------
   * 1. The vocabulary. Report it FIRST, because the value written must be
   *    byte-identical to what app_user_department() returns or the comparison
   *    silently fails again in a new way.
   * ---------------------------------------------------------------------- */
  const profileDepts = (
    await client.query(`
      select department, count(*)::int n,
             count(*) filter (where role_key = 'dept_head')::int heads
        from public.app_user_profile where is_active
       group by 1 order by department nulls last`)
  ).rows;
  const peopleDepts = (
    await client.query(`
      select department, count(*)::int n, count(*) filter (where is_active)::int active
        from public.people group by 1 order by department nulls last`)
  ).rows;

  console.log("=== DEPARTMENT VOCABULARY (the values RLS compares against) ===");
  console.log("  public.app_user_profile.department  <- app_user_department() reads THIS");
  for (const d of profileDepts) {
    console.log(
      `    ${String(d.department ?? "<NULL>").padEnd(12)} ${String(d.n).padStart(3)} profiles` +
        `${d.heads ? `, ${d.heads} dept_head` : ""}`,
    );
  }
  console.log("  public.people.department (informational; NOT what RLS reads)");
  for (const d of peopleDepts) {
    console.log(
      `    ${String(d.department ?? "<NULL>").padEnd(12)} ${String(d.n).padStart(3)} rows, ${d.active} active`,
    );
  }

  const validDepts = new Set(profileDepts.filter((d) => d.department).map((d) => d.department));
  console.log(`  => writable vocabulary: ${[...validDepts].sort().join(", ")}`);

  /* ------------------------------------------------------------------------
   * 2. The derivation. Tier B, then tier C, then optionally tier D.
   *    Computed in SQL so the rule is auditable as one expression.
   * ---------------------------------------------------------------------- */
  const derivation = `
    select
      p.id,
      p.contract_type,
      p.owner_person_id,
      p.department as current_department,
      (select a.department from public.app_user_profile a
        where a.person_id = p.owner_person_id and a.is_active
          and a.department is not null limit 1)                     as owner_dept,
      (select min(a.department) from public.project_responsibility r
         join public.app_user_profile a
           on a.person_id = r.person_id and a.is_active
        where r.project_id = p.id and r.role = 'responsible'
          and a.department is not null)                             as responsible_dept,
      (select count(distinct a.department)::int from public.project_responsibility r
         join public.app_user_profile a
           on a.person_id = r.person_id and a.is_active
        where r.project_id = p.id and r.role = 'responsible'
          and a.department is not null)                             as responsible_dept_variants
    from public.projects p
    order by p.id`;
  const rows = (await client.query(derivation)).rows;

  // Tier D's lookup, built from the observed data and only usable if it is
  // unambiguous. If any contract_type spanned two departments the mapping is
  // unsound and is dropped entirely rather than resolved by majority vote.
  const serviceMap = new Map();
  const serviceConflict = new Set();
  for (const r of rows) {
    const d = r.owner_dept ?? r.responsible_dept;
    if (!d || !r.contract_type) continue;
    if (serviceMap.has(r.contract_type) && serviceMap.get(r.contract_type) !== d) {
      serviceConflict.add(r.contract_type);
    }
    serviceMap.set(r.contract_type, d);
  }
  for (const t of serviceConflict) serviceMap.delete(t);

  const plan = [];
  const leftNull = [];
  const conflicts = [];
  for (const r of rows) {
    if (r.responsible_dept_variants > 1) {
      // Two responsibles in different departments: genuinely ambiguous, so the
      // data does not support an answer. Report, never pick one.
      conflicts.push(r);
      leftNull.push({ ...r, why: "responsibles disagree on department" });
      continue;
    }
    let dept = r.owner_dept ?? r.responsible_dept ?? null;
    let tier = r.owner_dept ? "B owner profile" : r.responsible_dept ? "C responsible profile" : null;

    if (!dept && INFER_SERVICE && serviceMap.has(r.contract_type)) {
      dept = serviceMap.get(r.contract_type);
      tier = "D service type (inferred)";
    }
    if (!dept) {
      leftNull.push({
        ...r,
        why: r.owner_person_id ? "owner has no department" : "no owner and no responsible",
      });
      continue;
    }
    if (!validDepts.has(dept)) {
      // Refuse to write a value app_user_department() can never return.
      leftNull.push({ ...r, why: `derived '${dept}' is not in the profile vocabulary` });
      continue;
    }
    if (r.current_department === dept) continue; // already correct
    plan.push({ id: r.id, dept, tier, contract_type: r.contract_type });
  }

  /* ------------------------------------------------------------------------
   * 3. Corroboration: do the two independent sources ever disagree?
   * ---------------------------------------------------------------------- */
  const both = rows.filter((r) => r.owner_dept && r.responsible_dept);
  const agree = both.filter((r) => r.owner_dept === r.responsible_dept).length;

  console.log(`\n=== DERIVATION RULE ===`);
  console.log(`  1. owner's app_user_profile.department            (tier B, primary)`);
  console.log(`  2. else masterdata responsible's profile.department (tier C)`);
  console.log(
    `  3. else service type mapping                       (tier D, ${INFER_SERVICE ? "ENABLED via --infer-from-service" : "DISABLED by default"})`,
  );
  console.log(`  4. else LEAVE NULL and report`);
  console.log(`\n  corroboration: ${both.length} projects have BOTH an owner dept and a responsible dept`);
  console.log(`    they agree on ${agree}/${both.length}, conflict on ${both.length - agree}`);
  if (both.length && agree === both.length) {
    console.log(`    -> two independent sources, zero conflicts: the rule reflects reality.`);
  }
  console.log(`  service-type mapping observed (tier D, ${INFER_SERVICE ? "in use" : "not applied"}):`);
  for (const [t, d] of [...serviceMap].sort()) console.log(`    ${t.padEnd(20)} -> ${d}`);
  if (serviceConflict.size) {
    console.log(`    DROPPED as ambiguous: ${[...serviceConflict].join(", ")}`);
  }

  /* ------------------------------------------------------------------------
   * 4. The resulting distribution, BEFORE writing anything.
   * ---------------------------------------------------------------------- */
  const dist = new Map();
  for (const p of plan) dist.set(p.dept, (dist.get(p.dept) ?? 0) + 1);
  const byTier = new Map();
  for (const p of plan) byTier.set(p.tier, (byTier.get(p.tier) ?? 0) + 1);

  console.log(`\n=== RESULTING DISTRIBUTION (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`  projects total:        ${rows.length}`);
  console.log(`  would be populated:    ${plan.length}`);
  for (const [d, n] of [...dist].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d.padEnd(12)} ${String(n).padStart(4)}`);
  }
  console.log(`  by tier:`);
  for (const [t, n] of [...byTier].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(28)} ${String(n).padStart(4)}`);
  }
  console.log(`  LEFT NULL (reported, not invented): ${leftNull.length}`);
  const whyTally = new Map();
  for (const r of leftNull) whyTally.set(r.why, (whyTally.get(r.why) ?? 0) + 1);
  for (const [w, n] of [...whyTally].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${w}`);
  }
  const nullByType = new Map();
  for (const r of leftNull) nullByType.set(r.contract_type, (nullByType.get(r.contract_type) ?? 0) + 1);
  console.log(`    those NULLs by contract_type:`);
  for (const [t, n] of [...nullByType].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${t}`);
  }
  if (conflicts.length) {
    console.log(`  AMBIGUOUS (responsibles in different departments): ${conflicts.length}`);
    for (const r of conflicts) console.log(`    ${r.id}`);
  }

  // Which departments end up reachable by a dept_head? This is the whole point,
  // so state it plainly instead of leaving it to be inferred from the numbers.
  const heads = (
    await client.query(`
      select u.email, a.department, a.person_id
        from public.app_user_profile a join auth.users u on u.id = a.user_id
       where a.is_active and a.role_key = 'dept_head' order by u.email`)
  ).rows;
  console.log(`\n  effect on each dept_head:`);
  for (const h of heads) {
    const n = h.department ? (dist.get(h.department) ?? 0) : 0;
    const note = !h.department
      ? "profile has NO department -> arm still inert (fix the profile, not the projects)"
      : n === 0
        ? `no project resolves to ${h.department} -> still sees only personal work (truthful: that department owns no projects)`
        : `gains department-wide sight of ${n} projects`;
    console.log(`    ${h.email.padEnd(34)} ${String(h.department ?? "<NULL>").padEnd(12)} ${note}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    inferFromService: INFER_SERVICE,
    projectsTotal: rows.length,
    populated: plan.length,
    distribution: Object.fromEntries(dist),
    byTier: Object.fromEntries(byTier),
    leftNullCount: leftNull.length,
    leftNullReasons: Object.fromEntries(whyTally),
    leftNull: leftNull.map((r) => ({ id: r.id, contract_type: r.contract_type, why: r.why })),
    corroboration: { bothSources: both.length, agree, conflict: both.length - agree },
    serviceMapObserved: Object.fromEntries(serviceMap),
  };
  writeFileSync(
    ".context-bridge/project-department-backfill.json",
    JSON.stringify(report, null, 2),
  );

  if (!APPLY) {
    console.log(`\nDRY RUN: nothing written. Re-run with --apply to write.`);
    console.log(`report: .context-bridge/project-department-backfill.json`);
    await client.end();
    process.exit(0);
  }

  /* ------------------------------------------------------------------------
   * 5. Write, in one transaction, verifying before commit.
   * ---------------------------------------------------------------------- */
  await client.query("begin");
  transactionOpen = true;

  let written = 0;
  const chunk = 200;
  for (let i = 0; i < plan.length; i += chunk) {
    const slice = plan.slice(i, i + chunk);
    const res = await client.query(
      `update public.projects p
          set department = v.dept
         from (select * from unnest($1::text[], $2::text[]) as t(id, dept)) v
        where p.id = v.id`,
      [slice.map((s) => s.id), slice.map((s) => s.dept)],
    );
    written += res.rowCount;
  }

  // Guard: never write a value app_user_department() cannot return, or RLS
  // fails silently again in a new way.
  const bad = await client.query(
    `select count(*)::int n from public.projects p
      where p.department is not null
        and not exists (select 1 from public.app_user_profile a
                         where a.department = p.department and a.is_active)`,
  );
  if (bad.rows[0].n > 0) {
    throw new Error(
      `${bad.rows[0].n} projects carry a department no active profile has; RLS could never match it.`,
    );
  }

  const after = (
    await client.query(
      `select coalesce(department,'<NULL>') d, count(*)::int n
         from public.projects group by 1 order by 2 desc`,
    )
  ).rows;

  await client.query("commit");
  transactionOpen = false;

  console.log(`\n=== APPLIED ===`);
  console.log(`  rows updated: ${written}`);
  console.log(`  projects.department now:`);
  for (const r of after) console.log(`    ${r.d.padEnd(12)} ${String(r.n).padStart(4)}`);
  console.log(`report: .context-bridge/project-department-backfill.json`);
} catch (error) {
  if (transactionOpen) await client.query("rollback").catch(() => {});
  console.error(`Backfill rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

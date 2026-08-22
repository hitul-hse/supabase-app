/**
 * Deep-verify the applied migrations by exercising BEHAVIOUR, not just
 * existence. Existence checks prove the DDL ran; these prove it works.
 *
 * Everything here writes to real production, so every write is undone in the
 * same run and the script asserts the cleanup succeeded. The rows use a
 * far-future window (2099) so that even a failure mid-run cannot collide with
 * a real contract or be mistaken for one.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const timeDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "time" }, auth: { persistSession: false } },
);

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

// A real project to test against: the user's own.
const { data: proj } = await timeDb
  .from("project")
  .select("id, name, estimated_hours")
  .ilike("name", "%WorkMotion%25/26 GU%")
  .order("id")
  .maybeSingle();
if (!proj) {
  console.log("could not find the WorkMotion GU project; aborting without writing");
  process.exit(1);
}
console.log(`testing against: ${proj.name} (id ${proj.id})\n`);

const created = [];
const cleanup = async () => {
  for (const id of created) {
    await timeDb.from("project_contract_period").delete().eq("id", id);
  }
};

try {
  /* ------------------------------------------------ a period can be created */

  const { data: p1, error: e1 } = await timeDb
    .from("project_contract_period")
    .insert({
      project_id: proj.id,
      period_no: 9001,
      budget_hours: 10,
      starts_on: "2099-01-01",
      ends_on: "2099-06-30",
      warn_at_percent: 80,
      contract_reference: "VERIFY-PROBE",
      notes: "automated verification, deleted immediately",
    })
    .select("id")
    .single();
  check("a contract period can be created", !e1, e1?.message?.slice(0, 90) ?? "");
  if (p1) created.push(p1.id);

  /* ------------------------- THE RULE THE WHOLE MODEL RESTS ON: no overlap */

  const { error: e2 } = await timeDb.from("project_contract_period").insert({
    project_id: proj.id,
    period_no: 9002,
    budget_hours: 10,
    // Deliberately overlaps p1 by one day.
    starts_on: "2099-06-30",
    ends_on: "2099-12-31",
  });
  check(
    "an OVERLAPPING period is rejected on the live database",
    Boolean(e2),
    e2 ? e2.message.slice(0, 100) : "ACCEPTED — two budgets could claim one date",
  );
  check(
    "the rejection carries the explanatory hint the UI shows",
    Boolean(e2) && /overlap|End the previous period/i.test(`${e2.message} ${e2.hint ?? ""}`),
    e2?.hint?.slice(0, 90) ?? e2?.message?.slice(0, 90) ?? "",
  );

  /* ------------------------------------------- an ADJACENT period is fine */

  const { data: p2, error: e3 } = await timeDb
    .from("project_contract_period")
    .insert({
      project_id: proj.id,
      period_no: 9002,
      budget_hours: 12,
      starts_on: "2099-07-01", // the day after p1 ends
      ends_on: "2099-12-31",
      renewed_from_id: p1?.id ?? null,
    })
    .select("id")
    .single();
  check("an ADJACENT, non-overlapping period IS allowed", !e3, e3?.message?.slice(0, 90) ?? "");
  if (p2) created.push(p2.id);

  /* --------------------------------------- constraints reject bad contracts */

  const bad = async (label, row, expectRejected = true) => {
    const { error, data } = await timeDb
      .from("project_contract_period")
      .insert({ project_id: proj.id, ...row })
      .select("id")
      .maybeSingle();
    if (data?.id) created.push(data.id);
    check(label, expectRejected ? Boolean(error) : !error, error?.message?.slice(0, 80) ?? "accepted");
  };
  await bad("a zero budget is rejected", {
    period_no: 9010, budget_hours: 0, starts_on: "2098-01-01", ends_on: "2098-12-31",
  });
  await bad("an end date before the start is rejected", {
    period_no: 9011, budget_hours: 5, starts_on: "2098-12-31", ends_on: "2098-01-01",
  });
  await bad("a warn threshold above 100 is rejected", {
    period_no: 9012, budget_hours: 5, starts_on: "2097-01-01", ends_on: "2097-12-31",
    warn_at_percent: 150,
  });

  /* ---------------------------------- the status view computes what it claims */

  const { data: status } = await timeDb
    .from("contract_period_status")
    .select("period_no, budget_hours, logged_hours, burn_percent, remaining_hours, is_current, days_remaining")
    .eq("project_id", proj.id)
    .in("period_no", [9001, 9002])
    .order("period_no");

  check(
    "the status view returns both probe periods",
    (status ?? []).length === 2,
    `${(status ?? []).length} row(s)`,
  );
  const s1 = (status ?? []).find((r) => r.period_no === 9001);
  if (s1) {
    check(
      "a future period correctly shows zero logged hours",
      Number(s1.logged_hours) === 0,
      `logged=${s1.logged_hours}h of ${s1.budget_hours}h`,
    );
    check(
      "remaining hours equals the full budget when nothing is logged",
      Number(s1.remaining_hours) === Number(s1.budget_hours),
      `remaining=${s1.remaining_hours}h`,
    );
    check(
      "a 2099 period is not marked current",
      s1.is_current === false,
      `is_current=${s1.is_current}, days_remaining=${s1.days_remaining}`,
    );
  }

  /*
   * THE RENEWAL ISOLATION PROPERTY, on live data. The real hours on this
   * project must NOT leak into a 2099 window. If they did, renewal would be
   * meaningless -- which is the whole reason hours are scoped by date.
   */
  const { data: realTotal } = await timeDb
    .from("entry")
    .select("duration_seconds")
    .eq("project_id", proj.id)
    .not("duration_seconds", "is", null)
    .order("id");
  const realHours =
    (realTotal ?? []).reduce((s, e) => s + (Number(e.duration_seconds) || 0), 0) / 3600;
  check(
    "the project's real hours do NOT leak into an unrelated period window",
    Number(s1?.logged_hours ?? 0) === 0 && realHours > 0,
    `${realHours.toFixed(1)}h exist on the project, 0h attributed to the 2099 window`,
  );
} finally {
  await cleanup();
}

/* ------------------------------------------------------------ cleanup proof */

const { data: leftover } = await timeDb
  .from("project_contract_period")
  .select("id, period_no")
  .eq("project_id", proj.id)
  .gte("period_no", 9000)
  .order("period_no");
check(
  "every probe row was removed from production",
  (leftover ?? []).length === 0,
  (leftover ?? []).length ? `LEFTOVER: ${(leftover ?? []).map((r) => r.period_no).join(", ")}` : "clean",
);

const { data: anyReal } = await timeDb
  .from("project_contract_period")
  .select("id")
  .order("id");
console.log(`\n${(anyReal ?? []).length} contract period(s) now recorded in production.`);

console.log(
  failed === 0
    ? "\nLIVE BEHAVIOUR VERIFIED: periods create, overlaps are refused, constraints hold,\n" +
        "the status view computes correctly, and hours stay scoped to their own period."
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);

"use server";

/**
 * Contract period writes: record the terms sales agreed, and renew them.
 *
 * THE MODEL, because it drives every decision below. A contract period is
 * immutable history once hours are booked against it. Renewing does not edit
 * the current period -- it INSERTS the next one, leaving the previous budget
 * and its booked hours exactly where they are. That is the whole point: a
 * renewed contract must not erase what the last one cost.
 *
 * WHY EVERY ACTION RE-CHECKS PERMISSION. A Server Action is a public HTTP
 * endpoint. Rendering a form conditionally hides a button; it does not stop
 * anybody POSTing to the action directly. So authorisation is asked of the
 * DATABASE on every call (app_user_has_permission), never inferred from what
 * the page happened to render, and never taken from the form.
 *
 * WHY THE PERMISSION IS ASKED RATHER THAN THE ROLE. Roles change and get
 * added -- 'hr' arrived after this pattern was set. Asking for the capability
 * means a new role that legitimately needs it works without editing this file,
 * and a role that loses it stops working immediately.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type ContractActionResult = { ok: boolean; message?: string };

const WRITE_KEY = "projects:contracts:write";

const DENIED =
  "Your role does not permit changing contract terms. Contract budgets are commercial " +
  "terms, so they are limited to executives and department heads.";

type Authorised = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  callerId: string;
};
type Refused = { ok: false; result: ContractActionResult };

async function authorise(): Promise<Authorised | Refused> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, result: { ok: false, message: "You are not signed in." } };

  const { data: allowed } = await supabase.rpc("app_user_has_permission", { p_key: WRITE_KEY });
  if (allowed !== true) return { ok: false, result: { ok: false, message: DENIED } };

  return { ok: true, supabase, callerId: user.id };
}

/** A trimmed string, or null when blank. */
function text(raw: FormDataEntryValue | null): string | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

/** A positive number of hours, or null when absent/invalid. */
function hours(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  // Accept a comma decimal: the business writes German numbers.
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** An ISO date (yyyy-mm-dd), or null when absent/invalid. */
function isoDate(raw: FormDataEntryValue | null): string | null {
  const s = text(raw);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Reject impossible dates (2026-02-31) rather than letting Postgres roll them.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

function positiveId(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** A warning threshold in 1..100, or null to inherit the default. */
function percent(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/**
 * Turn a Postgres error into something a human can act on.
 *
 * 23P01 is the overlap rejection. It is raised by a trigger carrying a HINT
 * explaining what to do, so that hint is preferred over inventing wording here
 * -- the database is the thing that knows which period collided.
 */
function explain(error: { code?: string; message: string; hint?: string | null }): string {
  if (error.code === "23P01") {
    return (
      (error.hint ??
        "That date range overlaps a contract period that already exists on this project.") +
      " Each date can belong to only one contract period, otherwise the budget guard cannot " +
      "tell which budget applies."
    );
  }
  if (error.code === "23514") {
    return "Those values are not a valid contract: check that the budget is above zero and the end date is not before the start date.";
  }
  if (error.code === "42501") {
    return DENIED;
  }
  if (error.code === "23505") {
    return "A contract period with that number already exists on this project. Reload the page and try again.";
  }
  return error.message;
}

function revalidateContracts(projectId: number): void {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  // The tracker's refusal messages quote the contract, so its cache is stale too.
  revalidatePath("/time");
}

/* -------------------------------------------------------- set initial terms */

/**
 * Record the FIRST contract period for a project.
 *
 * Separate from renewal because the two are different events: this one has no
 * predecessor to link to, and getting it wrong (a typo in the first budget) is
 * a correction rather than a renewal. Keeping them apart means the renewal path
 * can always assume a previous period exists.
 */
export async function setContractTerms(formData: FormData): Promise<ContractActionResult> {
  const auth = await authorise();
  if (!auth.ok) return auth.result;

  const projectId = positiveId(formData.get("project_id"));
  const budgetHours = hours(formData.get("budget_hours"));
  const startsOn = isoDate(formData.get("starts_on"));
  const endsOn = isoDate(formData.get("ends_on"));

  if (projectId === null) return { ok: false, message: "Missing project." };
  if (budgetHours === null) {
    return { ok: false, message: "Enter the agreed budget in hours, above zero." };
  }
  if (startsOn === null || endsOn === null) {
    return { ok: false, message: "Enter both contract dates as yyyy-mm-dd." };
  }
  if (endsOn < startsOn) {
    return { ok: false, message: "The contract cannot end before it starts." };
  }

  const { supabase, callerId } = auth;

  /*
   * period_no is computed here rather than defaulted in the database because
   * the numbers are per project, not global. Read-then-write races are handled
   * by the unique (project_id, period_no) constraint, which turns a collision
   * into 23505 and a "reload and try again" message rather than two periods
   * both claiming to be the first.
   */
  const { data: existing } = await supabase
    .schema("time")
    .from("project_contract_period")
    .select("period_no")
    .eq("project_id", projectId)
    .order("period_no", { ascending: false })
    .limit(1);

  const nextNo = Number(existing?.[0]?.period_no ?? 0) + 1;

  const { error } = await supabase
    .schema("time")
    .from("project_contract_period")
    .insert({
      project_id: projectId,
      period_no: nextNo,
      budget_hours: budgetHours,
      starts_on: startsOn,
      ends_on: endsOn,
      warn_at_percent: percent(formData.get("warn_at_percent")) ?? 80,
      contract_reference: text(formData.get("contract_reference")),
      notes: text(formData.get("notes")),
      // Recording terms IS the confirmation that sales agreed them, so the
      // audit fields are set here rather than left for a second step nobody
      // would remember to take.
      confirmed_by: callerId,
      confirmed_at: new Date().toISOString(),
      created_by: callerId,
    });

  if (error) return { ok: false, message: explain(error) };

  revalidateContracts(projectId);
  return {
    ok: true,
    message: `Contract period ${nextNo} recorded: ${budgetHours}h from ${startsOn} to ${endsOn}.`,
  };
}

/* -------------------------------------------------------------- renew terms */

/**
 * Renew: start a new period once sales confirm the terms.
 *
 * Goes through the database function rather than inserting here, because a
 * renewal has to pick the next period number, link the chain and reject an
 * overlap as ONE atomic step. Doing that in application code invites two
 * concurrent renewals both reading "the last period is 2" and both inserting a
 * period 3.
 */
export async function renewContract(formData: FormData): Promise<ContractActionResult> {
  const auth = await authorise();
  if (!auth.ok) return auth.result;

  const projectId = positiveId(formData.get("project_id"));
  const budgetHours = hours(formData.get("budget_hours"));
  const startsOn = isoDate(formData.get("starts_on"));
  const endsOn = isoDate(formData.get("ends_on"));

  if (projectId === null) return { ok: false, message: "Missing project." };
  if (budgetHours === null) {
    return { ok: false, message: "Enter the renewed budget in hours, above zero." };
  }
  if (startsOn === null || endsOn === null) {
    return { ok: false, message: "Enter both contract dates as yyyy-mm-dd." };
  }
  if (endsOn < startsOn) {
    return { ok: false, message: "The contract cannot end before it starts." };
  }

  const { supabase } = auth;
  const { data, error } = await supabase.schema("time").rpc("renew_contract_period", {
    p_project_id: projectId,
    p_budget_hours: budgetHours,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_contract_reference: text(formData.get("contract_reference")),
    p_warn_at_percent: percent(formData.get("warn_at_percent")),
    p_notes: text(formData.get("notes")),
  });

  if (error) return { ok: false, message: explain(error) };

  const periodNo = Array.isArray(data) ? data[0]?.period_no : data?.period_no;
  revalidateContracts(projectId);
  return {
    ok: true,
    message:
      `Renewed as contract period ${periodNo ?? "next"}: ${budgetHours}h from ${startsOn} to ${endsOn}. ` +
      "The previous period keeps its own budget and the hours booked against it.",
  };
}

/* ------------------------------------------------------------- correct terms */

/**
 * Fix a mistake in an existing period.
 *
 * Deliberately NOT a way to "reset" a contract: the budget and dates can be
 * corrected, but the period keeps its identity and its booked hours. Reducing a
 * budget below what is already logged is allowed on purpose -- that is a real
 * situation (the customer agreed less than we thought), and the guard will then
 * report it as already over, which is the truth rather than a hidden overrun.
 */
export async function correctContractPeriod(formData: FormData): Promise<ContractActionResult> {
  const auth = await authorise();
  if (!auth.ok) return auth.result;

  const periodId = positiveId(formData.get("period_id"));
  const projectId = positiveId(formData.get("project_id"));
  const budgetHours = hours(formData.get("budget_hours"));
  const startsOn = isoDate(formData.get("starts_on"));
  const endsOn = isoDate(formData.get("ends_on"));

  if (periodId === null || projectId === null) {
    return { ok: false, message: "Missing contract period." };
  }
  if (budgetHours === null) {
    return { ok: false, message: "Enter the agreed budget in hours, above zero." };
  }
  if (startsOn === null || endsOn === null) {
    return { ok: false, message: "Enter both contract dates as yyyy-mm-dd." };
  }
  if (endsOn < startsOn) {
    return { ok: false, message: "The contract cannot end before it starts." };
  }

  const { supabase } = auth;
  const patch: Record<string, unknown> = {
    budget_hours: budgetHours,
    starts_on: startsOn,
    ends_on: endsOn,
    contract_reference: text(formData.get("contract_reference")),
    notes: text(formData.get("notes")),
  };
  const warn = percent(formData.get("warn_at_percent"));
  if (warn !== null) patch.warn_at_percent = warn;

  const { error } = await supabase
    .schema("time")
    .from("project_contract_period")
    .update(patch)
    // Scoped by project as well as id: a mismatched pair is a bug or a probe,
    // and either way it must not write.
    .eq("id", periodId)
    .eq("project_id", projectId);

  if (error) return { ok: false, message: explain(error) };

  revalidateContracts(projectId);
  return { ok: true, message: "Contract period updated." };
}

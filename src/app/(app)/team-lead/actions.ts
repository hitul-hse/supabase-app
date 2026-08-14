"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type ApprovalResult = { ok: boolean; message?: string };

/**
 * Both actions report failures back to the caller instead of swallowing them.
 * RLS denies these updates for anyone who isn't exec/dept_head, and that
 * denial used to surface as a successful-looking no-op because the error was
 * never checked and revalidatePath ran unconditionally.
 */
export async function approveDecision(id: string): Promise<ApprovalResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("approval_decisions")
    .update({ status: "approved" }, { count: "exact" })
    .eq("id", id);

  if (error) {
    console.error("approveDecision failed:", error);
    return { ok: false, message: error.message };
  }

  if (!count) {
    return { ok: false, message: "That approval is no longer pending, or you can't change it." };
  }

  revalidatePath("/team-lead");
  return { ok: true };
}

export async function approveAllPending(): Promise<ApprovalResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("approval_decisions")
    .update({ status: "approved" }, { count: "exact" })
    .eq("status", "pending");

  if (error) {
    console.error("approveAllPending failed:", error);
    return { ok: false, message: error.message };
  }

  revalidatePath("/team-lead");
  return { ok: true, message: count ? `Approved ${count}.` : "Nothing was pending." };
}

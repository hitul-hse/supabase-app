"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type RequestLeaveState = { status: "idle" | "success" | "error"; message?: string };

export async function requestLeave(
  _prevState: RequestLeaveState,
  formData: FormData,
): Promise<RequestLeaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Not authenticated." };
  }

  // The caller's own person_id, not whatever the form claims -- RLS ("owner
  // can request their own leave") would reject a mismatch anyway, but this
  // gives a readable error instead of a bare permission-denied.
  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.person_id) {
    return { status: "error", message: "No person record is linked to your account." };
  }

  const startDate = String(formData.get("start_date") || "");
  const endDate = String(formData.get("end_date") || "");
  const days = Number(formData.get("days") || 0);
  const reason = String(formData.get("reason") || "").trim();

  if (!startDate || !endDate || !Number.isFinite(days) || days <= 0) {
    return { status: "error", message: "Start date, end date, and a positive number of days are required." };
  }

  const { error } = await supabase.from("leave_requests").insert({
    person_id: profile.person_id,
    start_date: startDate,
    end_date: endDate,
    days,
    reason: reason || null,
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/people");
  return { status: "success", message: "Leave request submitted." };
}

export async function cancelLeaveRequest(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const requestId = Number(formData.get("request_id"));
  if (!Number.isFinite(requestId)) return;

  await supabase.from("leave_requests").delete().eq("id", requestId);

  revalidatePath("/people");
}

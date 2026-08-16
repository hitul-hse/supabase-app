"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type SetBillableRateResult = { ok: boolean; message?: string };

/**
 * RLS ("exec can set billable rates") is what actually enforces that only
 * exec can do this -- the count check just turns a silent 0-row RLS denial
 * into a readable error instead of a false "success".
 */
export async function setBillableRate(formData: FormData): Promise<SetBillableRateResult> {
  const supabase = await createClient();
  const personId = String(formData.get("person_id") || "");
  const rate = Number(formData.get("billable_rate_eur"));

  if (!personId || !Number.isFinite(rate) || rate < 0) {
    return { ok: false, message: "Enter a valid, non-negative rate." };
  }

  const { error, count } = await supabase
    .from("people")
    .update({ billable_rate_eur: rate }, { count: "exact" })
    .eq("id", personId);

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!count) {
    return { ok: false, message: "You don't have permission to set billable rates." };
  }

  revalidatePath("/people");
  return { ok: true };
}

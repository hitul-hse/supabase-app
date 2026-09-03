"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";

export type SetBillableRateResult = { ok: boolean; message?: string };

/**
 * RLS ("exec can set billable rates") is what actually enforces that only
 * exec can do this -- the count check just turns a silent 0-row RLS denial
 * into a readable error instead of a false "success".
 */
export async function setBillableRate(formData: FormData): Promise<SetBillableRateResult> {
  // The panel renders whatever sentence it is handed, so a German reader has to
  // be handed German -- the pattern management/actions.ts established.
  const t = await getTranslations("people.actions.rate");
  const supabase = await createClient();
  const personId = String(formData.get("person_id") || "");
  const rate = Number(formData.get("billable_rate_eur"));

  if (!personId || !Number.isFinite(rate) || rate < 0) {
    return { ok: false, message: t("invalid") };
  }

  const { error, count } = await supabase
    .from("people")
    .update({ billable_rate_eur: rate }, { count: "exact" })
    .eq("id", personId);

  if (error) {
    // Postgres's own wording, in whatever language it speaks: translating a
    // vendor error would misquote it.
    return { ok: false, message: error.message };
  }
  if (!count) {
    return { ok: false, message: t("noPermission") };
  }

  revalidatePath("/people");
  return { ok: true };
}

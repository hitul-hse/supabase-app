"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export async function approveDecision(id: string) {
  const supabase = await createClient();
  await supabase.from("approval_decisions").update({ status: "approved" }).eq("id", id);
  revalidatePath("/team-lead");
}

export async function approveAllPending() {
  const supabase = await createClient();
  await supabase
    .from("approval_decisions")
    .update({ status: "approved" })
    .eq("status", "pending");
  revalidatePath("/team-lead");
}

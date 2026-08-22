"use server";

/**
 * Acknowledge a budget alert.
 *
 * WHY ACKNOWLEDGEMENT IS A WRITE AND NOT A DELETE. The alert list is a log, not
 * a queue that empties. Deleting handled alerts would destroy the record of an
 * overrun that somebody decided to accept, which is exactly the history worth
 * keeping. Acknowledging marks who took responsibility and when.
 *
 * It also has a functional role: the anti-spam index only permits one OPEN
 * alert per project/period/kind/threshold, so acknowledging is what allows a
 * recurrence to alert again. Handled-then-recurring is new information.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type AlertActionResult = { ok: boolean; message?: string };

const ACK_KEY = "projects:alerts:acknowledge";

export async function acknowledgeAlert(formData: FormData): Promise<AlertActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "You are not signed in." };

  /*
   * Re-checked server-side on every call. A Server Action is a public HTTP
   * endpoint, so the button being hidden proves nothing about the caller.
   */
  const { data: allowed } = await supabase.rpc("app_user_has_permission", { p_key: ACK_KEY });
  if (allowed !== true) {
    return {
      ok: false,
      message:
        "Your role does not permit acknowledging budget alerts. Acknowledging one means taking " +
        "responsibility for the overrun, so it is limited to executives and department heads.",
    };
  }

  const id = String(formData.get("alert_id") ?? "").trim();
  // A uuid, checked rather than trusted: this value goes into a filter.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Missing alert." };

  const note = String(formData.get("note") ?? "").trim();

  // Cast for the same reason as the read side: the table comes from a
  // migration and is not in the generated type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("overbooking_alert")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: user.id,
      acknowledged_note: note.length ? note : null,
    })
    .eq("id", id)
    // Only an OPEN alert can be acknowledged: without this, a second click
    // would overwrite who handled it first and when.
    .is("acknowledged_at", null);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/alerts");
  revalidatePath("/projects");
  return { ok: true, message: "Alert acknowledged." };
}

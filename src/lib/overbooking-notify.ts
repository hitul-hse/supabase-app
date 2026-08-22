/**
 * Overbooking notifications: record first, deliver second, never pretend.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE. There is no mail transport in this
 * project -- no Resend, Postmark, SES or SMTP dependency exists -- and
 * Supabase's built-in mailer is rate-limited PROJECT-WIDE. That limit is not
 * theoretical here: earlier in this codebase the "re-invite" feature reported
 * "Invite re-sent" while sending nothing, because generateLink does not queue
 * mail. So this module refuses to claim a send it cannot observe.
 *
 * THE ORDER MATTERS:
 *   1. Write the alert row (public.overbooking_alert). This always happens, and
 *      it is what makes the feature real: the sales team can read every refused
 *      booking in the app whether or not mail is configured.
 *   2. Attempt delivery IF a transport is configured, and write the outcome back
 *      onto the same row (notified true/false, delivery_error).
 *
 * A failure in either step must never block the refusal itself -- the booking is
 * already being rejected for a budget reason, and a mail outage is not a reason
 * to let it through, nor to show the user a mail error instead of the budget
 * one.
 *
 * TRANSPORT. Set RESEND_API_KEY (and optionally OVERBOOKING_ALERT_FROM) to turn
 * email on. Without it the row is still written and `notified` stays null,
 * meaning "never attempted" -- distinct from false, which means "tried and
 * failed". Recipients come from OVERBOOKING_ALERT_RECIPIENTS (comma-separated)
 * and fall back to the two addresses named for testing.
 */
import { createClient } from "@supabase/supabase-js";
import type { BudgetDecision } from "./budget-guard";

/**
 * Who hears about a refused booking.
 *
 * Defaults to the two addresses nominated for testing. Override in production
 * with OVERBOOKING_ALERT_RECIPIENTS="sales@…,ops@…" rather than editing code,
 * so the sales list is configuration and not a deploy.
 */
export function alertRecipients(): string[] {
  const configured = (process.env.OVERBOOKING_ALERT_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return ["hitul@hs-experts.com", "bjoern.schoenemann@hs-experts.com"];
}

export type AlertContext = {
  actorUserId: string | null;
  actorMemberId: number | null;
  actorName: string;
  projectId: number | null;
  projectName: string;
  decision: BudgetDecision;
  source: "create_entry" | "update_entry" | "start_timer" | "stop_timer";
};

/**
 * Record the refusal and try to tell the sales team.
 *
 * Returns nothing and throws nothing: the caller is in the middle of refusing a
 * write, and this is a side effect that must not change that outcome. Failures
 * are logged server-side and, where possible, persisted on the row itself.
 */
export async function notifyOverbooking(ctx: AlertContext): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Nothing to write to. Say so in the log rather than failing silently.
    console.error("[overbooking] no service credentials; alert not recorded");
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const recipients = alertRecipients();
  const d = ctx.decision;

  let alertId: string | null = null;
  try {
    const { data, error } = await admin
      .from("overbooking_alert")
      .insert({
        actor_user_id: ctx.actorUserId,
        actor_member_id: ctx.actorMemberId,
        actor_name: ctx.actorName,
        project_id: ctx.projectId,
        project_name: ctx.projectName,
        // The guard only refuses when a real budget exists, so this is non-null
        // on every row that reaches here; 0 is a defensive floor, not a claim.
        budget_hours: d.budgetHours ?? 0,
        logged_hours: d.loggedHours,
        requested_hours: d.requestedHours,
        projected_hours: d.projectedHours,
        over_by_hours: d.overByHours,
        // The level carries what alreadyOver used to, plus the states it could
        // not express (approaching, outside_contract). Kept as a boolean here
        // too so existing rows and readers of this column stay meaningful.
        already_over: d.level === "already_over",
        reason: d.reason,
        source: ctx.source,
        notify_recipients: recipients,
      })
      .select("id")
      .single();

    if (error) {
      // The most likely cause is the migration not being applied yet. Name it,
      // because a silent miss here would make the feature look like it works.
      console.error(
        `[overbooking] could not record alert (is add_overbooking_alerts.sql applied?): ${error.message}`,
      );
    } else {
      alertId = data?.id ?? null;
    }
  } catch (e) {
    console.error(`[overbooking] alert insert threw: ${(e as Error).message}`);
  }

  // ---- delivery, only if a transport is actually configured ----
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // notified stays null: "never attempted". The row is the notification.
    console.warn(
      `[overbooking] RESEND_API_KEY not set — alert recorded${alertId ? ` (${alertId})` : ""} but no email sent. ` +
        `Sales can read it in the app; set RESEND_API_KEY to enable mail.`,
    );
    return;
  }

  const from = process.env.OVERBOOKING_ALERT_FROM ?? "HSE Hub <onboarding@resend.dev>";
  const subject = `Overbooking blocked: ${ctx.projectName} (${d.overByHours}h over)`;
  const body = [
    `A time booking was refused because it would exceed the project budget.`,
    ``,
    `Project:    ${ctx.projectName}`,
    `Person:     ${ctx.actorName}`,
    `Budget:     ${d.budgetHours}h`,
    `Logged:     ${d.loggedHours}h`,
    `Attempted:  ${d.requestedHours}h`,
    `Would be:   ${d.projectedHours}h (${d.overByHours}h over${d.level === "already_over" ? ", project was ALREADY over" : ""})`,
    ``,
    d.reason,
    ``,
    `The booking was blocked, so these hours are NOT recorded. Either raise the`,
    `budget, re-scope the work, or have the time logged against another project.`,
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: recipients, subject, text: body }),
    });

    const ok = res.ok;
    const detail = ok ? null : `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (!ok) console.error(`[overbooking] email send failed: ${detail}`);

    if (alertId) {
      await admin
        .from("overbooking_alert")
        .update({
          notified: ok,
          notified_at: new Date().toISOString(),
          delivery_error: detail,
        })
        .eq("id", alertId);
    }
  } catch (e) {
    const detail = (e as Error).message.slice(0, 300);
    console.error(`[overbooking] email send threw: ${detail}`);
    if (alertId) {
      await admin
        .from("overbooking_alert")
        .update({ notified: false, notified_at: new Date().toISOString(), delivery_error: detail })
        .eq("id", alertId);
    }
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getSiteUrl } from "@/utils/site-url";
import { PERMISSIONS } from "@/lib/permissions";

export type InviteState = { status: "idle" | "success" | "error"; message?: string };

/**
 * Shared guard — re-checks server-side, never trusts the page gate alone.
 *
 * Asks for admin:users:write rather than comparing role_key to "exec". Only exec
 * holds that key today, so this changes nothing about who may act; what it
 * changes is that the "Manage User Accounts" toggle in /admin/roles now decides
 * the answer. Before, an administrator could grant that permission and the
 * grant reached no code — the toggle saved successfully and meant nothing.
 */
async function assertCanManageUsers(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: allowed } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.ADMIN_USERS_WRITE,
  });

  if (!allowed) return { error: "You do not have permission to manage user accounts." };
  return { userId: user.id };
}

/**
 * Does a role hold a permission?
 *
 * Asked of app_role_permission rather than hardcoding "exec", so if the
 * "Manage User Accounts" toggle is ever granted to another role this stays right.
 * Fails CLOSED: if the lookup errors we report that the role cannot manage users,
 * because the cost of a wrong "yes" is an administrator locked out of their own
 * console.
 */
async function roleHasPermission(roleKey: string, permissionKey: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_role_permission")
      .select("role_key")
      .eq("role_key", roleKey)
      .eq("permission_key", permissionKey)
      .maybeSingle();
    if (error) return false;
    return data !== null;
  } catch {
    return false;
  }
}

export async function inviteUser(
  _prevState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { status: "error", message: guard.error };

  const email = String(formData.get("email") || "").trim();
  const roleKey = String(formData.get("role_key") || "").trim();
  const department = String(formData.get("department") || "").trim();

  if (!email || !roleKey) {
    return { status: "error", message: "Email and role are required." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=%2Fauth%2Fset-password`,
  });

  if (inviteError || !invited.user) {
    return { status: "error", message: inviteError?.message ?? "Could not send invite." };
  }

  const { error: profileError } = await admin.from("app_user_profile").insert({
    user_id: invited.user.id,
    role_key: roleKey,
    // Deliberately not set. This used to carry the id of one of eight seeded
    // mockup people, chosen from a dropdown, which after the People rewire meant
    // linking a real colleague to a fictional one. The column stays in the schema
    // because app_user_person_id() gates timesheets and leave; it is simply no
    // longer populated from invented data.
    person_id: null,
    department: department || null,
  });

  if (profileError) {
    return {
      status: "error",
      message: `Invite sent, but saving the role failed: ${profileError.message}`,
    };
  }

  /**
   * Link the new account to its TrackingTime member, by email.
   *
   * This is the link that does the work: time.current_member_id() resolves
   *   where m.user_id = auth.uid() or (m.hub_person_id = app_user_person_id())
   * and checks user_id first, so setting it is what makes someone's own logged
   * hours visible on their Time page.
   *
   * Measured on live before writing this: all three Hub accounts on a real work
   * address already match a TrackingTime member on email exactly, and the only
   * unmatched accounts are throwaway test addresses. So email is the natural key
   * and the admin does not need to choose anything.
   *
   * A miss is NOT an error. Someone can legitimately have a Hub account with no
   * TrackingTime record -- an office manager who approves timesheets but logs
   * none -- so a failure to match must not undo a successful invite. It is
   * reported in the success message instead, because an admin who expected the
   * link deserves to know it did not happen.
   */
  let linkNote = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeAdmin = (admin as any).schema("time");
    const { data: member } = await timeAdmin
      .from("member")
      .select("id, display_name, user_id")
      // ilike, not eq: TrackingTime addresses are not case-normalised, and a
      // case mismatch would silently skip the link.
      .ilike("email", email)
      .maybeSingle();

    if (!member) {
      linkNote = " No TrackingTime account matches that address, so no hours are linked yet.";
    } else if (member.user_id && member.user_id !== invited.user.id) {
      // Someone else already owns this member record. Overwriting would move one
      // person's hours onto another's account, so refuse and say so.
      linkNote = ` Warning: TrackingTime member "${member.display_name}" is already linked to a different account, so it was left alone.`;
    } else {
      const { error: linkError } = await timeAdmin
        .from("member")
        .update({ user_id: invited.user.id })
        .eq("id", member.id);
      linkNote = linkError
        ? ` Their TrackingTime record could not be linked: ${linkError.message}`
        : ` Linked to TrackingTime member "${member.display_name}".`;
    }
  } catch (err) {
    linkNote = ` Their TrackingTime record could not be linked: ${err instanceof Error ? err.message : "unknown error"}`;
  }

  revalidatePath("/admin/users");
  return { status: "success", message: `Invited ${email}.${linkNote}` };
}

/**
 * Ban length used for a deactivated account: 100 years, which is Supabase's own
 * documented idiom for "indefinitely" (there is no unbounded value; `ban_duration`
 * is a Go duration string). Lifted with the literal "none".
 */
const INDEFINITE_BAN = "876000h";

export type SetActiveResult = {
  /** Nothing changed. The caller should put the toggle back where it was. */
  error?: string;
  /**
   * The profile write LANDED but the auth half did not. Distinct from `error`
   * because the two need opposite handling in the UI: on `error` the toggle must
   * revert, on `warning` it must NOT -- the account really is deactivated, it is
   * just not as deactivated as the operator was entitled to assume.
   */
  warning?: string;
};

/**
 * Activate or deactivate an account.
 *
 * Writes with the ADMIN client, not the caller's. app_user_profile grants
 * authenticated only `select`, so an UPDATE through the user's own client is
 * refused by Postgres with 42501 "permission denied for table" before its policy is
 * ever consulted -- which is why this toggle silently reverted for every exec. The
 * boundary is assertCanManageUsers() above, the same gate that lets inviteUser
 * create accounts outright.
 *
 * WHY IT ALSO BANS, AND WHAT THE BAN ACTUALLY BUYS
 * ------------------------------------------------
 * Until this existed the toggle wrote `app_user_profile.is_active` and nothing
 * else. That is most of the boundary and it was easy to mistake for all of it:
 * app_user_role(), app_user_department() and app_user_person_id() all filter on
 * is_active, so every role-scoped policy in schema.sql starts denying at once.
 *
 * Two things survive it, both measured against this project rather than assumed:
 *
 *   1. The SESSION. Nothing in a profile UPDATE reaches GoTrue, so an access
 *      token already in a browser keeps working, and the refresh token keeps
 *      minting new ones indefinitely. "Deactivated" therefore meant "loses
 *      permissions the next time a policy asks", with no bound on how long the
 *      account could keep asking.
 *
 *   2. Policies that key on something OTHER than the profile. time.current_member_id()
 *      resolves `m.user_id = auth.uid()` first and never consults
 *      app_user_profile, and "own entry update" / "own entry delete" on time.entry
 *      call no permission function at all -- so a deactivated colleague holding a
 *      session can still rewrite or delete their own unbilled hours. That one is
 *      fixed at the data layer for the departed colleague in
 *      supabase/migrations/20260904090000_offboard_departed_user.sql; the general
 *      case is fixed here, by there no longer being a session.
 *
 * BE PRECISE ABOUT WHAT A BAN DOES. It sets auth.users.banned_until, so GoTrue
 * refuses sign-in and refuses the refresh-token grant. It does NOT retroactively
 * invalidate an access token that has already been issued: PostgREST and Postgres
 * verify that token locally by signature and `exp`, without asking GoTrue. So the
 * honest claim is that access ends within one access-token lifetime (Supabase
 * default: 1 hour) instead of never. supabase-js has no admin call that kills a
 * live session by user id -- auth.admin.signOut() needs the user's own JWT, which
 * this console does not have -- so that is the ceiling, not a shortcut taken here.
 *
 * ORDER: profile first, ban second. Deliberate. If the ban fails, what remains is
 * the fail-CLOSED half: permissions are gone and only the session lingers. Banning
 * first and then failing the profile write would leave the opposite -- an account
 * that keeps its role while the UI shows it reverted to ACTIVE.
 *
 * A FAILED BAN IS REPORTED, NEVER SWALLOWED. Returning {} here would tell the
 * operator that access ended when it had not, which is precisely the
 * silence-as-success failure this codebase keeps paying for. It comes back as
 * `warning` rather than `error` so the toggle keeps its new (true) position while
 * the message says exactly what did not happen and what to do about it.
 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<SetActiveResult> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { error: guard.error };

  // Deactivating yourself removes your own access to this page. Previously the
  // write failed for everyone so it could not happen; through the service role it
  // would succeed, and with no other active exec there is no way back in. Now it
  // would also ban your own sign-in, so the guard matters more than it did.
  if (guard.userId === userId && !isActive) {
    return { error: "You cannot deactivate your own account. Ask another administrator." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable." };
  }
  const { error } = await admin
    .from("app_user_profile")
    .update({ is_active: isActive })
    .eq("user_id", userId);

  if (error) return { error: error.message };

  // The session half. Wrapped: updateUserById normally returns its error rather
  // than throwing, but a transport failure does throw, and an unhandled rejection
  // here would surface as a generic action failure with the profile already
  // written -- the exact ambiguity this whole path exists to remove.
  let banError: string | null = null;
  try {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: isActive ? "none" : INDEFINITE_BAN,
    });
    if (authError) banError = authError.message;
  } catch (err) {
    banError = err instanceof Error ? err.message : "unknown error";
  }

  revalidatePath("/admin/users");

  if (banError) {
    return {
      warning: isActive
        // Reactivation: the profile is live again but the sign-in is still barred,
        // so the person would be turned away at the login screen with no clue why.
        ? `Their Hub access was restored, but the sign-in suspension could NOT be lifted (${banError}). They still cannot sign in. Retry the toggle, or clear "Ban duration" for this user in Supabase → Authentication → Users.`
        // Deactivation: the dangerous direction. Say plainly that this is not done.
        : `Deactivated in the Hub, but their SIGN-IN WAS NOT REVOKED (${banError}). Their existing session keeps working until it expires and they can still sign in again. Retry the toggle, or ban the account in Supabase → Authentication → Users before treating this as complete.`,
    };
  }

  return {};
}

/** Change a user's role. Admin client for the reason given on setUserActive. */
export async function changeUserRole(
  userId: string,
  newRoleKey: string,
): Promise<{ error?: string }> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { error: guard.error };

  // Same reasoning as setUserActive: demoting yourself out of the role that grants
  // admin:users:write locks you out of the console. Checked by permission rather
  // than by comparing role keys, so a change to which roles hold it stays correct.
  if (guard.userId === userId) {
    const stillAllowed = await roleHasPermission(newRoleKey, PERMISSIONS.ADMIN_USERS_WRITE);
    if (!stillAllowed) {
      return {
        error: "That role cannot manage users, so you would lock yourself out. Ask another administrator to change your role.",
      };
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable." };
  }
  const { error } = await admin
    .from("app_user_profile")
    .update({ role_key: newRoleKey })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return {};
}

/**
 * Change a user's team.
 *
 * Stored in `department`, which also feeds app_user_department(). The column keeps
 * its name because it appears in RLS policies; only the label says "team".
 */
export async function changeUserDepartment(
  userId: string,
  department: string,
): Promise<{ error?: string }> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { error: guard.error };

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable." };
  }
  const { error } = await admin
    .from("app_user_profile")
    .update({ department: department || null })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return {};
}

/**
 * Send the invite again, for somebody who never signed in.
 *
 * WHY THIS IS NEEDED. Nineteen accounts were provisioned for real colleagues and most
 * have never signed in. There was no way to reach those people from the console: the
 * invite form calls inviteUserByEmail, which fails on an address that already has an
 * account, so the only apparent route was to delete the person and invite them afresh.
 *
 * HOW IT DELIVERS, and why not the obvious way. My first attempt used
 * admin.generateLink, which looked right and would have been a silent failure.
 * Measured against this project:
 *
 *     generateLink({type:'recovery'}) x3  -> ok, ok, ok      (never throttled)
 *     resetPasswordForEmail               -> 429 rate limited
 *     inviteUserByEmail                   -> "email rate limit exceeded"
 *
 * Only calls that actually queue mail are subject to the mail limiter. generateLink
 * hands the link BACK to the caller instead -- which is why it also returns
 * properties.action_link. So a resendInvite built on it would have reported success
 * while nothing reached the colleague.
 *
 * This therefore uses resetPasswordForEmail, the same call the sign-in page's own
 * "forgot password" flow uses, so the mail is one Supabase is configured to send and
 * the recipient lands on /auth/set-password exactly as a new invitee does.
 *
 * AND IT ALWAYS RETURNS THE LINK. Not as a rare fallback -- as the usual outcome.
 * Measured on this project: three sends to three addresses never used before all
 * returned 429 "email rate limit exceeded". That is the PROJECT-WIDE allowance on
 * Supabase's built-in SMTP (a development courtesy sender), not the per-address
 * cooldown, which words itself as "after 59 seconds". So until custom SMTP is
 * configured in the Supabase dashboard, the honest behaviour is to hand the admin a
 * one-time link to pass on, and to say so plainly rather than reporting a failure and
 * inviting a pointless retry.
 *
 * Showing the link is safe: it goes only to an admin who holds admin:users:write and
 * could reset that account outright anyway.
 *
 * ALREADY-ACTIVE ACCOUNTS ARE REFUSED. A password link arriving unrequested by
 * somebody who signs in daily looks exactly like a phishing attempt, and they can
 * reset their own password from the sign-in page. The UI only offers this where it
 * applies; this re-checks, because the UI is not the boundary.
 */
export async function resendInvite(
  userId: string,
): Promise<{ error?: string; message?: string; link?: string }> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { error: guard.error };

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  const { data: target, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError || !target?.user) {
    return { error: lookupError?.message ?? "That account no longer exists." };
  }
  const email = target.user.email;
  if (!email) {
    return { error: "That account has no email address, so there is nowhere to send an invite." };
  }

  if (target.user.last_sign_in_at) {
    return {
      error: `${email} has already signed in, so an invite would be misleading. They can reset their own password from the sign-in page.`,
    };
  }

  // A deactivated profile cannot use the link even after setting a password, and that
  // dead end would be invisible to the recipient.
  const { data: profile } = await admin
    .from("app_user_profile")
    .select("is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile && profile.is_active === false) {
    return {
      error: `${email}'s account is deactivated, so they could set a password and still be refused. Set them ACTIVE first.`,
    };
  }

  const redirectTo = `${getSiteUrl()}/auth/callback?next=%2Fauth%2Fset-password`;

  /*
   * The link is generated FIRST, as the fallback, before attempting to send.
   *
   * generateLink does not send and is not throttled, so it always succeeds and gives
   * the admin something usable even when the mail is refused. Note that each call
   * invalidates the previous token for that user, so this must come before the send
   * rather than after it -- generating afterwards would hand over a link while
   * invalidating the one just mailed.
   */
  let fallbackLink: string | undefined;
  const generated = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (!generated.error) {
    fallbackLink = generated.data?.properties?.action_link ?? undefined;
  }

  // Sending happens through the ordinary reset flow, which IS wired to the project's
  // mail configuration. The anon client is correct here: this is the same call the
  // sign-in page makes, and the service role has no separate sending path.
  const supabase = await createClient();
  const { error: sendError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (sendError) {
    // Not a failure if there is a link to hand over: say plainly what happened and
    // what to do, rather than reporting success or leaving a dead end.
    if (fallbackLink) {
      // Rate limiting is the EXPECTED case on this project, not an anomaly, so this
      // reads as an instruction rather than an apology. Measured: three sends to three
      // never-used addresses all returned "email rate limit exceeded", which is the
      // project-wide allowance on Supabase's built-in SMTP, not a per-address cooldown.
      const rateLimited = /rate limit|after \d+ seconds/i.test(sendError.message);
      return {
        message: rateLimited
          ? `Email sending is rate-limited on this project, so copy the one-time link below and send it to ${email} yourself. It sets their password and signs them in. (Configuring custom SMTP in Supabase would let the Hub send these directly.)`
          : `Could not send the email (${sendError.message}). Copy the one-time link below and send it to ${email} instead.`,
        link: fallbackLink,
      };
    }
    return { error: `Could not send the invite: ${sendError.message}` };
  }

  revalidatePath("/admin/users");
  return { message: `Invite re-sent to ${email}. They will get a link to set a password.` };
}

/**
 * Remove an account from the Hub entirely.
 *
 * DELETION IS NOT THE USUAL ANSWER, and the UI says so before asking for confirmation:
 * deactivating keeps the audit trail and is reversible, which is what suits somebody
 * who has left. This exists for what deactivation does not cover -- an address typed
 * wrong, a duplicate, a test account -- where a dead row in the console is just
 * clutter.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: the person's TrackingTime member record and
 * their logged hours. That is vendor data about work which really happened, and the
 * org chart and every hours total depend on it. Only the LINK is cleared
 * (time.member.user_id), so the roster keeps the person and the hours keep their
 * attribution while the Hub sign-in goes away.
 *
 * Clearing that link is not optional. Left in place it would point at a deleted auth
 * user, and the next person invited on that address could not be linked, because
 * inviteUser refuses to take over a member already claimed by another account.
 *
 * ORDER MATTERS. Link, then profile, then the auth user -- because
 * app_user_profile.user_id references auth.users. Deleting the user first either
 * cascades in a way that hides failures or fails halfway and leaves a profile whose
 * account is gone.
 *
 * TWO REFUSALS. Deleting yourself, for the reason self-deactivation is refused but
 * worse, since there is no undo. And deleting the last account that can manage users,
 * which would leave the Hub with no administrator at all.
 */
export async function deleteUser(userId: string): Promise<{ error?: string; message?: string }> {
  const guard = await assertCanManageUsers();
  if ("error" in guard) return { error: guard.error };

  if (guard.userId === userId) {
    return { error: "You cannot delete your own account. Ask another administrator." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Admin client unavailable." };
  }

  // Read the address BEFORE deleting: afterwards there is nothing left to name, and
  // "Removed the account" without saying whose is a poor thing to read.
  const { data: target } = await admin.auth.admin.getUserById(userId);
  const email = target?.user?.email ?? "that account";

  const { data: rows } = await admin
    .from("app_user_profile")
    .select("user_id, role_key, is_active");
  if (rows) {
    const managers: string[] = [];
    for (const row of rows) {
      if (!row.is_active) continue;
      if (await roleHasPermission(row.role_key, PERMISSIONS.ADMIN_USERS_WRITE)) {
        managers.push(row.user_id);
      }
    }
    if (managers.includes(userId) && managers.length <= 1) {
      return {
        error: "That is the only active account that can manage users. Promote somebody else first, or nobody will be able to administer the Hub.",
      };
    }
  }

  // 1. Unlink the TrackingTime member, keeping the person and their hours.
  let unlinkNote = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeAdmin = (admin as any).schema("time");
    const { data: members } = await timeAdmin
      .from("member")
      .select("id, display_name")
      .eq("user_id", userId);
    if (members && members.length > 0) {
      const { error: unlinkError } = await timeAdmin
        .from("member")
        .update({ user_id: null })
        .eq("user_id", userId);
      if (unlinkError) {
        return {
          error: `Could not unlink their TrackingTime record, so nothing was deleted: ${unlinkError.message}`,
        };
      }
      unlinkNote = ` Their TrackingTime record ("${members[0].display_name}") and its hours were kept, and unlinked.`;
    }
  } catch (err) {
    return {
      error: `Could not unlink their TrackingTime record, so nothing was deleted: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  // 2. The Hub profile.
  const { error: profileError } = await admin
    .from("app_user_profile")
    .delete()
    .eq("user_id", userId);
  if (profileError) {
    return { error: `Could not remove their profile, so the account was left in place: ${profileError.message}` };
  }

  // 3. The sign-in itself.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    return {
      error: `Their profile was removed but the sign-in could not be deleted: ${authError.message}. They can no longer use the Hub, but the account still exists.`,
    };
  }

  revalidatePath("/admin/users");
  return { message: `Removed ${email} from the Hub.${unlinkNote}` };
}

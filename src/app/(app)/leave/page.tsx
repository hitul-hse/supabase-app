import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getLeaveBalance, getLeaveRequests, getPendingLeaveApprovals } from "@/lib/queries/hse";
import { MyLeavePanel } from "./MyLeavePanel";
import { PendingLeaveApprovals } from "./PendingLeaveApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function LeavePage() {
  const profile = await requireProfile("/leave");
  const supabase = await createClient();
  // The approvals panel is gated on the permission that names it, not on being
  // one of two roles. Everyone reaches /leave to book their own time off; only
  // a holder of hr:leave:approve sees other people's requests.
  const isLead = await userHasPermission(PERMISSIONS.HR_LEAVE_APPROVE);

  const [balance, requests, pendingApprovals] = await Promise.all([
    profile.personId ? getLeaveBalance(supabase, profile.personId) : Promise.resolve(null),
    profile.personId ? getLeaveRequests(supabase, profile.personId) : Promise.resolve([]),
    isLead ? getPendingLeaveApprovals(supabase) : Promise.resolve([]),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <PageHeader
          category="HSE HUB / RECORDS"
          title="Leave &amp; Time Off"
          meta="FACTORIALHR-EQUIVALENT · REQUEST · APPROVE · BALANCE"
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          {profile.personId ? (
            <MyLeavePanel balance={balance} requests={requests} />
          ) : (
            /*
             * Not "your account is misconfigured", which is what this said before
             * and what no reader could act on.
             *
             * Leave tracking has no source system here. leave_requests is empty and
             * leave_balances holds only rows keyed to the seeded mockup people, so
             * there is no balance to show anybody -- for every account, not just
             * this one. Naming that is more useful than implying an admin could fix
             * it by linking a record, and it stops someone chasing a permissions
             * problem that does not exist.
             */
            <div className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface)] p-5">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                Leave tracking isn&apos;t connected yet
              </span>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Holiday balances and requests need a source system, and none is
                linked to the Hub yet — so there is nothing to show here for anyone.
                TrackingTime records hours worked, not absence.
              </p>
              <p className="font-mono text-[10px] text-[var(--text-faint)]">
                NOTHING IS WRONG WITH YOUR ACCOUNT
              </p>
            </div>
          )}

          {isLead && <PendingLeaveApprovals initialRequests={pendingApprovals} />}
        </div>
      </div>
    </PageTransition>
  );
}

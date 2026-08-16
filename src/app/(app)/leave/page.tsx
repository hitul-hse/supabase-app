import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getLeaveBalance, getLeaveRequests, getPendingLeaveApprovals } from "@/lib/queries/hse";
import { MyLeavePanel } from "./MyLeavePanel";
import { PendingLeaveApprovals } from "./PendingLeaveApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function LeavePage() {
  const profile = await requireProfile("/leave");
  const supabase = await createClient();
  const isLead = profile.roleKey === "exec" || profile.roleKey === "dept_head";

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
            <div className="border border-[var(--border)] bg-[var(--surface)] p-5 text-[12.5px] text-[var(--text-muted)]">
              No person record is linked to your account, so leave requests aren&apos;t available for you.
            </div>
          )}

          {isLead && <PendingLeaveApprovals initialRequests={pendingApprovals} />}
        </div>
      </div>
    </PageTransition>
  );
}

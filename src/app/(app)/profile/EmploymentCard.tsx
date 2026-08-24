import type { ProfileView } from "@/lib/queries/profile";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";

/**
 * HR data, deliberately inert.
 *
 * These fields are styled so they cannot be mistaken for inputs: muted text,
 * no border, no focus ring. A field that looks editable and silently is not is
 * worse than one that plainly is not -- and these will be owned by Factorial,
 * so an edit here would vanish at the next sync.
 */
function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        {label}
      </span>
      <span className={`text-[13px] text-[var(--text-secondary)] ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function EmploymentCard({ profile }: { profile: ProfileView }) {
  const dash = (v: string | number | null) => (v === null || v === "" ? "—" : String(v));

  return (
    // Employment is a top-level profile section — aggregates HR data.
    // Qualifier names the source so readers know editing here is futile.
    <Card>
      <CardHeader title="Employment" qualifier="MANAGED BY HR · READ ONLY" />
      <CardDivider />

      <div className="p-5">
      {profile.personId === null && (
        <p className="mb-4 border-b border-[var(--border)] pb-4 text-[12px] text-[var(--text-muted)]">
          No HR record is linked to your account yet, so the fields below are unavailable. This
          fills in once HR links your profile.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Role" value={profile.roleDisplayName} />
        <Field label="Department" value={dash(profile.department)} />
        <Field label="Employee no." value={dash(profile.employeeNumber)} mono />
        <Field label="Contract hours" value={dash(profile.contractHours)} mono />
        <Field
          label="Holiday"
          value={
            profile.holidayLeft === null || profile.totalHoliday === null
              ? "—"
              : `${profile.holidayLeft} of ${profile.totalHoliday} days left`
          }
        />
        <Field label="Certificates" value={dash(profile.certificateStatus)} />
        <Field label="With HSE since" value={dash(profile.since)} />
        <Field label="Sign-in email" value={dash(profile.email)} mono />
      </div>
      </div>
    </Card>
  );
}

import { LogoutButton } from "@/components/LogoutButton";

export default function AccessPendingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] p-4">
      <div className="w-full max-w-md border border-[var(--border)] bg-[var(--surface-2)] p-8">
        <h1 className="mb-2 text-2xl font-semibold text-[var(--text-primary)]">
          Access pending
        </h1>
        <p className="mb-6 text-sm text-[var(--text-secondary)]">
          You&apos;re signed in, but an administrator hasn&apos;t set up your account role
          yet. Ask an admin to provision your access, then log back in.
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}

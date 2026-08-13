import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { PageHeader } from "@/components/PageHeader";

const SECTIONS = [
  {
    href: "/dashboard",
    title: "Dashboard",
    description: "Aggregate stats and charts over the Netflix users sample dataset.",
  },
  {
    href: "/netflix",
    title: "Netflix Users",
    description: "Search and page through the raw Netflix users table.",
  },
  {
    href: "/uploads",
    title: "Uploads",
    description: "Upload files to Google Cloud Storage and browse what's there.",
  },
];

export default async function Home() {
  const envConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let connectionError: string | null = null;
  if (envConfigured) {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    if (error) connectionError = error.message;
  }

  const connected = envConfigured && !connectionError;

  return (
    <div>
      <PageHeader title="Overview" meta="Next.js + Supabase starter" />

      <div className="p-6">
        {!envConfigured && (
          <div className="flex max-w-xl items-start gap-3 border border-[var(--border)] p-4 text-sm" style={{ background: "var(--warning-wash)" }}>
            <span aria-hidden className="mt-0.5 text-base">⚠</span>
            <p className="text-[var(--text-primary)]">
              <span className="font-medium">Supabase isn&apos;t configured yet.</span>{" "}
              Copy <code className="bg-[var(--surface)] px-1 py-0.5 font-mono">.env.local.example</code> to{" "}
              <code className="bg-[var(--surface)] px-1 py-0.5 font-mono">.env.local</code> and fill in your
              project URL and anon key from Project Settings → API in the Supabase dashboard.
            </p>
          </div>
        )}

        {envConfigured && connectionError && (
          <div className="flex max-w-xl items-start gap-3 border border-[var(--border)] p-4 text-sm" style={{ background: "var(--critical-wash)" }}>
            <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">✕</span>
            <p className="text-[var(--text-primary)]">
              <span className="font-medium">Could not reach Supabase.</span> {connectionError}
            </p>
          </div>
        )}

        {connected && (
          <div className="mb-6 flex max-w-xl items-center gap-2 border border-[var(--border)] px-4 py-2.5 text-sm" style={{ background: "var(--good-wash)" }}>
            <span aria-hidden className="text-[var(--good)]">●</span>
            <span className="text-[var(--text-primary)]">Connected to Supabase</span>
          </div>
        )}

        {connected && (
          <div className="grid gap-3 sm:grid-cols-3">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[13.5px] font-medium text-[var(--text-primary)]">{s.title}</h2>
                  <span aria-hidden className="text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]">
                    →
                  </span>
                </div>
                <p className="text-[12.5px] text-[var(--text-secondary)]">{s.description}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

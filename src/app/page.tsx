import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 p-8 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Next.js + Supabase
      </h1>

      {!envConfigured && (
        <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Copy <code>.env.local.example</code> to <code>.env.local</code> and
          fill in your Supabase project URL and anon key from
          Project Settings → API in the Supabase dashboard.
        </div>
      )}

      {envConfigured && connectionError && (
        <div className="max-w-md rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          Could not reach Supabase: {connectionError}
        </div>
      )}

      {envConfigured && !connectionError && (
        <div className="max-w-md rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          Connected to Supabase. Create a table in the dashboard, then query
          it from <code>src/utils/supabase/server.ts</code> (server
          components) or <code>src/utils/supabase/client.ts</code> (client
          components).
        </div>
      )}

      {envConfigured && !connectionError && (
        <Link href="/netflix" className="text-sm font-medium underline text-black dark:text-zinc-50">
          Browse Netflix users data →
        </Link>
      )}
    </div>
  );
}

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
  return createBrowserClient<Database>(url, key, {
    /*
      Opt in to the passkey API (Face ID / Touch ID / Windows Hello sign-in).

      Verified on disk rather than assumed: @supabase/auth-js 2.112.3 ships
      lib/webauthn.js and declares signInWithPasskey(), registerPasskey() and a
      `passkey` namespace on GoTrueClient. Every one of them THROWS at call time
      unless this flag is set — the flag defaults to false.

      Setting it costs nothing when the feature is unused: it enables methods,
      it does not start a ceremony. The server side is a separate switch — this
      project currently reports passkeys_enabled=false in /auth/v1/settings, so
      BiometricSignIn probes for that before rendering anything (see its note).

      Marked experimental upstream: the signatures may change before GA, so
      @supabase/supabase-js should not be bumped without re-reading the
      changelog.
    */
    auth: { experimental: { passkey: true } },
  });
}

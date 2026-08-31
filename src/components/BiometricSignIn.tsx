"use client";

/**
 * BiometricSignIn — "Sign in with Face ID / Touch ID / Windows Hello", via a
 * Supabase passkey.
 *
 * IT RENDERS NOTHING UNLESS ALL FOUR OF THESE HOLD. This is the whole design,
 * because the alternative — a button that is always there — is worse than no
 * button: somebody taps it, nothing happens or an SDK error appears, and they
 * now distrust the sign-in page they are standing on.
 *
 *   0. NEXT_PUBLIC_ENABLE_PASSKEYS is exactly "true". This gate exists to keep
 *      the other three off the network. Gate 3 is a cross-origin GET, and it
 *      ran on every single sign-in page load — for every visitor, signed in or
 *      not — purely to be told `passkeys_enabled: false`, which is what this
 *      project has always returned. Worse, when Supabase is unreachable (a
 *      local stack that is not up, a bad URL) the browser logs the failure to
 *      the console before our .catch() ever sees it, so a misconfigured
 *      environment makes the sign-in page look broken while behaving fine.
 *      Same build-time-flag shape as NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN; it
 *      is inlined at build time, so turning passkeys on is a flag flip in the
 *      Supabase dashboard AND a rebuild, not a dashboard flip alone.
 *   1. The browser HAS a platform authenticator. `isUserVerifyingPlatform
 *      AuthenticatorAvailable()` is the real check. A desktop Chrome with no
 *      Hello enrolled returns false, and offering Face ID there is a lie.
 *   2. The page is a SECURE CONTEXT. navigator.credentials is undefined on
 *      plain http, so on a LAN-IP dev server the button must not appear.
 *   3. The SERVER has passkeys switched on. Measured on this project today:
 *      GET /auth/v1/settings returns passkeys_enabled=false, and
 *      /auth/v1/webauthn/* 404s. So right now this component renders null in
 *      production, correctly. Gate 0 does not replace this check — the server
 *      is still asked before any button appears, so setting the flag early can
 *      never produce a button GoTrue would refuse to honour.
 *
 * WHAT IT IS NOT. It is NOT "unlock a remembered session behind a biometric
 * prompt". That pattern calls navigator.credentials.get() purely for the
 * fingerprint animation and then restores a token from storage without any
 * server-side verification — so anyone who can read the token (XSS, a shared
 * device with an open tab) bypasses the biometric completely. It looks
 * identical to the user and defends nothing. signInWithPasskey() is a real
 * first factor: the assertion is verified against a public key held by GoTrue,
 * which then issues a fresh session JWT.
 *
 * A passkey must be REGISTERED first, from an already-signed-in session (see
 * `registerPasskey`). So the honest flow is: sign in with password or Google
 * once, enrol, and biometrics from then on.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

/** Face-scan glyph, drawn to the same 16×16 / 1.5-stroke rule as nav-icons.tsx:
 *  four bracket corners around a face. Deliberately generic rather than an
 *  Apple Face ID mark — the same button serves Windows Hello and Android. */
function IconBiometric({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M2 5.5V3.6A1.6 1.6 0 0 1 3.6 2h1.9M10.5 2h1.9A1.6 1.6 0 0 1 14 3.6v1.9M14 10.5v1.9a1.6 1.6 0 0 1-1.6 1.6h-1.9M5.5 14H3.6A1.6 1.6 0 0 1 2 12.4v-1.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M6 6.5v1M10 6.5v1M6 10.2c.5.5 1.2.8 2 .8s1.5-.3 2-.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type Availability = "checking" | "unavailable" | "ready";

export function BiometricSignIn({
  redirectTo,
  disabled,
  onError,
  onSuccess,
}: {
  redirectTo: string;
  disabled?: boolean;
  onError: (message: string) => void;
  onSuccess: (redirectTo: string) => void;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        // (0) Build-time opt-in, checked first because it is the only gate that
        // costs nothing and the only one that keeps us off the network.
        if (process.env.NEXT_PUBLIC_ENABLE_PASSKEYS !== "true") {
          if (active) setAvailability("unavailable");
          return;
        }

        // (2) Secure context / API present. `?.` because PublicKeyCredential
        // is undefined entirely on http, not merely unsupported.
        const pkc = typeof window !== "undefined"
          ? (window as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential
          : undefined;
        if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) {
          if (active) setAvailability("unavailable");
          return;
        }

        // (1) A real platform authenticator, not a roaming security key.
        const hasPlatform = await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!hasPlatform) {
          if (active) setAvailability("unavailable");
          return;
        }

        // (3) The server actually offers passkeys. Read straight from GoTrue's
        // own settings endpoint, so this never disagrees with what GoTrue will
        // do. Only reached when gate 0 is on, so it is not on the default path.
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) {
          if (active) setAvailability("unavailable");
          return;
        }
        const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        if (active) setAvailability(settings?.passkeys_enabled ? "ready" : "unavailable");
      } catch {
        if (active) setAvailability("unavailable");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (availability !== "ready") return null;

  const handle = async () => {
    onError("");
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPasskey();

      if (error) {
        /*
          A user cancelling the Face ID sheet is NOT an error worth shouting
          about — it is them changing their mind, and an angry red banner for
          it trains people to ignore the banner. WebAuthn reports both a
          cancel and a timeout as NotAllowedError, so both stay silent.
        */
        const name = (error as { name?: string }).name;
        if (name !== "NotAllowedError" && name !== "AbortError") {
          onError(error.message || "Biometric sign-in failed. Use your password instead.");
        }
        return;
      }
      if (data?.session) onSuccess(redirectTo);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError") return;
      onError(
        err instanceof Error ? err.message : "Biometric sign-in failed. Use your password instead.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      disabled={disabled || busy}
      data-testid="biometric-signin"
      /* min-h-11 (44px) like every other control on this form — see the note on
         authInputClass. `w-full` so it stacks cleanly above the OAuth buttons
         at 390px rather than sitting beside them at half width. */
      className="flex w-full min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <IconBiometric className="h-4 w-4 flex-none text-[var(--accent)]" />
      {busy ? "Waiting for biometrics…" : "Sign in with biometrics"}
    </button>
  );
}

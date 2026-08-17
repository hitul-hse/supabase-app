"use client";

/**
 * Google / Microsoft sign-in.
 *
 * Both go through Supabase's OAuth flow, which redirects to the provider and
 * back to /auth/callback with a PKCE code. Two details that are easy to get
 * wrong and expensive to debug:
 *
 *  - `redirectTo` must point at /auth/callback, not at the destination page.
 *    Supabase appends ?code=... and only that route knows how to exchange it.
 *    It must also appear in the project's Redirect URLs allowlist, or Supabase
 *    silently substitutes the bare Site URL and the code is lost.
 *
 *  - The eventual destination rides along as ?next=, which the callback
 *    validates as a same-site path before using. It is not passed through the
 *    provider, so it cannot be tampered with mid-flight.
 *
 * These buttons do NOT grant access. OAuth only creates an auth.users row; the
 * app requires a matching app_user_profile that an administrator provisions, so
 * an unknown Google account that signs in successfully still lands on
 * /access-pending and can read nothing. That separation is deliberate: it means
 * enabling a public identity provider does not widen who can see HSE data.
 */
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

/** The providers wired up here. Supabase calls Microsoft's provider "azure". */
type OAuthProvider = "google" | "azure";

function GoogleMark() {
  // Google's brand guidelines require their own four-colour mark, not a tinted
  // or monochrome version, so this is the official path data rather than an icon
  // font substitute.
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="h-4 w-4 flex-none">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H1.06v2.34A8.99 8.99 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H1.06a9 9 0 0 0 0 8.12l2.92-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.59A8.99 8.99 0 0 0 1.06 4.94l2.92 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  // Microsoft's four squares, in their specified colours.
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="h-4 w-4 flex-none">
      <path fill="#F25022" d="M1 1h7.6v7.6H1z" />
      <path fill="#7FBA00" d="M9.4 1H17v7.6H9.4z" />
      <path fill="#00A4EF" d="M1 9.4h7.6V17H1z" />
      <path fill="#FFB900" d="M9.4 9.4H17V17H9.4z" />
    </svg>
  );
}

export function OAuthButtons({
  redirectTo,
  disabled = false,
  onError,
}: {
  /** Same-site path to land on after sign-in, already validated by the caller. */
  redirectTo: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  // Tracks which provider is mid-flight, so only that button shows a pending
  // state. A single boolean would make both look like they were working.
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const signIn = async (provider: OAuthProvider) => {
    onError("");
    setPending(provider);

    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", redirectTo);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callback.toString(),
          // Ask Microsoft for the profile fields we actually display. Google
          // returns these by default; Azure needs them requested explicitly or
          // the user arrives with no name or email on their identity.
          scopes: provider === "azure" ? "email openid profile" : undefined,
        },
      });

      if (error) {
        // The most common cause by far is the provider not being enabled in the
        // Supabase project yet, which returns an opaque message. Say what to do.
        onError(
          `${error.message} — if this provider was just set up, check it is enabled in Supabase (Authentication → Providers).`,
        );
        setPending(null);
      }
      // On success the browser is navigating away; deliberately leave the
      // pending state set so the button cannot be clicked twice mid-redirect.
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start sign-in. Try again.");
      setPending(null);
    }
  };

  const base =
    "flex w-full items-center justify-center gap-2.5 border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50";

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={disabled || pending !== null}
        className={base}
      >
        <GoogleMark />
        {pending === "google" ? "Redirecting to Google…" : "Continue with Google"}
      </button>

      <button
        type="button"
        onClick={() => signIn("azure")}
        disabled={disabled || pending !== null}
        className={base}
      >
        <MicrosoftMark />
        {pending === "azure" ? "Redirecting to Microsoft…" : "Continue with Microsoft"}
      </button>
    </div>
  );
}

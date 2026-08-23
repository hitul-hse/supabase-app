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

/**
 * Is Microsoft sign-in offered at all?
 *
 * WHY A FLAG RATHER THAN DELETING THE BUTTON. Microsoft is deferred, not
 * rejected: enabling it needs an Azure app registration nobody has created yet
 * (see docs/ENABLE-SSO-STEPS.md, Part B). Deleting the code would mean rebuilding
 * the scopes, the provider-key mapping and the pending-state handling later, and
 * those are exactly the details this file exists to get right.
 *
 * WHY IT DEFAULTS TO OFF. Until that registration exists, the button cannot
 * succeed for anybody. The failure is now explained in place rather than dumping
 * the user on raw JSON, which is a real improvement -- but the best version of an
 * unusable control is not a well-explained one, it is its absence. Two sign-in
 * options where one always fails invites every colleague to try the broken one
 * first and quietly wonder whether the app is finished.
 *
 * Google is unaffected: it is offered unconditionally, because its remaining
 * problem is one field in the Google Cloud console rather than a missing
 * integration.
 *
 * TO TURN IT ON, once Part B of the guide is done, set
 * NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN=true and redeploy. Read at module scope
 * because Next inlines NEXT_PUBLIC_* at build time, so there is nothing to
 * re-evaluate per render.
 */
const MICROSOFT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN === "true";

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

    // What the user calls it, for messages. Supabase's provider key is "azure",
    // which nobody outside this codebase would recognise in an error.
    const label = provider === "azure" ? "Microsoft" : "Google";

    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callback.toString(),
          // Ask Microsoft for the profile fields we actually display. Google
          // returns these by default; Azure needs them requested explicitly or
          // the user arrives with no name or email on their identity.
          scopes: provider === "azure" ? "email openid profile" : undefined,
          /**
           * Navigate ourselves rather than letting supabase-js do it.
           *
           * Without this the library sets window.location immediately and
           * unconditionally. When a provider is not enabled, Supabase answers
           * that navigation with 400 and the browser lands on raw JSON —
           *   {"code":400,...,"msg":"Unsupported provider: provider is not enabled"}
           * — with no way back. The error handler below never runs, because by
           * then the page is gone. Observed, not theorised: that is exactly what
           * this project does today, since neither provider is enabled yet.
           *
           * Skipping the redirect turns the same failure into a returned error we
           * can explain in place, on a page that still has a working email form.
           */
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        // The overwhelmingly common cause is the provider not being enabled in
        // the Supabase project, whose raw message is "Unsupported provider:
        // provider is not enabled" — accurate, and useless to a colleague who
        // just wants to log in. Translate that one case and let anything else
        // through verbatim, since an unexpected message is worth seeing.
        const notEnabled = /provider is not enabled|unsupported provider/i.test(error.message);
        onError(
          notEnabled
            ? `${label} sign-in isn't switched on for this app yet. Use your email and password below, or ask an administrator to enable it.`
            : error.message,
        );
        setPending(null);
        return;
      }

      if (!data?.url) {
        // Should not happen, but a missing URL would otherwise leave the button
        // spinning forever with no explanation.
        onError(`Could not start ${label} sign-in. Try again, or use email below.`);
        setPending(null);
        return;
      }

      /**
       * Check the provider is actually enabled before handing the browser over.
       *
       * `skipBrowserRedirect` does NOT validate anything — measured, not guessed:
       * supabase-js builds the authorize URL client-side and returns it without
       * contacting the server, so `error` is null even for a provider that is
       * switched off. Navigating to it lands the user on
       *   {"code":400,...,"msg":"Unsupported provider: provider is not enabled"}
       * with no way back, which is what this app did before this check existed.
       *
       * GET, not HEAD: /auth/v1/authorize answers HEAD with 405 Method Not
       * Allowed, which is indistinguishable from "fine" if you only test for 400.
       * That mistake was made here first, and the browser sailed straight into
       * the JSON page.
       *
       * `redirect: "manual"` means the request is never followed, so an *enabled*
       * provider costs one opaque response and no consent screen. A disabled one
       * answers 400 and we explain it in place.
       *
       * If the probe itself fails (offline, blocked, CORS), fall through and
       * navigate anyway: a network hiccup must not block someone who could
       * otherwise sign in.
       */
      try {
        const probe = await fetch(data.url, { method: "GET", redirect: "manual" });
        // An opaque response (type "opaqueredirect", status 0) is the success
        // shape here: the provider redirect was returned and deliberately not
        // followed. Only an explicit 400 means "not enabled".
        if (probe.status === 400) {
          onError(
            `${label} sign-in isn't switched on for this app yet. Use your email and password below, or ask an administrator to enable it.`,
          );
          setPending(null);
          return;
        }
      } catch {
        // Probe failed for a reason unrelated to the provider; continue.
      }

      /**
       * The provider can be ENABLED here and still refuse the sign-in, and this is
       * not hypothetical -- it is what this project does today. Measured against
       * live: Supabase happily produces a Google authorize URL, and Google answers
       * it with a 302 to accounts.google.com/signin/oauth/error carrying
       * `redirect_uri_mismatch`, because the Supabase callback URI is not
       * registered on the Google OAuth client.
       *
       * The probe above cannot see that: Supabase returns 302, not 400, so the old
       * code handed the browser over and the user landed on Google's own error page
       * with no route back to the working email form. "It gives me an error" with
       * nothing actionable in it.
       *
       * So the destination is checked too. This is best-effort by nature -- the
       * provider is cross-origin, so a browser fetch is opaque and cannot read the
       * status. `redirect: "follow"` with an opaque response still tells us the
       * request completed; what it cannot tell us is WHERE it landed. Rather than
       * pretend otherwise, ask our own server, which can follow the chain and read
       * the reason.
       *
       * If the check is inconclusive for any reason we navigate anyway: a
       * diagnostic must never be the thing that stops a working sign-in.
       */
      try {
        const verdict = await fetch(
          `/auth/provider-status?provider=${encodeURIComponent(provider)}`,
          { cache: "no-store" },
        );
        if (verdict.ok) {
          const status: { ok?: boolean; reason?: string; hint?: string } = await verdict.json();
          if (status.ok === false) {
            onError(
              status.hint
                ? `${label} sign-in is not finished being set up: ${status.hint}`
                : `${label} sign-in is not working yet (${status.reason ?? "provider refused the request"}). Use your email and password below.`,
            );
            setPending(null);
            return;
          }
        }
      } catch {
        // Inconclusive -- fall through and let the user try.
      }

      // Hand off to the provider. pending deliberately stays set: the button must
      // not be clickable during the redirect.
      window.location.assign(data.url);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start sign-in. Try again.");
      setPending(null);
    }
  };

  // min-h-11 below sm: this is the first control on the sign-in form, and its
  // measured height was 37.3px — under the 44px minimum target on the one screen
  // nobody can skip. Relaxed at sm+, where a pointer is precise.
  const base =
    "flex w-full min-h-11 items-center justify-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50 sm:min-h-0";

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

      {MICROSOFT_ENABLED && (
        <button
          type="button"
          onClick={() => signIn("azure")}
          disabled={disabled || pending !== null}
          className={base}
        >
          <MicrosoftMark />
          {pending === "azure" ? "Redirecting to Microsoft…" : "Continue with Microsoft"}
        </button>
      )}
    </div>
  );
}

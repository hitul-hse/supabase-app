"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  AuthShell,
  AuthHeading,
  AuthNotice,
  authInputClass,
  authLabelClass,
} from "@/components/AuthShell";
import { Button } from "@/components/ui/Button";
import { OAuthButtons } from "@/components/OAuthButtons";
import { BiometricSignIn } from "@/components/BiometricSignIn";

/**
 * Where to go after a successful login, restricted to this app.
 *
 * `redirect_to` arrives from the URL, so it is attacker-controlled. Passing it
 * straight to router.push() is an open redirect: `?redirect_to=https://evil.com`
 * would send a user who has *just authenticated* to another origin, which is
 * exactly the moment they are most likely to trust the page they land on and
 * re-enter a credential.
 *
 * Only a same-site absolute path is allowed. Protocol-relative "//evil.com" is
 * rejected explicitly because it starts with "/" and is otherwise indistinguishable
 * from a local path, and a backslash is rejected because some browsers normalise
 * "/\evil.com" to a protocol-relative URL.
 */
function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect_to"));
  // /auth/callback sends failures back here with a readable reason.
  const linkError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a credential is accepted and never cleared: this component stays
  // mounted while the router works, and this is what stops the form snapping
  // back to its idle state for the few hundred milliseconds before the app
  // takes over. See the handler and the wrapper below.
  const [leaving, setLeaving] = useState(false);

  const supabase = createClient();

  // Rescue an invite or reset that landed here instead of on set-password.
  // Supabase only honours a redirectTo that appears in the project's redirect
  // allowlist; otherwise it silently swaps in the bare Site URL, so the
  // visitor arrives at "/" and the proxy forwards them here. The credential
  // rides along in the URL fragment (browsers re-apply fragments across
  // redirects), so the link is still good — it just needs the right page.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const type = new URLSearchParams(hash.slice(1)).get("type");
    if (type === "invite" || type === "recovery") {
      router.replace(`/auth/set-password${hash}`);
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Tracked locally rather than read back from state: `finally` runs before
    // React has re-rendered, so `leaving` would still be false there.
    let accepted = false;
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError(result.error.message);
      } else {
        accepted = true;
        setLeaving(true);
        router.push(redirectTo);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An error occurred. Please try again.",
      );
    } finally {
      // Only on failure. Releasing the busy state on success would flip the
      // button back to "Sign in" and re-enable both fields for the length of
      // the navigation — a form that looks ready to be filled in again is the
      // hard cut this avoids.
      if (!accepted) setLoading(false);
    }
  };

  return (
    /*
      TWO JOBS, ONE ELEMENT.

      ARRIVING — `stagger` is the house entrance (globals.css "MOTION
      VOCABULARY"): each direct child below rises 8 px into place, 30 ms apart,
      400 ms each, so the eye is led down the page in the order it must read it
      rather than being handed six blocks at once. The per-element move stays at
      the house's 400 ms; the stagger caps its delay at the sixth child.

      CSS keyframes, NOT a JS spring, and that is the load-bearing part. This
      form is server-rendered, and a framer entrance sets opacity 0 in the SSR
      HTML and only runs once hydration lands: measured in this worktree at
      160 ms after domcontentloaded, the entire sign-in form was still blank —
      an invisible login page for as long as the bundle takes, on the one screen
      nobody can skip. `.stagger` paints on the first frame with no JS at all,
      and `prefers-reduced-motion` removes it outright rather than shortening it.

      LEAVING — on a good credential the form recedes (200 ms to 45 %, pointer
      events off, the button still busy) and the app arrives over it, instead of
      the sign-in screen standing fully lit until the route swaps and then
      vanishing. An opacity change, not a movement, so it is as correct under
      Reduce Motion as without it.
    */
    <div
      className={`stagger transition-opacity duration-200 ${
        leaving ? "pointer-events-none opacity-45" : "opacity-100"
      }`}
    >
      {/* "Sign in", not "Welcome back": /portal already greets the user with
          "Welcome back, {name}." on the very next screen, and it can use their
          actual name because by then we know it. Two "welcome back"s a second
          apart, the first of them anonymous, reads as a template rather than as
          the product recognising anyone. This heading names the ACTION. */}
      <div>
        <AuthHeading eyebrow="HSE HUB / ACCESS" title="Sign in" />
      </div>

      {(error || linkError) && <AuthNotice tone="error">{error ?? linkError}</AuthNotice>}

      {/*
        Biometrics FIRST, above the OAuth buttons. On a phone this is the
        fastest path by a wide margin — one tap and a glance, versus typing an
        address and a password on a soft keyboard — and the reference this page
        follows puts a single prominent sign-in action directly under the
        heading rather than burying it beneath a form.

        It renders NOTHING unless the device has a platform authenticator, the
        page is a secure context, AND the Supabase project has passkeys enabled.
        Today the last is false in production, so nothing appears here and the
        page is exactly as it was — see BiometricSignIn's own note.
      */}
      <div>
        <BiometricSignIn
          redirectTo={redirectTo}
          disabled={loading}
          onError={(message) => setError(message || null)}
          onSuccess={(to) => {
            // The same recede as the password path: a passkey succeeds fast
            // enough that a hard cut is the only thing you would notice.
            setLeaving(true);
            router.push(to);
          }}
        />
      </div>

      {/* Single sign-on first: most staff already carry a Google session, so the
          password form below is the fallback rather than the default path.
          Whether Microsoft appears here too is decided inside OAuthButtons by a
          flag, so this page deliberately does not name the providers. Errors
          surface through the same notice as password failures, so there is only
          one place to look. */}
      <div>
        <OAuthButtons
          redirectTo={redirectTo}
          disabled={loading}
          onError={(message) => setError(message || null)}
        />
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="t-label text-[var(--text-faint)]">OR WITH EMAIL</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={authLabelClass}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className={authInputClass}
            placeholder="you@hs-experts.com"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="password" className="t-body font-medium text-[var(--text-primary)]">
              Password
            </label>
            {/* Measured at 18px tall / 12px text on a phone — by far the worst
                tap target on the page, and the one a locked-out user needs
                most. The negative margin lets the box grow to a 44px target
                without pushing the label row apart, and t-body (13px) is the
                smallest role that stays comfortably legible at arm's length. */}
            <Link
              href="/auth/forgot-password"
              className="-my-2 flex min-h-11 items-center py-2 t-body text-[var(--accent)] hover:underline sm:min-h-0 sm:t-callout"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className={authInputClass}
            placeholder="••••••••"
          />
        </div>

        {/*
          The house primary button, not a hand-rolled one. `busy` is what gives
          this its pending state: a spinner over a label that stays mounted, so
          the button cannot change width mid-submit, plus `aria-busy` and
          `disabled` together. The press is the primitive's own
          `active:translate-y-px`, which fires on pointer-down (APPLE_REF §5.7,
          "press — Apple's mandatory press state").
        */}
        <Button type="submit" variant="primary" busy={loading} className="w-full max-sm:min-h-11">
          Sign in
        </Button>
      </form>

      <div className="mt-6 border-t border-[var(--border)] pt-6">
        <p className="t-body t-loose text-[var(--text-secondary)]">
          Access is granted by an administrator. Signing in above identifies you,
          but you&apos;ll need a role assigned before you can see any data —
          contact your administrator if you land on &ldquo;Access pending&rdquo;.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="t-callout text-[var(--text-muted)]">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

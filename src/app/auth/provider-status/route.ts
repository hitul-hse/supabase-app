import { NextResponse, type NextRequest } from "next/server";
import { proxiedOrigin } from "@/utils/proxied-origin";

/**
 * Is an OAuth provider actually usable right now?
 *
 * WHY A SERVER ROUTE. The sign-in button needs to know whether handing the browser
 * to Google will work, and it cannot find out for itself: the provider is
 * cross-origin, so a browser `fetch` gets an opaque response whose status and
 * Location are both unreadable. The old code therefore only caught the one failure
 * Supabase reports directly (HTTP 400, "provider is not enabled") and walked
 * straight into every other kind.
 *
 * That gap was live. Measured against this project: Google is ENABLED in Supabase,
 * the authorize URL builds fine, and Google answers it with a 302 to
 * accounts.google.com/signin/oauth/error carrying `redirect_uri_mismatch` -- because
 * the Supabase callback URI is not registered on the Google OAuth client. The user
 * lands on Google's error page with no way back to the email form, and reports "it
 * gives me an error", which is all the information they have.
 *
 * The server has no same-origin restriction, so it can follow the chain and read the
 * reason. That turns an unexplained dead end into a sentence naming the fix.
 *
 * SAFETY AND COST
 *
 *  - Read-only: it performs GETs against Supabase and the provider and returns a
 *    verdict. It changes no configuration and creates no session.
 *  - No secrets are exposed. Everything it reads is already public in the authorize
 *    URL the browser would have been sent to anyway.
 *  - `redirect: "manual"` on each hop, with a small hop limit, so a provider
 *    redirect loop cannot hang the request.
 *  - Cached briefly. Provider configuration changes rarely, and without this every
 *    click on the button would cost two external round trips.
 *
 * FAILING OPEN IS DELIBERATE. If this route cannot reach a conclusion it reports
 * `ok: true`, and the button proceeds. A diagnostic that blocks a working sign-in
 * because it could not reach the internet would be worse than the problem it exists
 * to describe.
 */

/** The providers the app offers. Supabase calls Microsoft "azure". */
const PROVIDERS = new Set(["google", "azure"]);

/**
 * Signatures of the provider-side failures worth naming, with the fix.
 *
 * Each `hint` is written for whoever has to act on it, which is usually an
 * administrator rather than the person who clicked the button -- so it says where to
 * go and what to change, not just what is wrong.
 */
function classify(text: string, callbackUri: string): { reason: string; hint: string } | null {
  const t = text.toLowerCase();

  if (t.includes("redirect_uri_mismatch")) {
    return {
      reason: "redirect_uri_mismatch",
      hint:
        `the provider does not recognise this app's callback address. An administrator needs to add ` +
        `exactly "${callbackUri}" to the OAuth client's authorised redirect URIs.`,
    };
  }
  if (t.includes("deleted_client") || t.includes("oauth client was not found") || t.includes("invalid_client")) {
    return {
      reason: "invalid_client",
      hint: "the client ID or secret configured for this provider no longer matches a live OAuth client. An administrator needs to re-enter them.",
    };
  }
  if (t.includes("access_blocked") || t.includes("google verification") || t.includes("has not completed")) {
    return {
      reason: "app_not_verified",
      hint: "the provider's consent screen is still in testing, so only listed test users can sign in. An administrator needs to publish it or add this address as a test user.",
    };
  }
  if (t.includes("org_internal") || t.includes("within its organization") || t.includes("within its organisation")) {
    return {
      reason: "org_internal",
      hint: "the OAuth client is restricted to a single organisation, so outside accounts are refused.",
    };
  }
  if (t.includes("admin_policy_enforced") || t.includes("blocked by your administrator")) {
    return {
      reason: "admin_policy",
      hint: "an organisation policy blocks this app for that account.",
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider") ?? "";
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ ok: true, reason: "unknown provider, not checked" });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    // Nothing to check against; fail open.
    return NextResponse.json({ ok: true, reason: "no supabase url configured" });
  }

  // The URI Supabase will present to the provider. This is the value that has to be
  // registered provider-side, so it is what any hint must quote.
  const callbackUri = `${base.replace(/\/$/, "")}/auth/v1/callback`;
  const redirectTo = `${proxiedOrigin(request)}/auth/callback`;
  const authorize =
    `${base.replace(/\/$/, "")}/auth/v1/authorize?provider=${encodeURIComponent(provider)}` +
    `&redirect_to=${encodeURIComponent(redirectTo)}`;

  const headers = { "cache-control": "public, max-age=300" };

  try {
    const first = await fetch(authorize, { redirect: "manual" });

    // Supabase's own refusal: the provider is switched off.
    if (first.status === 400) {
      const body = await first.text();
      return NextResponse.json(
        {
          ok: false,
          reason: "provider_not_enabled",
          hint: "this provider is not switched on for the app yet. An administrator needs to enable it in the authentication settings.",
          detail: body.slice(0, 200),
        },
        { headers },
      );
    }

    // Narrowed to a definite string before the loop, so reassigning it inside
    // cannot smuggle a null into fetch(). tsc caught this, correctly: the loop
    // reassigns from another headers.get(), which is nullable.
    const firstLocation = first.headers.get("location");
    if (!firstLocation) {
      // No redirect and no 400 -- nothing conclusive to say.
      return NextResponse.json({ ok: true, reason: `supabase returned ${first.status}` }, { headers });
    }
    let location: string = firstLocation;

    // Follow the provider's chain. Google signals a rejected client by redirecting
    // to its own /signin/oauth/error page, so the verdict is only visible after
    // following it -- reading the first status and stopping is what made an earlier
    // version of this check report a broken client as working.
    for (let hop = 0; hop < 5; hop++) {
      const res: Response = await fetch(location, {
        redirect: "manual",
        // A plain fetch UA gets a different (JS-only) page from some providers.
        headers: { "user-agent": "Mozilla/5.0 (compatible; HSEHub/1.0)" },
      });

      const next = res.headers.get("location");
      if (next) {
        // The reason is often already in the query string of the error redirect.
        const asUrl: URL = new URL(next, location);
        const inQuery = `${asUrl.searchParams.get("error") ?? ""} ${asUrl.searchParams.get("error_description") ?? ""}`;
        const fromQuery = classify(inQuery, callbackUri);
        if (fromQuery) return NextResponse.json({ ok: false, ...fromQuery }, { headers });

        location = asUrl.toString();
        continue;
      }

      // Terminal page: classify its text.
      const body = await res.text();
      const verdict = classify(body, callbackUri);
      if (verdict) return NextResponse.json({ ok: false, ...verdict }, { headers });

      // A terminal page that is a sign-in form is the healthy outcome.
      return NextResponse.json({ ok: true, reason: "provider accepted the request" }, { headers });
    }

    // Ran out of hops without a verdict.
    return NextResponse.json({ ok: true, reason: "inconclusive" }, { headers });
  } catch (err) {
    // Network fault, DNS, timeout -- explicitly fail open.
    return NextResponse.json({
      ok: true,
      reason: `check failed: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
}

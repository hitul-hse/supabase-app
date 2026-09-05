"use client";

/**
 * "A new version was deployed while you were working" -- said plainly, and
 * recovered from, instead of the page breaking.
 *
 * THE FAILURE THIS CATCHES. A Server Action is addressed by an opaque ID baked into
 * the JS bundle at build time, and every deploy mints new IDs. A tab loaded before
 * a deploy still holds the old ones, so its next save reaches a server that has
 * never heard of that action. Measured against production, that request returns:
 *
 *     HTTP 404, x-nextjs-action-not-found=1, body "Server action not found."
 *
 * React surfaces it as a rejected action, which took down the page and left the
 * user with "reload" and no explanation. That is what the user hit while recording
 * the org chart, after six deploys landed during their session.
 *
 * WHY THIS EXISTS ALONGSIDE deploymentId. Pinning deploymentId (see next.config.ts)
 * is the real cure, but its routing half needs Skew Protection enabled on the Vercel
 * project. Until then -- and afterwards, for the window where a tab has been open
 * longer than deployments are retained -- the failure is still possible. A tool
 * people record organisation structure in should not answer that with a broken page.
 *
 * WHY A WINDOW LISTENER AND NOT AN ERROR BOUNDARY. An error boundary catches
 * failures during RENDER. This failure happens in an action's own promise, which
 * arrives as an unhandled rejection and never passes through a boundary, so
 * error.tsx cannot see it. Both events are watched because Next reports it as a
 * rejection in some paths and a window error in others.
 *
 * IT DOES NOT RELOAD BY ITSELF. An automatic reload would discard whatever is typed
 * in the form beside it, and the user would see a flash and their input gone. The
 * choice is theirs; the message says why it is needed.
 */

import { useEffect, useState } from "react";

/** The strings Next.js uses for a missing action, across versions. */
const SKEW_SIGNATURES = [
  "Failed to find Server Action",
  "Server action not found",
  "server action was not found",
  "an older or newer deployment",
];

const looksLikeSkew = (value: unknown): boolean => {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? `${value.message} ${value.stack ?? ""}`
        : String(value ?? "");
  return SKEW_SIGNATURES.some((s) => text.toLowerCase().includes(s.toLowerCase()));
};

export function StaleDeployNotice() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (looksLikeSkew(e.reason)) {
        setStale(true);
        // Claim it: otherwise this also reaches the console as an uncaught error
        // and, in some paths, tears down the tree we are trying to keep alive.
        e.preventDefault();
      }
    };
    const onError = (e: ErrorEvent) => {
      if (looksLikeSkew(e.error ?? e.message)) {
        setStale(true);
        e.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="alert"
      // Fixed and high: it must be readable wherever the person had scrolled to
      // when the save failed, and above the dashboard's own layers.
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t border-[var(--border-strong)] px-4 py-3"
      style={{ background: "var(--warning-wash)" }}
    >
      <div className="flex flex-col">
        <span className="t-headline text-[var(--text-primary)]">
          A new version of the Hub was deployed while this page was open
        </span>
        <span className="t-callout text-[var(--text-secondary)]">
          Your last change was not saved, because this tab was still talking to the
          previous version. Reload and repeat it — nothing else is affected.
        </span>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 t-callout font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
      >
        Reload now
      </button>
    </div>
  );
}

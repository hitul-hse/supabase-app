"use client";

/**
 * Route-level error boundary for the app shell.
 *
 * Without this, a failed query inside any (app) page falls through to the
 * framework's default error screen, which shows a stack trace in dev and a
 * blank page in production. A data-tool that silently blanks a page is worse
 * than one that says what happened and offers a way forward.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
          HSE HUB
        </span>
        <h1 className="text-[17px] font-semibold text-[var(--text-primary)]">
          This page couldn&apos;t load
        </h1>
        <p className="max-w-[52ch] text-[12px] leading-relaxed text-[var(--text-muted)]">
          The data behind this screen failed to load. This is usually temporary — trying again
          often resolves it. If it keeps happening, the reference below helps trace the cause.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={reset}
          className="bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="border border-[var(--border-strong)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
        >
          Back to Overview
        </Link>
      </div>

      {error.digest && (
        <span className="font-mono text-[10px] text-[var(--text-faint)]">REF {error.digest}</span>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { uploadFile } from "./actions";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/utils/uploads/validation";

export function UploadForm() {
  const [state, formAction, isPending] = useActionState(uploadFile, {
    status: "idle",
  });

  return (
    <>
      <form
        action={formAction}
        className="flex items-center gap-3 border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-4"
      >
        <input
          type="file"
          name="file"
          required
          disabled={isPending}
          className="w-full text-sm text-[var(--text-secondary)] file:mr-3 file:border-0 file:bg-[var(--surface-hover)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--text-primary)] hover:file:bg-[var(--border)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {isPending ? "Uploading…" : "Upload"}
        </button>
      </form>

      {state.status === "success" && (
        <div
          className="flex items-start gap-3 border border-[var(--border)] p-4 text-sm"
          style={{ background: "var(--good-wash)" }}
        >
          <span aria-hidden className="mt-0.5 text-base text-[var(--good)]">
            ✓
          </span>
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}

      {state.status === "error" && (
        <div
          className="flex items-start gap-3 border border-[var(--border)] p-4 text-sm"
          style={{ background: "var(--critical-wash)" }}
        >
          <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">
            ✕
          </span>
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}

      <div className="text-xs text-[var(--text-secondary)]">
        Max file size: {formatBytes(MAX_UPLOAD_BYTES)}. Allowed types: images (PNG, JPEG, GIF, WebP, SVG), PDF, plain text, CSV, JSON, ZIP.
      </div>
    </>
  );
}

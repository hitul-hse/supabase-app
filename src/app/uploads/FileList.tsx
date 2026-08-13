"use client";

import Link from "next/link";
import { formatBytes } from "@/utils/uploads/validation";
import type { FileRecord } from "@/lib/queries/types";

type Props = {
  files: (FileRecord & { url: string })[];
  page: number;
  totalPages: number;
};

export function FileList({ files, page, totalPages }: Props) {
  const navBtn =
    "border border-[var(--border)] px-3 py-1.5 text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]";
  const navBtnDisabled =
    "pointer-events-none border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)] opacity-50";

  return (
    <>
      <ul className="divide-y divide-[var(--border)] border border-[var(--border)] bg-[var(--surface)]">
        {files.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-[var(--surface-hover)]"
          >
            <div>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
              >
                {f.original_name}
              </a>
              <div className="font-mono text-[11px] text-[var(--text-muted)]">
                {formatBytes(f.size_bytes ?? 0)} · {new Date(f.uploaded_at).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
        {files.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            No files uploaded yet.
          </li>
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/uploads?page=${Math.max(1, page - 1)}`}
            className={page <= 1 ? navBtnDisabled : navBtn}
          >
            ← Previous
          </Link>
          <span className="font-mono text-[12px] text-[var(--text-secondary)]">
            Page {page} of {totalPages}
          </span>
          <Link
            href={`/uploads?page=${Math.min(totalPages, page + 1)}`}
            className={page >= totalPages ? navBtnDisabled : navBtn}
          >
            Next →
          </Link>
        </div>
      )}
    </>
  );
}

// Shared upload constraints. Used by the server action to reject bad uploads
// before anything touches Google Cloud Storage.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
] as const;

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Turn a user-supplied filename into a safe GCS object key segment.
 *
 * Strips any directory components, drops characters outside a conservative
 * allowlist, and collapses runs of separators. Always returns a non-empty
 * string so the caller can't end up with a bare or path-traversing key.
 */
export function sanitizeFileName(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? "";

  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);

  return cleaned.length > 0 ? cleaned : "file";
}

/** Build the object key for an upload: time-ordered prefix + safe name. */
export function buildObjectPath(rawName: string): string {
  return `${Date.now()}-${sanitizeFileName(rawName)}`;
}

export function isAllowedContentType(contentType: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

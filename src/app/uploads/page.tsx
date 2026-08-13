import { cache } from "react";
import { getBucket } from "@/utils/gcs/client";
import { createClient } from "@/utils/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { uploadFile } from "./actions";

const getSignedUrlExpiry = cache(() => Date.now() + 15 * 60 * 1000);

export default async function UploadsPage() {
  const supabase = await createClient();
  const { data: files, error } = await supabase
    .from("files")
    .select("*")
    .order("uploaded_at", { ascending: false });

  const bucket = getBucket();
  const filesWithUrls = await Promise.all(
    (files ?? []).map(async (f) => {
      const [url] = await bucket.file(f.object_path).getSignedUrl({
        action: "read",
        expires: getSignedUrlExpiry(),
      });
      return { ...f, url };
    }),
  );

  return (
    <div>
      <PageHeader title="Uploads" meta="Google Cloud Storage" />

      <div className="flex flex-col gap-5 p-6">
        <form
          action={uploadFile}
          className="flex items-center gap-3 border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-4"
        >
          <input
            type="file"
            name="file"
            required
            className="w-full text-sm text-[var(--text-secondary)] file:mr-3 file:border-0 file:bg-[var(--surface-hover)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--text-primary)] hover:file:bg-[var(--border)]"
          />
          <button
            type="submit"
            className="shrink-0 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Upload
          </button>
        </form>

        {error && (
          <div className="flex items-start gap-3 border border-[var(--border)] p-4 text-sm" style={{ background: "var(--critical-wash)" }}>
            <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">✕</span>
            <p className="text-[var(--text-primary)]">{error.message}</p>
          </div>
        )}

        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] bg-[var(--surface)]">
          {filesWithUrls.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-[var(--surface-hover)]">
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
                  {(f.size_bytes / 1024).toFixed(1)} KB · {new Date(f.uploaded_at).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
          {filesWithUrls.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No files uploaded yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

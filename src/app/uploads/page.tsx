import { getBucket } from "@/utils/gcs/client";
import { createClient } from "@/utils/supabase/server";
import { uploadFile } from "./actions";

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
        expires: Date.now() + 15 * 60 * 1000,
      });
      return { ...f, url };
    }),
  );

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
          Uploads (Google Cloud Storage)
        </h1>

        <form action={uploadFile} className="mb-6 flex gap-2">
          <input
            type="file"
            name="file"
            required
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            Upload
          </button>
        </form>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
            {error.message}
          </div>
        )}

        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filesWithUrls.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                  {f.original_name}
                </a>
                <div className="text-zinc-500">
                  {(f.size_bytes / 1024).toFixed(1)} KB · {new Date(f.uploaded_at).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
          {filesWithUrls.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">No files uploaded yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

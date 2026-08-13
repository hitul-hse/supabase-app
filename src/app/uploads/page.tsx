import { cache } from "react";
import { getBucket } from "@/utils/gcs/client";
import { createClient } from "@/utils/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { UploadForm } from "./UploadForm";
import { FileList } from "./FileList";

const PAGE_SIZE = 25;

type SearchParams = { page?: string };

const getSignedUrlExpiry = cache(() => Date.now() + 15 * 60 * 1000);

export default async function UploadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const { data: files, count, error } = await supabase
    .from("files")
    .select("*", { count: "exact" })
    .order("uploaded_at", { ascending: false })
    .range(from, to);

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  if (error) {
    return (
      <div>
        <PageHeader title="Uploads" meta="Google Cloud Storage" />
        <div className="flex flex-col gap-5 p-6">
          <div
            className="flex items-start gap-3 border border-[var(--border)] p-4 text-sm"
            style={{ background: "var(--critical-wash)" }}
          >
            <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">
              ✕
            </span>
            <p className="text-[var(--text-primary)]">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  let filesWithUrls: Array<(typeof files)[number] & { url: string }> = [];
  if (files && files.length > 0) {
    const bucket = getBucket();
    filesWithUrls = await Promise.all(
      files.map(async (f) => {
        const [url] = await bucket.file(f.object_path).getSignedUrl({
          action: "read",
          expires: getSignedUrlExpiry(),
        });
        return { ...f, url };
      }),
    );
  }

  return (
    <div>
      <PageHeader title="Uploads" meta="Google Cloud Storage" />
      <div className="flex flex-col gap-5 p-6">
        <UploadForm />
        <FileList
          files={filesWithUrls}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}

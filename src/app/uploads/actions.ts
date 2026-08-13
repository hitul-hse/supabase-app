"use server";

import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { getBucket } from "@/utils/gcs/client";
import { createClient } from "@/utils/supabase/server";
import {
  ALLOWED_CONTENT_TYPES,
  DEFAULT_CONTENT_TYPE,
  MAX_UPLOAD_BYTES,
  buildObjectPath,
  formatBytes,
  isAllowedContentType,
} from "@/utils/uploads/validation";

export type UploadState = { status: "idle" | "success" | "error"; message?: string };

function failure(message: string): UploadState {
  return { status: "error", message };
}

export async function uploadFile(
  _prevState: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return failure("Choose a file to upload.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return failure(
      `File is ${formatBytes(file.size)}, which exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`,
    );
  }

  const contentType = file.type || DEFAULT_CONTENT_TYPE;
  if (!isAllowedContentType(contentType)) {
    return failure(
      `Files of type "${contentType}" aren't allowed. Accepted types: ${ALLOWED_CONTENT_TYPES.join(", ")}.`,
    );
  }

  const objectPath = buildObjectPath(file.name);
  const blob = getBucket().file(objectPath);

  // Stream straight through to GCS so a large upload never has to sit in
  // function memory as one contiguous buffer.
  try {
    await pipeline(
      Readable.fromWeb(file.stream() as NodeWebReadableStream<Uint8Array>),
      blob.createWriteStream({ contentType, resumable: false }),
    );
  } catch (error) {
    console.error("[uploads] GCS write failed", { objectPath, error });
    return failure("Upload to storage failed. Please try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("files").insert({
    object_path: objectPath,
    original_name: file.name,
    content_type: contentType,
    size_bytes: file.size,
  });

  // There's no transaction spanning GCS and Postgres, so if the metadata row
  // fails we delete the object we just wrote rather than leaving it orphaned
  // in the bucket with nothing pointing at it.
  if (error) {
    console.error("[uploads] metadata insert failed, rolling back object", {
      objectPath,
      error,
    });

    try {
      await blob.delete({ ignoreNotFound: true });
    } catch (cleanupError) {
      console.error("[uploads] orphan cleanup failed; object left in bucket", {
        objectPath,
        cleanupError,
      });
    }

    return failure("Could not record the upload. Please try again.");
  }

  revalidatePath("/uploads");
  return { status: "success", message: `Uploaded ${file.name}.` };
}

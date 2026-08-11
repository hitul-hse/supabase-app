"use server";

import { revalidatePath } from "next/cache";
import { getBucket } from "@/utils/gcs/client";
import { createClient } from "@/utils/supabase/server";

export async function uploadFile(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return;

  const objectPath = `${Date.now()}-${file.name}`;
  const bucket = getBucket();
  const buffer = Buffer.from(await file.arrayBuffer());

  await bucket.file(objectPath).save(buffer, {
    contentType: file.type || "application/octet-stream",
  });

  const supabase = await createClient();
  await supabase.from("files").insert({
    object_path: objectPath,
    original_name: file.name,
    content_type: file.type,
    size_bytes: file.size,
  });

  revalidatePath("/uploads");
}

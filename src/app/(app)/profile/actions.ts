"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { MAX_AVATAR_BYTES, ALLOWED_AVATAR_TYPES, type ProfileActionState } from "./constants";

const MAX_DISPLAY_NAME = 60;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function updateDisplayName(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const raw = String(formData.get("display_name") ?? "").trim();
  if (raw.length > MAX_DISPLAY_NAME) {
    return { status: "error", message: `Keep it under ${MAX_DISPLAY_NAME} characters.` };
  }

  // Empty clears the override and falls back to the HR name, which is why
  // this is null rather than "". A whitespace-only name would also violate
  // the display_name check constraint (char_length(btrim(...)) >= 1), so it
  // is treated the same as empty here rather than sent through to fail loudly.
  const { error } = await supabase
    .from("app_user_profile")
    .update({ display_name: raw === "" ? null : raw })
    .eq("user_id", user.id);

  if (error) {
    // The raw error can contain schema/constraint internals (e.g. a check
    // constraint name) that mean nothing to the caller and shouldn't leave
    // the server. Logged here for a developer; a short message goes out.
    console.error("[profile] updateDisplayName failed:", error);
    return { status: "error", message: "Couldn't save your name. Try again." };
  }

  revalidatePath("/profile");
  return { status: "success", message: raw === "" ? "Using your HR name." : "Name updated." };
}

export async function uploadAvatar(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose an image first." };
  }
  // Re-checked here on purpose. The browser resized and filtered before
  // sending, but this endpoint is reachable without the browser.
  if (file.size > MAX_AVATAR_BYTES) {
    return { status: "error", message: "That image is over 2 MB." };
  }
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return { status: "error", message: "Use a JPEG, PNG, or WebP image." };
  }

  const { data: existing } = await supabase
    .from("app_user_profile")
    .select("avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const key = `${user.id}/avatar.${EXT[file.type]}`;

  // Write first, delete the old key after. The other order leaves the account
  // with no photo at all if the upload fails.
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(key, file, { upsert: true, contentType: file.type });
  if (upErr) {
    console.error("[profile] uploadAvatar storage upload failed:", upErr);
    return { status: "error", message: "Couldn't upload your photo. Try again." };
  }

  const { error: rowErr } = await supabase
    .from("app_user_profile")
    .update({ avatar_url: key })
    .eq("user_id", user.id);
  if (rowErr) {
    console.error("[profile] uploadAvatar row update failed:", rowErr);
    return { status: "error", message: "Couldn't save your photo. Try again." };
  }

  if (existing?.avatar_url && existing.avatar_url !== key) {
    await supabase.storage.from("avatars").remove([existing.avatar_url]);
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout"); // the sidebar chip
  return { status: "success", message: "Photo updated." };
}

export async function removeAvatar(): Promise<ProfileActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const { data: existing } = await supabase
    .from("app_user_profile")
    .select("avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.avatar_url) {
    await supabase.storage.from("avatars").remove([existing.avatar_url]);
  }

  const { error } = await supabase
    .from("app_user_profile")
    .update({ avatar_url: null })
    .eq("user_id", user.id);
  if (error) {
    console.error("[profile] removeAvatar failed:", error);
    return { status: "error", message: "Couldn't remove your photo. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { status: "success", message: "Photo removed." };
}

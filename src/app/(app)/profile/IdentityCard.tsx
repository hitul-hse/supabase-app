"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { ProfileView } from "@/lib/queries/profile";
import { ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES, type ProfileActionState } from "./constants";
import { updateDisplayName, uploadAvatar } from "./actions";

const IDLE: ProfileActionState = { status: "idle" };

export function IdentityCard({
  profile,
  signedAvatarUrl,
}: {
  profile: ProfileView;
  signedAvatarUrl: string | null;
}) {
  const [nameState, nameAction, namePending] = useActionState(updateDisplayName, IDLE);
  const [photoState, photoAction, photoPending] = useActionState(uploadAvatar, IDLE);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Without this the "Save photo" button stays visible against the now-stale
  // preview after a successful upload, and a second click re-uploads the same
  // file.
  //
  // Cleared during render rather than in a useEffect: react-hooks/set-state-in-effect
  // flags a setState call that only derives one piece of state (preview) from
  // another (photoState) inside an effect, since it costs an extra render pass
  // for no benefit. `handledPhotoState` tracks the last photoState this
  // component has reacted to, so the clear happens at most once per action
  // result, in the same render that observes the new result.
  const [handledPhotoState, setHandledPhotoState] = useState(photoState);
  if (photoState !== handledPhotoState) {
    setHandledPhotoState(photoState);
    if (photoState.status === "success") setPreview(null);
  }

  // Revoking the object URL and resetting the file input's value are real
  // side effects on external state (a browser object URL, DOM element value),
  // not derived React state, so they belong in an effect keyed on `preview`.
  // Resetting the input also lets the same file be re-picked immediately.
  useEffect(() => {
    if (preview === null && fileRef.current) fileRef.current.value = "";
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Optimistic preview so the new photo appears before the round trip. The
  // same limits are enforced in the action; this only saves a wasted upload.
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLocalError(null);
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setLocalError("Use a JPEG, PNG, or WebP image.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setLocalError("That image is over 2 MB.");
      e.target.value = "";
      return;
    }
    setPreview(URL.createObjectURL(file));
  }

  const message = localError ?? photoState.message ?? nameState.message;
  const isError = !!localError || photoState.status === "error" || nameState.status === "error";

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-4 text-[13px] font-semibold text-[var(--text-primary)]">Identity</h2>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <form action={photoAction} className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Change your photo"
          >
            <Avatar name={profile.effectiveName} src={preview ?? signedAvatarUrl} size={88} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </button>

          <input
            ref={fileRef}
            type="file"
            name="avatar"
            accept={ALLOWED_AVATAR_TYPES.join(",")}
            onChange={onPick}
            className="hidden"
          />

          {preview && (
            <button
              type="submit"
              disabled={photoPending}
              className="text-[11px] text-[var(--accent)] disabled:opacity-50"
            >
              {photoPending ? "Uploading…" : "Save photo"}
            </button>
          )}
        </form>

        <form action={nameAction} className="flex flex-1 flex-col gap-2">
          <label
            htmlFor="display_name"
            className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--text-faint)]"
          >
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            defaultValue={profile.displayName ?? ""}
            maxLength={60}
            placeholder={profile.effectiveName}
            className="w-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <p className="text-[11px] text-[var(--text-faint)]">
            Leave empty to use your HR name.
          </p>
          <button
            type="submit"
            disabled={namePending}
            className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            {namePending ? "Saving…" : "Save name"}
          </button>
        </form>
      </div>

      {message && (
        <p
          className="mt-4 text-[12px]"
          style={{ color: isError ? "var(--critical)" : "var(--good)" }}
        >
          {message}
        </p>
      )}
    </section>
  );
}

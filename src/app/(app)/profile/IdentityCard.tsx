"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";
import type { ProfileView } from "@/lib/queries/profile";
import { ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES, type ProfileActionState } from "./constants";
import { updateDisplayName, uploadAvatar, removeAvatar } from "./actions";

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
  // removeAvatar takes no arguments -- it acts on the caller's own session,
  // same as the other three actions read their user from getUser() rather
  // than from any submitted field. useActionState always calls the action
  // with (state, formData); removeAvatar simply ignores both, which
  // TypeScript accepts because a function requiring fewer parameters is
  // assignable wherever one requiring more is expected.
  const [removeState, removeAction, removePending] = useActionState(removeAvatar, IDLE);
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

  // Which of the three actions produced the most recently observed result.
  // Without this, a fixed priority order (photo, then name, then remove)
  // means an older result can shadow a newer one from a different action --
  // e.g. upload a photo, then click "Remove photo", and the card kept
  // showing "Photo updated." forever, in the success colour, even after a
  // remove failure turned the true state to an error. Each state object is a
  // fresh reference only when its action actually completes, so comparing by
  // reference (same pattern as handledPhotoState above) tells us which one
  // just changed, in the same render that observes it -- no effect needed.
  const [lastResult, setLastResult] = useState<ProfileActionState | null>(null);
  const [seenName, setSeenName] = useState(nameState);
  const [seenRemove, setSeenRemove] = useState(removeState);

  if (photoState !== handledPhotoState) {
    setHandledPhotoState(photoState);
    if (photoState.status === "success") setPreview(null);
    if (photoState.status !== "idle") setLastResult(photoState);
  }
  if (nameState !== seenName) {
    setSeenName(nameState);
    if (nameState.status !== "idle") setLastResult(nameState);
  }
  if (removeState !== seenRemove) {
    setSeenRemove(removeState);
    if (removeState.status !== "idle") setLastResult(removeState);
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

  const message = localError ?? lastResult?.message;
  const isError = !!localError || lastResult?.status === "error";

  return (
    // Identity is a top-level profile section: avatar upload + display name.
    <Card>
      <CardHeader title="Identity" />
      <CardDivider />
      <div className="p-5">

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
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

          {/*
            Only when there is a photo to remove -- a person who has never
            set one, or who is mid-pick of a new file (a fresh preview,
            not yet saved), has nothing this control should act on. A
            separate <form> because removeAvatar is its own Server Action
            and a <form> can only carry one `action`; nesting it inside
            photoAction's form would be invalid HTML besides.
          */}
          {signedAvatarUrl && !preview && (
            <form action={removeAction}>
              <button
                type="submit"
                disabled={removePending}
                className="border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                {removePending ? "Removing…" : "Remove photo"}
              </button>
            </form>
          )}
        </div>

        <form action={nameAction} className="flex flex-1 flex-col gap-2">
          <label
            htmlFor="display_name"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]"
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
      </div>
    </Card>
  );
}

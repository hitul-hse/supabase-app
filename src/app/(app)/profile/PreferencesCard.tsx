"use client";

import { useActionState } from "react";
import type { ProfileView } from "@/lib/queries/profile";
import { updatePreferences } from "./actions";
import { LANDING_PAGES, LOCALES, type ProfileActionState } from "./constants";

const IDLE: ProfileActionState = { status: "idle" };

const selectClass =
  "w-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";
const labelClass =
  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--text-faint)]";

export function PreferencesCard({ profile }: { profile: ProfileView }) {
  const [state, action, pending] = useActionState(updatePreferences, IDLE);

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-4 text-[13px] font-semibold text-[var(--text-primary)]">Preferences</h2>
      <p className="mb-4 text-[11.5px] text-[var(--text-faint)]">
        These are saved to your profile now, but nothing in the app reads them yet — they will
        take effect in a later release.
      </p>

      <form action={action} className="flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref_landing_page" className={labelClass}>
            Open on sign-in
          </label>
          <select
            id="pref_landing_page"
            name="pref_landing_page"
            defaultValue={profile.prefLandingPage}
            className={selectClass}
          >
            {LANDING_PAGES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref_locale" className={labelClass}>
            Dates and numbers
          </label>
          <select
            id="pref_locale"
            name="pref_locale"
            defaultValue={profile.prefLocale}
            className={selectClass}
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            name="pref_sidebar_collapsed"
            defaultChecked={profile.prefSidebarCollapsed}
          />
          Keep the sidebar collapsed
        </label>

        <button
          type="submit"
          disabled={pending}
          className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>

        {state.message && (
          <p
            className="text-[12px]"
            style={{ color: state.status === "error" ? "var(--critical)" : "var(--good)" }}
          >
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}

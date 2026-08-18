# User Profile Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-service `/profile` page where a signed-in person manages their photo, display name, password, and preferences, and reads their HR data.

**Architecture:** One route in the `(app)` group, four cards that submit independently via Server Actions. User-owned data lives on `app_user_profile`; HR data renders read-only from `people` and is never written. Photos go to a private Supabase Storage bucket with owner-scoped RLS.

**Tech Stack:** Next.js 16 (App Router, React 19 `useActionState`), TypeScript, Tailwind, Supabase (Postgres + Auth + Storage), `@supabase/ssr`, framer-motion. Tests are plain Node scripts under `scripts/check-*.mjs` — there is no vitest or jest in this repo, do not add one.

**Spec:** `docs/superpowers/specs/2026-08-18-user-profile-design.md`

## Global Constraints

- **Never write to `public.people`.** It is destined for Factorial/TrackingTime sync. All user-editable data goes on `public.app_user_profile`.
- **Design tokens are the ones in `src/app/globals.css`**, not the ones in `DESIGN.md`. `DESIGN.md` documents `--bg-0`/`--teal`, which do not exist. Use: `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-faint`, `--accent`, `--critical`, `--warning`, `--good`, `--radius`.
- **Every Server Action re-checks identity server-side.** From `AGENTS.md`: *"Server Actions are public HTTP endpoints. Re-check the caller's identity and role inside the action. A page-level gate does not protect an action."* No action accepts a target user id — always `auth.uid()`.
- **Client-side validation is never the only validation.** Every size/MIME/length limit enforced in the browser is re-enforced in the action.
- **Migration files** live in `supabase/migrations/` with plain unversioned names (repo convention — they are not in the Supabase ledger).
- **Commit after every task.** Branch is `feat/user-profile`; do not push.
- Card markup convention, copied from `src/app/(app)/leave/page.tsx`:
  `className="border border-[var(--border)] bg-[var(--surface)] p-5"`

---

### Task 1: Schema — profile columns, avatars bucket, storage RLS

**Files:**
- Create: `supabase/migrations/add_user_profile_fields.sql`
- Create: `scripts/check-profile-rls.mjs`
- Modify: `package.json` (scripts block)
- Modify: `src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: nothing
- Produces: columns `app_user_profile.display_name`, `.avatar_url`, `.pref_landing_page`, `.pref_locale`, `.pref_sidebar_collapsed`; storage bucket `avatars`; npm script `check:profile-rls`

- [ ] **Step 1: Write the failing gate**

Create `scripts/check-profile-rls.mjs`:

```js
/**
 * Does the profile schema exist, and can one user reach another's data?
 *
 * The columns and bucket are easy to assert. The part that matters is the
 * storage policy: every avatar lives in the same bucket, so the ONLY thing
 * standing between one employee's photo and another is a policy expression
 * on a path prefix. This asserts that expression exists and is anchored to
 * auth.uid(), because a policy that merely mentions the right table is not
 * the same as one that restricts anything.
 *
 * SKIPs without a service-role key so CI cannot go red over a missing secret.
 */
import { readFileSync, existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local");
  process.exit(0);
}
const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const service = get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !service) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function sql(query) {
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql_readonly`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const cols = await sql(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='app_user_profile'
`);
const names = cols.map((r) => r.column_name);
for (const c of [
  "display_name",
  "avatar_url",
  "pref_landing_page",
  "pref_locale",
  "pref_sidebar_collapsed",
]) {
  check(names.includes(c), `app_user_profile.${c} exists`);
}

const buckets = await sql(`select id, public from storage.buckets where id='avatars'`);
check(buckets.length === 1, "avatars bucket exists");
check(buckets[0]?.public === false, "avatars bucket is PRIVATE", "a public bucket is world-readable by URL");

const pols = await sql(`
  select policyname, cmd, qual, with_check from pg_policies
  where schemaname='storage' and tablename='objects' and policyname like 'avatars_%'
`);
for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
  const p = pols.find((x) => x.cmd === cmd);
  check(!!p, `avatars policy for ${cmd} exists`);
  const expr = `${p?.qual ?? ""} ${p?.with_check ?? ""}`;
  check(
    !!p && expr.includes("auth.uid()") && expr.includes("foldername"),
    `${cmd} policy is anchored to auth.uid() and the path prefix`,
    p ? "" : "missing"
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
```

Add to `package.json` scripts:

```json
"check:profile-rls": "node scripts/check-profile-rls.mjs",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:profile-rls`
Expected: FAIL lines for every column, the bucket, and all four policies (or SKIP if `.env.local` lacks a service key — in that case set one before continuing; this gate is the reason the task exists).

> If the repo has no `exec_sql_readonly` RPC, replace the `sql()` helper body with a direct `pg` connection using `SUPABASE_DB_URL`, or run the assertions through the Supabase MCP `execute_sql` tool and keep the gate as a thin wrapper. Do not skip the assertions.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/add_user_profile_fields.sql`:

```sql
-- Self-service profile fields, and a private bucket for photos.
--
-- Everything here hangs off app_user_profile, never public.people. people is
-- destined to be fed by Factorial and TrackingTime, so a display name written
-- there would be silently overwritten by the next sync with no way to detect
-- or resolve the conflict.
--
-- Safe to run more than once.

begin;

alter table public.app_user_profile
  add column if not exists display_name           text,
  add column if not exists avatar_url             text,
  add column if not exists pref_landing_page      text    not null default '/',
  add column if not exists pref_locale            text    not null default 'de-DE',
  add column if not exists pref_sidebar_collapsed boolean not null default false;

-- Constraints rather than a JSON blob: each preference has a fixed domain, and
-- a bad value should fail at write time rather than render as a broken page.
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname='app_user_profile_locale_check') then
    alter table public.app_user_profile add constraint app_user_profile_locale_check
      check (pref_locale in ('de-DE','en-GB'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_user_profile_landing_check') then
    alter table public.app_user_profile add constraint app_user_profile_landing_check
      check (pref_landing_page in ('/','/people','/projects','/timesheets','/time/dashboard','/leave'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_user_profile_display_name_len') then
    alter table public.app_user_profile add constraint app_user_profile_display_name_len
      check (display_name is null or char_length(btrim(display_name)) between 1 and 60);
  end if;
end $mig$;

-- Private. A public bucket serves every employee photo to anyone who can guess
-- a path, and the paths are user uuids, which appear in other responses.
insert into storage.buckets (id, name, public)
values ('avatars','avatars', false)
on conflict (id) do update set public = false;

-- One object per user at {user_id}/avatar.{ext}. foldername(name)[1] is that
-- first path segment; comparing it to auth.uid() is what keeps one employee
-- out of another's photo.
drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
```

- [ ] **Step 4: Apply it**

Apply the file's contents to the project using the Supabase MCP `apply_migration` tool, name `add_user_profile_fields`. Do not hand-edit the database instead of the file — the file is the record.

- [ ] **Step 5: Run the gate to verify it passes**

Run: `npm run check:profile-rls`
Expected: every line PASS, exit 0.

- [ ] **Step 6: Regenerate types**

Use the Supabase MCP `generate_typescript_types` tool and write its output to `src/lib/database.types.ts`. Confirm the new columns appear:

Run: `grep -c "pref_landing_page\|display_name\|avatar_url" src/lib/database.types.ts`
Expected: at least 3.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/add_user_profile_fields.sql scripts/check-profile-rls.mjs package.json src/lib/database.types.ts
git commit -m "Add profile fields and a private avatars bucket, with the policy gate first"
```

---

### Task 2: Extract the password-strength helpers

**Files:**
- Create: `src/lib/password-strength.ts`
- Create: `scripts/check-password-strength.mjs`
- Modify: `src/app/auth/set-password/page.tsx` (remove local copies, import instead)
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `getPasswordStrength(pwd: string): { score: number; label: string; color: string }`, `PasswordStrengthBar({ password }: { password: string })`, `MIN_PASSWORD_LENGTH: number`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-password-strength.mjs`:

```js
/**
 * The strength meter moved out of set-password so the profile page can reuse
 * it. Two meters that scored differently would be worse than one, so this
 * pins the scoring rather than merely checking the module imports.
 */
import { getPasswordStrength } from "../src/lib/password-strength.ts";

let failures = 0;
const eq = (actual, expected, label) => {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
};

eq(getPasswordStrength("").score, 0, "empty scores 0");
eq(getPasswordStrength("").label, "", "empty has no label");
eq(getPasswordStrength("abcdefgh").score, 1, "8 lowercase scores 1");
eq(getPasswordStrength("abcdefgh1").score, 2, "8 + digit scores 2");
eq(getPasswordStrength("Abcdefgh1").score, 3, "8 + digit + upper scores 3");
eq(getPasswordStrength("Abcdefgh1!").score, 4, "8 + digit + upper + symbol scores 4");
eq(getPasswordStrength("Abcdefghijklmn1!").score, 4, "score clamps at 4");
eq(getPasswordStrength("Abcdefgh1!").label, "Very strong", "label matches score 4");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
```

Add to `package.json`:

```json
"check:password-strength": "node --experimental-strip-types scripts/check-password-strength.mjs",
```

(`--experimental-strip-types` is already used by `check:parallel-paging` in this repo, so the flag is an established pattern here.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:password-strength`
Expected: FAIL — cannot resolve `../src/lib/password-strength.ts`.

- [ ] **Step 3: Create the module**

Create `src/lib/password-strength.ts` with the code moved verbatim from `src/app/auth/set-password/page.tsx`, now exported:

```tsx
export const MIN_PASSWORD_LENGTH = 8;

/** 0-4 password strength score based on length, digits, uppercase, and symbols. */
export function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 14) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const clamp = Math.min(score, 4);
  const labels = ["Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["var(--critical)", "var(--warning)", "var(--warning)", "var(--good)", "var(--good)"];
  return { score: clamp, label: labels[clamp], color: colors[clamp] };
}

export function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all"
            style={{ background: i <= score ? color : "var(--border)" }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Update the original call site**

In `src/app/auth/set-password/page.tsx`, delete the local `MIN_PASSWORD_LENGTH`, `getPasswordStrength`, and `PasswordStrengthBar` definitions and add:

```tsx
import { MIN_PASSWORD_LENGTH, PasswordStrengthBar } from "@/lib/password-strength";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check:password-strength`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: exit 0 — proves the set-password page still compiles with the imports.

- [ ] **Step 6: Commit**

```bash
git add src/lib/password-strength.ts scripts/check-password-strength.mjs src/app/auth/set-password/page.tsx package.json
git commit -m "Extract the password strength meter so two pages cannot disagree"
```

---

### Task 3: Profile read query and Avatar component

**Files:**
- Create: `src/lib/queries/profile.ts`
- Create: `src/components/Avatar.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/utils/supabase/server`, `SupabaseTyped` from `@/lib/queries/types`
- Produces:
  - `type ProfileView = { userId, email, displayName, effectiveName, avatarUrl, roleKey, roleDisplayName, department, personId, employeeNumber, contractHours, holidayLeft, totalHoliday, certificateStatus, since, prefLandingPage, prefLocale, prefSidebarCollapsed }`
  - `getProfileView(supabase: SupabaseTyped, userId: string, email: string | null): Promise<ProfileView | null>`
  - `<Avatar name={string} src={string | null} size={number} />`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-avatar-monogram.mjs`:

```js
/**
 * The monogram is the fallback every account starts on, so it has to look
 * deliberate rather than broken. Two properties matter: initials are derived
 * predictably, and a person's colour is stable — a monogram that changed hue
 * between renders would read as a glitch.
 */
import { initialsOf, colorForName } from "../src/components/Avatar.tsx";

let failures = 0;
const eq = (a, b, label) => {
  const ok = a === b;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(a)}`);
  if (!ok) failures++;
};

eq(initialsOf("Lena Fischer"), "LF", "two names give two initials");
eq(initialsOf("Lena"), "L", "one name gives one initial");
eq(initialsOf("lena fischer"), "LF", "initials are uppercased");
eq(initialsOf("Lena van der Berg"), "LB", "first and last only");
eq(initialsOf("  "), "?", "blank falls back to ?");
eq(initialsOf(""), "?", "empty falls back to ?");
eq(colorForName("Lena Fischer"), colorForName("Lena Fischer"), "colour is stable for a name");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
```

Add to `package.json`:

```json
"check:avatar": "node --experimental-strip-types scripts/check-avatar-monogram.mjs",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:avatar`
Expected: FAIL — cannot resolve `../src/components/Avatar.tsx`.

- [ ] **Step 3: Write the Avatar component**

Create `src/components/Avatar.tsx`:

```tsx
/**
 * A person's picture, or a monogram when they have not set one.
 *
 * The monogram is not a placeholder — most accounts will never upload a photo,
 * so this is the normal state and has to look designed. Colour is derived from
 * the name so it is stable across sessions and devices; a hue that changed per
 * render would read as a rendering bug.
 */
import Image from "next/image";

/** First and last initial. Middle names are dropped: "L. van der Berg" reads as LB. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PALETTE = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--viz-series-1)",
];

/** Deterministic palette pick, so one person is always the same colour. */
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-label={name}
      className="flex items-center justify-center rounded-full font-medium text-[var(--surface)]"
      style={{
        width: size,
        height: size,
        background: colorForName(name),
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
```

- [ ] **Step 4: Write the profile query**

Create `src/lib/queries/profile.ts`:

```ts
import type { SupabaseTyped } from "./types";

export type ProfileView = {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** What to show: the chosen name, else the HR name, else a neutral fallback. */
  effectiveName: string;
  avatarUrl: string | null;
  roleKey: string;
  roleDisplayName: string;
  department: string | null;
  personId: string | null;
  employeeNumber: string | null;
  contractHours: number | null;
  holidayLeft: number | null;
  totalHoliday: number | null;
  certificateStatus: string | null;
  since: string | null;
  prefLandingPage: string;
  prefLocale: string;
  prefSidebarCollapsed: boolean;
};

/**
 * Everything /profile renders, in one round trip.
 *
 * The HR half comes from people and is read-only everywhere in this feature:
 * that table is destined for Factorial/TrackingTime sync, so a value edited
 * here would be overwritten with no conflict-resolution story.
 */
export async function getProfileView(
  supabase: SupabaseTyped,
  userId: string,
  email: string | null,
): Promise<ProfileView | null> {
  const { data } = await supabase
    .from("app_user_profile")
    .select(
      `user_id, display_name, avatar_url, department, person_id,
       pref_landing_page, pref_locale, pref_sidebar_collapsed,
       app_role(role_key, display_name),
       people(name, employee_number, contract_hours, holiday_left,
              total_holiday, certificate_status, since)`,
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data || !data.app_role) return null;

  const person = data.people;

  return {
    userId: data.user_id,
    email,
    displayName: data.display_name,
    effectiveName: data.display_name ?? person?.name ?? "Team member",
    avatarUrl: data.avatar_url,
    roleKey: data.app_role.role_key,
    roleDisplayName: data.app_role.display_name,
    department: data.department,
    personId: data.person_id,
    employeeNumber: person?.employee_number ?? null,
    contractHours: person?.contract_hours ?? null,
    holidayLeft: person?.holiday_left ?? null,
    totalHoliday: person?.total_holiday ?? null,
    certificateStatus: person?.certificate_status ?? null,
    since: person?.since ?? null,
    prefLandingPage: data.pref_landing_page,
    prefLocale: data.pref_locale,
    prefSidebarCollapsed: data.pref_sidebar_collapsed,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check:avatar`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: exit 0. If the `people(...)` join errors, the types from Task 1 Step 6 were not regenerated — go back and do that.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/profile.ts src/components/Avatar.tsx scripts/check-avatar-monogram.mjs package.json
git commit -m "Read the profile in one query, and give accounts without a photo a real monogram"
```

---

### Task 4: The `/profile` route and the read-only Employment card

**Files:**
- Create: `src/app/(app)/profile/page.tsx`
- Create: `src/app/(app)/profile/EmploymentCard.tsx`

**Interfaces:**
- Consumes: `getProfileView`, `ProfileView`, `Avatar`, `requireProfile` from `@/utils/supabase/require-profile`
- Produces: the route `/profile`; `<EmploymentCard profile={ProfileView} />`

- [ ] **Step 1: Write the page**

Create `src/app/(app)/profile/page.tsx`:

```tsx
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getProfileView } from "@/lib/queries/profile";
import { EmploymentCard } from "./EmploymentCard";

export const metadata = { title: "Your profile — HSE Hub" };

export default async function ProfilePage() {
  // Every signed-in role may see their own profile, so no allowedRoles here.
  await requireProfile("/profile");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = await getProfileView(supabase, user!.id, user!.email ?? null);

  if (!profile) return null; // requireProfile already redirected

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          Your profile
        </h1>
        <p className="text-[12.5px] text-[var(--text-muted)]">
          What the Hub knows about you, and the parts you control.
        </p>
      </header>

      <EmploymentCard profile={profile} />
    </div>
  );
}
```

- [ ] **Step 2: Write the Employment card**

Create `src/app/(app)/profile/EmploymentCard.tsx`:

```tsx
import type { ProfileView } from "@/lib/queries/profile";

/**
 * HR data, deliberately inert.
 *
 * These fields are styled so they cannot be mistaken for inputs: muted text,
 * no border, no focus ring. A field that looks editable and silently is not is
 * worse than one that plainly is not — and these will be owned by Factorial,
 * so an edit here would vanish at the next sync.
 */
function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        {label}
      </span>
      <span
        className={`text-[13px] text-[var(--text-secondary)] ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export function EmploymentCard({ profile }: { profile: ProfileView }) {
  const dash = (v: string | number | null) =>
    v === null || v === "" ? "—" : String(v);

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Employment</h2>
        <span className="text-[11px] text-[var(--text-faint)]">Managed by HR — read only</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Role" value={profile.roleDisplayName} />
        <Field label="Department" value={dash(profile.department)} />
        <Field label="Employee no." value={dash(profile.employeeNumber)} mono />
        <Field label="Contract hours" value={dash(profile.contractHours)} mono />
        <Field
          label="Holiday"
          value={
            profile.holidayLeft === null || profile.totalHoliday === null
              ? "—"
              : `${profile.holidayLeft} of ${profile.totalHoliday} days left`
          }
        />
        <Field label="Certificates" value={dash(profile.certificateStatus)} />
        <Field label="With HSE since" value={dash(profile.since)} />
        <Field label="Sign-in email" value={dash(profile.email)} mono />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify it builds and renders**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds and lists `/profile` in the route output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/profile"
git commit -m "Add /profile, starting with the half nobody can edit"
```

---

### Task 5: Identity card — display name and avatar upload

**Files:**
- Create: `src/app/(app)/profile/actions.ts`
- Create: `src/app/(app)/profile/IdentityCard.tsx`
- Create: `scripts/check-profile-actions.mjs`
- Modify: `src/app/(app)/profile/page.tsx` (mount the card)
- Modify: `package.json`

**Interfaces:**
- Consumes: `ProfileView`, `Avatar`
- Produces:
  - `type ProfileActionState = { status: "idle" | "success" | "error"; message?: string }`
  - `updateDisplayName(prev: ProfileActionState, form: FormData): Promise<ProfileActionState>`
  - `uploadAvatar(prev: ProfileActionState, form: FormData): Promise<ProfileActionState>`
  - `removeAvatar(): Promise<ProfileActionState>`
  - constants `MAX_AVATAR_BYTES = 2_097_152`, `ALLOWED_AVATAR_TYPES = ["image/jpeg","image/png","image/webp"]`

- [ ] **Step 1: Write the failing gate**

Create `scripts/check-profile-actions.mjs`:

```js
/**
 * The profile actions enforce their own limits, not the browser's.
 *
 * The upload UI resizes and filters before sending, which is a convenience.
 * A Server Action is a public HTTP endpoint and receives whatever the caller
 * sends, so the same three limits have to hold when the client is skipped
 * entirely. This reads the action source and asserts the checks are present
 * and server-side; Task 8 drives them over the wire.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("src/app/(app)/profile/actions.ts", "utf8");

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

check(src.startsWith('"use server"'), "actions file is server-only");
check(/getUser\(\)/.test(src), "identity is re-checked inside the actions");
check(!/user_id\s*:\s*formData/.test(src), "no action takes a user id from the form");
check(/MAX_AVATAR_BYTES/.test(src) && /\.size\s*>\s*MAX_AVATAR_BYTES/.test(src), "size limit enforced server-side");
check(/ALLOWED_AVATAR_TYPES/.test(src) && /includes\(file\.type\)/.test(src), "MIME allow-list enforced server-side");
check(/char_length|\.length\s*>\s*60|slice\(0,\s*60\)/.test(src), "display name length bounded server-side");
check(/\.eq\("user_id",\s*user\.id\)/.test(src), "writes are scoped to the caller's own row");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
```

Add to `package.json`:

```json
"check:profile-actions": "node scripts/check-profile-actions.mjs",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:profile-actions`
Expected: FAIL — `ENOENT`, the actions file does not exist yet.

- [ ] **Step 3: Write the actions**

Create `src/app/(app)/profile/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type ProfileActionState = { status: "idle" | "success" | "error"; message?: string };

export const MAX_AVATAR_BYTES = 2_097_152; // 2 MB
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
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
  // this is null rather than "".
  const { error } = await supabase
    .from("app_user_profile")
    .update({ display_name: raw === "" ? null : raw })
    .eq("user_id", user.id);

  if (error) return { status: "error", message: error.message };

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
  if (upErr) return { status: "error", message: upErr.message };

  const { error: rowErr } = await supabase
    .from("app_user_profile")
    .update({ avatar_url: key })
    .eq("user_id", user.id);
  if (rowErr) return { status: "error", message: rowErr.message };

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
  if (error) return { status: "error", message: error.message };

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { status: "success", message: "Photo removed." };
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `npm run check:profile-actions`
Expected: all PASS.

- [ ] **Step 5: Write the Identity card**

Create `src/app/(app)/profile/IdentityCard.tsx`:

```tsx
"use client";

import { useActionState, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { ProfileView } from "@/lib/queries/profile";
import {
  updateDisplayName,
  uploadAvatar,
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  type ProfileActionState,
} from "./actions";

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
```

- [ ] **Step 6: Mount it, with a signed URL**

In `src/app/(app)/profile/page.tsx`, add the import and the signed-URL lookup, then render the card above `<EmploymentCard>`:

```tsx
import { IdentityCard } from "./IdentityCard";

// …after `profile` is loaded:
// The bucket is private, so the stored key is not itself fetchable. One hour
// is longer than anyone will sit on this page and short enough that a leaked
// URL expires on its own.
let signedAvatarUrl: string | null = null;
if (profile.avatarUrl) {
  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(profile.avatarUrl, 3600);
  signedAvatarUrl = data?.signedUrl ?? null;
}
```

```tsx
<IdentityCard profile={profile} signedAvatarUrl={signedAvatarUrl} />
<EmploymentCard profile={profile} />
```

Add the Supabase project host to `next.config.ts` `images.remotePatterns` so `next/image` will render the signed URL:

```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/sign/**" },
  ],
},
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → exit 0
Run: `npm run check:profile-actions` → all PASS
Run: `npm run build` → succeeds

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/profile" scripts/check-profile-actions.mjs package.json next.config.ts
git commit -m "Let people set a display name and a photo, enforcing the limits server-side"
```

---

### Task 6: Security card — password change requiring the current password

**Files:**
- Create: `src/app/(app)/profile/SecurityCard.tsx`
- Modify: `src/app/(app)/profile/actions.ts` (add `changePassword`)
- Modify: `src/app/(app)/profile/page.tsx` (mount)
- Modify: `scripts/check-profile-actions.mjs` (extend)

**Interfaces:**
- Consumes: `MIN_PASSWORD_LENGTH`, `PasswordStrengthBar` from `@/lib/password-strength`
- Produces: `changePassword(prev: ProfileActionState, form: FormData): Promise<ProfileActionState>`

- [ ] **Step 1: Extend the gate first**

Append to `scripts/check-profile-actions.mjs`, before the summary lines:

```js
check(/signInWithPassword/.test(src), "password change verifies the CURRENT password first");
check(/auth\.updateUser\(\s*\{\s*password/.test(src), "password change calls updateUser");
check(
  src.indexOf("signInWithPassword") < src.indexOf("updateUser"),
  "verification happens before the update, not after",
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:profile-actions`
Expected: the three new lines FAIL, earlier ones still PASS.

- [ ] **Step 3: Add the action**

Append to `src/app/(app)/profile/actions.ts`:

```ts
import { MIN_PASSWORD_LENGTH } from "@/lib/password-strength";

export async function changePassword(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { status: "error", message: "Not authenticated." };

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (next.length < MIN_PASSWORD_LENGTH) {
    return { status: "error", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (next !== confirm) {
    return { status: "error", message: "Those two passwords don't match." };
  }
  if (next === current) {
    return { status: "error", message: "That is already your password." };
  }

  // Supabase will change the password on a valid session alone. Requiring the
  // current one is what stops an unlocked laptop being a full account
  // takeover rather than a nuisance.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyError) {
    return { status: "error", message: "That current password is not right." };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { status: "error", message: error.message };

  return { status: "success", message: "Password changed." };
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `npm run check:profile-actions`
Expected: all PASS.

- [ ] **Step 5: Write the card**

Create `src/app/(app)/profile/SecurityCard.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { MIN_PASSWORD_LENGTH, PasswordStrengthBar } from "@/lib/password-strength";
import { changePassword, type ProfileActionState } from "./actions";

const IDLE: ProfileActionState = { status: "idle" };

const inputClass =
  "w-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";
const labelClass =
  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--text-faint)]";

export function SecurityCard() {
  const [state, action, pending] = useActionState(changePassword, IDLE);
  const [next, setNext] = useState("");

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Security</h2>
        <span className="text-[11px] text-[var(--text-faint)]">
          Your current password is required
        </span>
      </div>

      <form action={action} className="flex max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current_password" className={labelClass}>Current password</label>
          <input id="current_password" name="current_password" type="password"
                 autoComplete="current-password" required className={inputClass} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new_password" className={labelClass}>New password</label>
          <input id="new_password" name="new_password" type="password"
                 autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
                 value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          <PasswordStrengthBar password={next} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm_password" className={labelClass}>Confirm new password</label>
          <input id="confirm_password" name="confirm_password" type="password"
                 autoComplete="new-password" required className={inputClass} />
        </div>

        <button type="submit" disabled={pending}
                className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">
          {pending ? "Changing…" : "Change password"}
        </button>

        {state.message && (
          <p className="text-[12px]"
             style={{ color: state.status === "error" ? "var(--critical)" : "var(--good)" }}>
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Mount and verify**

Add `<SecurityCard />` to `page.tsx` after `<EmploymentCard>`.

Run: `npx tsc --noEmit` → exit 0
Run: `npm run build` → succeeds

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/profile" scripts/check-profile-actions.mjs
git commit -m "Require the current password to change it, so a borrowed laptop is not a takeover"
```

---

### Task 7: Preferences card

**Files:**
- Create: `src/app/(app)/profile/PreferencesCard.tsx`
- Modify: `src/app/(app)/profile/actions.ts` (add `updatePreferences`)
- Modify: `src/app/(app)/profile/page.tsx` (mount)

**Interfaces:**
- Produces: `updatePreferences(prev: ProfileActionState, form: FormData): Promise<ProfileActionState>`; exported `LANDING_PAGES` and `LOCALES` arrays matching the Task 1 check constraints exactly.

- [ ] **Step 1: Add the action**

Append to `src/app/(app)/profile/actions.ts`:

```ts
// These two lists MUST match the check constraints in
// supabase/migrations/add_user_profile_fields.sql. A value that passes here and
// fails there surfaces as an unexplained database error in the UI.
export const LANDING_PAGES = [
  { value: "/", label: "Overview" },
  { value: "/people", label: "People" },
  { value: "/projects", label: "Projects" },
  { value: "/timesheets", label: "Timesheets" },
  { value: "/time/dashboard", label: "TrackingTime Dashboard" },
  { value: "/leave", label: "Leave & Time Off" },
];
export const LOCALES = [
  { value: "de-DE", label: "German (24h, 31.12.2026)" },
  { value: "en-GB", label: "English (24h, 31/12/2026)" },
];

export async function updatePreferences(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const landing = String(formData.get("pref_landing_page") ?? "");
  const locale = String(formData.get("pref_locale") ?? "");
  const collapsed = formData.get("pref_sidebar_collapsed") === "on";

  if (!LANDING_PAGES.some((p) => p.value === landing)) {
    return { status: "error", message: "That is not a page you can land on." };
  }
  if (!LOCALES.some((l) => l.value === locale)) {
    return { status: "error", message: "Unsupported locale." };
  }

  const { error } = await supabase
    .from("app_user_profile")
    .update({
      pref_landing_page: landing,
      pref_locale: locale,
      pref_sidebar_collapsed: collapsed,
    })
    .eq("user_id", user.id);

  if (error) return { status: "error", message: error.message };

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { status: "success", message: "Preferences saved." };
}
```

- [ ] **Step 2: Write the card**

Create `src/app/(app)/profile/PreferencesCard.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import type { ProfileView } from "@/lib/queries/profile";
import { updatePreferences, LANDING_PAGES, LOCALES, type ProfileActionState } from "./actions";

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

      <form action={action} className="flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref_landing_page" className={labelClass}>Open on sign-in</label>
          <select id="pref_landing_page" name="pref_landing_page"
                  defaultValue={profile.prefLandingPage} className={selectClass}>
            {LANDING_PAGES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref_locale" className={labelClass}>Dates and numbers</label>
          <select id="pref_locale" name="pref_locale"
                  defaultValue={profile.prefLocale} className={selectClass}>
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
          <input type="checkbox" name="pref_sidebar_collapsed"
                 defaultChecked={profile.prefSidebarCollapsed} />
          Keep the sidebar collapsed
        </label>

        <button type="submit" disabled={pending}
                className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">
          {pending ? "Saving…" : "Save preferences"}
        </button>

        {state.message && (
          <p className="text-[12px]"
             style={{ color: state.status === "error" ? "var(--critical)" : "var(--good)" }}>
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Mount and verify**

Add `<PreferencesCard profile={profile} />` to `page.tsx` after `<SecurityCard />`.

Run: `npx tsc --noEmit` → exit 0
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/profile"
git commit -m "Add three real preferences, with the same domains the database enforces"
```

---

### Task 8: Sidebar chip, and the end-to-end auth gate

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Create: `scripts/check-profile-action-auth.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Avatar`, `getProfileView`
- Produces: a `/profile` link in the sidebar showing the user's avatar and name

> **Merge note:** `Sidebar.tsx`, `SidebarNav.tsx`, and `nav-icons.tsx` were all rewritten on master at 13:40 today for the icon-rail collapse. This task touches **only `Sidebar.tsx`** — the chip is the navigation entry, so `NAV_GROUPS` and `NAV_ICONS` are deliberately left alone. Rebase on master before starting this task.

- [ ] **Step 1: Write the failing gate**

Create `scripts/check-profile-action-auth.mjs`:

```js
/**
 * Drives each profile Server Action over HTTP with no session.
 *
 * check-profile-actions.mjs reads the source and asserts the guards are
 * written; this asserts they FIRE. Server Actions are POST endpoints with a
 * Next-Action header, so an unauthenticated caller can invoke them directly
 * without ever loading the page.
 *
 * SKIPs unless a server is already running at PROFILE_GATE_URL, so CI cannot
 * go red for want of a build.
 */
const base = process.env.PROFILE_GATE_URL || "http://localhost:3000";

const res = await fetch(base, { redirect: "manual" }).catch(() => null);
if (!res) {
  console.log(`SKIP: nothing serving at ${base} — run \`npm run build && npm start\` first`);
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// An unauthenticated GET of the page must not render the profile.
const page = await fetch(`${base}/profile`, { redirect: "manual" });
check(
  page.status === 307 || page.status === 302,
  "GET /profile while signed out redirects",
  `got ${page.status}`,
);
check(
  (page.headers.get("location") || "").includes("/auth/login"),
  "…and the redirect goes to the login page",
  page.headers.get("location") || "no location header",
);

// The page must not leak profile data in its unauthenticated body either.
const body = await fetch(`${base}/profile`).then((r) => r.text());
check(!/Employee no\./.test(body), "signed-out body contains no employment fields");
check(!/display_name/.test(body), "signed-out body contains no profile form");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
```

Add to `package.json`:

```json
"check:profile-action-auth": "node scripts/check-profile-action-auth.mjs",
```

- [ ] **Step 2: Run it**

Run: `npm run build && npm start &` then `npm run check:profile-action-auth`
Expected: PASS on all four (the `requireProfile("/profile")` from Task 4 already provides this). If any FAIL, the page gate is wrong — fix it before adding the chip.

- [ ] **Step 3: Add the chip to Sidebar.tsx**

Read `src/components/Sidebar.tsx` first to find where `<SidebarNav roleKey={roleKey} />` and `<LogoutButton />` render. Add above the logout button:

```tsx
import Link from "next/link";
import { Avatar } from "./Avatar";

// …inside the sidebar footer, above <LogoutButton />:
<Link
  href="/profile"
  className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
>
  <Avatar name={displayName} src={signedAvatarUrl} size={26} />
  {/* The label collapses in rail mode; the avatar stays as the only
      affordance, matching how LogoutButton behaves at 64px. */}
  <span className="truncate group-data-[collapsed=true]/sidebar:hidden">{displayName}</span>
</Link>
```

`Sidebar.tsx` must receive `displayName` and `signedAvatarUrl`. Follow how `roleKey` is already threaded to it from its parent, and resolve the signed URL the same way `page.tsx` does in Task 5 Step 6.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0
Run: `npm run build` → succeeds
Run: `npm run check:profile-action-auth` → all PASS

Manually: sign in, confirm the chip shows your monogram, click it, land on `/profile`. Upload a photo, confirm the chip updates after `revalidatePath("/", "layout")`.

- [ ] **Step 5: Run every gate**

```bash
npm run check:profile-rls
npm run check:password-strength
npm run check:avatar
npm run check:profile-actions
npm run check:profile-action-auth
npx tsc --noEmit
npm run lint
```

Expected: all pass or SKIP. No FAIL.

- [ ] **Step 6: Prove the gates can fail**

For each of `check:profile-rls` and `check:profile-actions`, revert one guarded behaviour and confirm the gate goes red, then restore it:

- Comment out the `file.size > MAX_AVATAR_BYTES` branch → `check:profile-actions` must FAIL.
- `drop policy avatars_select_own on storage.objects;` → `check:profile-rls` must FAIL. Re-apply the migration afterwards.

A gate that stays green against broken code is worse than no gate. Record the result in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx scripts/check-profile-action-auth.mjs package.json
git commit -m "Put the signed-in person in the sidebar, linking to their profile"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| `/profile` in the `(app)` group | 4 |
| Four independently-submitting cards | 4, 5, 6, 7 |
| `display_name` / `avatar_url` columns | 1 |
| Private `avatars` bucket, owner-scoped RLS | 1 |
| Never writes to `people` | 1 (schema), 5/6/7 (all writes target `app_user_profile`) |
| `user_display_names` unchanged | no task touches it — by omission, deliberately |
| Five Server Actions | 5 (3), 6 (1), 7 (1) |
| Server-side re-validation of upload limits | 5 |
| Write-then-delete ordering on replace | 5 |
| Current password required | 6 |
| Extract password-strength helpers | 2 |
| Three real preferences | 7 |
| Read-only HR fields, visibly distinct | 4 |
| Monogram fallback, stable colour | 3 |
| `check-profile-rls.mjs` | 1 |
| Action-auth gate | 5 (source), 8 (over the wire) |
| Upload-limit gate | 5 |
| Gates proven to fail | 8, Step 6 |
| Merge risk confined to sidebar | 8 |

Two spec items are intentionally narrowed, and both make the plan smaller than the spec:

1. The spec named `check-profile-upload-limits.mjs` as a third gate. Its assertions live in `check-profile-actions.mjs` (source) and `check-profile-action-auth.mjs` (wire) instead — a third harness for the same three limits would be duplication, not coverage.
2. The spec put the profile link in the nav. Investigation showed `SidebarNav.tsx` and `nav-icons.tsx` were both rewritten at 13:40 today, so the chip is the entry point and the merge surface drops from three files to one.

**Placeholder scan:** no TBD/TODO. Every code step carries the actual code. Task 8 Step 3 references reading `Sidebar.tsx` for its existing structure rather than reproducing a file the plan has not seen in full — that is a read instruction, not a placeholder.

**Type consistency:** `ProfileActionState` is defined in Task 5 and used unchanged in 6 and 7. `ProfileView` is defined in Task 3 and consumed in 4, 5, 7. `MIN_PASSWORD_LENGTH` and `PasswordStrengthBar` come from Task 2 and are consumed in 6. `initialsOf` / `colorForName` are exported in Task 3 and consumed by its own gate. `LANDING_PAGES` / `LOCALES` in Task 7 are pinned to the Task 1 check constraints, and the plan says so at both ends.

import { PageHeader } from "@/components/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { IconWarning, IconArrowRight } from "@/components/nav-icons";
import { NumberedPager } from "@/components/NumberedPager";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { createAdminClient } from "@/utils/supabase/admin";
import { listUserProfiles, getRoles } from "@/lib/queries/auth";
import { InviteUserForm } from "./InviteUserForm";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";
import { UserRow } from "./UserRow";

export type AppRoleRow = { role_key: string; display_name: string; seniority: number };

/**
 * UI-CONVENTIONS rule 1: an account console is worked account by account --
 * invite, re-invite, change role, remove -- so it pages at 10.
 *
 * WHY IT NOW PAGES AT ALL (2026-09-10). It rendered every profile, so the height
 * of this page was however many accounts happen to exist. That is the defect
 * check-table-scroll-budget.mjs exists to catch, and it caught it: 4,910px =
 * 5.82 screens at 390px, against a pinned budget of 5.5 that was itself recorded
 * as DEBT ("Measured 5.25. The user list renders a card per user at phone
 * width"). It had grown past its own debt pin without anyone noticing, which is
 * exactly what pinning one notch above the measurement is for.
 *
 * This is the same class of bug the same gate found in the risks tab's cover
 * worklist on the same run: a long list that is not a <table>, so only the
 * document-height assertion can see it.
 */
const ACCOUNTS_PER_PAGE = 10;

/** `?page=N`, 1-based, like the numbers on screen. */
type SearchParams = Promise<{ page?: string }>;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  // Permission keys, not role strings. These two decisions were previously
  // `["exec", "dept_head"]` and `roleKey === "exec"`, which meant the
  // "Manage User Accounts" toggles in /admin/roles were shown, saved, and
  // decided nothing — an administrator could grant this page to a project
  // manager and watch the grant have no effect.
  await requirePermission("/admin/users", PERMISSIONS.ADMIN_USERS_READ);
  const canEdit = await userHasPermission(PERMISSIONS.ADMIN_USERS_WRITE);
  // A SEPARATE key from the two above. The per-person record at
  // /admin/users/[userId] is gated on admin:profiles:read, so the link to it is
  // shown on exactly that basis -- reusing canEdit would offer a link that
  // redirects straight back here, or hide it from an auditor entitled to it.
  const canManageProfile = await userHasPermission(PERMISSIONS.ADMIN_PROFILES_READ);
  const supabase = await createClient();

  const [profiles, roles] = await Promise.all([
    listUserProfiles(supabase),
    getRoles(supabase),
  ]);

  let emailByUserId = new Map<string, string>();
  /**
   * Who has ever signed in, from the SAME listUsers response as the emails.
   *
   * This decides whether RE-INVITE is offered on a row. Most of the 19 provisioned
   * accounts have never been used, and there was previously no way to reach those
   * people from this console: the invite form calls inviteUserByEmail, which fails on
   * an address that already has an account.
   *
   * A missing entry means "cannot tell" rather than "never signed in", which is why
   * the row prop is boolean | null. Without the service-role client this map is empty,
   * and offering to send password links on that basis would mail people who did not
   * ask.
   */
  let signedInByUserId = new Map<string, boolean>();
  let adminUnavailable: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers();
    emailByUserId = new Map(data.users.map((u) => [u.id, u.email ?? ""]));
    signedInByUserId = new Map(data.users.map((u) => [u.id, Boolean(u.last_sign_in_at)]));
  } catch (err) {
    adminUnavailable = err instanceof Error ? err.message : "Admin client unavailable.";
  }

  const activeCount = profiles.filter(p => p.isActive).length;
  // Counted over every profile, not over the page on screen: the header states the
  // size of the whole account list, and the pager below states which slice of it is
  // rendered (UI-CONVENTIONS rule 6).
  const neverSignedIn = profiles.filter((p) => signedInByUserId.get(p.userId) === false).length;

  /*
   * NEWEST FIRST, and the page's working order rather than the query's.
   *
   * listUserProfiles returns oldest-first. On a console whose first control is
   * the invite form, the account you just created is the one you came back to
   * look at -- and with a page size, oldest-first would put every new account on
   * the last page, where nobody looks. `created_at` is an ISO timestamp, so a
   * string compare is a time compare.
   */
  const ordered = [...profiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pageCount = Math.max(1, Math.ceil(ordered.length / ACCOUNTS_PER_PAGE));
  /*
   * Clamped, never 404 (UI-CONVENTIONS rule 2): accounts get removed, so a
   * bookmark to page 3 of a list that shrank shows the last page instead of an
   * empty one. An unparsable value is page 1.
   */
  const params = await searchParams;
  const currentPage = Math.min(pageCount, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const firstShown = (currentPage - 1) * ACCOUNTS_PER_PAGE;
  const shown = ordered.slice(firstShown, firstShown + ACCOUNTS_PER_PAGE);

  return (
    <div className="flex flex-col">
      <SyncBar />
      <PageHeader
        category="HSE HUB / ADMIN"
        title="Users &amp; Roles"
        meta={`${activeCount} ACTIVE · ${profiles.length} TOTAL${neverSignedIn > 0 ? ` · ${neverSignedIn} NEVER SIGNED IN` : ""}`}
        actions={
          <ButtonLink href="/admin/roles">
            Role Permissions
            <IconArrowRight className="h-3.5 w-3.5" />
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5 page-shell">
        {adminUnavailable && (
          <div
            role="alert"
            className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
            style={{ background: "var(--warning-wash)" }}
          >
            <IconWarning className="mt-0.5 h-4 w-4 flex-none text-[var(--warning)]" />
            <p className="text-[var(--text-primary)]">
              {adminUnavailable} Emails below are blank and invites will fail until it&apos;s set.
            </p>
          </div>
        )}

        {canEdit && <InviteUserForm roles={roles} />}

        {/* User table is the primary admin panel — aggregates column headers
            and all account rows; qualifies itself with active/total count.
            These lines MUST stay inside braces: a bare `//` in JSX children is
            a text node, so the comment renders on the page as literal text. */}
        <Card>
          <CardHeader title="User accounts" />
          <CardDivider />
          {/* Table header */}
          <div className="hidden grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] sm:grid">
            <span className="col-span-3">EMAIL</span>
            <span className="col-span-2">ROLE</span>
            <span className="col-span-2">TEAM</span>
            <span className="col-span-1">PERSON</span>
            <span className="col-span-1">STATUS</span>
            {/* PERSON narrowed and SINCE replaced: the date was the least useful
                column on the page, and the row needs the width for the re-invite
                and remove controls. The created date is still shown on the mobile
                card, where there is room for it. */}
            <span className="col-span-3 text-right">ACTIONS</span>
          </div>

          {profiles.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
              NO ACCOUNTS YET
            </div>
          ) : (
            shown.map((p) => (
              <UserRow
                key={p.userId}
                userId={p.userId}
                email={emailByUserId.get(p.userId) || ""}
                roleKey={p.roleKey}
                roleDisplayName={p.roleDisplayName}
                department={p.department}
                personName={p.personName}
                isActive={p.isActive}
                createdAt={p.createdAt}
                roles={roles}
                canEdit={canEdit}
                canManageProfile={canManageProfile}
                hasSignedIn={signedInByUserId.has(p.userId) ? signedInByUserId.get(p.userId)! : null}
              />
            ))
          )}

          {/* The house pager (rule 3), server-rendered links so the back button,
              a refresh and a pasted link all land on the same accounts. The count
              line says what the ten are ten OF, so a bounded list is not misread
              as the whole roster. */}
          {profiles.length > 0 && (
            <NumberedPager
              page={currentPage}
              pageCount={pageCount}
              countLine={
                `${firstShown + 1}–${firstShown + shown.length} OF ${ordered.length} ACCOUNTS`
                + (pageCount > 1 ? ` · PAGE ${currentPage} OF ${pageCount}` : "")
              }
              navLabel="Account pages"
              labels={{ prev: "PREV", next: "NEXT", pageLabel: (n) => `Accounts, page ${n}` }}
              hrefFor={(n) => (n === 1 ? "/admin/users" : `/admin/users?page=${n}`)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

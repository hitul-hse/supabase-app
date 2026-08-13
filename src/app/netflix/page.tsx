import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { PageHeader } from "@/components/PageHeader";
import { getNetflixUsers } from "@/lib/queries/netflix";

const PAGE_SIZE = 25;

type SearchParams = { q?: string; page?: string };

const TIER_COLORS: Record<string, string> = {
  basic: "var(--accent)",
  standard: "var(--warning)",
  premium: "#5b8ae0",
};

function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLORS[tier.toLowerCase()] ?? "var(--text-muted)";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[var(--text-primary)]">
      <span aria-hidden className="h-1.5 w-1.5" style={{ background: color }} />
      {tier.toUpperCase()}
    </span>
  );
}

export default async function NetflixUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  await requireUser("/netflix");
  const supabase = await createClient();

  const result = await getNetflixUsers(supabase, {
    page,
    search: q,
  });

  const rows = result.data;
  const count = result.count;
  const error = result.error;
  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  const navBtn = "border border-[var(--border)] px-3 py-1.5 text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]";
  const navBtnDisabled = "pointer-events-none border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)] opacity-50";

  return (
    <div>
      <PageHeader
        title="Netflix Users"
        meta={count !== null ? `${count.toLocaleString()} total records` : undefined}
        actions={
          <form className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search name, country, or genre..."
              className="w-64 border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              Search
            </button>
          </form>
        }
      />

      <div className="p-6">
        {error && (
          <div className="flex items-start gap-3 border border-[var(--border)] p-4 text-sm" style={{ background: "var(--critical-wash)" }}>
            <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">✕</span>
            <p className="text-[var(--text-primary)]">{error.message}</p>
          </div>
        )}

        {!error && (
          <>
            <div className="overflow-x-auto border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">ID</th>
                    <th className="px-3 py-2.5 font-medium">NAME</th>
                    <th className="px-3 py-2.5 font-medium">AGE</th>
                    <th className="px-3 py-2.5 font-medium">COUNTRY</th>
                    <th className="px-3 py-2.5 font-medium">PLAN</th>
                    <th className="px-3 py-2.5 text-right font-medium">WATCH HRS</th>
                    <th className="px-3 py-2.5 font-medium">GENRE</th>
                    <th className="px-3 py-2.5 text-right font-medium">LAST LOGIN</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((row) => (
                    <tr
                      key={row.user_id}
                      className="border-t border-[var(--border)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-faint)]">{row.user_id}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{row.age}</td>
                      <td className="px-3 py-2">{row.country}</td>
                      <td className="px-3 py-2">
                        <TierBadge tier={row.subscription_type ?? ""} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.watch_time_hours}</td>
                      <td className="px-3 py-2">{row.favorite_genre}</td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{row.last_login}</td>
                    </tr>
                  ))}
                  {rows?.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                        No users match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-3 text-sm">
              <Link
                href={`/netflix?q=${encodeURIComponent(q)}&page=${Math.max(1, page - 1)}`}
                className={page <= 1 ? navBtnDisabled : navBtn}
              >
                ← Previous
              </Link>
              <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <Link
                href={`/netflix?q=${encodeURIComponent(q)}&page=${Math.min(totalPages, page + 1)}`}
                className={page >= totalPages ? navBtnDisabled : navBtn}
              >
                Next →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

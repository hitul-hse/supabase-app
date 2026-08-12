import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

const PAGE_SIZE = 25;

type SearchParams = { q?: string; page?: string };

const TIER_COLORS: Record<string, string> = {
  basic: "var(--accent)",
  standard: "#eb6834",
  premium: "#1baf7a",
};

function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLORS[tier.toLowerCase()] ?? "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)]"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {tier}
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
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  let query = supabase
    .from("netflix_users")
    .select("user_id, name, age, country, subscription_type, watch_time_hours, favorite_genre, last_login", {
      count: "exact",
    })
    .order("user_id", { ascending: true })
    .range(from, to);

  if (q) {
    query = query.or(`name.ilike.%${q}%,country.ilike.%${q}%,favorite_genre.ilike.%${q}%`);
  }

  const { data: rows, count, error } = await query;

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  const navBtn = "rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]";
  const navBtnDisabled = "pointer-events-none rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)] opacity-50";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-4 text-2xl font-semibold text-[var(--text-primary)]">
        Netflix Users {count !== null && <span className="text-base font-normal text-[var(--text-muted)]">({count} total)</span>}
      </h1>

      <form className="mb-5 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search name, country, or genre..."
          className="w-full max-w-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] p-4 text-sm" style={{ background: "var(--critical-wash)" }}>
          <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">✕</span>
          <p className="text-[var(--text-primary)]">{error.message}</p>
        </div>
      )}

      {!error && (
        <>
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">ID</th>
                  <th className="px-3 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Age</th>
                  <th className="px-3 py-2.5 font-medium">Country</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Watch Hrs</th>
                  <th className="px-3 py-2.5 font-medium">Genre</th>
                  <th className="px-3 py-2.5 font-medium">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((row) => (
                  <tr
                    key={row.user_id}
                    className="border-t border-[var(--border)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{row.user_id}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2 tabular-nums">{row.age}</td>
                    <td className="px-3 py-2">{row.country}</td>
                    <td className="px-3 py-2">
                      <TierBadge tier={row.subscription_type} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.watch_time_hours}</td>
                    <td className="px-3 py-2">{row.favorite_genre}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{row.last_login}</td>
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
            <span className="text-[var(--text-secondary)]">
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
  );
}

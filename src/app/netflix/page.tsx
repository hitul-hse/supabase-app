import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

const PAGE_SIZE = 25;

type SearchParams = { q?: string; page?: string };

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

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
          Netflix Users {count !== null && <span className="text-base font-normal text-zinc-500">({count} total)</span>}
        </h1>

        <form className="mb-4 flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search name, country, or genre..."
            className="w-full max-w-sm rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            Search
          </button>
        </form>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
            {error.message}
          </div>
        )}

        {!error && (
          <>
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-100 dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Age</th>
                    <th className="px-3 py-2">Country</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Watch Hrs</th>
                    <th className="px-3 py-2">Genre</th>
                    <th className="px-3 py-2">Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((row) => (
                    <tr key={row.user_id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2">{row.user_id}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.age}</td>
                      <td className="px-3 py-2">{row.country}</td>
                      <td className="px-3 py-2">{row.subscription_type}</td>
                      <td className="px-3 py-2">{row.watch_time_hours}</td>
                      <td className="px-3 py-2">{row.favorite_genre}</td>
                      <td className="px-3 py-2">{row.last_login}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-4 text-sm">
              <Link
                href={`/netflix?q=${encodeURIComponent(q)}&page=${Math.max(1, page - 1)}`}
                className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
              >
                Previous
              </Link>
              <span>
                Page {page} of {totalPages}
              </span>
              <Link
                href={`/netflix?q=${encodeURIComponent(q)}&page=${Math.min(totalPages, page + 1)}`}
                className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}
              >
                Next
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { createClient } from "@/utils/supabase/server";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";

function compact(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [overview, countries, genres, subscriptions] = await Promise.all([
    supabase.from("netflix_overview").select("*").single(),
    supabase.from("netflix_country_stats").select("*"),
    supabase.from("netflix_genre_stats").select("*"),
    supabase.from("netflix_subscription_stats").select("*"),
  ]);

  const anyError =
    overview.error || countries.error || genres.error || subscriptions.error;

  if (anyError) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          Could not load dashboard data: {anyError.message}. Make sure you've
          run the aggregate views in <code>supabase/schema.sql</code>.
        </div>
      </div>
    );
  }

  const stats = overview.data!;

  return (
    <div className="viz-root min-h-screen bg-[var(--background)] p-8 font-sans">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold text-[var(--viz-text-primary)]">
          Netflix Users Dashboard
        </h1>
        <p className="mb-6 text-sm text-[var(--viz-text-secondary)]">
          Test dashboard built on the Kaggle sample dataset, before we wire up real integrations.
        </p>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Total users" value={compact(stats.total_users)} />
          <StatTile label="Avg watch time" value={`${Number(stats.avg_watch_time_hours).toFixed(1)} hrs`} />
          <StatTile label="Avg age" value={Number(stats.avg_age).toFixed(0)} />
          <StatTile label="Countries" value={String(stats.country_count)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <BarChart
            title="Users by country"
            bars={countries.data!.map((r) => ({ label: r.country, value: r.user_count }))}
          />
          <BarChart
            title="Users by favorite genre"
            bars={genres.data!.map((r) => ({ label: r.favorite_genre, value: r.user_count }))}
          />
          <BarChart
            title="Users by subscription tier"
            bars={subscriptions.data!.map((r) => ({ label: r.subscription_type, value: r.user_count }))}
          />
          <BarChart
            title="Avg watch time by subscription tier (hrs)"
            bars={subscriptions.data!.map((r) => ({
              label: r.subscription_type,
              value: Number(r.avg_watch_time_hours),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

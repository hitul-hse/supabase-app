import { createClient } from "@/utils/supabase/server";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { PageHeader } from "@/components/PageHeader";

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
      <div>
        <PageHeader title="Dashboard" meta="Netflix users sample dataset" />
        <div className="p-6">
          <div className="flex max-w-3xl items-start gap-3 border border-[var(--border)] p-4 text-sm" style={{ background: "var(--critical-wash)" }}>
            <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">✕</span>
            <p className="text-[var(--text-primary)]">
              <span className="font-medium">Could not load dashboard data.</span> {anyError.message}. Make
              sure you&apos;ve run the aggregate views in <code className="bg-[var(--surface)] px-1 py-0.5 font-mono">supabase/schema.sql</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const stats = overview.data!;

  return (
    <div className="viz-root">
      <PageHeader
        title="Business overview"
        meta={`Sample dataset · ${compact(stats.total_users)} users · ${stats.country_count} countries`}
      />

      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-2 border border-[var(--viz-border)] bg-[var(--viz-surface)] sm:grid-cols-4">
          <StatTile label="Total users" value={compact(stats.total_users)} />
          <StatTile label="Avg watch time" value={`${Number(stats.avg_watch_time_hours).toFixed(1)}h`} />
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

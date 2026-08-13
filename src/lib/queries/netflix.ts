import type {
  SupabaseTyped,
  NetflixUser,
  NetflixOverview,
  NetflixCountryStats,
  NetflixGenreStats,
  NetflixSubscriptionStats,
} from "./types";

const PAGE_SIZE = 25;

/** Paginate netflix_users with optional search. Returns data and total count. */
export async function getNetflixUsers(
  supabase: SupabaseTyped,
  options: {
    page: number;
    search?: string;
  },
): Promise<{
  data: NetflixUser[];
  count: number | null;
  error: Error | null;
}> {
  const { page, search = "" } = options;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("netflix_users")
    .select(
      "user_id, name, age, country, subscription_type, watch_time_hours, favorite_genre, last_login",
      { count: "exact" },
    )
    .order("user_id", { ascending: true })
    .range(from, to);

  // If search is provided, escape it and apply as OR filter across multiple fields.
  // PostgREST filter syntax requires backslash escaping of special chars: \ " %
  if (search.trim()) {
    const escaped = search
      .trim()
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/%/g, "\\%");

    query = query.or(
      `name.ilike.%${escaped}%,country.ilike.%${escaped}%,favorite_genre.ilike.%${escaped}%`,
    );
  }

  const { data, count, error } = await query;

  return {
    data: data ?? [],
    count,
    error: error ? new Error(error.message) : null,
  };
}

/** Get aggregate overview stats from netflix_overview view. */
export async function getNetflixOverview(
  supabase: SupabaseTyped,
): Promise<{
  data: NetflixOverview | null;
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from("netflix_overview")
    .select("*")
    .single();

  return {
    data: data ?? null,
    error: error ? new Error(error.message) : null,
  };
}

/** Get country-level stats from netflix_country_stats view. */
export async function getNetflixCountryStats(
  supabase: SupabaseTyped,
): Promise<{
  data: NetflixCountryStats[];
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from("netflix_country_stats")
    .select("*");

  return {
    data: data ?? [],
    error: error ? new Error(error.message) : null,
  };
}

/** Get genre-level stats from netflix_genre_stats view. */
export async function getNetflixGenreStats(
  supabase: SupabaseTyped,
): Promise<{
  data: NetflixGenreStats[];
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from("netflix_genre_stats")
    .select("*");

  return {
    data: data ?? [],
    error: error ? new Error(error.message) : null,
  };
}

/** Get subscription tier stats from netflix_subscription_stats view. */
export async function getNetflixSubscriptionStats(
  supabase: SupabaseTyped,
): Promise<{
  data: NetflixSubscriptionStats[];
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from("netflix_subscription_stats")
    .select("*");

  return {
    data: data ?? [],
    error: error ? new Error(error.message) : null,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type SupabaseTyped = SupabaseClient<Database>;

/** Typed row from netflix_users */
export type NetflixUser = Database["public"]["Tables"]["netflix_users"]["Row"];

/** Typed row from files */
export type FileRecord = Database["public"]["Tables"]["files"]["Row"];

/** Result from netflix_overview view */
export type NetflixOverview =
  Database["public"]["Views"]["netflix_overview"]["Row"];

/** Result from netflix_country_stats view */
export type NetflixCountryStats =
  Database["public"]["Views"]["netflix_country_stats"]["Row"];

/** Result from netflix_genre_stats view */
export type NetflixGenreStats =
  Database["public"]["Views"]["netflix_genre_stats"]["Row"];

/** Result from netflix_subscription_stats view */
export type NetflixSubscriptionStats =
  Database["public"]["Views"]["netflix_subscription_stats"]["Row"];
